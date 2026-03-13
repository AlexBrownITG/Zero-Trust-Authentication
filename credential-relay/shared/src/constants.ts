export const SERVER_PORT = 3000;
export const SERVER_HOST = 'localhost';
export const SERVER_URL = `http://${SERVER_HOST}:${SERVER_PORT}`;
export const WS_URL = `ws://${SERVER_HOST}:${SERVER_PORT}`;

export const API_PREFIX = '/api';

export const CREDENTIAL_REQUEST_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const CREDENTIAL_PLAINTEXT_TTL_MS = 60_000; // 60 seconds in agent RAM (increased for testing)

export const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
export const ENCRYPTION_IV_LENGTH = 12;
export const ENCRYPTION_KEY_LENGTH = 32;

export const WS_PATHS = {
  AGENT: '/ws/agent',
  ADMIN: '/ws/admin',
} as const;

export const KEYSTROKE_DELAY_MIN_MS = 10;
export const KEYSTROKE_DELAY_MAX_MS = 40;

export const IPC_SOCKET_PATH_UNIX = '/tmp/credential-relay.sock';
export const IPC_PIPE_PATH_WINDOWS = '\\\\.\\pipe\\credential-relay';
