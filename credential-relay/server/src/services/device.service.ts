import { Device, DeviceRegistration, DeviceStatus, generateId } from '@credential-relay/shared';
import { getDb } from '../db/database';
import { writeAuditLog } from './audit.service';

interface DeviceRow {
  id: string;
  mac_address: string;
  hostname: string;
  device_alias: string | null;
  cert_fingerprint: string | null;
  registered_at: string;
  last_seen: string;
  status: string;
}

function rowToDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    macAddress: row.mac_address,
    hostname: row.hostname,
    deviceAlias: row.device_alias || undefined,
    certFingerprint: row.cert_fingerprint || undefined,
    registeredAt: row.registered_at,
    lastSeen: row.last_seen,
    status: row.status as DeviceStatus,
  };
}

export function registerDevice(data: DeviceRegistration): Device {
  const db = getDb();
  const now = new Date().toISOString();

  // Check for existing device by MAC
  const existing = db.prepare('SELECT * FROM devices WHERE mac_address = ?').get(data.macAddress) as DeviceRow | undefined;
  if (existing) {
    // Update last seen and re-activate
    db.prepare('UPDATE devices SET hostname = ?, device_alias = ?, last_seen = ?, status = ? WHERE id = ?')
      .run(data.hostname, data.deviceAlias || null, now, 'active', existing.id);

    writeAuditLog({
      eventType: 'device_updated',
      deviceId: existing.id,
      metadata: { hostname: data.hostname, action: 're-registered' },
    });

    return rowToDevice({ ...existing, hostname: data.hostname, device_alias: data.deviceAlias || null, last_seen: now, status: 'active' });
  }

  const id = generateId();
  db.prepare(`
    INSERT INTO devices (id, mac_address, hostname, device_alias, registered_at, last_seen, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.macAddress, data.hostname, data.deviceAlias || null, now, now, 'active');

  writeAuditLog({
    eventType: 'device_registered',
    deviceId: id,
    metadata: { hostname: data.hostname, macAddress: data.macAddress },
  });

  return {
    id,
    macAddress: data.macAddress,
    hostname: data.hostname,
    deviceAlias: data.deviceAlias,
    registeredAt: now,
    lastSeen: now,
    status: 'active',
  };
}

export function listDevices(): Device[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM devices ORDER BY registered_at DESC').all() as DeviceRow[];
  return rows.map(rowToDevice);
}

export function getDeviceById(id: string): Device | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceRow | undefined;
  return row ? rowToDevice(row) : null;
}

export function updateDeviceLastSeen(id: string): void {
  const db = getDb();
  db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(new Date().toISOString(), id);
}
