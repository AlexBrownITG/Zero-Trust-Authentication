import {
  CredentialRequest,
  CreateCredentialRequest,
  RequestStatus,
  AuditEventType,
  generateId,
  CREDENTIAL_REQUEST_TTL_MS,
} from '@credential-relay/shared';
import { getDb } from '../db/database';
import { getDeviceById } from './device.service';
import { writeAuditLog } from './audit.service';

interface RequestRow {
  id: string;
  device_id: string;
  credential_id: string;
  user_mac: string;
  site_url: string;
  hostname: string;
  status: string;
  requested_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  expires_at: string;
}

function rowToRequest(row: RequestRow): CredentialRequest {
  return {
    id: row.id,
    deviceId: row.device_id,
    credentialId: row.credential_id,
    userMac: row.user_mac,
    siteUrl: row.site_url,
    hostname: row.hostname,
    status: row.status as RequestStatus,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at || undefined,
    resolvedBy: row.resolved_by || undefined,
    expiresAt: row.expires_at,
  };
}

export function createRequest(data: CreateCredentialRequest): CredentialRequest {
  const db = getDb();
  const id = generateId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CREDENTIAL_REQUEST_TTL_MS);

  // Look up device to capture MAC and hostname at request time
  const device = getDeviceById(data.deviceId);
  const userMac = device?.macAddress || '';
  const hostname = device?.hostname || '';

  db.prepare(`
    INSERT INTO credential_requests (id, device_id, credential_id, user_mac, site_url, hostname, status, requested_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.deviceId, data.credentialId, userMac, data.siteUrl, hostname, 'pending', now.toISOString(), expiresAt.toISOString());

  writeAuditLog({
    eventType: 'request_created',
    deviceId: data.deviceId,
    requestId: id,
    metadata: { siteUrl: data.siteUrl, hostname },
  });

  return {
    id,
    deviceId: data.deviceId,
    credentialId: data.credentialId,
    userMac,
    siteUrl: data.siteUrl,
    hostname,
    status: 'pending',
    requestedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export function listRequests(status?: string): CredentialRequest[] {
  const db = getDb();
  let rows: RequestRow[];

  if (status) {
    rows = db.prepare('SELECT * FROM credential_requests WHERE status = ? ORDER BY requested_at DESC').all(status) as RequestRow[];
  } else {
    rows = db.prepare('SELECT * FROM credential_requests ORDER BY requested_at DESC').all() as RequestRow[];
  }

  return rows.map(rowToRequest);
}

export function getRequestById(id: string): CredentialRequest | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM credential_requests WHERE id = ?').get(id) as RequestRow | undefined;
  return row ? rowToRequest(row) : null;
}

export function resolveRequest(id: string, action: 'approve' | 'reject', resolvedBy: string): CredentialRequest | null {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM credential_requests WHERE id = ?').get(id) as RequestRow | undefined;
  if (!existing) return null;

  if (existing.status !== 'pending') {
    throw new Error(`Request is not pending (current status: ${existing.status})`);
  }

  // Check expiry
  if (new Date(existing.expires_at) < new Date()) {
    updateRequestStatus(id, 'expired');
    writeAuditLog({
      eventType: 'request_expired',
      requestId: id,
      deviceId: existing.device_id,
    });
    throw new Error('Request has expired');
  }

  const now = new Date().toISOString();
  const newStatus: RequestStatus = action === 'approve' ? 'approved' : 'rejected';

  db.prepare('UPDATE credential_requests SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?')
    .run(newStatus, now, resolvedBy, id);

  writeAuditLog({
    eventType: action === 'approve' ? 'request_approved' : 'request_rejected',
    requestId: id,
    deviceId: existing.device_id,
    adminId: resolvedBy,
    metadata: { action, siteUrl: existing.site_url },
  });

  return {
    ...rowToRequest(existing),
    status: newStatus,
    resolvedAt: now,
    resolvedBy,
  };
}

export function updateRequestStatus(id: string, status: RequestStatus): void {
  const db = getDb();
  db.prepare('UPDATE credential_requests SET status = ? WHERE id = ?').run(status, id);

  // Map status to audit event type
  const eventMap: Partial<Record<RequestStatus, AuditEventType>> = {
    relayed: 'credential_relayed',
    completed: 'injection_confirmed',
    expired: 'request_expired',
  };
  const eventType = eventMap[status];
  if (eventType) {
    writeAuditLog({ eventType, requestId: id });
  }
}

export function expireOldRequests(): number {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.prepare(
    "UPDATE credential_requests SET status = 'expired' WHERE status = 'pending' AND expires_at < ?"
  ).run(now);
  return result.changes;
}
