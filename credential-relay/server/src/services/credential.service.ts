import {
  StoredCredential,
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
  account_email: string;
  encrypted_password: string;
  iv: string;
  auth_tag: string;
  target_domain: string;
  updated_at: string;
}

function rowToCredential(row: CredentialRow): StoredCredential {
  return {
    id: row.id,
    accountEmail: row.account_email,
    encryptedPassword: row.encrypted_password,
    iv: row.iv,
    authTag: row.auth_tag,
    targetDomain: row.target_domain,
    updatedAt: row.updated_at,
  };
}

function rowToMetadata(row: CredentialRow): CredentialMetadata {
  return {
    id: row.id,
    accountEmail: row.account_email,
    targetDomain: row.target_domain,
    updatedAt: row.updated_at,
  };
}

export function createCredential(data: CreateCredential): CredentialMetadata {
  const db = getDb();
  const id = generateId();
  const now = new Date().toISOString();

  const encrypted = encrypt(data.password, config.vaultMasterKey);

  db.prepare(`
    INSERT INTO credentials (id, account_email, encrypted_password, iv, auth_tag, target_domain, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.accountEmail, encrypted.ciphertext, encrypted.iv, encrypted.authTag, data.targetDomain, now);

  writeAuditLog({
    eventType: 'credential_created',
    metadata: { accountEmail: data.accountEmail, targetDomain: data.targetDomain },
  });

  return { id, accountEmail: data.accountEmail, targetDomain: data.targetDomain, updatedAt: now };
}

export function updateCredential(id: string, data: UpdateCredential): CredentialMetadata | null {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM credentials WHERE id = ?').get(id) as CredentialRow | undefined;
  if (!existing) return null;

  const now = new Date().toISOString();
  const accountEmail = data.accountEmail || existing.account_email;
  const targetDomain = data.targetDomain || existing.target_domain;

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
    UPDATE credentials SET account_email = ?, encrypted_password = ?, iv = ?, auth_tag = ?, target_domain = ?, updated_at = ?
    WHERE id = ?
  `).run(accountEmail, encryptedPassword, iv, authTag, targetDomain, now, id);

  writeAuditLog({
    eventType: 'credential_updated',
    metadata: { accountEmail, targetDomain },
  });

  return { id, accountEmail, targetDomain, updatedAt: now };
}

export function listCredentials(): CredentialMetadata[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM credentials ORDER BY updated_at DESC').all() as CredentialRow[];
  return rows.map(rowToMetadata);
}

export function getCredentialById(id: string): StoredCredential | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM credentials WHERE id = ?').get(id) as CredentialRow | undefined;
  return row ? rowToCredential(row) : null;
}
