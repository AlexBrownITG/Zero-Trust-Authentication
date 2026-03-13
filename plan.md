# Zero-Trust Credential Relay System — MVP Implementation Plan

> **Target Model:** Claude Code (Opus 4.6)
> **Build Style:** Phase-by-phase, each phase tested before proceeding
> **Monorepo Structure:** Single repo, four packages

---

## MVP Environment

Everything runs on a **single local machine** for MVP and team demo purposes.

| Concern | MVP Approach |
|---|---|
| Server hosting | `localhost:3000` — no cloud, no domain, no VPN |
| Transport security | Plain HTTP + WS for MVP. TLS is deferred to Phase 6 (post-demo). |
| Agent location | Runs on the **same machine** as the server. Uses `--device-alias` flag to simulate different employee devices during demo. |
| Extension | Sideloaded via `chrome://extensions` in developer mode. |
| Device identity | MAC + hostname only for MVP. Device certificates are deferred to Phase 6. |
| Seed data | A `npm run seed` script pre-loads a test credential and a test device so the demo starts ready. |
| Startup | `npm run demo` boots the server, seeds data, and starts one agent instance. |
| Target audience | Internal team presentation — demo the full request → approve → inject flow live. |

---

## Project Structure

```
credential-relay/
├── package.json                  # Workspace root (npm workspaces)
├── .env.example                  # Environment variable template
├── README.md
│
├── server/                       # Phase 1 + 2
│   ├── package.json
│   ├── src/
│   │   ├── index.ts              # Express + WS entry point
│   │   ├── config.ts             # Env vars, constants
│   │   ├── vault/
│   │   │   ├── vault.ts          # Credential CRUD (SQLCipher)
│   │   │   └── encryption.ts     # AES-256-GCM helpers
│   │   ├── routes/
│   │   │   ├── auth.ts           # Admin login (basic auth → JWT)
│   │   │   ├── requests.ts       # Credential request endpoints
│   │   │   ├── devices.ts        # Device registration endpoints
│   │   │   └── credentials.ts    # Credential management (admin)
│   │   ├── ws/
│   │   │   ├── handler.ts        # WebSocket connection manager
│   │   │   └── channels.ts       # Agent + Admin channel routing
│   │   ├── middleware/
│   │   │   ├── authMiddleware.ts  # JWT verification
│   │   │   └── auditLogger.ts    # Request/response audit logging
│   │   ├── audit/
│   │   │   └── logger.ts         # Structured audit log writer
│   │   └── types/
│   │       └── index.ts          # Shared type definitions
│   ├── dashboard/                # Phase 2 — Admin UI
│   │   ├── index.html
│   │   ├── app.js
│   │   └── style.css
│   └── tests/
│       ├── vault.test.ts
│       ├── requests.test.ts
│       └── ws.test.ts
│
├── agent/                        # Phase 3
│   ├── package.json
│   ├── src/
│   │   ├── main.ts               # Agent entry point
│   │   ├── identity.ts           # MAC + hostname + cert fingerprint
│   │   ├── registration.ts       # Server registration handshake
│   │   ├── wsClient.ts           # WebSocket client (reconnect logic)
│   │   ├── decryptor.ts          # Payload decryption (AES-256-GCM)
│   │   ├── ipc/
│   │   │   ├── server.ts         # Unix socket / named pipe listener
│   │   │   └── protocol.ts       # IPC message schema
│   │   └── cleanup.ts            # Memory wipe utilities
│   └── tests/
│       └── identity.test.ts
│
├── extension/                    # Phase 4 + 5
│   ├── manifest.json             # Chrome MV3 manifest
│   ├── background.js             # Service worker — IPC + request logic
│   ├── content.js                # Login page detection + injection
│   ├── overlay/
│   │   ├── overlay.html          # "Request credential?" prompt UI
│   │   ├── overlay.js
│   │   └── overlay.css
│   ├── lib/
│   │   ├── detector.ts           # URL pattern matching for login pages
│   │   ├── injector.ts           # KeyboardEvent simulation engine
│   │   ├── blocker.ts            # Copy/paste/context menu suppression
│   │   └── fieldLock.ts          # Show-password toggle removal
│   └── native-messaging/
│       └── manifest.json         # Chrome native messaging host config
│
└── shared/                       # Cross-package types + constants
    ├── package.json
    ├── types.ts                  # Request, Device, Credential interfaces
    ├── constants.ts              # URL patterns, timeouts, status enums
    └── crypto.ts                 # Shared encryption/decryption utils
```

