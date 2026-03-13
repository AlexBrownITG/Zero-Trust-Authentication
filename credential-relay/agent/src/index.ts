import { collectDeviceIdentity } from './identity';
import { registerWithServer } from './registration';
import { AgentWsClient } from './ws-client';
import { CredentialStore } from './credential-store';
import { IpcServer } from './ipc-server';
import { logger } from './logger';

function parseArgs(): { deviceAlias?: string } {
  const args = process.argv.slice(2);
  let deviceAlias: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--device-alias' && args[i + 1]) {
      deviceAlias = args[i + 1];
      i++;
    }
  }

  return { deviceAlias };
}

async function main(): Promise<void> {
  const { deviceAlias } = parseArgs();
  const masterKey = process.env.VAULT_MASTER_KEY;

  if (!masterKey) {
    logger.fatal('VAULT_MASTER_KEY environment variable is required');
    process.exit(1);
  }

  // 1. Collect device identity
  const identity = collectDeviceIdentity(deviceAlias);

  // 2. Register with server
  let deviceId: string;
  try {
    deviceId = await registerWithServer(identity);
  } catch (err) {
    logger.fatal({ err }, 'Failed to register with server');
    process.exit(1);
  }

  // 3. Set up credential store + IPC server
  const store = new CredentialStore();
  const ipc = new IpcServer(store);
  ipc.start();

  // 4. Connect to server WebSocket
  const wsClient = new AgentWsClient(deviceId, (payload) => {
    store.store(payload, masterKey);
  });
  wsClient.connect();

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down agent...');
    wsClient.destroy();
    ipc.destroy();
    store.destroy();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info({ deviceId }, 'Agent running — waiting for credential payloads');
}

main().catch((err) => {
  logger.fatal({ err }, 'Agent crashed');
  process.exit(1);
});
