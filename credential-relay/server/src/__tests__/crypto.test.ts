import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, generateId } from '@credential-relay/shared';

describe('Crypto', () => {
  const masterKey = 'test-master-key-for-testing-only-32ch';

  it('encrypts and decrypts a password correctly', () => {
    const plaintext = 'my-secret-password-123!@#';
    const encrypted = encrypt(plaintext, masterKey);

    expect(encrypted.ciphertext).toBeTruthy();
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.authTag).toBeTruthy();
    expect(encrypted.ciphertext).not.toBe(plaintext);

    const decrypted = decrypt(encrypted, masterKey);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const plaintext = 'same-password';
    const a = encrypt(plaintext, masterKey);
    const b = encrypt(plaintext, masterKey);

    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it('fails to decrypt with wrong master key', () => {
    const encrypted = encrypt('secret', masterKey);
    expect(() => decrypt(encrypted, 'wrong-key-that-is-totally-different!')).toThrow();
  });

  it('fails to decrypt with tampered auth tag', () => {
    const encrypted = encrypt('secret', masterKey);
    encrypted.authTag = 'deadbeef'.repeat(4);
    expect(() => decrypt(encrypted, masterKey)).toThrow();
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});
