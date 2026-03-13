import net from 'node:net';
import fs from 'node:fs';
import { IPC_SOCKET_PATH_UNIX, IPC_PIPE_PATH_WINDOWS } from '@credential-relay/shared';
import { CredentialStore } from './credential-store';
import { logger } from './logger';

const SOCKET_PATH = process.platform === 'win32' ? IPC_PIPE_PATH_WINDOWS : IPC_SOCKET_PATH_UNIX;

interface IpcRequest {
  action: 'consume' | 'list';
  requestId?: string;
}

interface IpcResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/**
 * IPC server that listens on a Unix socket (or Windows named pipe).
 * The browser extension's native messaging host connects here to
 * retrieve decrypted credentials.
 *
 * Protocol: newline-delimited JSON over the socket.
 *   Request:  { "action": "list" }
 *   Request:  { "action": "consume", "requestId": "<uuid>" }
 *   Response: { "ok": true, "data": ... } or { "ok": false, "error": "..." }
 */
export class IpcServer {
  private server: net.Server;
  private store: CredentialStore;

  constructor(store: CredentialStore) {
    this.store = store;
    this.server = net.createServer((socket) => this.handleConnection(socket));
  }

  start(): void {
    // Clean up stale socket file on Unix
    if (process.platform !== 'win32') {
      try {
        fs.unlinkSync(SOCKET_PATH);
      } catch {
        // Ignore if doesn't exist
      }
    }

    this.server.listen(SOCKET_PATH, () => {
      logger.info({ socketPath: SOCKET_PATH }, 'IPC server listening');
    });

    this.server.on('error', (err) => {
      logger.error({ err: err.message }, 'IPC server error');
    });
  }

  private handleConnection(socket: net.Socket): void {
    logger.debug('IPC client connected');

    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += chunk.toString();

      // Process complete newline-delimited messages
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);

        if (!line) continue;

        try {
          const request: IpcRequest = JSON.parse(line);
          const response = this.handleRequest(request);
          socket.write(JSON.stringify(response) + '\n');
        } catch {
          const errorResp: IpcResponse = { ok: false, error: 'Invalid JSON' };
          socket.write(JSON.stringify(errorResp) + '\n');
        }
      }
    });

    socket.on('error', (err) => {
      logger.debug({ err: err.message }, 'IPC client error');
    });
  }

  private handleRequest(request: IpcRequest): IpcResponse {
    switch (request.action) {
      case 'list': {
        const available = this.store.listAvailable();
        return { ok: true, data: available };
      }
      case 'consume': {
        if (!request.requestId) {
          return { ok: false, error: 'requestId is required' };
        }
        const credential = this.store.consume(request.requestId);
        if (!credential) {
          return { ok: false, error: 'Credential not found or already consumed' };
        }
        return { ok: true, data: credential };
      }
      default:
        return { ok: false, error: `Unknown action: ${request.action}` };
    }
  }

  destroy(): void {
    this.server.close();
    if (process.platform !== 'win32') {
      try {
        fs.unlinkSync(SOCKET_PATH);
      } catch {
        // Ignore
      }
    }
    logger.info('IPC server stopped');
  }
}
