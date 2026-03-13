import WebSocket from 'ws';
import { WS_URL, WS_PATHS, WsMessage, CredentialPayload } from '@credential-relay/shared';
import { logger } from './logger';

const RECONNECT_INTERVAL_MS = 3_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

export type CredentialHandler = (payload: CredentialPayload) => void;

export class AgentWsClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private onCredential: CredentialHandler;
  private deviceId: string;

  constructor(deviceId: string, onCredential: CredentialHandler) {
    this.deviceId = deviceId;
    this.onCredential = onCredential;
  }

  connect(): void {
    if (this.destroyed) return;

    const url = `${WS_URL}${WS_PATHS.AGENT}?deviceId=${this.deviceId}`;
    logger.info({ url }, 'Connecting to server WebSocket');

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      logger.info('WebSocket connected');
      this.startHeartbeat();
    });

    this.ws.on('message', (data) => {
      try {
        const message: WsMessage = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (err) {
        logger.error({ err }, 'Failed to parse WebSocket message');
      }
    });

    this.ws.on('close', (code, reason) => {
      logger.warn({ code, reason: reason.toString() }, 'WebSocket disconnected');
      this.cleanup();
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      logger.error({ err: err.message }, 'WebSocket error');
    });
  }

  private handleMessage(message: WsMessage): void {
    logger.debug({ type: message.type }, 'Received message');

    switch (message.type) {
      case 'credential_payload': {
        const payload = message.payload as CredentialPayload;
        logger.info(
          { requestId: payload.requestId, targetDomain: payload.targetDomain },
          'Credential payload received'
        );

        // Acknowledge receipt — server updates status to 'relayed'
        this.send({
          type: 'credential_payload',
          payload: { requestId: payload.requestId },
          timestamp: new Date().toISOString(),
        });

        this.onCredential(payload);
        break;
      }
      case 'error': {
        logger.error({ payload: message.payload }, 'Server sent error');
        break;
      }
      default:
        logger.debug({ type: message.type }, 'Unhandled message type');
    }
  }

  private send(message: WsMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    logger.info({ delayMs: RECONNECT_INTERVAL_MS }, 'Scheduling reconnect');
    this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_INTERVAL_MS);
  }

  private cleanup(): void {
    this.stopHeartbeat();
    this.ws = null;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    logger.info('WebSocket client destroyed');
  }
}
