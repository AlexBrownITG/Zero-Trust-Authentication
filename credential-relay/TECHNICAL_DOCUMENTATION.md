# Zero-Trust Credential Relay — Technical Documentation

> **Version**: 1.0.0 (MVP)
> **Last Updated**: March 2026
> **Author**: ITGeeks Engineering

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [Component Deep Dive](#2-component-deep-dive)
3. [Data Models & Database Schema](#3-data-models--database-schema)
4. [API Reference](#4-api-reference)
5. [WebSocket Protocol](#5-websocket-protocol)
6. [Encryption & Key Management](#6-encryption--key-management)
7. [Data Flow: Complete Request Lifecycle](#7-data-flow-complete-request-lifecycle)
8. [IPC & Native Messaging Protocol](#8-ipc--native-messaging-protocol)
9. [Content Script — Injection Engine](#9-content-script--injection-engine)
10. [Configuration & Environment](#10-configuration--environment)
11. [Project Structure](#11-project-structure)
12. [Development & Build](#12-development--build)
13. [Security Considerations](#13-security-considerations)
14. [Production Deployment Checklist](#14-production-deployment-checklist)

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        ADMIN DASHBOARD (Browser)                        │
│                  WebSocket: ws://server/ws/admin                         │
│            Real-time request notifications, approve/reject              │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ WebSocket
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         CENTRAL SERVER (Node.js)                        │
│                                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │ REST API │  │ WebSocket Hub│  │ SQLite DB │  │ Audit Logger     │  │
│  │ (Express)│  │ Agent + Admin│  │ (encrypted│  │ (every action    │  │
│  │          │  │ connections  │  │  vault)   │  │  is logged)      │  │
│  └──────────┘  └──────────────┘  └───────────┘  └──────────────────┘  │
│                                                                         │
│  Port: 3000 (HTTP + WS)                                                │
└──────────┬───────────────────────────────────┬──────────────────────────┘
           │ WebSocket                          │ HTTP (REST)
           ▼                                    ▼
┌────────────────────────┐         ┌──────────────────────────────────────┐
│   AGENT (on device)    │         │     CHROME EXTENSION (in browser)    │
│                        │         │                                      │
│  ┌──────────────────┐  │         │  ┌─────────┐ ┌────────┐ ┌────────┐ │
│  │ WS Client        │  │         │  │ Popup   │ │Background│ │Content│ │
│  │ (receives creds) │  │         │  │ (UI)    │ │(Service  │ │Script │ │
│  ├──────────────────┤  │         │  │         │ │ Worker)  │ │(inject│ │
│  │ Credential Store │  │         │  │ Select  │ │ API calls│ │ into  │ │
│  │ (in-memory, TTL) │  │         │  │ Request │ │ Polling  │ │ forms)│ │
│  ├──────────────────┤  │         │  │ Status  │ │          │ │       │ │
│  │ IPC Server       │  │         │  └─────────┘ └────────┘ └────────┘ │
│  │ (Unix socket)    │  │         │                                      │
│  └──────────────────┘  │         │  Manifest V3 | Permissions:          │
│                        │         │  activeTab, nativeMessaging           │
└────────────────────────┘         └──────────────────────────────────────┘
```

### Communication Channels

| Path | Protocol | Purpose |
|------|----------|---------|
| Server ↔ Admin Dashboard | WebSocket (`/ws/admin`) | Real-time request notifications, agent status |
| Server ↔ Agent | WebSocket (`/ws/agent`) | Credential payload delivery, status updates |
| Extension ↔ Server | HTTP REST | Create requests, poll status, fetch credentials |
| Extension ↔ Agent (optional) | Native Messaging → IPC Socket | Direct credential consumption (advanced mode) |
| Agent ↔ Agent IPC | Unix Socket / Named Pipe | Local credential retrieval by native host |

---

## 2. Component Deep Dive

### 2.1 Shared Module (`@credential-relay/shared`)

The shared library used by both server and agent. Contains no runtime dependencies.

**Exports:**
- **Types**: `Device`, `StoredCredential`, `CredentialRequest`, `AuditEntry`, `WsMessage`, `CredentialPayload`, etc.
- **Constants**: Ports, URLs, TTLs, encryption parameters, WebSocket paths, IPC paths
- **Crypto**: `encrypt()`, `decrypt()`, `generateId()`

**Key Constants:**

| Constant | Value | Purpose |
|----------|-------|---------|
| `SERVER_PORT` | `3000` | HTTP + WebSocket server port |
| `CREDENTIAL_REQUEST_TTL_MS` | `300,000` (5 min) | Request auto-expiry |
| `CREDENTIAL_PLAINTEXT_TTL_MS` | `60,000` (60 sec) | In-memory credential lifetime in agent |
| `ENCRYPTION_ALGORITHM` | `aes-256-gcm` | Vault encryption |
| `ENCRYPTION_IV_LENGTH` | `12` bytes | GCM initialization vector |
| `ENCRYPTION_KEY_LENGTH` | `32` bytes | AES-256 key size |
| `KEYSTROKE_DELAY_MIN_MS` | `10` ms | Simulated typing speed min |
| `KEYSTROKE_DELAY_MAX_MS` | `40` ms | Simulated typing speed max |
| `IPC_SOCKET_PATH_UNIX` | `/tmp/credential-relay.sock` | Agent IPC socket |

### 2.2 Server (`@credential-relay/server`)

**Technology**: Express 4.19 + better-sqlite3 + ws (WebSocket) + Zod validation + Pino logging

**Responsibilities:**
1. Encrypted credential vault (SQLite with AES-256-GCM)
2. Device registration and tracking
3. Credential request lifecycle management
4. WebSocket hub (agent connections + admin dashboard)
5. Audit logging of every action
6. Request expiry (30-second sweep interval)
7. Admin dashboard (static HTML served at `/dashboard`)

**Startup Sequence:**
```
1. Load .env (dotenv)
2. Initialize SQLite database (create tables if needed)
3. Create Express app (JSON parsing, CORS, static files, API routes)
4. Create HTTP server
5. Attach WebSocket upgrade handler (agent + admin paths)
6. Start request expiry interval (every 30s)
7. Listen on port 3000
```

### 2.3 Agent (`@credential-relay/agent`)

**Technology**: Node.js + ws (WebSocket client) + Pino logging

**Responsibilities:**
1. Collect device identity (MAC address, hostname)
2. Register with server via REST API (with retry logic)
3. Maintain persistent WebSocket connection to server
4. Receive encrypted credential payloads
5. Decrypt credentials in memory (using VAULT_MASTER_KEY)
6. Serve credentials via IPC server (Unix socket)
7. Auto-purge credentials after TTL (60 seconds)

**Startup Sequence:**
```
1. Load .env (VAULT_MASTER_KEY required)
2. Collect device identity (MAC, hostname)
3. Register with server (retry up to 10 times, 2s interval)
4. Start IPC server on /tmp/credential-relay.sock
5. Connect to server WebSocket (/ws/agent?deviceId=...)
6. Wait for credential payloads
```

**Credential Lifecycle in Agent Memory:**
```
Receive encrypted payload → Decrypt with master key → Store in Map
    → 60s TTL timer starts → Timer fires → Overwrite password with "" → Delete from Map
    OR
    → Consumed via IPC → Overwrite password with "" → Delete from Map
```

### 2.4 Chrome Extension

**Manifest Version**: 3
**Permissions**: `activeTab`, `nativeMessaging`

**Three Scripts:**

| Script | Type | Role |
|--------|------|------|
| `background.js` | Service Worker | API calls to server, message routing |
| `popup.js` | Popup UI | User interface for credential requests |
| `content.js` | Content Script | Login form detection, credential injection, auto-submit |

**Popup Flow:**
```
1. Check server connectivity (GET /api/devices)
2. Detect login form on current tab (message content script)
3. Load available credentials + devices from server
4. User selects credential + device → clicks "Request"
5. POST /api/requests → get requestId
6. Poll GET /api/requests/:id every 1.5s for status change
7. When status = "approved" or "relayed":
   a. GET /api/requests/:id/credential (one-time, server decrypts)
   b. Send to content script for injection
   c. Show success/failure result
```

---

## 3. Data Models & Database Schema

### 3.1 Entity Relationship

```
┌──────────────┐     ┌──────────────────────┐     ┌──────────────┐
│   devices    │     │ credential_requests   │     │ credentials  │
├──────────────┤     ├──────────────────────┤     ├──────────────┤
│ id (PK)      │◄────│ device_id (FK)       │     │ id (PK)      │
│ mac_address  │     │ credential_id (FK)   │────►│ account_email│
│ hostname     │     │ id (PK)              │     │ encrypted_pw │
│ device_alias │     │ user_mac             │     │ iv           │
│ cert_fp      │     │ site_url             │     │ auth_tag     │
│ registered_at│     │ hostname             │     │ target_domain│
│ last_seen    │     │ status               │     │ updated_at   │
│ status       │     │ requested_at         │     └──────────────┘
└──────────────┘     │ resolved_at          │
                     │ resolved_by          │
                     │ expires_at           │     ┌──────────────┐
                     └──────────────────────┘     │  audit_log   │
                                                  ├──────────────┤
                                                  │ id (PK)      │
                                                  │ event_type   │
                                                  │ request_id   │
                                                  │ device_id    │
                                                  │ admin_id     │
                                                  │ metadata (JSON)│
                                                  │ timestamp    │
                                                  └──────────────┘
```

### 3.2 Table: `devices`

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | UUID v4 |
| `mac_address` | TEXT NOT NULL | Unique index, device fingerprint |
| `hostname` | TEXT NOT NULL | OS hostname at registration |
| `device_alias` | TEXT | Human-friendly name (optional) |
| `cert_fingerprint` | TEXT | Reserved for Phase 6 (mTLS) |
| `registered_at` | TEXT NOT NULL | ISO 8601 |
| `last_seen` | TEXT NOT NULL | Updated on WebSocket connect |
| `status` | TEXT NOT NULL | `active` \| `revoked` |

### 3.3 Table: `credentials`

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | UUID v4 |
| `account_email` | TEXT NOT NULL | Login email/username |
| `encrypted_password` | TEXT NOT NULL | AES-256-GCM ciphertext (hex) |
| `iv` | TEXT NOT NULL | Initialization vector (hex) |
| `auth_tag` | TEXT NOT NULL | GCM authentication tag (hex) |
| `target_domain` | TEXT NOT NULL | e.g. `leetcode.com` |
| `updated_at` | TEXT NOT NULL | ISO 8601 |

### 3.4 Table: `credential_requests`

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | UUID v4 |
| `device_id` | TEXT FK | References `devices.id` |
| `credential_id` | TEXT FK | References `credentials.id` |
| `user_mac` | TEXT NOT NULL | Captured at request time |
| `site_url` | TEXT NOT NULL | URL where credential is needed |
| `hostname` | TEXT NOT NULL | Device hostname at request time |
| `status` | TEXT NOT NULL | See status enum below |
| `requested_at` | TEXT NOT NULL | ISO 8601 |
| `resolved_at` | TEXT | ISO 8601 (when approved/rejected) |
| `resolved_by` | TEXT | Admin identifier |
| `expires_at` | TEXT NOT NULL | Auto-calculated (request time + 5min) |

**Request Status Lifecycle:**
```
pending → approved → relayed → completed
pending → rejected
pending → expired (auto, after 5 min)
```

| Status | Meaning |
|--------|---------|
| `pending` | Waiting for admin action |
| `approved` | Admin approved; credential sent to agent via WebSocket |
| `relayed` | Agent confirmed receipt of encrypted credential |
| `completed` | Extension fetched and injected the credential |
| `rejected` | Admin denied the request |
| `expired` | Not resolved within 5-minute TTL |

### 3.5 Table: `audit_log`

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | UUID v4 |
| `event_type` | TEXT NOT NULL | See event types below |
| `request_id` | TEXT | Links to credential request |
| `device_id` | TEXT | Links to device |
| `admin_id` | TEXT | Admin who performed action |
| `metadata` | TEXT NOT NULL | JSON blob for extra context |
| `timestamp` | TEXT NOT NULL | ISO 8601 |

**Audit Event Types:**
```
request_created     — Employee requested a credential
request_approved    — Admin approved a request
request_rejected    — Admin rejected a request
credential_relayed  — Server sent credential to agent
injection_confirmed — Extension injected credential into form
request_expired     — Request timed out (5 min)
device_registered   — New device registered
device_updated      — Device re-registered or updated
credential_created  — Admin created a credential in vault
credential_updated  — Admin updated a credential
agent_connected     — Agent WebSocket connected
agent_disconnected  — Agent WebSocket disconnected
```

---

## 4. API Reference

**Base URL**: `http://localhost:3000/api`

### 4.1 Devices

| Method | Endpoint | Body | Response | Description |
|--------|----------|------|----------|-------------|
| POST | `/devices/register` | `{ macAddress, hostname, deviceAlias? }` | `Device` | Register or re-register a device |
| GET | `/devices` | — | `Device[]` | List all devices |

### 4.2 Credentials

| Method | Endpoint | Body | Response | Description |
|--------|----------|------|----------|-------------|
| POST | `/credentials` | `{ accountEmail, targetDomain, password }` | `CredentialMetadata` | Create (password is encrypted at rest) |
| PUT | `/credentials/:id` | `{ accountEmail?, targetDomain?, password? }` | `CredentialMetadata` | Update credential |
| GET | `/credentials` | — | `CredentialMetadata[]` | List metadata only (no passwords) |

### 4.3 Requests

| Method | Endpoint | Body | Response | Description |
|--------|----------|------|----------|-------------|
| POST | `/requests` | `{ deviceId, credentialId, siteUrl }` | `CredentialRequest` | Create a credential request |
| GET | `/requests` | `?status=pending` | `CredentialRequest[]` | List requests (optional status filter) |
| GET | `/requests/:id` | — | `CredentialRequest` | Get single request (for polling) |
| GET | `/requests/:id/credential` | — | `{ accountEmail, password, targetDomain }` | **One-time credential fetch** (decrypts, marks completed) |
| PATCH | `/requests/:id` | `{ action: "approve"\|"reject", resolvedBy }` | `CredentialRequest` | Approve or reject |

**Important**: `GET /requests/:id/credential` is one-time use. After fetching, the request status becomes `completed` and the credential cannot be fetched again.

### 4.4 Audit Log

| Method | Endpoint | Query Params | Response | Description |
|--------|----------|------|----------|-------------|
| GET | `/audit` | `?deviceId=&eventType=&limit=100` | `AuditEntry[]` | Query audit log |

### 4.5 Validation

All POST/PUT/PATCH endpoints use **Zod** schema validation. Invalid requests return:
```json
{
  "error": "Validation failed",
  "code": "VALIDATION_ERROR",
  "details": [{ "path": ["field"], "message": "reason" }]
}
```

---

## 5. WebSocket Protocol

### 5.1 Endpoints

| Path | Client | Purpose |
|------|--------|---------|
| `/ws/agent?deviceId=<uuid>` | Agent | Receive credential payloads |
| `/ws/admin` | Dashboard | Real-time notifications |

### 5.2 Message Format

All messages follow:
```typescript
interface WsMessage {
  type: string;       // Message type identifier
  payload: unknown;   // Type-specific data
  timestamp: string;  // ISO 8601
}
```

### 5.3 Server → Agent Messages

**`credential_payload`** — Sent when admin approves a request:
```json
{
  "type": "credential_payload",
  "payload": {
    "requestId": "uuid",
    "credentialId": "uuid",
    "accountEmail": "user@example.com",
    "targetDomain": "example.com",
    "encryptedPassword": "hex-ciphertext",
    "iv": "hex-iv",
    "authTag": "hex-auth-tag"
  },
  "timestamp": "2026-03-13T..."
}
```

### 5.4 Agent → Server Messages

**`credential_payload`** (acknowledgment) — Agent confirms receipt:
```json
{
  "type": "credential_payload",
  "payload": { "requestId": "uuid" },
  "timestamp": "2026-03-13T..."
}
```
*Server sets request status to `relayed` on receipt.*

### 5.5 Server → Admin Messages

| Type | Payload | Trigger |
|------|---------|---------|
| `new_request` | Request + device alias + credential info | Request created |
| `request_resolved` | Request status update | Approved/rejected/relayed/completed |
| `agent_status` | `{ deviceId, status }` or `{ connectedAgents }` | Agent connect/disconnect |

---

## 6. Encryption & Key Management

### 6.1 Algorithm

| Parameter | Value |
|-----------|-------|
| Algorithm | AES-256-GCM |
| Key Derivation | `scrypt(masterKey, "credential-relay-salt", 32)` |
| IV | 12 bytes, randomly generated per encryption |
| Auth Tag | 16 bytes, GCM authentication tag |
| Encoding | All binary values stored as hex strings |

### 6.2 Encryption Flow

```
Password (plaintext)
    │
    ▼
scrypt(VAULT_MASTER_KEY, "credential-relay-salt", 32) → derived_key
    │
    ▼
AES-256-GCM.encrypt(plaintext, derived_key, random_iv)
    │
    ▼
Store: { ciphertext (hex), iv (hex), authTag (hex) }
```

### 6.3 Decryption Contexts

| Where | When | Purpose |
|-------|------|---------|
| **Server** | `GET /requests/:id/credential` | Direct credential fetch by extension |
| **Agent** | On `credential_payload` WebSocket message | Store plaintext in memory for IPC |

Both use the same `VAULT_MASTER_KEY` from `.env`.

### 6.4 Key Rotation (Future)

Currently, a single `VAULT_MASTER_KEY` is used. To rotate:
1. Decrypt all credentials with old key
2. Re-encrypt with new key
3. Update `.env`
4. Restart server + all agents

---

## 7. Data Flow: Complete Request Lifecycle

### 7.1 Sequence Diagram

```
Employee            Extension          Server              Agent           Admin
   │                    │                 │                   │               │
   │ Visit login page   │                 │                   │               │
   │───────────────────►│                 │                   │               │
   │                    │ detect_login    │                   │               │
   │                    │ (content.js)    │                   │               │
   │                    │                 │                   │               │
   │ Click "Request"    │                 │                   │               │
   │───────────────────►│                 │                   │               │
   │                    │ POST /requests  │                   │               │
   │                    │────────────────►│                   │               │
   │                    │                 │ WS: new_request   │               │
   │                    │                 │──────────────────────────────────►│
   │                    │   201 Created   │                   │               │
   │                    │◄────────────────│                   │               │
   │                    │                 │                   │               │
   │  "Waiting..."      │                 │                   │    Approve    │
   │◄───────────────────│                 │                   │               │
   │                    │                 │  PATCH /requests/:id              │
   │                    │                 │◄──────────────────────────────────│
   │                    │                 │                   │               │
   │                    │                 │ WS: credential_payload            │
   │                    │                 │──────────────────►│               │
   │                    │                 │                   │ decrypt +     │
   │                    │                 │                   │ store in RAM  │
   │                    │                 │ WS: ack (relayed) │               │
   │                    │                 │◄──────────────────│               │
   │                    │                 │                   │               │
   │                    │ Poll: GET /requests/:id             │               │
   │                    │────────────────►│                   │               │
   │                    │   status=relayed│                   │               │
   │                    │◄────────────────│                   │               │
   │                    │                 │                   │               │
   │                    │ GET /requests/:id/credential        │               │
   │                    │────────────────►│                   │               │
   │                    │                 │ decrypt password  │               │
   │                    │  { email, pw }  │ mark: completed   │               │
   │                    │◄────────────────│                   │               │
   │                    │                 │                   │               │
   │                    │ inject_credential                   │               │
   │                    │ (content.js)    │                   │               │
   │                    │ type email      │                   │               │
   │                    │ type password   │                   │               │
   │                    │ click submit    │                   │               │
   │  Logged in!        │                 │                   │               │
   │◄───────────────────│                 │                   │               │
```

### 7.2 Timing

| Step | Typical Duration |
|------|-----------------|
| Form detection | Instant (MutationObserver) |
| Request creation | < 50ms |
| Admin approval | Manual (seconds to minutes) |
| Credential relay (server → agent) | < 100ms |
| Extension polling (detect approval) | 0-1.5s (poll interval) |
| Credential fetch + decrypt | < 50ms |
| Field injection (typing simulation) | 200-800ms (depends on password length) |
| Auto-submit | < 50ms |
| **Total (after approval)** | **~1-3 seconds** |

---

## 8. IPC & Native Messaging Protocol

### 8.1 IPC Server (Agent)

**Socket**: `/tmp/credential-relay.sock` (Unix) or `\\.\pipe\credential-relay` (Windows)

**Protocol**: Newline-delimited JSON

**Requests:**
```json
{ "action": "list" }
→ { "ok": true, "data": [{ "requestId": "...", "accountEmail": "...", "targetDomain": "..." }] }

{ "action": "consume", "requestId": "uuid" }
→ { "ok": true, "data": { "accountEmail": "...", "targetDomain": "...", "password": "..." } }
→ { "ok": false, "error": "Credential not found or already consumed" }
```

**Consume is destructive** — the credential is immediately wiped from memory after a successful consume.

### 8.2 Native Messaging Host (Optional)

**Name**: `com.credential_relay.agent`
**Protocol**: Chrome Native Messaging (4-byte LE length prefix + JSON)

The native host acts as a bridge: `Extension ↔ Native Host ↔ IPC Socket ↔ Agent`

Currently unused in the default flow (extension talks to server directly), but available for advanced setups where the credential should never leave the local machine via network.

---

## 9. Content Script — Injection Engine

### 9.1 Login Form Detection

Two detection modes:

**Google Multi-Step Login** (accounts.google.com):
- Step 1: Detect email/identifier field → type email → click "Next"
- Step 2: Wait for password field (MutationObserver) → type password → click "Next"

**Generic Login** (all other sites):
- Find `input[type="password"]` fields
- Find email/username field via multiple selectors:
  - `input[type="email"]`
  - `input[type="text"]` with name containing: `user`, `email`, `login`
  - `input` with autocomplete: `username`, `email`
  - Fallback: any `input[type="text"]` before the password field
- Find submit button: `button[type="submit"]` → `button` with text matching "Sign In"/"Log In"/etc.

### 9.2 Typing Simulation

Each character is typed individually with:
1. `keydown` event
2. `keypress` event
3. Native `HTMLInputElement.prototype.value` setter (bypasses React/Angular interceptors)
4. `input` event (with `inputType: "insertText"`)
5. `keyup` event
6. Random delay: 10-40ms between keystrokes

### 9.3 Field Security (Post-Injection)

After typing the password:
- `lockField()`: blocks copy/cut/paste/contextmenu events
- `Object.defineProperty(element, 'type', ...)`: prevents show-password toggles from changing type
- `removeShowPasswordToggle()`: hides eye-icon buttons (CSS display: none)

**Important**: `lockField` is called AFTER `typeText` to avoid interfering with the native value setter.

### 9.4 Auto-Submit

Submit button detection (in priority order):
1. `button[type="submit"]` or `input[type="submit"]` inside the form
2. `button[type="submit"]` anywhere on the page
3. Any `<button>` whose text matches: "sign in", "log in", "login", "submit", "sign up", "continue"

Click simulation: `mousedown` → `mouseup` → `click` (all with `bubbles: true`)

### 9.5 Post-Submit Cleanup

After 1 second, both email and password fields are cleared using the native value setter.

---

## 10. Configuration & Environment

### 10.1 `.env` File

```bash
VAULT_MASTER_KEY=change-me-to-a-secure-random-key-at-least-32-chars
ADMIN_PASSWORD=admin-secret-change-me
JWT_SECRET=jwt-secret-change-me-to-random-string
DB_PATH=./data/credential-relay.db
LOG_LEVEL=info
PORT=3000
```

| Variable | Required | Used By | Description |
|----------|----------|---------|-------------|
| `VAULT_MASTER_KEY` | Yes | Server + Agent | Master encryption key for credential vault |
| `ADMIN_PASSWORD` | Yes | Server | Admin dashboard authentication |
| `JWT_SECRET` | Yes | Server | JWT signing key (future auth) |
| `DB_PATH` | No | Server | SQLite file path (default: `./data/credential-relay.db`) |
| `LOG_LEVEL` | No | Server + Agent | Pino log level (default: `info`) |
| `PORT` | No | Server | HTTP port (default: `3000`) |

### 10.2 TypeScript Configuration

- Target: ES2022
- Module: CommonJS
- Strict mode enabled
- Workspace-based monorepo (npm workspaces)

---

## 11. Project Structure

```
credential-relay/
├── .env                        # Environment configuration
├── .env.example                # Template
├── package.json                # Root workspace config
├── tsconfig.base.json          # Shared TS config
│
├── shared/                     # @credential-relay/shared
│   ├── src/
│   │   ├── index.ts            # Re-exports
│   │   ├── types.ts            # All TypeScript interfaces
│   │   ├── constants.ts        # Ports, TTLs, paths, algorithm config
│   │   └── crypto.ts           # encrypt(), decrypt(), generateId()
│   ├── package.json
│   └── tsconfig.json
│
├── server/                     # @credential-relay/server
│   ├── src/
│   │   ├── index.ts            # Entry point (DB init, HTTP + WS server)
│   │   ├── app.ts              # Express app setup
│   │   ├── config.ts           # Environment config loader
│   │   ├── logger.ts           # Pino logger
│   │   ├── db/
│   │   │   └── database.ts     # SQLite init, table creation
│   │   ├── middleware/
│   │   │   └── validation.ts   # Zod validation middleware
│   │   ├── routes/
│   │   │   ├── schemas.ts      # Zod schemas for all endpoints
│   │   │   ├── credentials.ts  # CRUD for credentials
│   │   │   ├── devices.ts      # Device registration
│   │   │   ├── requests.ts     # Request lifecycle + credential fetch
│   │   │   └── audit.ts        # Audit log query
│   │   ├── services/
│   │   │   ├── credential.service.ts
│   │   │   ├── device.service.ts
│   │   │   ├── request.service.ts
│   │   │   └── audit.service.ts
│   │   ├── ws/
│   │   │   └── ws-server.ts    # WebSocket hub (agent + admin)
│   │   └── public/
│   │       └── dashboard/      # Admin dashboard (static HTML/JS)
│   ├── package.json
│   └── tsconfig.json
│
├── agent/                      # @credential-relay/agent
│   ├── src/
│   │   ├── index.ts            # Entry point (identity → register → WS → IPC)
│   │   ├── identity.ts         # MAC address + hostname collection
│   │   ├── registration.ts     # Server registration with retry
│   │   ├── ws-client.ts        # WebSocket client (reconnect, heartbeat)
│   │   ├── credential-store.ts # In-memory store with TTL cleanup
│   │   ├── ipc-server.ts       # Unix socket server for extension
│   │   └── logger.ts           # Pino logger
│   ├── package.json
│   └── tsconfig.json
│
└── extension/                  # Chrome Extension (Manifest V3)
    ├── src/
    │   ├── manifest.json       # Extension manifest
    │   ├── background.js       # Service worker (API + message routing)
    │   ├── popup.html          # Popup UI structure
    │   ├── popup.css           # Popup styles (dark theme)
    │   ├── popup.js            # Popup logic (request → poll → inject)
    │   ├── content.js          # Content script (detect, inject, submit)
    │   └── icons/              # Extension icons
    ├── native-host/
    │   └── host.js             # Native messaging bridge (optional)
    ├── install-native-host.sh  # macOS/Linux native host installer
    └── package.json
```

---

## 12. Development & Build

### 12.1 Quick Start

```bash
cd credential-relay
npm install                     # Install all workspace dependencies
cp .env.example .env            # Configure environment
npm run dev                     # Start server + agent concurrently
```

### 12.2 Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `npm run dev` | `concurrently server agent` | Dev mode (tsx, hot reload) |
| `npm run build` | Build shared → server → agent | Production TypeScript compilation |
| `npm run demo` | Build + run server + agent | Production demo |
| `npm run seed` | Build shared + server → run seed | Seed database with test data |
| `npm test` | `vitest run` | Run test suite |
| `npm run test:watch` | `vitest` | Watch mode tests |

### 12.3 Extension Development

1. Go to `chrome://extensions`
2. Enable Developer Mode
3. Click "Load unpacked" → select `extension/src/`
4. After code changes, click the refresh icon on the extension card

---

## 13. Security Considerations

### 13.1 Current Protections

| Area | Implementation |
|------|----------------|
| Password storage | AES-256-GCM encrypted in SQLite |
| In-memory lifetime | 60-second auto-purge in agent |
| One-time use | Credential fetch marks request as "completed" |
| Audit trail | Every action logged with device ID, timestamps, metadata |
| Device fingerprinting | MAC address captured at registration and request time |
| Field protection | Copy/paste blocked, show-password toggle disabled |
| Input validation | Zod schemas on all API endpoints |
| Request expiry | Automatic 5-minute TTL on pending requests |

### 13.2 Known Gaps (MVP)

| Gap | Risk | Mitigation Path |
|-----|------|-----------------|
| HTTP only (no TLS) | Credentials visible on network | HTTPS with valid TLS certificate |
| No API authentication | Anyone can call endpoints | JWT auth + API keys |
| Static salt in scrypt | Weakens key derivation | Per-credential random salt |
| Single master key | Key compromise = full breach | HSM or AWS KMS integration |
| No rate limiting | Brute-force requests | Express rate-limit middleware |
| No RBAC | Single admin role | Role hierarchy (super-admin, admin, viewer) |
| SQLite | Single-writer, no replication | PostgreSQL for production |
| Extension talks to localhost | Only works locally | Deploy server on internal network |

### 13.3 Content Script Security

The content script runs with elevated privileges on every page. Risks:
- **XSS on target site** could potentially read injected values via DOM access
- **Mitigation**: Fields are cleared 1 second after submission
- **Mitigation**: `lockField()` prevents programmatic copy/paste

---

## 14. Production Deployment Checklist

### Must-Have (Before Production)

- [ ] Enable HTTPS/TLS (Let's Encrypt or internal CA)
- [ ] Add JWT authentication to all API endpoints
- [ ] Replace SQLite with PostgreSQL
- [ ] Use HSM or cloud KMS for master key management
- [ ] Add rate limiting (express-rate-limit)
- [ ] Use per-credential random salt for scrypt
- [ ] Add RBAC (at minimum: admin, viewer roles)
- [ ] Restrict CORS to extension origin only
- [ ] Add CSP headers to dashboard
- [ ] Move `.env` secrets to a secret manager (Vault, AWS Secrets Manager)
- [ ] Set up log aggregation (ship Pino JSON logs to Datadog/Splunk)
- [ ] Deploy agent as a system service (systemd/launchd)
- [ ] Pin extension to specific server URL (not hardcoded localhost)
- [ ] Add health check endpoint (`GET /health`)

### Nice-to-Have (Phase 2+)

- [ ] SSO integration (Google Workspace, Azure AD, Okta)
- [ ] Mobile admin app for push-notification approvals
- [ ] Automatic credential rotation
- [ ] Geo-fencing and IP allowlisting
- [ ] Time-based access policies
- [ ] Multi-admin approval for sensitive credentials
- [ ] mTLS between agent and server (cert_fingerprint field is ready)
- [ ] Credential access analytics dashboard

---

*This document is the source of truth for the Credential Relay system architecture. Update it when making architectural changes.*