---

## Data Models

Define these before writing any code. All phases reference them.

```typescript
// === Core Entities ===

interface Device {
  id: string;                   // UUID
  macAddress: string;
  hostname: string;
  deviceAlias?: string;         // Optional — for simulating multiple devices on one machine (MVP demo)
  certFingerprint?: string;     // Phase 6 — not used in MVP
  registeredAt: string;         // ISO 8601
  lastSeen: string;
  status: 'active' | 'revoked';
}

interface StoredCredential {
  id: string;
  accountEmail: string;
  encryptedPassword: string;    // AES-256-GCM ciphertext
  iv: string;                   // Initialization vector
  authTag: string;              // GCM auth tag
  targetDomain: string;         // e.g. "accounts.google.com"
  updatedAt: string;
}

interface CredentialRequest {
  id: string;
  deviceId: string;
  userMac: string;
  siteUrl: string;
  hostname: string;
  status: 'pending' | 'approved' | 'rejected' | 'completed' | 'expired';
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;          // Admin who approved/rejected
}

interface AuditEntry {
  id: string;
  eventType: 'request_created' | 'request_approved' | 'request_rejected'
           | 'credential_relayed' | 'injection_confirmed' | 'request_expired';
  requestId: string;
  deviceId: string;
  adminId?: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}
```

---

## Phase 1 — Central Server + Vault

**Goal:** Running server with credential CRUD, request lifecycle, and audit logging. No auth yet.

### Tasks

1. **Project scaffolding** — Init monorepo with npm workspaces. Set up TypeScript config, ESLint, shared package. Server listens on `localhost:3000`.
2. **Vault module** — SQLite via `better-sqlite3` with application-level AES-256-GCM encryption on credential fields. No SQLCipher for MVP — keep dependencies simple. CRUD for credentials table.
3. **Encryption helpers** — `encrypt(plaintext, key)` → `{ciphertext, iv, authTag}` and `decrypt(...)` using Node's `crypto` module with AES-256-GCM. Vault master key from env var.
4. **Request lifecycle** — REST endpoints:
   - `POST /api/requests` — Create a credential request (from extension)
   - `GET /api/requests?status=pending` — List pending requests (for dashboard)
   - `PATCH /api/requests/:id` — Approve or reject (from dashboard)
5. **Device registry** — REST endpoints:
   - `POST /api/devices/register` — Register device (MAC + hostname + optional `deviceAlias`). For MVP, the alias lets a single machine simulate multiple employee devices.
   - `GET /api/devices` — List registered devices
6. **Credential management** — REST endpoints (admin only, auth deferred to Phase 2):
   - `POST /api/credentials` — Store a new credential
   - `PUT /api/credentials/:id` — Update credential
   - `GET /api/credentials` — List credentials (metadata only, never plaintext)
7. **Audit logger** — Write structured JSON audit entries to a `audit_log` table on every state change.
8. **WebSocket server** — Set up `ws` library alongside Express on the same port (`localhost:3000`). Two channel types: `agent:{deviceId}` and `admin`. Broadcast request events to admin channel. Route approved payloads to specific agent channels.
9. **Seed script** — `npm run seed` creates a test device registration and stores a test credential (e.g., a dummy Google account). This ensures the demo starts with data already in place rather than requiring manual setup.

### Acceptance Criteria

- [ ] `POST /api/requests` creates a request and writes an audit entry
- [ ] `PATCH /api/requests/:id` with `{action: "approve"}` changes status, logs it, and emits a WebSocket event to the correct agent channel
- [ ] Credentials are stored encrypted; raw SELECT shows ciphertext only
- [ ] WebSocket connection from a test client receives real-time request events
- [ ] All endpoints return proper error codes (400, 404, 409, 500)

---

## Phase 2 — Admin Dashboard

**Goal:** Functional web UI where admin can log in, see live requests, and approve/reject.

### Tasks

1. **Admin auth** — Basic auth for MVP (single admin user, credentials in env var). Issue a short-lived JWT on login. Protect all `/api/*` routes behind JWT middleware. (Login page served at `/login`.)
2. **Dashboard page** — Served by Express at `/dashboard`. Plain HTML + vanilla JS (no React for MVP).
   - Pending requests list with auto-refresh via WebSocket
   - Each request card shows: employee hostname, target site URL, timestamp, device status
   - Approve / Reject buttons per request
   - Toast notification on new incoming request
   - Simple request history table (last 50 resolved requests)
