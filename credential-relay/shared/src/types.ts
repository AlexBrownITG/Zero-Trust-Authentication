// ── Device ──────────────────────────────────────────────────────────────────

export interface Device {
  id: string;
  macAddress: string;
  hostname: string;
  deviceAlias?: string;
  certFingerprint?: string;       // Phase 6 — not used in MVP
  registeredAt: string;           // ISO 8601
  lastSeen: string;
  status: DeviceStatus;
}

export type DeviceStatus = 'active' | 'revoked';

export interface DeviceRegistration {
  macAddress: string;
  hostname: string;
  deviceAlias?: string;
}

// ── Credential (StoredCredential in plan.md) ────────────────────────────────

export interface StoredCredential {
  id: string;
  accountEmail: string;
  encryptedPassword: string;      // AES-256-GCM ciphertext
  iv: string;                     // Initialization vector
  authTag: string;                // GCM auth tag
  targetDomain: string;           // e.g. "accounts.google.com"
  updatedAt: string;
}

export interface CredentialMetadata {
  id: string;
  accountEmail: string;
  targetDomain: string;
  updatedAt: string;
}

export interface CreateCredential {
  accountEmail: string;
  targetDomain: string;
  password: string;
}

export interface UpdateCredential {
  accountEmail?: string;
  targetDomain?: string;
  password?: string;
}

// ── Credential Request ──────────────────────────────────────────────────────

export interface CredentialRequest {
  id: string;
  deviceId: string;
  credentialId: string;           // Links to StoredCredential
  userMac: string;                // MAC of requesting device (captured at request time)
  siteUrl: string;                // URL where credential is needed
  hostname: string;               // Device hostname at request time
  status: RequestStatus;
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;            // Admin who approved/rejected
  expiresAt: string;
}

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'relayed' | 'completed' | 'expired';

export interface CreateCredentialRequest {
  deviceId: string;
  credentialId: string;
  siteUrl: string;
}

export interface ResolveCredentialRequest {
  action: 'approve' | 'reject';
  resolvedBy: string;
}

// ── Audit Log ───────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  eventType: AuditEventType;
  requestId?: string;
  deviceId?: string;
  adminId?: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export type AuditEventType =
  | 'request_created'
  | 'request_approved'
  | 'request_rejected'
  | 'credential_relayed'
  | 'injection_confirmed'
  | 'request_expired'
  | 'device_registered'
  | 'device_updated'
  | 'credential_created'
  | 'credential_updated'
  | 'agent_connected'
  | 'agent_disconnected';

// ── WebSocket Messages ──────────────────────────────────────────────────────

export type WsMessageType =
  | 'new_request'
  | 'request_resolved'
  | 'credential_payload'
  | 'agent_status'
  | 'error';

export interface WsMessage {
  type: WsMessageType;
  payload: unknown;
  timestamp: string;
}

export interface CredentialPayload {
  requestId: string;
  credentialId: string;
  accountEmail: string;
  targetDomain: string;
  encryptedPassword: string;
  iv: string;
  authTag: string;
}

// ── API Error ───────────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}
