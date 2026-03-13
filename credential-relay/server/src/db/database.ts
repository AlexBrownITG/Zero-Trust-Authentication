import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../logger';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function initDb(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables(db);
  logger.info({ dbPath }, 'Database initialized');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
  }
}

function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      mac_address TEXT NOT NULL,
      hostname TEXT NOT NULL,
      device_alias TEXT,
      cert_fingerprint TEXT,
      registered_at TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_mac ON devices(mac_address);

    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      account_email TEXT NOT NULL,
      encrypted_password TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      target_domain TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS credential_requests (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      credential_id TEXT NOT NULL,
      user_mac TEXT NOT NULL,
      site_url TEXT NOT NULL,
      hostname TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at TEXT NOT NULL,
      resolved_at TEXT,
      resolved_by TEXT,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (device_id) REFERENCES devices(id),
      FOREIGN KEY (credential_id) REFERENCES credentials(id)
    );

    CREATE INDEX IF NOT EXISTS idx_requests_status ON credential_requests(status);
    CREATE INDEX IF NOT EXISTS idx_requests_device ON credential_requests(device_id);

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      request_id TEXT,
      device_id TEXT,
      admin_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_device ON audit_log(device_id);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
  `);
}
