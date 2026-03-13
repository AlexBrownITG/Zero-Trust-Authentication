import {
  Credential,
  CredentialMetadata,
  CreateCredential,
  UpdateCredential,
  encrypt,
  generateId,
} from '@credential-relay/shared';
import { getDb } from '../db/database';
import { config } from '../config';
import { writeAuditLog } from './audit.service';

interface CredentialRow {
  id: string;
  service_name: string;
  username: string;
  encrypted_password: string;
  iv: string;
  auth_tag: string;
  created_at: string;
  updated_at: string;
}

function rowToCredential(row: CredentialRow): Credential {
  return {
    id: row.id,
    serviceName: row.service_name,
    username: row.username,
    encryptedPassword: row.encrypted_password,
    iv: row.iv,
    authTag: row.auth_tag,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMetadata(row: CredentialRow): CredentialMetadata {
  return {
    id: row.id,
    serviceName: row.service_name,
    username: row.username,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createCredential(data: CreateCredential): CredentialMetadata {
  const db = getDb();
  const id = generateId();
  const now = new Date().toISOString();

  const encrypted = encrypt(data.password, config.vaultMasterKey);

  db.prepare(`
    INSERT INTO credentials (id, service_name, username, encrypted_password, iv, auth_tag, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.serviceName, data.username, encrypted.ciphertext, encrypted.iv, encrypted.authTag, now, now);

  writeAuditLog({
    eventType: 'credential.created',
    credentialId: id,
    details: `Credential created for ${data.serviceName} (${data.username})`,
  });

  return { id, serviceName: data.serviceName, username: data.username, createdAt: now, updatedAt: now };
}

export function updateCredential(id: string, data: UpdateCredential): CredentialMetadata | null {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM credentials WHERE id = ?').get(id) as CredentialRow | undefined;
  if (!existing) return null;

  const now = new Date().toISOString();
  const serviceName = data.serviceName || existing.service_name;
  const username = data.username || existing.username;

  let encryptedPassword = existing.encrypted_password;
  let iv = existing.iv;
  let authTag = existing.auth_tag;

  if (data.password) {
    const encrypted = encrypt(data.password, config.vaultMasterKey);
    encryptedPassword = encrypted.ciphertext;
    iv = encrypted.iv;
    authTag = encrypted.authTag;
  }

  db.prepare(`
    UPDATE credentials SET service_name = ?, username = ?, encrypted_password = ?, iv = ?, auth_tag = ?, updated_at = ?
    WHERE id = ?
  `).run(serviceName, username, encryptedPassword, iv, authTag, now, id);

  writeAuditLog({
    eventType: 'credential.updated',
    credentialId: id,
    details: `Credential updated for ${serviceName}`,
  });

  return { id, serviceName, username, createdAt: existing.created_at, updatedAt: now };
}

export function listCredentials(): CredentialMetadata[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM credentials ORDER BY created_at DESC').all() as CredentialRow[];
  return rows.map(rowToMetadata);
}

export function getCredentialById(id: string): Credential | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM credentials WHERE id = ?').get(id) as CredentialRow | undefined;
  return row ? rowToCredential(row) : null;
}
