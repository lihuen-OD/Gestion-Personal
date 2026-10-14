# Security Standards

## Objective

Every system must be secure by default.

Security must be reviewed in every change that touches:
- authentication
- authorization
- users
- roles
- permissions
- files
- payments
- personal data
- business-critical data
- admin panels
- database access
- external integrations

## Golden rules

- Never trust the frontend.
- Validate on the backend.
- Enforce permissions on the backend.
- Never expose secrets.
- Never store plain passwords.
- Never log tokens or credentials.
- Never return sensitive fields unless required.
- Prefer deny-by-default.
- Fail safely.

## Authentication

Check:
- endpoints that require authentication are protected
- tokens are validated
- expired tokens are rejected
- password hashing is strong
- login errors do not leak unnecessary information
- sessions/tokens are stored safely

## Authorization

Check:
- roles are enforced server-side
- users can only access allowed resources
- admin endpoints are protected
- ownership is validated
- permissions are not only hidden in the UI

## Public clock endpoints (fichador)

The fichador has no user session, so its four operational routes are not behind `requireAuth`. Since F6 of the standalone fichador plan (`docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md`) each of them requires an individually authenticated **`ClockDevice` in status `ACTIVE`** (see "Clock device authentication" below). Since F7 they live under the device namespace `/api/clock/*` (module `clock`) and the same mount is kept as a **deprecated alias** under `/api/time-entries/clock/*` until F11 (same guards, same limiter instances, same controller and service; responses carry `Deprecation: @1791849600`). These are the **only** operational routes reachable with a device credential:

| Route (`/api/clock/…`; alias `/api/time-entries/clock/…`) | Purpose | Exposes |
|---|---|---|
| `GET /employees?search=` | Search `ACTIVO` employees by name (min 2 chars, max 12 results) | id, legajo, first/last name, **last 3 DNI digits** (`dniSuffix`) |
| `POST /status` | Open shift of the selected employee | same employee label + open shift `{id, startAt}` |
| `POST /photo-punch` | Clock in/out **with photo**, idempotent by `requestId`, with per-employee cooldown | employee label, shift times/totals, segment labels |
| `GET /attempts/:requestId?employeeId=` | State of a punch attempt **of the same device** (network-failure recovery) | same as photo-punch |

Rules:
- guard order per route: a per-IP limiter **before** authentication (`CLOCK_IP_RATE_LIMIT_MAX`, slows credential brute force without touching the database), then `requireClockDevice()`, then a per-device limiter keyed by the **already authenticated** device id (`CLOCK_RATE_LIMIT_MAX`), so an invented device id never creates a bucket and kiosks behind the same NAT do not share one small quota. All of them are separate from the global API limiter. Both namespaces share the **same limiter instances** (one bucket per IP and one per device, never one per namespace). The per-IP layer only works with a correct `TRUST_PROXY_HOPS` (see "Client IP behind proxies")
- the punch channel is decided by the route, never by the client: `/api/clock/*` records `source = KIOSK`, the legacy alias keeps `PUBLIC_CLOCK_PHOTO`; a `source` or `deviceId` in the body is dropped by the schema. Historical punches are never rewritten
- **cooldown (F7)** is a business rule, not a rate limit: a different punch (new `requestId`) of the same employee within `CLOCK_PUNCH_COOLDOWN_SECONDS` of their last non-rejected `AttendancePunch` — from any device, through either namespace — gets `409 CLOCK_PUNCH_COOLDOWN`. It is measured with the server clock only. Idempotency runs first (a retry of the same `requestId` returns the stored result, never a cooldown). It is race-proof: the write transaction starts with a **non-blocking per-employee advisory lock** (`pg_try_advisory_xact_lock(hashtextextended('clock-punch:<employeeId>', 0))`) and only then reads the last punch, so two simultaneous punches of the same employee on two kiosks produce exactly one `AttendancePunch`; the loser fails immediately (no waiting, no global lock, other employees unaffected). The lock is always taken before the closure locks (D-5), so the lock order is fixed
- the `/clock` namespaces are closed: any other `/api/clock/*` or `/time-entries/clock/*` path answers `404 ROUTE_NOT_FOUND` with or without a credential and never falls through to `requireAuth` or the `/:id` routes. **There is no photo-less punch path** — `POST /clock/in`, `/clock/out`, `/clock/status-by-dni`, `/clock/in-by-dni` and `/clock/out-by-dni` were removed in F0 (they let anyone clock any employee in/out by id or DNI)
- the full DNI, CUIL, enabled hour concepts and internal `TimeEntry`/`TimeSegment` rows never leave the backend through these routes; attempts stored before F0 are projected to the same public shape when read back
- **`faceValidationStatus` on the photo-punch endpoint is a client-reported result (MediaPipe running in the browser), not a server-side biometric verification.** The backend only checks that the client claims a valid detection — it never re-validates the uploaded photo against the employee's identity. Treat it as an anti-mistake UX signal, not a security control, until real server-side face matching is implemented
- idempotency is enforced via `ClockPunchAttempt.requestId` (unique); concurrent double ingress is also blocked at the database level by the partial unique index `WorkShift_one_open_per_employee` (mapped to a clean 409, not a 500)

