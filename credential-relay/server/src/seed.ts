import 'dotenv/config';
import { config } from './config';
import { initDb, closeDb } from './db/database';
import { registerDevice } from './services/device.service';
import { createCredential } from './services/credential.service';
import { logger } from './logger';

// Initialize database
initDb(config.dbPath);

logger.info('Seeding database...');

// Register test device
const device = registerDevice({
  macAddress: '00:11:22:33:44:55',
  hostname: 'test-workstation',
  deviceAlias: 'test-device',
});
logger.info({ deviceId: device.id }, 'Test device registered');

// Create test credential
const credential = createCredential({
  accountEmail: 'employee@company.com',
  targetDomain: 'accounts.google.com',
  password: 'test-password-123',
});
logger.info({ credentialId: credential.id }, 'Test credential created');

logger.info('Seed complete!');
logger.info(`Device ID: ${device.id}`);
logger.info(`Credential ID: ${credential.id}`);

closeDb();
