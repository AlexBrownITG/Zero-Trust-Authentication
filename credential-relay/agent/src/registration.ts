import { SERVER_URL, API_PREFIX, DeviceRegistration, Device } from '@credential-relay/shared';
import { logger } from './logger';

/**
 * Registers this device with the credential relay server.
 * Returns the assigned device ID on success.
 */
export async function registerWithServer(identity: DeviceRegistration): Promise<string> {
  const url = `${SERVER_URL}${API_PREFIX}/devices/register`;

  logger.info({ url, hostname: identity.hostname }, 'Registering with server');

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
}