3. **WebSocket integration** — Dashboard connects via WSS (or WS for local dev). Receives `new_request`, `request_resolved` events. Sends `approve` / `reject` commands.
4. **Request expiry** — Requests older than 5 minutes auto-expire (server-side cron or interval check). Expired requests cannot be approved.

### Acceptance Criteria

- [ ] Admin can log in at `/login` and is redirected to `/dashboard`
- [ ] New requests appear on dashboard in real time (< 1s)
- [ ] Approve sends encrypted payload to the correct agent WebSocket channel
- [ ] Reject updates status and notifies the requesting extension
- [ ] Expired requests show as expired and cannot be approved

---

## Phase 3 — Desktop Agent

**Goal:** Background process that registers the device, maintains a WebSocket connection, and receives approved payloads. For MVP, this runs on the same machine as the server.

### Tasks

1. **Device identity** — Collect MAC address (`os.networkInterfaces()`), hostname (`os.hostname()`). Accept an optional `--device-alias` CLI flag (e.g., `--device-alias employee-laptop-1`) so a single machine can simulate multiple employee devices during demo. Device certificates are deferred to Phase 6.
2. **Server registration** — On startup, POST to `http://localhost:3000/api/devices/register` with identity payload (MAC + hostname + alias). Store the returned `deviceId` + auth token in a local JSON config file (`.credential-relay-agent.json` in home directory).
3. **WebSocket client** — Connect to `ws://localhost:3000/ws/agent?deviceId=X`. Auto-reconnect with exponential backoff. Heartbeat ping every 30s.
4. **Payload handler** — On receiving an approved credential payload: decrypt using a shared symmetric key (from env var, matching the server's vault key for MVP simplicity), then hold the plaintext credential in memory.
5. **IPC server** — Listen on a Unix domain socket (macOS/Linux: `/tmp/credential-relay.sock`) or named pipe (Windows: `\\.\pipe\credential-relay`). Accept connections only from localhost. Serve the decrypted credential to the extension on request, then immediately wipe it from memory. If multiple agent instances run with different aliases, use alias-namespaced socket paths (e.g., `/tmp/credential-relay-employee-1.sock`).
6. **Memory cleanup** — After IPC delivery (or after a 10s timeout if the extension never connects), zero-fill the credential buffer and release it.

### Acceptance Criteria

- [ ] Agent registers on startup and appears in the server's device list
- [ ] Agent reconnects automatically if the server restarts
- [ ] Approved payload arrives via WebSocket within 1s of admin approval
- [ ] IPC socket is created and responds to a test client
- [ ] Credential is wiped from memory after delivery (verify via heap snapshot or log)

---

## Phase 4 — Browser Extension

**Goal:** Detect Google login pages, show overlay, send requests, and communicate with the agent.

### Tasks

1. **Manifest V3 setup** — `manifest.json` with permissions: `activeTab`, `scripting`, `storage`, `webNavigation`, `nativeMessaging`. Content script matches: `*://accounts.google.com/*`.
2. **Login page detector** — Content script checks URL patterns + DOM selectors to identify:
   - Scenario A: Password re-confirmation (`input[type="password"]` visible on `accounts.google.com`)
   - Scenario B: Full sign-in flow (`identifier` + `password` steps)
3. **Overlay UI** — Inject a small shadow-DOM overlay: "Login detected. Request credential?" with a single Request button. Non-intrusive, dismissible, positioned bottom-right.
4. **Request dispatch** — On click, the content script sends a message to the background service worker → service worker POSTs to `/api/requests` with `{userMac, siteUrl, timestamp, hostname}`.
   - Note: The extension gets `userMac` and `hostname` from the agent via IPC (or from stored config set during agent registration).
5. **Native messaging** — Background service worker connects to the desktop agent via Chrome's Native Messaging API (which bridges to the agent's IPC). Register the native messaging host manifest pointing to the agent binary.
6. **Status updates** — Extension listens for approval/rejection via the native messaging channel. Show overlay status: "Pending approval..." → "Approved — injecting..." → "Done" or "Rejected".

### Acceptance Criteria

- [ ] Extension activates on `accounts.google.com/signin` and `accounts.google.com/v3/signin`
- [ ] Overlay appears within 500ms of page load
- [ ] Clicking Request creates a server-side request (visible on admin dashboard)
- [ ] Extension receives approval signal via native messaging
- [ ] Extension does NOT activate on non-login Google pages (Drive, Gmail inbox, etc.)

