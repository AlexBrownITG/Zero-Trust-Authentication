import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createApp } from '../app';
import { initDb, closeDb, getDb } from '../db/database';
import path from 'node:path';
import fs from 'node:fs';

// Set env vars before config is loaded
process.env.VAULT_MASTER_KEY = 'test-vault-key-for-testing-only-32ch';
process.env.ADMIN_PASSWORD = 'test-admin';
process.env.JWT_SECRET = 'test-jwt-secret';

const TEST_DB_PATH = path.join(__dirname, '../../test-data/test.db');

let server: http.Server;
let baseUrl: string;

function api(method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(url, { method, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode!, data: JSON.parse(data) });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

beforeAll(async () => {
  // Clean up any previous test db
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);

  initDb(TEST_DB_PATH);
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://localhost:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDb();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const dir = path.dirname(TEST_DB_PATH);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Health', () => {
  it('GET /api/health returns ok', async () => {
    const res = await api('GET', '/api/health');
    expect(res.status).toBe(200);
    expect((res.data as { status: string }).status).toBe('ok');
  });
});

describe('Devices API', () => {
  let deviceId: string;

  it('POST /api/devices/register creates a device', async () => {
    const res = await api('POST', '/api/devices/register', {
      macAddress: 'AA:BB:CC:DD:EE:FF',
      hostname: 'test-host',
      alias: 'dev-machine',
    });
    expect(res.status).toBe(201);
    const data = res.data as { id: string; macAddress: string; hostname: string; status: string };
    expect(data.id).toBeTruthy();
    expect(data.macAddress).toBe('AA:BB:CC:DD:EE:FF');
    expect(data.status).toBe('active');
    deviceId = data.id;
  });

  it('POST /api/devices/register rejects invalid body', async () => {
    const res = await api('POST', '/api/devices/register', {});
    expect(res.status).toBe(400);
    expect((res.data as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/devices/register re-registers existing MAC', async () => {
    const res = await api('POST', '/api/devices/register', {
      macAddress: 'AA:BB:CC:DD:EE:FF',
      hostname: 'updated-host',
    });
    expect(res.status).toBe(201);
    const data = res.data as { id: string; hostname: string };
    expect(data.id).toBe(deviceId);
    expect(data.hostname).toBe('updated-host');
  });

  it('GET /api/devices lists devices', async () => {
    const res = await api('GET', '/api/devices');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
    expect((res.data as unknown[]).length).toBeGreaterThanOrEqual(1);
  });
});

describe('Credentials API', () => {
  let credentialId: string;

  it('POST /api/credentials creates a credential', async () => {
    const res = await api('POST', '/api/credentials', {
      serviceName: 'Google',
      username: 'user@test.com',
      password: 'super-secret-123',
    });
    expect(res.status).toBe(201);
    const data = res.data as { id: string; serviceName: string; username: string };
    expect(data.id).toBeTruthy();
    expect(data.serviceName).toBe('Google');
    // Password should NOT be in the response
    expect((data as Record<string, unknown>).password).toBeUndefined();
    expect((data as Record<string, unknown>).encryptedPassword).toBeUndefined();
    credentialId = data.id;
  });

  it('POST /api/credentials rejects missing fields', async () => {
    const res = await api('POST', '/api/credentials', { serviceName: 'X' });
    expect(res.status).toBe(400);
  });

  it('PUT /api/credentials/:id updates a credential', async () => {
    const res = await api('PUT', `/api/credentials/${credentialId}`, {
      username: 'updated@test.com',
    });
    expect(res.status).toBe(200);
    expect((res.data as { username: string }).username).toBe('updated@test.com');
  });

  it('PUT /api/credentials/:id returns 404 for missing credential', async () => {
    const res = await api('PUT', '/api/credentials/00000000-0000-0000-0000-000000000000', {
      username: 'nope',
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/credentials lists metadata only', async () => {
    const res = await api('GET', '/api/credentials');
    expect(res.status).toBe(200);
    const list = res.data as Array<Record<string, unknown>>;
    expect(list.length).toBeGreaterThanOrEqual(1);
    // Ensure no encrypted data leaks
    for (const item of list) {
      expect(item.encryptedPassword).toBeUndefined();
      expect(item.iv).toBeUndefined();
      expect(item.authTag).toBeUndefined();
      expect(item.password).toBeUndefined();
    }
  });
});

describe('Requests API', () => {
  let deviceId: string;
  let credentialId: string;
  let requestId: string;

  beforeAll(async () => {
    // Create a device and credential for request tests
    const devRes = await api('POST', '/api/devices/register', {
      macAddress: '11:22:33:44:55:66',
      hostname: 'req-test-host',
    });
    deviceId = (devRes.data as { id: string }).id;

    const credRes = await api('POST', '/api/credentials', {
      serviceName: 'Teams',
      username: 'req-user@test.com',
      password: 'req-password-123',
    });
    credentialId = (credRes.data as { id: string }).id;
  });

  it('POST /api/requests creates a request', async () => {
    const res = await api('POST', '/api/requests', { deviceId, credentialId });
    expect(res.status).toBe(201);
    const data = res.data as { id: string; status: string; deviceId: string; credentialId: string; expiresAt: string };
    expect(data.id).toBeTruthy();
    expect(data.status).toBe('pending');
    expect(data.deviceId).toBe(deviceId);
    expect(data.credentialId).toBe(credentialId);
    expect(data.expiresAt).toBeTruthy();
    requestId = data.id;
  });

  it('POST /api/requests rejects invalid device', async () => {
    const res = await api('POST', '/api/requests', {
      deviceId: '00000000-0000-0000-0000-000000000000',
      credentialId,
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/requests?status=pending lists pending requests', async () => {
    const res = await api('GET', '/api/requests?status=pending');
    expect(res.status).toBe(200);
    const list = res.data as Array<{ id: string }>;
    expect(list.some((r) => r.id === requestId)).toBe(true);
  });

  it('PATCH /api/requests/:id approves a request', async () => {
    const res = await api('PATCH', `/api/requests/${requestId}`, {
      action: 'approve',
      resolvedBy: 'admin-test',
    });
    expect(res.status).toBe(200);
    const data = res.data as { status: string; resolvedBy: string };
    expect(data.status).toBe('approved');
    expect(data.resolvedBy).toBe('admin-test');
  });

  it('PATCH /api/requests/:id rejects already-resolved request', async () => {
    const res = await api('PATCH', `/api/requests/${requestId}`, {
      action: 'reject',
      resolvedBy: 'admin-test',
    });
    expect(res.status).toBe(409);
  });

  it('POST + PATCH reject flow works', async () => {
    const createRes = await api('POST', '/api/requests', { deviceId, credentialId });
    const id = (createRes.data as { id: string }).id;

    const res = await api('PATCH', `/api/requests/${id}`, {
      action: 'reject',
      resolvedBy: 'admin-test',
    });
    expect(res.status).toBe(200);
    expect((res.data as { status: string }).status).toBe('rejected');
  });
});

describe('Audit API', () => {
  it('GET /api/audit returns audit entries', async () => {
    const res = await api('GET', '/api/audit');
    expect(res.status).toBe(200);
    const list = res.data as Array<{ eventType: string }>;
    expect(list.length).toBeGreaterThan(0);
    // Verify no plaintext credentials in audit
    for (const entry of list) {
      const str = JSON.stringify(entry);
      expect(str).not.toContain('super-secret-123');
      expect(str).not.toContain('req-password-123');
    }
  });

  it('GET /api/audit?deviceId=X filters by device', async () => {
    const devRes = await api('GET', '/api/devices');
    const firstDevice = (devRes.data as Array<{ id: string }>)[0];

    const res = await api('GET', `/api/audit?deviceId=${firstDevice.id}`);
    expect(res.status).toBe(200);
    const list = res.data as Array<{ deviceId?: string }>;
    for (const entry of list) {
      expect(entry.deviceId).toBe(firstDevice.id);
    }
  });
});
