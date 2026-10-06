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

The fichador has no user session, so its four routes are not behind `requireAuth`. After F0 of the standalone fichador plan (`docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md`) these are the **only** routes reachable with the kiosk credential:

| Route | Purpose | Exposes |
|---|---|---|
| `GET /time-entries/clock/employees?search=` | Search `ACTIVO` employees by name (min 2 chars, max 12 results) | id, legajo, first/last name, **last 3 DNI digits** (`dniSuffix`) |
| `POST /time-entries/clock/status` | Open shift of the selected employee | same employee label + open shift `{id, startAt}` |
| `POST /time-entries/clock/photo-punch` | Clock in/out **with photo**, idempotent by `requestId` | employee label, shift times/totals, segment labels |
| `GET /time-entries/clock/attempts/:requestId?employeeId=` | State of a punch attempt (network-failure recovery) | same as photo-punch |

Rules:
- each route carries the kiosk token check and its own rate limiter (`CLOCK_RATE_LIMIT_*`, one bucket per client IP), separate from the global API limiter. Per-IP buckets only work with a correct `TRUST_PROXY_HOPS` (see "Client IP behind proxies")
- the `/clock` namespace is closed: any other `/time-entries/clock/*` path answers `404 ROUTE_NOT_FOUND` with or without the token and never falls through to `requireAuth` or the `/:id` routes. **There is no photo-less punch path** — `POST /clock/in`, `/clock/out`, `/clock/status-by-dni`, `/clock/in-by-dni` and `/clock/out-by-dni` were removed in F0 (they let anyone clock any employee in/out by id or DNI)
- the full DNI, CUIL, enabled hour concepts and internal `TimeEntry`/`TimeSegment` rows never leave the backend through these routes; attempts stored before F0 are projected to the same public shape when read back
- **`faceValidationStatus` on the photo-punch endpoint is a client-reported result (MediaPipe running in the browser), not a server-side biometric verification.** The backend only checks that the client claims a valid detection — it never re-validates the uploaded photo against the employee's identity. Treat it as an anti-mistake UX signal, not a security control, until real server-side face matching is implemented
- idempotency is enforced via `ClockPunchAttempt.requestId` (unique); concurrent double ingress is also blocked at the database level by the partial unique index `WorkShift_one_open_per_employee` (mapped to a clean 409, not a 500)

### Device token (`x-clock-device-token`) — temporary, to be replaced by `ClockDevice`

What exists today (`backend/src/middlewares/clockDeviceAuth.ts`): the four routes above require one shared secret in the `x-clock-device-token` header (`CLOCK_DEVICE_TOKEN` / `VITE_CLOCK_DEVICE_TOKEN`), compared with `crypto.timingSafeEqual`.

**The shared secret is a temporary solution and will be replaced by `ClockDevice` (per-device identity, enrollment approved by RRHH, revocable) in stages F4–F6 of `docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md`.** Until then:

- the token is **not a secret**: it is a `VITE_*` variable, so Vite inlines it into the JavaScript chunk of `TimeClockPage`, which the admin site serves without login. Anyone who can load that site can read it. Moving it to another env var or another `VITE_*` name would not change that
- whoever has it can use exactly the four routes above (search active employees by name, read their open shift, punch **with a photo**, read attempts) and nothing else; it gives no access to any admin endpoint, and admin JWTs give no access to these routes
- if `CLOCK_DEVICE_TOKEN` is unset in `NODE_ENV=production`, the middleware **fails closed** (`503 CLOCK_DEVICE_NOT_CONFIGURED`); in development/test/demo it lets requests through with a one-time warning
- it cannot tell kiosks apart or revoke one of them; `AttendancePunch.deviceId`/`kioskId` stay unused until F4

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
