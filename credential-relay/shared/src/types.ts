// ── Device ──────────────────────────────────────────────────────────────────

export interface Device {
  id: string;
  macAddress: string;
  hostname: string;
  alias?: string;
  registeredAt: string;
  lastSeenAt: string;
  status: DeviceStatus;
}

export type DeviceStatus = 'active' | 'inactive' | 'revoked';

export interface DeviceRegistration {
  macAddress: string;
  hostname: string;
  alias?: string;
}

// ── Credential ──────────────────────────────────────────────────────────────

export interface Credential {
  id: string;
  serviceName: string;
  username: string;
  encryptedPassword: string;
  iv: string;
  authTag: string;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialMetadata {
  id: string;
  serviceName: string;
  username: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCredential {
  serviceName: string;
  username: string;
  password: string;
}

export interface UpdateCredential {
  serviceName?: string;
  username?: string;
  password?: string;
}

// ── Credential Request ──────────────────────────────────────────────────────

export interface CredentialRequest {
  id: string;
  deviceId: string;
  credentialId: string;
  status: RequestStatus;
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  expiresAt: string;
}

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'relayed' | 'completed' | 'expired';

export interface CreateCredentialRequest {
  deviceId: string;
  credentialId: string;
}

export interface ResolveCredentialRequest {
  action: 'approve' | 'reject';
  resolvedBy: string;
}

// ── Audit Log ───────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  eventType: AuditEventType;
  deviceId?: string;
  credentialId?: string;
  requestId?: string;
  actor?: string;
  details?: string;
}

export type AuditEventType =
  | 'device.registered'
  | 'device.updated'
  | 'credential.created'
  | 'credential.updated'
  | 'request.created'
  | 'request.approved'
  | 'request.rejected'
  | 'request.relayed'
  | 'request.completed'
  | 'request.expired'
  | 'agent.connected'
  | 'agent.disconnected';

// ── WebSocket Messages ──────────────────────────────────────────────────────

export type WsMessageType =
  | 'request.new'
  | 'request.approved'
  | 'request.rejected'
  | 'request.relayed'
  | 'request.completed'
  | 'request.expired'
  | 'credential.payload'
  | 'agent.status'
  | 'error';

export interface WsMessage {
  type: WsMessageType;
  payload: unknown;
  timestamp: string;
}

export interface CredentialPayload {
  requestId: string;
  credentialId: string;
  serviceName: string;
  username: string;
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
