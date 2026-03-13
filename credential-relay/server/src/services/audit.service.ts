import { AuditEventType, AuditLogEntry, generateId } from '@credential-relay/shared';
import { getDb } from '../db/database';
import { logger } from '../logger';

export interface AuditParams {
  eventType: AuditEventType;
  deviceId?: string;
  credentialId?: string;
  requestId?: string;
  actor?: string;
  details?: string;
}

export function writeAuditLog(params: AuditParams): AuditLogEntry {
  const entry: AuditLogEntry = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    eventType: params.eventType,
    deviceId: params.deviceId,
    credentialId: params.credentialId,
    requestId: params.requestId,
    actor: params.actor,
    details: params.details,
  };

  const db = getDb();
  db.prepare(`
    INSERT INTO audit_log (id, timestamp, event_type, device_id, credential_id, request_id, actor, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id,
    entry.timestamp,
    entry.eventType,
    entry.deviceId || null,
    entry.credentialId || null,
    entry.requestId || null,
    entry.actor || null,
    entry.details || null,
  );

  logger.info({ eventType: entry.eventType, requestId: entry.requestId }, 'Audit log entry written');
  return entry;
}

export function queryAuditLog(filters: { deviceId?: string; eventType?: string; limit?: number }): AuditLogEntry[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.deviceId) {
    conditions.push('device_id = ?');
    params.push(filters.deviceId);
  }
  if (filters.eventType) {
    conditions.push('event_type = ?');
    params.push(filters.eventType);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || 100;

  const rows = db.prepare(`
    SELECT id, timestamp, event_type, device_id, credential_id, request_id, actor, details
    FROM audit_log ${where}
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(...params, limit) as Array<{
    id: string;
    timestamp: string;
    event_type: string;
    device_id: string | null;
    credential_id: string | null;
    request_id: string | null;
    actor: string | null;
    details: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    eventType: row.event_type as AuditEventType,
    deviceId: row.device_id || undefined,
    credentialId: row.credential_id || undefined,
    requestId: row.request_id || undefined,
    actor: row.actor || undefined,
    details: row.details || undefined,
  }));
}