### Clock device authentication (`ClockDevice`, F5 enrollment + F6 enforcement)

There is **no shared kiosk secret anymore**. The former `x-clock-device-token` header and the `CLOCK_DEVICE_TOKEN` / `VITE_CLOCK_DEVICE_TOKEN` variables were removed in F6: the header authenticates nothing (`401`), and the fichador build fails if the hosting still defines the retired variable. Compromising one iPad no longer compromises every kiosk.

Credential, the only accepted format: `Authorization: ClockDevice <uuid>.<base64url-secret>`. The secret is 32 random bytes (`randomBytes(32)`), returned once at registration and stored by the PWA in IndexedDB (never in Cache Storage: `/api` is never handled by the service worker). The database stores only its SHA-256 (`tokenHash`); verification hashes the presented secret and uses `timingSafeEqual`. bcrypt/argon2 are intentionally not used because this is a high-entropy random secret, not a human password.

`requireClockDevice()` (`backend/src/modules/clock-devices/clockDeviceAuthentication.ts`) is the single middleware for every device route, in both namespaces:
- malformed header, unknown id and wrong secret answer the same `401 CLOCK_DEVICE_INVALID_CREDENTIAL`; a well-formed id always performs the primary-key lookup and the hash comparison (against a dummy hash when the id does not exist), so the response never says which part failed
- valid credential in a non-allowed state: `403 CLOCK_DEVICE_REVOKED` or `403 CLOCK_DEVICE_NOT_ACTIVE`. Operational routes allow only `ACTIVE`; the enrollment routes (`/clock/device/status`, `/clock/device/pairing-code/refresh`) explicitly allow every state so a `PENDING` device can poll and a `REVOKED` one can learn it was revoked
- it attaches `req.clockDevice = { id, status, name }` and never `tokenHash`, `pairingCodeHash` or `req.user`. A JWT never opens a device route and a device credential never opens an admin route (both directions covered by `app.clockDeviceIsolation.test.ts`)
- cost: one indexed lookup by primary key plus a SHA-256 (~2 µs); no cache, so a revocation is effective on the very next request
- **A device's location (`ClockDevice.establishmentId`, Locations tree) is metadata, not authorization.** An `ACTIVE` device can search and punch any active employee, including employees outside its establishment; `ClockDevice.sectorId` was dropped by M2 of the org reorganization (`docs/decisions/ORG_LOCATION_REORGANIZATION.md`). Restricting a device to its location is an open business decision (plan §25.2); never assume location = permission.
- **Known debt — rate limits are in-memory per process** (`express-rate-limit` default store). With the single backend instance planned today the configured quotas are exact; with N instances each one keeps its own buckets, so the effective per-IP and per-device limits become N× the configured values, and every deploy/restart resets them. A shared store (e.g. Redis) is future hardening (plan §25.3), not implemented

Attribution: `AttendancePunch.deviceId` and `ClockPunchAttempt.deviceId` are written **only** from `req.clockDevice.id`; the request body cannot choose them, and the punch IP / user-agent come from the request (`req.ip`, `User-Agent`), never from the body. Historical rows keep `deviceId = NULL`; there is no backfill. `requestId` stays globally unique: an attempt can only be read (`GET …/attempts/:requestId`) or replayed (`POST …/photo-punch` with the same key) by the device that created it — another device, or a pre-F6 attempt without a device, gets the same `404` / `409 CLOCK_IDEMPOTENCY_KEY_REUSED` as an unknown key, never the stored result.

