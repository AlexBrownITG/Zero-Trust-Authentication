import os from 'node:os';
import { DeviceRegistration } from '@credential-relay/shared';
import { logger } from './logger';

/**
 * Finds the first non-internal network interface MAC address.
 * Falls back to '00:00:00:00:00:00' if none found.
 */
function getMacAddress(): string {
  const interfaces = os.networkInterfaces();

  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (!entry.internal && entry.mac && entry.mac !== '00:00:00:00:00:00') {
        logger.debug({ interface: name, mac: entry.mac }, 'Found MAC address');
        return entry.mac;
      }
    }
  }

  logger.warn('No external network interface found, using fallback MAC');
  return '00:00:00:00:00:00';
}

/**
 * Collects device identity information for server registration.
 */
export function collectDeviceIdentity(deviceAlias?: string): DeviceRegistration {
  const macAddress = getMacAddress();
  const hostname = os.hostname();

  const identity: DeviceRegistration = {
    macAddress,
    hostname,
    ...(deviceAlias && { deviceAlias }),
  };

  logger.info({ macAddress, hostname, deviceAlias }, 'Device identity collected');
  return identity;
}
