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

The fichador has no user session, so its four routes are not behind `requireAuth`. Since F6 of the standalone fichador plan (`docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md`) each of them requires an individually authenticated **`ClockDevice` in status `ACTIVE`** (see "Clock device authentication" below). These are the **only** routes reachable with a device credential:

| Route | Purpose | Exposes |
|---|---|---|
| `GET /time-entries/clock/employees?search=` | Search `ACTIVO` employees by name (min 2 chars, max 12 results) | id, legajo, first/last name, **last 3 DNI digits** (`dniSuffix`) |
| `POST /time-entries/clock/status` | Open shift of the selected employee | same employee label + open shift `{id, startAt}` |
| `POST /time-entries/clock/photo-punch` | Clock in/out **with photo**, idempotent by `requestId` | employee label, shift times/totals, segment labels |
| `GET /time-entries/clock/attempts/:requestId?employeeId=` | State of a punch attempt **of the same device** (network-failure recovery) | same as photo-punch |

Rules:
- guard order per route: a per-IP limiter **before** authentication (`CLOCK_IP_RATE_LIMIT_MAX`, slows credential brute force without touching the database), then `requireClockDevice()`, then a per-device limiter keyed by the **already authenticated** device id (`CLOCK_RATE_LIMIT_MAX`), so an invented device id never creates a bucket and kiosks behind the same NAT do not share one small quota. All of them are separate from the global API limiter. The per-IP layer only works with a correct `TRUST_PROXY_HOPS` (see "Client IP behind proxies")
- the `/clock` namespace is closed: any other `/time-entries/clock/*` path answers `404 ROUTE_NOT_FOUND` with or without a credential and never falls through to `requireAuth` or the `/:id` routes. **There is no photo-less punch path** — `POST /clock/in`, `/clock/out`, `/clock/status-by-dni`, `/clock/in-by-dni` and `/clock/out-by-dni` were removed in F0 (they let anyone clock any employee in/out by id or DNI)
- the full DNI, CUIL, enabled hour concepts and internal `TimeEntry`/`TimeSegment` rows never leave the backend through these routes; attempts stored before F0 are projected to the same public shape when read back
- **`faceValidationStatus` on the photo-punch endpoint is a client-reported result (MediaPipe running in the browser), not a server-side biometric verification.** The backend only checks that the client claims a valid detection — it never re-validates the uploaded photo against the employee's identity. Treat it as an anti-mistake UX signal, not a security control, until real server-side face matching is implemented
- idempotency is enforced via `ClockPunchAttempt.requestId` (unique); concurrent double ingress is also blocked at the database level by the partial unique index `WorkShift_one_open_per_employee` (mapped to a clean 409, not a 500)

### Clock device authentication (`ClockDevice`, F5 enrollment + F6 enforcement)

There is **no shared kiosk secret anymore**. The former `x-clock-device-token` header and the `CLOCK_DEVICE_TOKEN` / `VITE_CLOCK_DEVICE_TOKEN` variables were removed in F6: the header authenticates nothing (`401`), and the fichador build fails if the hosting still defines the retired variable. Compromising one iPad no longer compromises every kiosk.

Credential, the only accepted format: `Authorization: ClockDevice <uuid>.<base64url-secret>`. The secret is 32 random bytes (`randomBytes(32)`), returned once at registration and stored by the PWA in IndexedDB (never in Cache Storage: `/api` is never handled by the service worker). The database stores only its SHA-256 (`tokenHash`); verification hashes the presented secret and uses `timingSafeEqual`. bcrypt/argon2 are intentionally not used because this is a high-entropy random secret, not a human password.

`requireClockDevice()` (`backend/src/modules/clock-devices/clockDeviceAuthentication.ts`) is the single middleware for every device route:
- malformed header, unknown id and wrong secret answer the same `401 CLOCK_DEVICE_INVALID_CREDENTIAL`; a well-formed id always performs the primary-key lookup and the hash comparison (against a dummy hash when the id does not exist), so the response never says which part failed
- valid credential in a non-allowed state: `403 CLOCK_DEVICE_REVOKED` or `403 CLOCK_DEVICE_NOT_ACTIVE`. Operational routes allow only `ACTIVE`; the enrollment routes (`/clock/device/status`, `/clock/device/pairing-code/refresh`) explicitly allow every state so a `PENDING` device can poll and a `REVOKED` one can learn it was revoked
- it attaches `req.clockDevice = { id, status, name, sectorId }` and never `tokenHash`, `pairingCodeHash` or `req.user`. A JWT never opens a device route and a device credential never opens an admin route (both directions covered by `app.clockDeviceIsolation.test.ts`)
- cost: one indexed lookup by primary key plus a SHA-256 (~2 µs); no cache, so a revocation is effective on the very next request

Attribution: `AttendancePunch.deviceId` and `ClockPunchAttempt.deviceId` are written **only** from `req.clockDevice.id`; the request body cannot choose them, and the punch IP / user-agent come from the request (`req.ip`, `User-Agent`), never from the body. Historical rows keep `deviceId = NULL`; there is no backfill. `requestId` stays globally unique: an attempt can only be read (`GET …/attempts/:requestId`) or replayed (`POST …/photo-punch` with the same key) by the device that created it — another device, or a pre-F6 attempt without a device, gets the same `404` / `409 CLOCK_IDEMPOTENCY_KEY_REUSED` as an unknown key, never the stored result.

Presence: on operational routes the middleware refreshes `lastSeenAt`, `lastIp`, `lastUserAgent` and `lastAppVersion` at most once per minute per device, conditionally and without blocking the response. `X-Clock-App-Version` is informative only and validated as a short version string; it never takes part in authentication.

Logging: request logs never include headers; `/health/client-ip` never echoes `Authorization`; the presence-update failure log carries only the device id and the error message. A rejected device request (`403`) is recorded by the global "Acceso denegado" audit rule like any other forbidden request; searches and successful operations add no audit noise (each punch is already traced by `AttendancePunch` / `ClockPunchAttempt`).

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
