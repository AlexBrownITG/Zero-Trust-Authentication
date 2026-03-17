# Vaultwarden - Comprehensive Analysis & Context Document

## Table of Contents
1. [Overview](#1-overview)
2. [Architecture & Tech Stack](#2-architecture--tech-stack)
3. [Project Structure](#3-project-structure)
4. [Configuration System](#4-configuration-system)
5. [Database Layer](#5-database-layer)
6. [Authentication & Authorization](#6-authentication--authorization)
7. [Cryptography](#7-cryptography)
8. [API Routes - Complete Reference](#8-api-routes---complete-reference)
9. [Two-Factor Authentication](#9-two-factor-authentication)
10. [SSO/OIDC Integration](#10-ssooidc-integration)
11. [WebSocket & Push Notifications](#11-websocket--push-notifications)
12. [Email System](#12-email-system)
13. [Admin Panel](#13-admin-panel)
14. [Organization & Group Management](#14-organization--group-management)
15. [Bitwarden Send](#15-bitwarden-send)
16. [Emergency Access](#16-emergency-access)
17. [Icon/Favicon Service](#17-iconfavicon-service)
18. [Rate Limiting & Security](#18-rate-limiting--security)
19. [Background Jobs & Scheduling](#19-background-jobs--scheduling)
20. [Deployment & Docker](#20-deployment--docker)
21. [Known Limitations & Potential Issues](#21-known-limitations--potential-issues)
22. [Feature Comparison with Official Bitwarden](#22-feature-comparison-with-official-bitwarden)

---

## 1. Overview

**Vaultwarden** (formerly bitwarden_rs) is an unofficial, open-source implementation of the Bitwarden server API, written in Rust. It is compatible with all official Bitwarden clients (web vault, browser extensions, desktop apps, mobile apps, CLI).

- **License**: AGPL-3.0-only
- **Language**: Rust (edition 2021, requires rustc 1.92.0+)
- **Repository**: https://github.com/dani-garcia/vaultwarden
- **Current Commit**: `9c7df6412c088832e1aeb673000716f5801dc8ed`

### Why Vaultwarden Exists
- **Resource efficiency**: Official Bitwarden server requires Microsoft SQL Server and significant RAM. Vaultwarden runs on SQLite with ~50MB RAM.
- **Self-hosting friendly**: Single binary, Docker image < 100MB, runs on Raspberry Pi.
- **Feature parity**: Implements most Bitwarden premium features for free (attachments, TOTP, organizations, Send, emergency access).

---

## 2. Architecture & Tech Stack

### Core Stack
| Component | Technology | Version |
|-----------|-----------|---------|
| Web Framework | Rocket | 0.5.1 |
| Async Runtime | Tokio | 1.50.0 |
| Database ORM | Diesel | 2.3.6 |
| Database Backends | SQLite, MySQL, PostgreSQL | Multi-connection |
| Cryptography | ring, openssl, argon2 | 0.17.14, 0.10.75, 0.5.3 |
| JWT | jsonwebtoken (RS256) | 10.3.0 |
| WebAuthn | webauthn-rs | 0.5.4 |
| SSO/OIDC | openidconnect | 4.0.1 |
| Email | lettre | 0.11.19 |
| HTTP Client | reqwest | 0.12.28 |
| DNS | hickory-resolver | 0.25.2 |
| Template Engine | Handlebars | 6.4.0 |
| Job Scheduler | job_scheduler_ng | 2.4.0 |
| Rate Limiting | governor | 0.10.4 |
| Caching | moka (async) | 0.12.13 |
| WebSocket | rocket_ws | 0.1.1 |
| MessagePack | rmpv | 1.3.1 |
| Memory Allocator | mimalloc (optional) | 0.1.48 |

### Application Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                    Bitwarden Clients                         │
│  (Web Vault, Browser Extension, Desktop, Mobile, CLI)       │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS / WebSocket
┌────────────────────────▼────────────────────────────────────┐
│                    Rocket Web Server                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐ │
│  │ /api/    │ │/identity/│ │ /admin/  │ │/notifications/│ │
│  │ Core API │ │  Auth    │ │  Panel   │ │  WebSocket    │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬────────┘ │
│       │             │            │               │          │
│  ┌────▼─────────────▼────────────▼───────────────▼────────┐│
│  │              Service Layer                              ││
│  │  (auth, crypto, mail, push, ratelimit, sso)            ││
│  └────────────────────────┬───────────────────────────────┘│
│                           │                                 │
│  ┌────────────────────────▼───────────────────────────────┐│
│  │           Diesel ORM + Connection Pool                  ││
│  │     (SQLite | MySQL | PostgreSQL via MultiConnection)   ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### Entry Point Flow (`src/main.rs`)
1. Parse CLI arguments (hash, backup, version)
2. Initialize logging (fern + optional syslog)
3. Check data folder (local FS or S3)
4. Generate/load RSA key pair for JWT signing
5. Check web vault presence
6. Create database connection pool
7. Run database migrations
8. Schedule background jobs (9 different cron jobs)
9. Launch Rocket web server with all routes
10. Install signal handlers (SIGINT, SIGUSR1 for SQLite backup)

---

## 3. Project Structure

```
vaultwarden/
├── Cargo.toml                    # Workspace config, features, dependencies
├── Cargo.lock
├── Dockerfile                    # Multi-stage build (Debian-based)
├── .env.template                 # ~100+ config options documented
├── build.rs                      # Git version extraction
├── diesel.toml                   # Schema generation config
├── rust-toolchain.toml           # Rust 1.94.0
├── macros/                       # Proc-macro crate
│   └── src/lib.rs                # UuidFromParam, IdFromParam derives
│
└── src/
    ├── main.rs                   # Entry point (~725 lines)
    ├── auth.rs                   # JWT, RSA keys, auth guards (~1259 lines)
    ├── config.rs                 # Configuration system (~1892 lines)
    ├── crypto.rs                 # PBKDF2, HMAC, random generation
    ├── error.rs                  # Error types
    ├── http_client.rs            # HTTP client with security features
    ├── mail.rs                   # SMTP/sendmail email
    ├── ratelimit.rs              # IP-based rate limiting
    ├── sso.rs                    # OpenID Connect SSO
    ├── sso_client.rs             # SSO client implementation
    ├── util.rs                   # CORS, headers, logging utilities
    │
    ├── api/
    │   ├── mod.rs                # API types, route registration
    │   ├── admin.rs              # Admin dashboard & API
    │   ├── icons.rs              # Favicon/icon proxy
    │   ├── identity.rs           # OAuth2 login/token endpoint
    │   ├── notifications.rs      # WebSocket hub
    │   ├── push.rs               # Push notifications to clients
    │   ├── web.rs                # Web vault static serving
    │   └── core/
    │       ├── mod.rs            # Core API routing
    │       ├── accounts.rs       # User account management
    │       ├── ciphers.rs        # Vault items (largest file)
    │       ├── emergency_access.rs
    │       ├── events.rs         # Audit logging
    │       ├── folders.rs
    │       ├── organizations.rs  # Org, collection, group, policy mgmt
    │       ├── public.rs         # LDAP import endpoint
    │       ├── sends.rs          # Bitwarden Send
    │       └── two_factor/
    │           ├── mod.rs
    │           ├── authenticator.rs  # TOTP
    │           ├── duo.rs           # Duo Security
    │           ├── duo_oidc.rs      # Duo OIDC flow
    │           ├── email.rs         # Email 2FA
    │           ├── protected_actions.rs
    │           ├── webauthn.rs      # FIDO2/WebAuthn
    │           └── yubikey.rs       # YubiKey OTP
    │
    ├── db/
    │   ├── mod.rs                # Connection pool, MultiConnection
    │   ├── schema.rs             # Diesel auto-generated schema
    │   ├── query_logger.rs       # SQL query logging
    │   └── models/
    │       ├── mod.rs
    │       ├── user.rs           # User, Invitation, SsoUser
    │       ├── device.rs         # Device, DeviceType
    │       ├── cipher.rs         # Cipher (vault items)
    │       ├── attachment.rs     # File attachments
    │       ├── folder.rs         # Folders
    │       ├── collection.rs     # Collections, CollectionUser, CollectionCipher
    │       ├── organization.rs   # Organization, Membership, OrgApiKey
    │       ├── group.rs          # Groups, GroupUser
    │       ├── send.rs           # Bitwarden Send
    │       ├── two_factor.rs     # 2FA config
    │       ├── two_factor_duo_context.rs
    │       ├── two_factor_incomplete.rs
    │       ├── auth_request.rs   # Passwordless auth
    │       ├── sso_auth.rs       # SSO session tracking
    │       ├── event.rs          # Audit events
    │       ├── emergency_access.rs
    │       ├── favorite.rs       # User favorites
    │       └── org_policy.rs     # Organization policies
    │
    └── static/
        ├── images/
        ├── scripts/              # Admin UI JavaScript
        └── templates/
            ├── admin/            # Admin dashboard templates
            ├── email/            # Email templates (HTML + text)
            └── scss/             # Stylesheets
```

---

## 4. Configuration System

### Architecture
- Macro-based config system (`make_config!` macro in `config.rs`, ~1892 lines)
- ~100+ configuration options, all settable via environment variables
- Thread-safe: `LazyLock<RwLock<Inner>>`
- Runtime-updateable via admin panel (saved to `config.json`)
- Hierarchical: env vars → config.json → defaults

### Key Environment Variables

#### Core Settings
| Variable | Default | Description |
|----------|---------|-------------|
| `DOMAIN` | (required) | Full URL including https:// |
| `DATA_FOLDER` | `./data` | Data storage root |
| `DATABASE_URL` | `data/db.sqlite3` | Database connection string |
| `WEB_VAULT_ENABLED` | `true` | Serve web vault UI |
| `ROCKET_ADDRESS` | `0.0.0.0` | Listen address |
| `ROCKET_PORT` | `80` | Listen port |
| `LOG_LEVEL` | `info` | Log verbosity |

#### Security & Auth
| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_TOKEN` | (none) | Admin panel password (Argon2 PHC or plaintext) |
| `DISABLE_ADMIN_TOKEN` | `false` | Allow admin access without auth |
| `SIGNUPS_ALLOWED` | `true` | Allow new user registration |
| `SIGNUPS_VERIFY` | `false` | Require email verification |
| `SIGNUPS_DOMAINS_WHITELIST` | (none) | Comma-separated allowed email domains |
| `INVITATIONS_ALLOWED` | `true` | Allow organization invitations |
| `PASSWORD_ITERATIONS` | `600000` | Server-side PBKDF2 iterations |
| `PASSWORD_HINTS_ALLOWED` | `true` | Allow password hints |
| `SHOW_PASSWORD_HINT` | `false` | Show hints on login page |

#### Database
| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_DB_WAL` | `true` | SQLite WAL mode |
| `DB_CONNECTION_RETRIES` | `15` | Connection retry count |
| `DATABASE_TIMEOUT` | `30` | Connection timeout (seconds) |
| `DATABASE_MAX_CONNS` | `10` | Max pool connections |

#### Email/SMTP
| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | (none) | SMTP server hostname |
| `SMTP_FROM` | (none) | From email address |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_SECURITY` | `starttls` | off, starttls, force_tls |
| `SMTP_USERNAME` | (none) | SMTP auth username |
| `SMTP_PASSWORD` | (none) | SMTP auth password |
| `USE_SENDMAIL` | `false` | Use sendmail instead of SMTP |

#### SSO/OIDC
| Variable | Default | Description |
|----------|---------|-------------|
| `SSO_ENABLED` | `false` | Enable OpenID Connect SSO |
| `SSO_ONLY` | `false` | Disable non-SSO login |
| `SSO_AUTHORITY` | (none) | OIDC provider URL |
| `SSO_CLIENT_ID` | (none) | OIDC client ID |
| `SSO_CLIENT_SECRET` | (none) | OIDC client secret |
| `SSO_PKCE` | `true` | Use PKCE for OIDC |
| `SSO_SCOPES` | `email profile` | OIDC scopes |

#### Two-Factor Authentication
| Variable | Default | Description |
|----------|---------|-------------|
| `YUBICO_CLIENT_ID` | (none) | YubiKey validation client ID |
| `YUBICO_SECRET_KEY` | (none) | YubiKey validation secret |
| `DUO_IKEY` | (none) | Duo integration key |
| `DUO_SKEY` | (none) | Duo secret key |
| `DUO_HOST` | (none) | Duo API hostname |
| `EMAIL_TOKEN_SIZE` | `6` | Email 2FA token length |
| `EMAIL_EXPIRATION_TIME` | `600` | Email token validity (seconds) |
| `DISABLE_2FA_REMEMBER` | `false` | Disable "remember device" for 2FA |

#### Push Notifications
| Variable | Default | Description |
|----------|---------|-------------|
| `PUSH_ENABLED` | `false` | Enable push notifications |
| `PUSH_INSTALLATION_ID` | (none) | Bitwarden installation ID |
| `PUSH_INSTALLATION_KEY` | (none) | Bitwarden installation key |

#### Advanced
| Variable | Default | Description |
|----------|---------|-------------|
| `SENDS_ALLOWED` | `true` | Enable Bitwarden Send |
| `EMERGENCY_ACCESS_ALLOWED` | `true` | Enable emergency access |
| `ORG_EVENTS_ENABLED` | `false` | Enable organization event logging |
| `ORG_GROUPS_ENABLED` | `false` | Enable organization groups |
| `TRASH_AUTO_DELETE_DAYS` | (none) | Auto-delete trashed items |
| `HIBP_API_KEY` | (none) | HaveIBeenPwned API key |
| `IP_HEADER` | (none) | Custom IP header (e.g., X-Forwarded-For) |
| `ICON_SERVICE` | `internal` | Icon provider (internal, bitwarden, duckduckgo, google) |
| `HTTP_REQUEST_BLOCK_NON_GLOBAL_IPS` | `true` | Block requests to private IPs |
| `EXPERIMENTAL_CLIENT_FEATURE_FLAGS` | (none) | Enable client features |

---

## 5. Database Layer

### Supported Backends
- **SQLite** (default, recommended for small deployments)
- **MySQL/MariaDB** (via diesel mysql feature)
- **PostgreSQL** (via diesel postgres feature)

All three are supported simultaneously via Diesel's `MultiConnection` enum.

### Connection Pooling
- Uses `r2d2` connection pool via Diesel
- Configurable: min/max connections, idle timeout, connection init SQL
- Custom `DbConnManager` for connection establishment
- `Semaphore`-based connection limiting
- Request guard `DbConn` for dependency injection into Rocket handlers

### Database Tables

#### `users`
```rust
User {
    uuid: UserId,                           // Primary key (UUID)
    enabled: bool,
    created_at: NaiveDateTime,
    updated_at: NaiveDateTime,
    verified_at: Option<NaiveDateTime>,
    last_verifying_at: Option<NaiveDateTime>,
    login_verify_count: i32,
    email: String,                          // Unique, lowercase
    email_new: Option<String>,              // Pending email change
    email_new_token: Option<String>,
    name: String,
    password_hash: Vec<u8>,                 // PBKDF2-HMAC-SHA256
    salt: Vec<u8>,                          // 64 random bytes
    password_iterations: i32,               // Default: 600,000
    password_hint: Option<String>,
    akey: String,                           // Encrypted master key
    private_key: Option<String>,            // RSA private key (encrypted)
    public_key: Option<String>,             // RSA public key
    totp_recover: Option<String>,           // 2FA recovery code
    security_stamp: String,                 // UUID, rotated on security events
    stamp_exception: Option<String>,        // JSON: temporary route exceptions
    equivalent_domains: String,             // JSON array
    excluded_globals: String,               // JSON array
    client_kdf_type: i32,                   // 0=Pbkdf2, 1=Argon2id
    client_kdf_iter: i32,
    client_kdf_memory: Option<i32>,         // Argon2 memory (MB)
    client_kdf_parallelism: Option<i32>,    // Argon2 threads
    api_key: Option<String>,                // Personal API key
    avatar_color: Option<String>,
    external_id: Option<String>,
}
```

#### `devices`
```rust
Device {
    uuid: DeviceId,                         // Composite PK with user_uuid
    created_at: NaiveDateTime,
    updated_at: NaiveDateTime,
    user_uuid: UserId,                      // Composite PK
    name: String,
    atype: i32,                             // DeviceType (0-25)
    push_uuid: Option<PushId>,              // Push notification ID
    push_token: Option<String>,             // Platform push token
    refresh_token: String,                  // BASE64URL, 64 bytes
    twofactor_remember: Option<String>,     // BASE64, 180 bytes
}
```

**DeviceType Enum**: Android(0), iOS(1), ChromeExtension(2), FirefoxExtension(3), OperaExtension(4), EdgeExtension(5), WindowsDesktop(6), MacOsDesktop(7), LinuxDesktop(8), ChromeBrowser(9), FirefoxBrowser(10), OperaBrowser(11), EdgeBrowser(12), IEBrowser(13), UnknownBrowser(14), AndroidAmazon(15), Uwp(16), SafariBrowser(17), VivaldiBrowser(18), VivaldiExtension(19), SafariExtension(20), Sdk(21), Server(22), WindowsCLI(23), MacOsCLI(24), LinuxCLI(25)

#### `ciphers`
```rust
Cipher {
    uuid: CipherId,
    created_at: NaiveDateTime,
    updated_at: NaiveDateTime,
    user_uuid: Option<UserId>,              // Personal owner
    organization_uuid: Option<OrganizationId>, // Org owner
    key: Option<String>,                    // Encrypted item key
    atype: i32,                             // 1=Login, 2=SecureNote, 3=Card, 4=Identity, 5=SshKey
    name: String,                           // Encrypted
    notes: Option<String>,                  // Encrypted
    fields: Option<String>,                 // Encrypted JSON
    data: String,                           // Encrypted cipher data
    password_history: Option<String>,       // Encrypted JSON
    deleted_at: Option<NaiveDateTime>,      // Soft delete (trash)
    reprompt: Option<i32>,                  // 0=None, 1=Password
}
```

#### `organizations`
```rust
Organization {
    uuid: OrganizationId,
    name: String,
    billing_email: String,
    private_key: Option<String>,            // RSA private key
    public_key: Option<String>,             // RSA public key
}

Membership {
    uuid: MembershipId,
    user_uuid: UserId,
    org_uuid: OrganizationId,
    invited_by_email: Option<String>,
    access_all: bool,                       // Bypass collection permissions
    akey: String,                           // Encrypted org key
    status: i32,                            // 0=Invited, 1=Accepted, 2=Confirmed
    atype: i32,                             // 0=Owner, 1=Admin, 2=Manager, 3=User
    reset_password_key: Option<String>,
    external_id: Option<String>,
}
```

#### `collections`
```rust
Collection {
    uuid: CollectionId,
    org_uuid: OrganizationId,
    name: String,                           // Encrypted
    external_id: Option<String>,
}

CollectionUser {
    user_uuid: UserId,
    collection_uuid: CollectionId,
    read_only: bool,
    hide_passwords: bool,
    manage: bool,
}

CollectionCipher {
    cipher_uuid: CipherId,
    collection_uuid: CollectionId,
}
```

#### `sends`
```rust
Send {
    uuid: SendId,
    user_uuid: Option<UserId>,
    organization_uuid: Option<OrganizationId>,
    name: String,                           // Encrypted
    notes: Option<String>,                  // Encrypted
    atype: i32,                             // 0=Text, 1=File
    data: String,                           // Encrypted
    akey: String,                           // Encrypted key
    password_hash: Option<Vec<u8>>,         // Optional PBKDF2 protection
    max_access_count: Option<i32>,
    access_count: i32,
    creation_date: NaiveDateTime,
    revision_date: NaiveDateTime,
    expiration_date: Option<NaiveDateTime>,
    deletion_date: NaiveDateTime,           // Mandatory deletion date
    disabled: bool,
    hide_email: Option<bool>,
}
```

#### `emergency_access`
```rust
EmergencyAccess {
    uuid: EmergencyAccessId,
    grantor_uuid: UserId,
    grantee_uuid: Option<UserId>,
    email: Option<String>,
    key_encrypted: Option<String>,
    atype: i32,                             // 0=View, 1=Takeover
    status: i32,                            // 0-4 (see below)
    wait_time_days: i32,
    recovery_initiated_at: Option<NaiveDateTime>,
    last_notification_at: Option<NaiveDateTime>,
    updated_at: NaiveDateTime,
    created_at: NaiveDateTime,
}
// Status: Invited(0), Accepted(1), Confirmed(2), RecoveryInitiated(3), RecoveryApproved(4)
```

#### `twofactor`
```rust
TwoFactor {
    uuid: TwoFactorId,
    user_uuid: UserId,
    atype: i32,                             // TwoFactorType enum
    enabled: bool,
    data: String,                           // JSON serialized 2FA config
    last_used: i64,                         // Unix timestamp
}
```

#### `event` (Audit Log)
```rust
Event {
    uuid: EventId,
    event_type: i32,                        // EventType enum (1000-1700+)
    user_uuid: Option<UserId>,
    org_uuid: Option<OrganizationId>,
    cipher_uuid: Option<CipherId>,
    collection_uuid: Option<CollectionId>,
    group_uuid: Option<GroupId>,
    org_user_uuid: Option<MembershipId>,
    act_user_uuid: Option<UserId>,          // Acting user
    device_type: Option<i32>,
    ip_address: Option<String>,
    event_date: NaiveDateTime,
    policy_uuid: Option<OrgPolicyId>,
}
```

#### Other Tables
- `attachments` - File attachments linked to ciphers
- `folders` - User folders
- `folders_ciphers` - Folder-cipher mapping
- `favorites` - User favorites
- `invitations` - Pending invitations
- `org_policies` - Organization policies
- `groups` - Organization groups
- `groups_users` - Group membership
- `collections_groups` - Group-collection permissions
- `twofactor_incomplete` - Incomplete 2FA login tracking
- `twofactor_duo_ctx` - Duo authentication state
- `auth_requests` - Passwordless auth requests
- `sso_users` - SSO user identifiers
- `sso_auth` - SSO session tracking

---

## 6. Authentication & Authorization

### JWT Token System
- **Algorithm**: RS256 (RSA-256 with 2048-bit keys)
- **Key Management**: RSA keypair generated on first run, stored in `DATA_FOLDER/rsa_key.pem`
- **Library**: jsonwebtoken crate

#### Token Types & Expiration

| Token Type | Issuer Pattern | Expiration | Purpose |
|-----------|---------------|------------|---------|
| Access Token | `{domain}\|login` | 2 hours | API authentication |
| Refresh Token | `{domain}\|login` | 30 days (90 for mobile) | Token refresh |
| Invite Token | `{domain}\|invite` | Config-based | Organization invites |
| Emergency Access | `{domain}\|emergencyaccessinvite` | Config-based | Emergency access invites |
| Delete Token | `{domain}\|delete` | Config-based | Account deletion verification |
| SSO Token | `{domain}\|sso` | 2 minutes | SSO authentication flow |
| Admin Token | Cookie-based | Configurable session lifetime | Admin panel access |

#### Token Constants
```
BW_EXPIRATION = 5 minutes (client considers token expired)
DEFAULT_REFRESH_VALIDITY = 30 days
MOBILE_REFRESH_VALIDITY = 90 days
DEFAULT_ACCESS_VALIDITY = 2 hours
```

### Authentication Flow
1. Client sends credentials to `POST /identity/connect/token`
2. Server validates email/password (PBKDF2-HMAC-SHA256)
3. If 2FA enabled, validates second factor
4. Returns access_token (JWT) + refresh_token
5. Client uses Bearer token for subsequent requests
6. Refresh flow uses refresh_token to get new access_token

### Security Stamp
- UUID stored per-user, rotated on security events (password change, 2FA changes, etc.)
- All existing tokens invalidated when stamp changes
- `stamp_exception` allows temporary access to specific routes for 2 minutes after password change

### Request Guards (Rocket)
- `Headers` - Authenticated user extraction from Bearer token
- `ClientHeaders` - Unauthenticated operations (login, registration)
- `AdminToken` - Cookie-based admin authentication
- `PublicToken` - Organization API key authentication
- `WsAccessTokenHeader` - WebSocket connection authentication

### OAuth2 Grant Types
- `password` - Standard username/password
- `client_credentials` - API key authentication
- `authorization_code` - SSO/OIDC flow

---

## 7. Cryptography

### Password Hashing
- **Algorithm**: PBKDF2-HMAC-SHA256
- **Salt**: 64 random bytes per user
- **Iterations**: Configurable (default 600,000)
- **Output**: 32 bytes (SHA256_OUTPUT_LEN)
- **Library**: ring

### Client-Side KDF Options
| Type | ID | Parameters |
|------|-----|------------|
| PBKDF2 | 0 | iterations (default: 600,000) |
| Argon2id | 1 | iterations, memory (MB), parallelism |

### Key Functions
```rust
hash_password(secret, salt, iterations) -> Vec<u8>     // PBKDF2-HMAC-SHA256
verify_password_hash(secret, salt, previous, iterations) -> bool
hmac_sign(key, data) -> String                          // HMAC-SHA1 (legacy)
ct_eq(a, b) -> bool                                     // Constant-time comparison
get_random_bytes<N>() -> [u8; N]                        // Secure random
generate_id<N>() -> String                              // Hex-encoded UUID
generate_api_key() -> String                            // 30 chars, ~178 bits entropy
generate_email_token(size) -> String                    // Numeric token
```

### Encryption Model
- **Zero-knowledge**: Server never sees plaintext vault data
- **Client-side encryption**: All cipher data encrypted before transmission
- **Organization keys**: RSA key pair per organization, shared via encrypted symmetric key
- **Per-item keys**: Each cipher can have its own encrypted key

---

## 8. API Routes - Complete Reference

### Identity Endpoints (`/identity/`)
| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/connect/token` | `login()` | OAuth2 token endpoint |
| POST | `/connect/prelogin` | `prelogin()` | Get KDF parameters |
| POST | `/register` | `identity_register()` | User registration |
| POST | `/register/send-verification-email` | `register_verification_email()` | Send verification email |
| POST | `/register/finish` | `register_finish()` | Complete registration |
| GET | `/authorize` | `authorize()` | OAuth authorize (SSO) |
| GET | `/oidcsignin` | `oidcsignin()` | OIDC callback |

### Account Endpoints (`/api/accounts/`)
| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/profile` | `profile()` | Get user profile |
| PUT | `/profile` | `put_profile()` | Update profile |
| PUT | `/avatar` | `put_avatar()` | Update avatar |
| POST | `/keys` | `post_keys()` | Rotate encryption keys |
| POST | `/password` | `post_password()` | Change master password |
| POST | `/set-password` | `post_set_password()` | Set password (SSO) |
| POST | `/kdf` | `post_kdf()` | Update KDF settings |
| POST | `/rotatekey` | `post_rotatekey()` | Full key rotation |
| POST | `/security-stamp` | `post_sstamp()` | Reset security stamp |
| POST | `/email-token` | `post_email_token()` | Request email change |
| POST | `/email` | `post_email()` | Change email |
| POST | `/verify-email` | `post_verify_email()` | Verify email |
| POST | `/delete` | `post_delete_account()` | Delete account |
| GET | `/revision-date` | `revision_date()` | Get revision date |
| GET | `/password-hint` | `password_hint()` | Get password hint |
| POST | `/request-otp` | `request_otp()` | Request OTP |
| POST | `/verify-otp` | `verify_otp()` | Verify OTP |

### Cipher/Vault Item Endpoints (`/api/`)
| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/sync` | `sync()` | Full vault sync |
| GET | `/ciphers` | `get_ciphers()` | List all ciphers |
| GET | `/ciphers/<id>` | `get_cipher()` | Get single cipher |
| POST | `/ciphers` | `post_ciphers()` | Create cipher |
| POST | `/ciphers/create` | `post_ciphers_create()` | Create (org/clone) |
| POST | `/ciphers/import` | `post_ciphers_import()` | Import ciphers |
| PUT | `/ciphers/<id>` | `put_cipher()` | Update cipher |
| DELETE | `/ciphers/<id>` | `delete_cipher()` | Delete cipher |
| POST | `/ciphers/<id>/share` | `post_cipher_share()` | Share cipher |
| PUT | `/ciphers/move` | `move_cipher_selected()` | Move ciphers |
| PUT | `/ciphers/delete` | `delete_cipher_selected_put()` | Bulk delete |
| POST | `/ciphers/<id>/restore` | `restore_cipher_put()` | Restore from trash |
| PUT | `/ciphers/<id>/collections` | `put_collections_update()` | Update collections |

### Attachment Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/ciphers/<id>/attachment` | Upload attachment (legacy) |
| POST | `/ciphers/<id>/attachment/v2` | Upload attachment (v2) |
| DELETE | `/ciphers/<id>/attachment/<aid>` | Delete attachment |

### Folder Endpoints (`/api/folders/`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/folders` | List folders |
| GET | `/folders/<id>` | Get folder |
| POST | `/folders` | Create folder |
| PUT | `/folders/<id>` | Update folder |
| DELETE | `/folders/<id>` | Delete folder |

### Send Endpoints (`/api/sends/`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/sends` | List sends |
| POST | `/sends` | Create text send |
| POST | `/sends/file` | Create file send |
| POST | `/sends/file/v2` | Create file send (v2) |
| PUT | `/sends/<id>` | Update send |
| DELETE | `/sends/<id>` | Delete send |
| PUT | `/sends/<id>/remove-password` | Remove password |
| POST | `/sends/<id>/access` | Access send (recipient) |

### Organization Endpoints (`/api/organizations/`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/organizations` | Create org |
| GET | `/organizations/<id>` | Get org |
| PUT | `/organizations/<id>` | Update org |
| DELETE | `/organizations/<id>` | Delete org |
| POST | `/organizations/<id>/leave` | Leave org |
| GET | `/organizations/<id>/collections` | List collections |
| POST | `/organizations/<id>/collections` | Create collection |
| GET | `/organizations/<id>/members` | List members |
| POST | `/organizations/<id>/invite` | Invite user |
| POST | `/organizations/<id>/users/<uid>/confirm` | Confirm invite |
| PUT | `/organizations/<id>/users/<uid>` | Update member |
| DELETE | `/organizations/<id>/users/<uid>` | Remove member |
| POST | `/organizations/<id>/import` | LDAP import |
| GET | `/organizations/<id>/policies` | List policies |
| PUT | `/organizations/<id>/policies/<pid>` | Update policy |
| GET | `/organizations/<id>/groups` | List groups |
| POST | `/organizations/<id>/groups` | Create group |
| PUT | `/organizations/<id>/groups/<gid>` | Update group |
| DELETE | `/organizations/<id>/groups/<gid>` | Delete group |
| GET | `/organizations/<id>/export` | Export org vault |
| POST | `/organizations/<id>/api-key` | Manage API key |

### Two-Factor Endpoints (`/api/two-factor/`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/two-factor` | List 2FA methods |
| POST | `/two-factor/get-recover` | Get recovery codes |
| POST | `/two-factor/disable` | Disable 2FA |
| POST | `/two-factor/get-authenticator` | Get TOTP setup |
| POST | `/two-factor/authenticator` | Enable TOTP |
| POST | `/two-factor/get-webauthn` | Get WebAuthn keys |
| POST | `/two-factor/get-webauthn-challenge` | Get registration challenge |
| POST | `/two-factor/webauthn` | Register WebAuthn key |
| POST | `/two-factor/send-email-login` | Send 2FA email |
| PUT | `/two-factor/email` | Enable email 2FA |
| POST | `/two-factor/get-duo` | Get Duo config |
| POST | `/two-factor/duo` | Enable Duo |
| POST | `/two-factor/get-yubico` | Get YubiKey config |
| POST | `/two-factor/yubico` | Enable YubiKey |

### Emergency Access Endpoints (`/api/emergency-access/`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/trusted` | List trusted contacts |
| GET | `/granted` | List granted access |
| POST | `/invite` | Send invite |
| POST | `/<id>/confirm` | Confirm access |
| POST | `/<id>/initiate` | Initiate recovery |
| POST | `/<id>/approve` | Approve recovery |
| POST | `/<id>/reject` | Reject recovery |
| POST | `/<id>/takeover` | Complete takeover |
| POST | `/<id>/password` | Set new password |
| GET | `/<id>/view` | View vault (emergency) |

### Event Endpoints (`/api/`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/organizations/<id>/events` | Get org events |
| GET | `/ciphers/<id>/events` | Get cipher events |
| GET | `/organizations/<id>/users/<uid>/events` | Get user events |
| POST | `/events/collect` | Submit client events |

### Admin Endpoints (`/admin/`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Admin dashboard |
| POST | `/` | Admin login |
| GET | `/logout` | Admin logout |
| GET | `/users` | List all users |
| POST | `/invite` | Invite user |
| POST | `/test/smtp` | Test SMTP |
| POST | `/users/<id>/delete` | Delete user |
| POST | `/users/<id>/deauth` | Force logout |
| POST | `/users/<id>/disable` | Disable user |
| POST | `/users/<id>/enable` | Enable user |
| POST | `/users/<id>/remove-2fa` | Remove 2FA |
| POST | `/config` | Update server config |
| POST | `/config/backup_db` | Backup database |
| GET | `/diagnostics` | System diagnostics |

### Other Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/alive` | Health check |
| GET | `/now` | Server time |
| GET | `/version` | Server version |
| GET | `/config` | Server config |
| GET | `/icons/<domain>/icon.png` | Favicon proxy |
| GET | `/notifications/hub` | WebSocket (authenticated) |
| GET | `/notifications/anonymous-hub` | WebSocket (anonymous) |
| GET | `/hibp/breach` | HaveIBeenPwned check |
| POST | `/public/organization/import` | LDAP import (API key auth) |

---

## 9. Two-Factor Authentication

### Supported Methods

| Method | Type ID | Implementation | External Service |
|--------|---------|---------------|------------------|
| TOTP (Authenticator) | 0 | `totp-lite` crate | None |
| Email | 1 | `lettre` + custom tokens | SMTP server |
| Duo Security | 2 | Duo OIDC flow | Duo API |
| YubiKey OTP | 3 | `yubico_ng` crate | Yubico validation server |
| WebAuthn/FIDO2 | 7 | `webauthn-rs` crate | None (local) |
| Recovery Code | 8 | Random alphanumeric | None |
| Remember Device | 5 | 180-byte token, 30-day validity | None |

### Legacy Support
- U2F (type 4) automatically migrated to WebAuthn (type 7)
- Credential migration from V1/V2 to V3 format

### 2FA Data Storage
Each 2FA method stores configuration in the `data` field as JSON:
- **TOTP**: `{"secret": "base32-encoded-key"}`
- **WebAuthn**: Array of `WebauthnRegistrationV3` objects
- **Email**: `{"email": "user@example.com", "token": "123456", "expiration": "2024-01-01T00:00:00"}`
- **Duo**: `{"ik": "integration-key", "sk": "secret-key", "host": "api-xxx.duosecurity.com"}`
- **YubiKey**: Array of YubiKey IDs

### Organization Duo
- Organizations can enforce Duo as a separate policy
- Type 6 (OrganizationDuo) stored at org level

### Protected Actions
- Sensitive operations (export, 2FA changes) can require email OTP
- Type 2000 (ProtectedActions) for tracking verification state

---

## 10. SSO/OIDC Integration

### Implementation
- Full OpenID Connect support via `openidconnect` crate
- PKCE support (enabled by default)
- Multiple client types: web, desktop, mobile, CLI, connector

### SSO Flow
1. Client requests `/identity/authorize` with state + PKCE challenge
2. Server generates SSO JWT token (2-minute validity)
3. Client redirected to OIDC provider
4. Provider redirects back to `/identity/oidcsignin` with auth code
5. Server exchanges code for tokens
6. Server validates ID token, extracts user identity
7. User matched by OIDC identifier (`issuer/subject`)
8. JWT access/refresh tokens issued

### SSO User Matching
```rust
OIDCIdentifier = "{issuer}/{subject}"  // Unique per provider per user
```

### Configuration Options
- `SSO_ONLY` - Disable password login entirely
- `SSO_SIGNUPS_MATCH_EMAIL` - Match existing users by email
- `SSO_MASTER_PASSWORD_POLICY` - Require master password with SSO
- `SSO_AUTH_ONLY_NOT_SESSION` - SSO for auth only, not session management
- `SSO_AUDIENCE_TRUSTED` - Trusted audience values
- `SSO_AUTHORIZE_EXTRA_PARAMS` - Extra params for authorize URL

---

## 11. WebSocket & Push Notifications

### WebSocket Implementation
- **Framework**: rocket-ws
- **Protocol**: SignalR-compatible MessagePack (binary)
- **Endpoints**:
  - `/notifications/hub?access_token=<jwt>` - Authenticated users
  - `/notifications/anonymous-hub?token=<token>` - Anonymous Send access

### WebSocket Message Format
```
[
    1,                          // MessageType.Invocation
    {},                         // Headers (empty)
    null,                       // InvocationId
    "ReceiveMessage",           // Target method
    [{                          // Arguments
        "ContextId": device_id,
        "Type": UpdateType,
        "Payload": { ... }
    }]
]
```

### Update Types
| Type | Value | Description |
|------|-------|-------------|
| SyncCipherUpdate | 0 | Cipher modified |
| SyncCipherCreate | 1 | Cipher created |
| SyncLoginDelete | 2 | Login deleted |
| SyncFolderDelete | 3 | Folder deleted |
| SyncCiphers | 4 | Full cipher sync needed |
| SyncVault | 5 | Full vault sync needed |
| SyncOrgKeys | 6 | Org keys changed |
| SyncFolderCreate | 7 | Folder created |
| SyncFolderUpdate | 8 | Folder updated |
| SyncSettings | 10 | Settings changed |
| LogOut | 11 | Force logout |
| SyncSendCreate | 12 | Send created |
| SyncSendUpdate | 13 | Send updated |
| SyncSendDelete | 14 | Send deleted |
| AuthRequest | 15 | Auth request |
| AuthRequestResponse | 16 | Auth response |

### Connection Management
- `WebSocketUsers`: Map<UserId, Vec<(Uuid, Sender)>> - Multiple connections per user
- `AnonymousWebSocketSubscriptions`: Map<token, Sender> - Anonymous connections
- Ping/pong keep-alive every 15 seconds
- Guard-based cleanup on disconnect

### Push Notifications
- Uses external Bitwarden push relay service
- OAuth2 client credentials for relay authentication
- Token cached with half-expiration refresh strategy
- Notifications sent for: cipher changes, folder changes, send changes, logout, auth requests

---

## 12. Email System

### Transport Options
1. **SMTP** - Full SMTP support via lettre
   - TLS modes: off, STARTTLS, force_tls
   - Auth mechanisms: Plain, Login, Xoauth2
   - Configurable timeout, invalid cert acceptance
2. **Sendmail** - System sendmail binary

### Email Templates
Located in `src/static/templates/email/`:
- HTML + plain text versions
- Handlebars templating
- Image embedding support (configurable)

### Email Functions
- Organization invitations
- Account verification
- Email change verification
- Account deletion confirmation
- Emergency access invitations
- 2FA email tokens
- Incomplete 2FA notifications
- Password hints
- Admin notifications

### Anti-XSS
- All user-provided data sanitized before template rendering
- HTML tags stripped from user inputs in email context

---

## 13. Admin Panel

### Authentication
- Protected by `ADMIN_TOKEN` (supports Argon2 PHC hash or plaintext)
- Cookie-based session management
- Configurable session lifetime (`ADMIN_SESSION_LIFETIME`)
- Rate limited per IP (`ADMIN_RATELIMIT_SECONDS`, `ADMIN_RATELIMIT_MAX_BURST`)

### Features
- **User Management**: List, invite, delete, enable/disable, remove 2FA, force logout
- **Organization Management**: List, delete organizations
- **Configuration**: Runtime config updates (saved to `config.json`)
- **Database Backup**: SQLite backup trigger
- **SMTP Testing**: Send test emails
- **Diagnostics**: System info, version, DNS resolution, time info, config dump
- **SSO User Management**: Remove SSO links

### Admin UI
- Server-side rendered Handlebars templates
- Bootstrap-based styling (SCSS compiled with grass)
- JavaScript for interactive features
- Embedded static assets

---

## 14. Organization & Group Management

### Organization Hierarchy
```
Organization
├── Members (Owner, Admin, Manager, User)
├── Collections
│   ├── Items (Ciphers)
│   └── User Permissions (read_only, hide_passwords, manage)
├── Groups
│   ├── Members
│   └── Collection Permissions
└── Policies
```

### Membership Types
| Type | Value | Capabilities |
|------|-------|-------------|
| Owner | 0 | Full control, manage other owners |
| Admin | 1 | Manage members, collections, groups |
| Manager | 2 | Manage assigned collections |
| User | 3 | Access assigned collections |

### Organization Policies
- Master password requirements
- Two-factor enforcement
- Single organization restriction
- Password generator settings
- Personal vault restrictions
- Reset password enrollment

### Groups (Optional, `ORG_GROUPS_ENABLED`)
- Named groups with member assignments
- Collection-level permissions per group
- Bulk operations (add/remove members, delete groups)

### LDAP/Directory Import
- `POST /organizations/<id>/import` - Import users and groups
- `POST /public/organization/import` - API key authenticated import
- Supports adding/removing members and group assignments

---

## 15. Bitwarden Send

### Overview
Temporary, encrypted sharing mechanism for text or files.

### Send Types
| Type | ID | Storage |
|------|-----|---------|
| Text | 0 | Encrypted in database |
| File | 1 | Encrypted file on disk/S3 |

### Features
- **Password Protection**: Optional PBKDF2-hashed password (100,000 iterations)
- **Access Limits**: Configurable max access count
- **Expiration**: Both expiration date and mandatory deletion date
- **Email Privacy**: Option to hide sender email
- **Disable/Enable**: Can be toggled without deletion

### Lifecycle
1. Creator creates Send with encrypted data + deletion date
2. Send gets unique access ID (BASE64URL encoded)
3. Recipient accesses via `/sends/<id>/access`
4. If password-protected, recipient must provide password
5. Access count incremented on each access
6. Send auto-purged after deletion date (background job)

---

## 16. Emergency Access

### Overview
Dead-man's switch for vault access. Trusted contacts can request access after a configurable waiting period.

### Access Types
| Type | ID | Capability |
|------|-----|-----------|
| View | 0 | Read-only access to grantor's vault |
| Takeover | 1 | Full account takeover (password reset) |

### Status Lifecycle
```
Invited(0) → Accepted(1) → Confirmed(2) → RecoveryInitiated(3) → RecoveryApproved(4)
```

### Flow
1. Grantor invites trusted contact
2. Grantee accepts invitation
3. Grantor confirms (shares encrypted key)
4. [Crisis] Grantee initiates recovery
5. Grantor notified, has `wait_time_days` to reject
6. If not rejected, access auto-approved after waiting period
7. Grantee can view vault or takeover account

### Background Jobs
- Emergency notification reminders (cron)
- Automatic timeout/approval after waiting period (cron)

---

## 17. Icon/Favicon Service

### Providers
| Provider | Config Value | Source |
|----------|-------------|--------|
| Internal | `internal` | Direct download + cache |
| Bitwarden | `bitwarden` | icons.bitwarden.net |
| DuckDuckGo | `duckduckgo` | icons.duckduckgo.com |
| Google | `google` | www.google.com/s2/favicons |

### Internal Provider Features
- Multi-source icon resolution (HTML parsing for `<link>` tags)
- SVG sanitization (`svg-hush` crate)
- Icon caching with configurable TTL
- Negative cache for failed lookups
- Cookie handling for icon downloads
- SSRF protection (blocks private IP ranges by default)

### Configuration
- `ICON_CACHE_TTL` - Positive cache duration (default: 2592000 = 30 days)
- `ICON_CACHE_NEGTTL` - Negative cache duration (default: 259200 = 3 days)
- `ICON_DOWNLOAD_TIMEOUT` - Download timeout (default: 10 seconds)
- `DISABLE_ICON_DOWNLOAD` - Completely disable icon fetching

---

## 18. Rate Limiting & Security

### Rate Limiters
| Limiter | Target | Config | Default |
|---------|--------|--------|---------|
| Login | IP address | `LOGIN_RATELIMIT_SECONDS/MAX_BURST` | Configurable |
| Admin | IP address | `ADMIN_RATELIMIT_SECONDS/MAX_BURST` | Configurable |

Uses `governor` crate with `DashMap` state store.

### Security Measures
1. **SSRF Protection**: `HTTP_REQUEST_BLOCK_NON_GLOBAL_IPS` blocks internal network requests
2. **Request Blocking**: `HTTP_REQUEST_BLOCK_REGEX` for URL pattern blocking
3. **CORS**: Proper CORS headers on all responses
4. **CSP**: Content Security Policy headers
5. **Secure Headers**: HSTS, X-Frame-Options (configurable ancestors)
6. **Input Sanitization**: HTML stripping in email context
7. **Constant-Time Comparison**: For password/token verification
8. **Security Stamp**: Token invalidation on security events
9. **TLS Support**: Built-in Rocket TLS (`ROCKET_TLS`)

### Anti-Abuse
- Signup restrictions: domain whitelist, email verification
- Invitation-only mode
- Configurable password hint visibility
- Incomplete 2FA tracking and notification

---

## 19. Background Jobs & Scheduling

### Scheduled Jobs (via `job_scheduler_ng`)

| Job | Schedule Config | Default | Description |
|-----|----------------|---------|-------------|
| Send Purge | `SEND_PURGE_SCHEDULE` | Every 5 min | Delete expired sends |
| Trash Purge | `TRASH_PURGE_SCHEDULE` | Daily | Auto-delete trashed items |
| Incomplete 2FA | `INCOMPLETE_2FA_SCHEDULE` | Every 5 min | Notify about incomplete 2FA logins |
| Emergency Notification | `EMERGENCY_NOTIFICATION_REMINDER_SCHEDULE` | Daily | Remind about pending emergency requests |
| Emergency Timeout | `EMERGENCY_REQUEST_TIMEOUT_SCHEDULE` | Every 5 min | Auto-approve timed-out emergency requests |
| Auth Request Cleanup | `AUTH_REQUEST_PURGE_SCHEDULE` | Every 5 min | Clean expired auth requests |
| Duo Context Cleanup | `DUO_CONTEXT_PURGE_SCHEDULE` | Every 5 min | Clean expired Duo contexts |
| Event Cleanup | `EVENT_CLEANUP_SCHEDULE` | Daily | Purge old audit events |
| SSO Auth Cleanup | `PURGE_INCOMPLETE_SSO_AUTH` | Every 5 min | Clean incomplete SSO sessions |

### Job Configuration
- `JOB_POLL_INTERVAL_MS` - Scheduler poll interval (default: 30000ms)
- All schedules use cron syntax
- Jobs run in a dedicated thread

---

## 20. Deployment & Docker

### Docker Image
- **Base**: debian:trixie-slim
- **Multi-stage build**: Rust compile → minimal runtime
- **Cross-compilation**: Supports multiple architectures via `xx` helper
- **Runtime deps**: ca-certificates, curl, libmariadb3, libpq5, openssl

### Docker Configuration
```dockerfile
EXPOSE 80
VOLUME /data
HEALTHCHECK CMD /healthcheck.sh
CMD ["/start.sh"]
```

### Build Profiles
| Profile | Use Case | Optimization |
|---------|----------|-------------|
| `release` | Production | Fat LTO, 1 codegen unit, strip debuginfo |
| `release-micro` | Minimal size | opt-level z, strip symbols |
| `release-low` | Low resources | Thin LTO, 16 codegen units |
| `ci` | CI/CD | Optimized compile time |

### Feature Flags
| Flag | Description |
|------|-------------|
| `sqlite` | SQLite backend |
| `mysql` | MySQL backend |
| `postgresql` | PostgreSQL backend |
| `vendored_openssl` | Static OpenSSL |
| `enable_mimalloc` | MiMalloc allocator |
| `s3` | AWS S3 storage |
| `enable_syslog` | Syslog output |
| `unstable` | Unstable features |

### Storage Options
- **Local filesystem**: Default, data in `DATA_FOLDER`
- **AWS S3**: Optional via `s3` feature flag, using `opendal` crate

### Data Layout
```
DATA_FOLDER/
├── db.sqlite3          # Database (SQLite)
├── rsa_key.pem         # RSA private key
├── rsa_key.pub.pem     # RSA public key
├── config.json         # Runtime config overrides
├── icon_cache/         # Favicon cache
├── attachments/        # Cipher attachments
├── sends/              # Send files
└── tmp/                # Temporary files
```

---

## 21. Known Limitations & Potential Issues

### Security Considerations
1. **Single Admin Token**: No role-based admin access — single shared token
2. **No Built-in WAF**: Relies on reverse proxy for WAF capabilities
3. **PBKDF2 Default**: While Argon2id is supported client-side, server-side still uses PBKDF2
4. **Admin Token Storage**: Supports plaintext admin tokens (Argon2 hash recommended)
5. **No Audit Log by Default**: `ORG_EVENTS_ENABLED` is off by default

### Compatibility Issues
1. **Premium Features**: All premium features are free — may conflict with official Bitwarden licensing expectations
2. **API Compatibility**: Must track upstream Bitwarden API changes; lag possible
3. **Web Vault**: Requires separate web vault build from official Bitwarden repo
4. **Push Notifications**: Requires registration with Bitwarden push relay (third-party dependency)

### Scalability Concerns
1. **Single Process**: No built-in clustering or horizontal scaling
2. **SQLite Limitations**: Single-writer lock for SQLite (WAL mode helps but has limits)
3. **In-Memory WebSocket State**: WebSocket connections tracked in-memory, lost on restart
4. **Connection Pool**: Fixed pool size per instance

### Feature Gaps vs Official Bitwarden
1. **No Directory Connector**: LDAP import exists but no full directory sync
2. **No Provider Portal**: MSP features not implemented
3. **No Key Connector**: Enterprise key management not supported
4. **No Passwordless Login**: Auth request flow partially implemented
5. **Limited Organization Features**: Some enterprise policies may be missing

### Potential Bugs / Edge Cases
1. **Race Conditions**: WebSocket state management uses DashMap but complex multi-step operations may have TOCTOU issues
2. **Token Refresh Race**: Multiple clients refreshing simultaneously could conflict
3. **U2F Migration**: Automatic U2F→WebAuthn migration may fail for edge-case credential formats
4. **Attachment Size**: Large attachments (up to 525MB limit) may cause memory pressure
5. **Icon Fetching**: External icon downloads could be slow or hang despite timeout
6. **Clock Skew**: JWT validation sensitive to server time accuracy
7. **Database Migrations**: Cross-database compatibility for complex migrations may have edge cases

---

## 22. Feature Comparison with Official Bitwarden

| Feature | Vaultwarden | Official Bitwarden |
|---------|------------|-------------------|
| Password vault | Yes | Yes |
| Secure notes | Yes | Yes |
| Card/Identity storage | Yes | Yes |
| SSH Key storage | Yes | Yes |
| File attachments | Yes (free) | Premium |
| TOTP generator | Yes (free) | Premium |
| Organizations | Yes (free, unlimited) | Paid plans |
| Collections | Yes | Yes |
| Groups | Yes (optional) | Enterprise |
| Bitwarden Send | Yes | Yes |
| Emergency Access | Yes | Premium |
| 2FA (TOTP) | Yes | Yes |
| 2FA (WebAuthn/FIDO2) | Yes | Premium |
| 2FA (Duo) | Yes | Enterprise |
| 2FA (YubiKey) | Yes | Premium |
| 2FA (Email) | Yes | Yes |
| SSO (OIDC) | Yes | Enterprise |
| Admin Panel | Yes (custom) | Yes (different) |
| Event Logging | Yes (optional) | Enterprise |
| HIBP Integration | Yes | Premium |
| Push Notifications | Yes (via relay) | Yes |
| WebSocket Sync | Yes | Yes |
| SQLite Support | Yes (primary) | No |
| MySQL Support | Yes | No (MSSQL) |
| PostgreSQL Support | Yes | No (MSSQL) |
| Resource Usage | ~50MB RAM | ~2GB+ RAM |
| Clustering | No | Yes |
| Enterprise Policies | Partial | Full |

---

## Appendix: Event Type Reference

### User Events (1000-1099)
| Code | Event |
|------|-------|
| 1000 | UserLoggedIn |
| 1001 | UserChangedPassword |
| 1002 | UserUpdated2fa |
| 1003 | UserDisabled2fa |
| 1004 | UserRecovered2fa |
| 1005 | UserFailedLogIn |
| 1006 | UserFailedLogIn2fa |
| 1007 | UserClientExportedVault |
| 1010 | UserRequestedDeviceApproval |

### Cipher Events (1100-1199)
| Code | Event |
|------|-------|
| 1100 | CipherCreated |
| 1101 | CipherUpdated |
| 1102 | CipherDeleted |
| 1103 | CipherAttachmentCreated |
| 1104 | CipherAttachmentDeleted |
| 1105 | CipherShared |
| 1106 | CipherUpdatedCollections |
| 1107 | CipherClientViewed |
| 1108 | CipherClientToggledPasswordVisible |
| 1109 | CipherClientToggledHiddenFieldVisible |
| 1110 | CipherClientToggledCardCodeVisible |
| 1111 | CipherClientCopiedPassword |
| 1112 | CipherClientCopiedHiddenField |
| 1113 | CipherClientCopiedCardCode |
| 1114 | CipherClientAutofilled |
| 1115 | CipherSoftDeleted |
| 1116 | CipherRestored |
| 1117 | CipherClientToggledCardNumberVisible |

### Collection Events (1300-1399)
| Code | Event |
|------|-------|
| 1300 | CollectionCreated |
| 1301 | CollectionUpdated |
| 1302 | CollectionDeleted |

### Group Events (1400-1499)
| Code | Event |
|------|-------|
| 1400 | GroupCreated |
| 1401 | GroupUpdated |
| 1402 | GroupDeleted |

### Organization User Events (1500-1599)
| Code | Event |
|------|-------|
| 1500 | OrganizationUserInvited |
| 1501 | OrganizationUserConfirmed |
| 1502 | OrganizationUserUpdated |
| 1503 | OrganizationUserRemoved |
| 1504 | OrganizationUserUpdatedGroups |
| 1505 | OrganizationUserUnlinkedSso |
| 1506 | OrganizationUserResetPasswordEnroll |
| 1507 | OrganizationUserResetPasswordWithdraw |
| 1508 | OrganizationUserAdminResetPassword |
| 1511 | OrganizationUserRevoked |
| 1512 | OrganizationUserRestored |
| 1513 | OrganizationUserApprovedAuthRequest |
| 1514 | OrganizationUserRejectedAuthRequest |
| 1515 | OrganizationUserDeleted |
| 1516 | OrganizationUserLeft |

### Organization Events (1600-1699)
| Code | Event |
|------|-------|
| 1600 | OrganizationUpdated |
| 1601 | OrganizationPurgedVault |
| 1602 | OrganizationClientExportedVault |

### Policy Events (1700+)
| Code | Event |
|------|-------|
| 1700 | PolicyUpdated |