Technical actor in the audit trail (F7): a device is never turned into a `User`. The punch `AuditLog` (`CREATE WorkShift`) keeps `userId = NULL` (no human actor), names the device in the human description (`… desde el dispositivo de fichada "<nombre>" …`, never its UUID) and stores the technical actor only in metadata (`after.actorClockDeviceId`, plus `after.source`); the admin audit UI hides `*Id` keys. No hash, secret or pairing data is ever written. A device cannot forge another actor: the id and name come from `requireClockDevice`. Rejected punches (cooldown, open/closed shift, face validation) are traced by `ClockPunchAttempt` (`FAILED` + `errorCode` + `deviceId`), not by `AuditLog`, so a device cannot turn retries into audit spam.

Presence: on operational routes the middleware refreshes `lastSeenAt`, `lastIp`, `lastUserAgent` and `lastAppVersion` at most once per minute per device, conditionally and without blocking the response. `X-Clock-App-Version` is informative only and validated as a short version string; it never takes part in authentication.

Heartbeat (F9): `POST /api/clock/heartbeat`.

- **Guards:** a per-IP limiter before authentication, `requireClockDevice()`
  (`ACTIVE` only; no JWT, no body identity), then a per-device limiter keyed
  by the authenticated id (10 / 5 min). Both are separate instances from the
  operational limiters, so presence never eats the punch quota.
- **Write:** IP, user-agent and version come from the request and the header;
  the body is never read. A single `UPDATE … WHERE status = 'ACTIVE'` keeps a
  device revoked mid-request from being marked as seen.
- **Response:** device id, name, status and establishment, plus `serverTime`.
  Never hashes, IP or user-agent.
- **No audit:** each ping is technical presence and writes no `AuditLog` row.
- **Not cached:** the service worker never caches it, like every other `/api`
  call.
- **Admin connectivity:** derived from `lastSeenAt` and never persisted. A
  `REVOKED` device is never shown online.

RRHH device management (F9): `PATCH /api/clock-devices/:id`.

- **Access:** `requireAuth` plus the RRHH role, like the rest of
  `/api/clock-devices`.
- **Body:** a `.strict()` schema that accepts only `name` and
  `establishmentId`. Status, credentials, timestamps and presence are
  rejected, so there is no mass assignment.
- **Edits:** a `REVOKED` device is not editable. Every real change writes an
  `UPDATE` audit row with before/after (name, establishment) and the RRHH
  user. No hashes, IP or user-agent are ever stored in it.
- **Stale `PENDING` cleanup:** automatic, system actor, audited. It deletes
  only never-activated devices with no punches and no attempts; the
  conditions are repeated in every `DELETE`, and the FKs stay `Restrict`.

Logging: request logs never include headers; `/health/client-ip` never echoes `Authorization`; the presence-update failure log carries only the device id and the error message; `CLOCK_ATTEMPT_FAILED` carries request/employee/device ids, source and the error code, never the photo, the credential or the token hash. A rejected device request (`403`) is recorded by the global "Acceso denegado" audit rule like any other forbidden request; searches, status reads and attempt polling add no audit noise. A punch that is confirmed writes exactly one `AuditLog` row (see "Technical actor" above).

### Individual device enrollment (F5)

Pairing codes have 8 non-ambiguous characters, expire after 10 minutes and are
also stored only as SHA-256. Clear codes exist only in the register/refresh
response and PWA memory. Admin DTOs are allow-listed and never include either
hash or any secret. Registration, status, refresh and RRHH resolution have
separate rate limits; registration also caps concurrent pending requests.

Only Nivel 1 RRHH can list, resolve, activate, revoke or delete a pending
device. Activation/revocation/deletion are audited with human text. Public
registration deliberately does not create AuditLog rows to avoid an
unauthenticated audit-spam vector.

**Boundary:** since F6 the device state is enforced server-side on every punch route; the PWA lock screens for `PENDING`/`REVOKED` are UX on top of that control, not the control itself. The admin app no longer has a working fichador: `/fichador` only points to the standalone app.

