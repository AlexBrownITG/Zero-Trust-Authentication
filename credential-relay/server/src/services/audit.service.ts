import { AuditEventType, AuditEntry, generateId } from '@credential-relay/shared';
import { getDb } from '../db/database';
import { logger } from '../logger';

export interface AuditParams {
  eventType: AuditEventType;
  requestId?: string;
  deviceId?: string;
  adminId?: string;
  metadata?: Record<string, unknown>;
}

export function writeAuditLog(params: AuditParams): AuditEntry {
  const entry: AuditEntry = {
    id: generateId(),
    eventType: params.eventType,
    requestId: params.requestId,
    deviceId: params.deviceId,
    adminId: params.adminId,
    metadata: params.metadata || {},
    timestamp: new Date().toISOString(),
  };

  const db = getDb();
  db.prepare(`
    INSERT INTO audit_log (id, event_type, request_id, device_id, admin_id, metadata, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id,
    entry.eventType,
    entry.requestId || null,
    entry.deviceId || null,
    entry.adminId || null,
    JSON.stringify(entry.metadata),
    entry.timestamp,
  );

  logger.info({ eventType: entry.eventType, requestId: entry.requestId }, 'Audit log entry written');
  return entry;
}

export function queryAuditLog(filters: { deviceId?: string; eventType?: string; limit?: number }): AuditEntry[] {
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
    SELECT id, event_type, request_id, device_id, admin_id, metadata, timestamp
    FROM audit_log ${where}
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(...params, limit) as Array<{
    id: string;
    event_type: string;
    request_id: string | null;
    device_id: string | null;
    admin_id: string | null;
    metadata: string;
    timestamp: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type as AuditEventType,
    requestId: row.request_id || undefined,
    deviceId: row.device_id || undefined,
    adminId: row.admin_id || undefined,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    timestamp: row.timestamp,
  }));
}
