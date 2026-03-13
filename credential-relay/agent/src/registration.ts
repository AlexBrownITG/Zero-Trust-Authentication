import { SERVER_URL, API_PREFIX, DeviceRegistration, Device } from '@credential-relay/shared';
import { logger } from './logger';

const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Registers this device with the credential relay server.
 * Retries on connection failure (server may still be starting up).
 * Returns the assigned device ID on success.
 */
export async function registerWithServer(identity: DeviceRegistration): Promise<string> {
  const url = `${SERVER_URL}${API_PREFIX}/devices/register`;

  logger.info({ url, hostname: identity.hostname }, 'Registering with server');

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(identity),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Registration failed (${response.status}): ${body}`);
      }

      const device = (await response.json()) as Device;

      logger.info({ deviceId: device.id, status: device.status }, 'Device registered successfully');
      return device.id;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const isConnectionError = message.includes('ECONNREFUSED') || message.includes('fetch failed');

      if (isConnectionError && attempt < MAX_RETRIES) {
        logger.warn({ attempt, maxRetries: MAX_RETRIES }, 'Server not ready, retrying...');
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      throw err;
    }
  }

  throw new Error('Unreachable');
}