### Hosting headers of the fichador site

`fichador/scripts/hosting-headers.mjs` generates `dist/_headers`: `nosniff`, `strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, HSTS, `Permissions-Policy` with the camera for its own origin only, and a CSP limited to `'self'` and the environment's API origin (since F3 MediaPipe and Inter are self-hosted; no `unsafe-inline`/`unsafe-eval`, only `'wasm-unsafe-eval'`). The CSP ships as **Report-Only** until it is validated on Safari/iPad over HTTPS (it is already validated enforced in Chromium). Details: plan §20.3.

## Client IP behind proxies (`trust proxy`)

`req.ip` feeds rate limiting, `AuditLog.ipAddress` and `AttendancePunch.ipAddress`. Express trusts exactly `TRUST_PROXY_HOPS` proxy hops (`backend/src/shared/http/clientIp.ts`, applied first thing in `createApp()`):

- `0` (default) = do not trust `X-Forwarded-For`; `req.ip` is the socket address. This is the correct value for **direct local development**. Behind a proxy (e.g. the future backend deploy) it means **every client shares the proxy's IP** — one rate-limit bucket for everybody and the proxy's address in audit/punch records. Production logs a startup warning while it stays at 0
- `N` = the exact number of proxies between the client and Express. Entries a client prepends to `X-Forwarded-For` never become `req.ip`. **A value above the real count lets a client choose its IP**, so the value is measured, never guessed, and `true` is never used
- **measuring it is a prerequisite of the first real backend deploy** (and of any later proxy/CDN change in front of it). Do not take the value from external docs or examples (no assumed 1, 2 or 3). VS Code Dev Tunnels was only a temporary review tool and is not part of the deployment architecture: it is not measured or configured
- measure it in the deployed environment with `CLIENT_IP_DIAGNOSTICS_ENABLED=true` + `GET /api/health/client-ip` (own rate limit, returns only the caller's IP and proxy chain, never credentials), following the procedure in the plan's F0 section; turn the probe off afterwards
- nothing reads client IP headers manually; always use `req.ip`

## Input validation

Validate:
- required fields
- data types
- lengths
- formats
- enums
- dates
- numbers and ranges
- IDs
- file types
- file sizes

## Sensitive data

Never expose:
- passwords
- password hashes
- refresh tokens
- private tokens
- API keys
- database URLs
- SMTP credentials
- internal stack traces
- private environment variables

### PII por rol — estado y decisiones pendientes

- Nivel 3 no accede al legajo integral (los endpoints operativos que necesita devuelven datos redactados, ver `redactPiiForRole`). Desde la Etapa 15D.4 (`docs/decisions/DOCUMENT_CATEGORY_AUTHORIZATION_15D4.md`) ya NO está bloqueado por completo de `/api/documents` — puede ver/listar/descargar/subir sólo los documentos de categorías cuyo `viewRoles`/`uploadRoles` lo incluya explícitamente, y siempre dentro de su alcance por empleado (`employeeAccessWhere`). Por default (categorías no configuradas explícitamente para Nivel 3) el efecto práctico sigue siendo "sin acceso", igual que antes de esta etapa.
- Supervisión conserva PII completa por decisión actual. Un recorte posterior debe validar primero sus pantallas de gestión.
- La evidencia fotográfica de asistencia continúa disponible para Nivel 3 y queda pendiente de una decisión específica de producto y seguridad.

## CORS

Production CORS must:
- allow only known frontend origins
- avoid `*` when credentials are used
- be configured with environment variables
- be reviewed after deploy URL changes

## Upload security

For file uploads:
- validate MIME type
- validate extension
- validate size
- rename files safely
- avoid executable paths
- store outside source code when possible
- restrict access if files are private
- scan or sanitize when needed

## Database security

Check:
- ORM is used safely
- raw queries are parameterized
- users cannot access unauthorized records
- destructive operations require permission
- soft delete/audit is considered for important records

## Error security

Errors must not expose:
- stack traces in production
- SQL details
- internal file paths
- secrets
- tokens
- private server info

## Dependency security

Before adding dependencies:
- verify need
- prefer maintained libraries
- avoid abandoned packages
- check known vulnerabilities
- avoid huge dependencies for small tasks
