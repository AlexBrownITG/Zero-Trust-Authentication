import { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'node:http';
import { URL } from 'node:url';
import { WsMessage, WS_PATHS } from '@credential-relay/shared';
import { logger } from '../logger';
import { writeAuditLog } from '../services/audit.service';
import { updateDeviceLastSeen } from '../services/device.service';
import { updateRequestStatus } from '../services/request.service';

const agentConnections = new Map<string, WebSocket>();
const adminConnections = new Set<WebSocket>();

export function setupWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const pathname = url.pathname;

    if (pathname === WS_PATHS.AGENT) {
      const deviceId = url.searchParams.get('deviceId');
      if (!deviceId) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        handleAgentConnection(ws, deviceId);
      });
    } else if (pathname === WS_PATHS.ADMIN) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        handleAdminConnection(ws);
      });
    } else {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
    }
  });
}

function handleAgentConnection(ws: WebSocket, deviceId: string): void {
  logger.info({ deviceId }, 'Agent connected');
  agentConnections.set(deviceId, ws);
  updateDeviceLastSeen(deviceId);

  writeAuditLog({
    eventType: 'agent_connected',
    deviceId,
    metadata: { deviceId },
  });

  // Notify admins of agent status
  broadcastToAdmins({
    type: 'agent_status',
    payload: { deviceId, status: 'connected' },
    timestamp: new Date().toISOString(),
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as WsMessage;
      handleAgentMessage(deviceId, msg);
    } catch (err) {
      logger.error({ err, deviceId }, 'Failed to parse agent message');
    }
  });

  ws.on('close', () => {
    logger.info({ deviceId }, 'Agent disconnected');
    agentConnections.delete(deviceId);

    writeAuditLog({
      eventType: 'agent_disconnected',
      deviceId,
      metadata: { deviceId },
    });

    broadcastToAdmins({
      type: 'agent_status',
      payload: { deviceId, status: 'disconnected' },
      timestamp: new Date().toISOString(),
    });
  });

  ws.on('error', (err) => {
    logger.error({ err, deviceId }, 'Agent WebSocket error');
  });
}

function handleAgentMessage(deviceId: string, msg: WsMessage): void {
  const payload = msg.payload as { requestId: string };
  switch (msg.type) {
    case 'credential_payload': {
      // Agent confirms relay — credential was delivered to extension via IPC
      updateRequestStatus(payload.requestId, 'relayed');
      broadcastToAdmins({
        type: 'request_resolved',
        payload: { requestId: payload.requestId, deviceId, status: 'relayed' },
        timestamp: new Date().toISOString(),
      });
      break;
    }
    case 'request_resolved': {
      // Agent confirms injection complete
      updateRequestStatus(payload.requestId, 'completed');
      broadcastToAdmins({
        type: 'request_resolved',
        payload: { requestId: payload.requestId, deviceId, status: 'completed' },
        timestamp: new Date().toISOString(),
      });
      break;
    }
    default:
      logger.warn({ type: msg.type, deviceId }, 'Unknown agent message type');
  }
}

function handleAdminConnection(ws: WebSocket): void {
  logger.info('Admin dashboard connected');
  adminConnections.add(ws);

  // Send current agent statuses
  const connectedAgents = Array.from(agentConnections.keys());
  ws.send(JSON.stringify({
    type: 'agent_status',
    payload: { connectedAgents },
    timestamp: new Date().toISOString(),
  }));

  ws.on('close', () => {
    logger.info('Admin dashboard disconnected');
    adminConnections.delete(ws);
  });

  ws.on('error', (err) => {
    logger.error({ err }, 'Admin WebSocket error');
  });
}

export function broadcastToAdmins(message: WsMessage): void {
  const data = JSON.stringify(message);
  for (const ws of adminConnections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

export function sendToAgent(deviceId: string, message: WsMessage): boolean {
  const ws = agentConnections.get(deviceId);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    logger.warn({ deviceId }, 'Agent not connected, cannot send message');
    return false;
  }
  ws.send(JSON.stringify(message));
  return true;
}

export function getConnectedAgentIds(): string[] {
  return Array.from(agentConnections.keys());
}
