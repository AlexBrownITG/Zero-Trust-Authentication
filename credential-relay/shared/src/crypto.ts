import * as crypto from 'node:crypto';
import { ENCRYPTION_ALGORITHM, ENCRYPTION_IV_LENGTH, ENCRYPTION_KEY_LENGTH } from './constants';

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  authTag: string;
}

function deriveKey(masterKey: string): Buffer {
  return crypto.scryptSync(masterKey, 'credential-relay-salt', ENCRYPTION_KEY_LENGTH);
}

export function encrypt(plaintext: string, masterKey: string): EncryptedData {
  const key = deriveKey(masterKey);
  const iv = crypto.randomBytes(ENCRYPTION_IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    ciphertext,
    iv: iv.toString('hex'),
    authTag,
  };
}

export function decrypt(data: EncryptedData, masterKey: string): string {
  const key = deriveKey(masterKey);
  const iv = Buffer.from(data.iv, 'hex');
  const authTag = Buffer.from(data.authTag, 'hex');
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(data.ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}

export function generateId(): string {
  return crypto.randomUUID();
}