---

## Phase 5 — Credential Injection + Auto-Submit

**Goal:** Fill credentials into Google's login form and submit instantly. Block all credential exposure vectors.

### Tasks

1. **KeyboardEvent injection engine** — Build `injector.ts`:
   - Focus the target input field
   - For each character in the credential, dispatch `keydown`, `keypress`, `input`, `keyup` events with correct `key`, `code`, `keyCode` values
   - Add randomised inter-keystroke delays (10–40ms) to mimic human typing
   - Google's login is multi-step: handle email field first, wait for password step, then inject password
2. **Auto-submit** — After password injection completes, find the submit button (`#passwordNext` or equivalent) and dispatch a `click` event. Target total time from injection start to submit: < 500ms.
3. **Field blocking** — Immediately before injection:
   - Attach `copy`, `cut`, `contextmenu` event listeners on the password field that call `preventDefault()`
   - Use `Object.defineProperty` to lock `field.type` to `"password"` (prevents show-password toggles)
   - Remove any existing show-password toggle elements from the DOM (Google's built-in eye icon)
4. **Post-submit cleanup** — After click:
   - Set field `.value = ''` and dispatch `input` event
   - Remove all injected event listeners
   - Send `injection_confirmed` message back to the agent via native messaging
   - Agent writes audit log entry via server API
5. **Error handling** — If the login page structure doesn't match expected selectors, abort injection, notify admin via audit log, and show the user a "Manual login required — contact admin" message.

### Acceptance Criteria

- [ ] Full Google sign-in flow completes automatically (email step + password step + submit)
- [ ] Password re-confirmation prompt (single password field) completes automatically
- [ ] Ctrl+C / right-click copy is blocked during injection window
- [ ] Show-password toggle is neutralised
- [ ] Field is cleared after submission
- [ ] Audit log records the full injection event (without the credential itself)
- [ ] Graceful fallback if Google changes their DOM selectors

---

## Phase 6 — Security Hardening (Post-Demo / Production Readiness)

**Goal:** Production-grade security for real deployment. Not required for MVP demo, but documented here so the team knows the production path.

> **For the team demo:** Phases 1–5 are the demo scope. Phase 6 is presented as "here's what we'd add before rolling this out to all employees."

### Tasks

1. **TLS on all connections** — Server serves over HTTPS (self-signed cert for internal use or Let's Encrypt if on a domain). WebSocket upgrades to WSS. Enforce TLS 1.3 minimum.
2. **Vault encryption at rest** — Migrate to SQLCipher or verify AES-256-GCM application-level encryption covers all credential data at rest. Master key from a hardware-backed store or a KMS if available; otherwise env var with strict file permissions.
3. **Device certificates** — On first registration, the agent generates a key pair and a self-signed certificate. The server stores the cert fingerprint. Subsequent WebSocket connections must present the device cert for mutual TLS (mTLS) or include a signed challenge in the handshake.
4. **Audit log integrity** — Each audit entry includes a SHA-256 hash of the previous entry (hash chain). This makes retroactive tampering detectable.
5. **Request expiry hardening** — Server rejects any approval for a request older than 5 minutes. Agent rejects any payload if the request timestamp is stale.
6. **Rate limiting** — Max 5 requests per device per hour. Admin approval rate limit: 20/hour. Prevents abuse if a device or admin session is compromised.
7. **Agent binary signing** — Sign the agent binary with a code-signing certificate so the OS verifies integrity before execution.

### Acceptance Criteria

- [ ] All HTTP and WebSocket traffic is encrypted (no plaintext connections accepted)
- [ ] Vault database file is unreadable without the master key
- [ ] Device impersonation fails (wrong cert → connection rejected)
- [ ] Audit log hash chain is verified on server startup
- [ ] Stale requests are rejected at both server and agent level

---

## Non-Functional Requirements

| Concern | Target |
|---|---|
| Injection-to-submit latency | < 500ms |
| Request-to-login total time | < 30s (including admin approval) |
| Agent reconnect time | < 5s after server restart |
| Dashboard request visibility | < 1s from request creation |
| Concurrent request handling | At least 10 simultaneous requests |
| Supported browsers | Chrome 120+, Edge 120+ |
| Supported agent OS (MVP) | Whatever the dev machine runs (macOS or Windows) |
| Server hosting (MVP) | `localhost:3000` — single machine |

---

## Key Technical Decisions (Locked)

These are final. Do not revisit during implementation.

1. **Injection method:** `KeyboardEvent` simulation only. Never `.value` assignment.
2. **Clipboard:** Never used anywhere in the pipeline. Direct DOM injection.
3. **Auto-submit:** Fires immediately after injection. No user interaction window.
4. **Show-password blocking:** DOM removal + `Object.defineProperty` lock + auto-submit speed.
5. **Copy/paste blocking:** `copy`, `cut`, `contextmenu` event suppression on password field.
6. **Device identity (MVP):** MAC + hostname + optional alias. Device certificates deferred to Phase 6.
7. **No Google API integration.** Pure HTML form automation.
8. **IPC:** Unix socket (macOS/Linux) or Named Pipe (Windows).
9. **MVP tech stack:** Node.js/TypeScript server, vanilla JS dashboard, Node.js agent, Chrome MV3 extension.
10. **MVP environment:** Everything on `localhost`. Plain HTTP/WS. No TLS until Phase 6.

---

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Google changes login page DOM structure | Injection breaks | Selector config is externalised; update without redeploying agent/extension |
| Google detects simulated keystrokes as bot | Login blocked / CAPTCHA | KeyboardEvent with realistic timing; escalate to manual if detected |
| Employee uses DevTools to read field value | Credential exposed | Auto-submit < 200ms window; org policy prohibits DevTools; audit log deters |
| Agent process killed mid-relay | Credential stuck in memory | 10s timeout auto-wipe; OS process exit handler zeros buffers |
| Admin unavailable for approval | Employee stuck | Request expiry + queue visibility; consider secondary approver role post-MVP |

---

## Demo Startup

A single command boots the full system for demonstration:

```bash
# 1. Install everything
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env: set VAULT_MASTER_KEY, ADMIN_PASSWORD, JWT_SECRET

# 3. Seed test data (creates a test device + test credential)
npm run seed

# 4. Start the full stack
npm run demo
# This runs concurrently:
#   - Server on http://localhost:3000
#   - Agent instance (auto-registers as the seeded test device)
#   - Opens admin dashboard in default browser
```

### `.env.example`

```
SERVER_PORT=3000
SERVER_HOST=localhost
VAULT_MASTER_KEY=change-me-to-a-64-char-hex-string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=demo-password-change-me
JWT_SECRET=change-me-jwt-secret
REQUEST_EXPIRY_SECONDS=300
```

---

## Demo Script (Team Presentation)

Use this flow when presenting to the team. Two browser windows side by side — one is the "admin view", one is the "employee view".

### Setup (before the meeting)

1. Run `npm run demo` — server, agent, and seed data are all live.
2. Open the admin dashboard at `http://localhost:3000/dashboard` in Window A (left side of screen).
3. Open Chrome with the extension sideloaded in Window B (right side). This is the "employee" browser.
4. Make sure the seeded test credential is for a throwaway Google account (not a real one).

### Live Demo Flow

| Step | What You Do | What the Team Sees |
|---|---|---|
| 1 | In Window B (employee), navigate to `accounts.google.com` | Extension overlay appears: "Login detected. Request credential?" |
| 2 | Click "Request" on the overlay | Overlay changes to "Pending approval..." |
| 3 | Switch to Window A (admin dashboard) | A new request card appears in real time with the device name + target URL |
| 4 | Click "Approve" on the dashboard | Request card moves to "Completed" |
| 5 | Switch back to Window B | The Google login form fills itself and submits automatically. Employee is logged in. |
| 6 | (Optional) Show the audit log on the dashboard | Every step is recorded — who requested, who approved, when it happened |

### Talking Points During Demo

- **"The password was never visible."** — The employee never saw it, never typed it, never had a chance to copy it.
- **"The whole thing took under 30 seconds."** — vs. 5–15 minutes with the current AnyDesk workflow.
- **"Every action is audited."** — Show the audit log. Full accountability.
- **"The admin didn't need to remote into anyone's machine."** — No AnyDesk, no screen sharing, no desktop exposure.
- **"For production, we'd add TLS, device certificates, and rate limiting"** — Reference Phase 6 as the production hardening roadmap.

### If Something Breaks During Demo

- **Extension doesn't detect the login page:** Google may have changed their DOM. Show the team the error fallback message and explain the selector config is externalised.
- **Agent disconnects:** It auto-reconnects within 5 seconds. Just wait.
- **Google shows CAPTCHA:** This can happen with simulated input. Explain this is a known edge case and the system falls back to manual (contact admin) gracefully.
