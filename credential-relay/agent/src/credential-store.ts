import { CredentialPayload, CREDENTIAL_PLAINTEXT_TTL_MS, decrypt } from '@credential-relay/shared';
import { logger } from './logger';

interface StoredPlaintext {
  requestId: string;
  credentialId: string;
  accountEmail: string;
  targetDomain: string;
  password: string;
  storedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Holds decrypted credentials in memory with automatic TTL cleanup.
 * Extension connects via IPC to retrieve and consume credentials.
 */
export class CredentialStore {
  private credentials = new Map<string, StoredPlaintext>();

  /**
   * Decrypts and stores a credential payload. Automatically purges after TTL.
   */
  store(payload: CredentialPayload, masterKey: string): void {
    const plaintext = decrypt(
      {
        ciphertext: payload.encryptedPassword,
        iv: payload.iv,
        authTag: payload.authTag,
      },
      masterKey
    );

    // Clear any existing entry for this request
    this.remove(payload.requestId);

    const timer = setTimeout(() => {
      this.remove(payload.requestId);
      logger.info({ requestId: payload.requestId }, 'Credential expired from memory');
    }, CREDENTIAL_PLAINTEXT_TTL_MS);

    this.credentials.set(payload.requestId, {
      requestId: payload.requestId,
      credentialId: payload.credentialId,
      accountEmail: payload.accountEmail,
      targetDomain: payload.targetDomain,
      password: plaintext,
      storedAt: Date.now(),
      timer,
    });

    logger.info(
      { requestId: payload.requestId, targetDomain: payload.targetDomain, ttlMs: CREDENTIAL_PLAINTEXT_TTL_MS },
      'Credential decrypted and stored in memory'
    );
  }

  /**
   * Retrieves and removes a credential from the store (one-time read).
   * Returns null if not found or already expired.
   */
  consume(requestId: string): { accountEmail: string; targetDomain: string; password: string } | null {
    const entry = this.credentials.get(requestId);
    if (!entry) return null;

    this.remove(requestId);

    logger.info({ requestId }, 'Credential consumed and removed from memory');
    return {
      accountEmail: entry.accountEmail,
      targetDomain: entry.targetDomain,
      password: entry.password,
    };
  }

  /**
   * Lists available (not yet consumed) credential request IDs.
   */
  listAvailable(): Array<{ requestId: string; accountEmail: string; targetDomain: string }> {
    return Array.from(this.credentials.values()).map((entry) => ({
      requestId: entry.requestId,
      accountEmail: entry.accountEmail,
      targetDomain: entry.targetDomain,
    }));
  }

  private remove(requestId: string): void {
    const entry = this.credentials.get(requestId);
    if (entry) {
      clearTimeout(entry.timer);
      // Overwrite sensitive data before deleting
      entry.password = '';
      this.credentials.delete(requestId);
    }
  }

  destroy(): void {
    for (const [requestId] of this.credentials) {
      this.remove(requestId);
    }
    logger.info('Credential store cleared');
  }
}
