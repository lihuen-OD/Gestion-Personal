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

`POST /time-entries/clock/*` and `GET /time-entries/clock/employees` are intentionally unauthenticated (public kiosk flow). Because of that:
- they carry their own rate limiter (`CLOCK_RATE_LIMIT_*` env vars), separate from the global API limiter
- `GET /clock/employees` only returns `ACTIVO` employees, never inactive/terminated ones
- **`faceValidationStatus` on the photo-punch endpoint is a client-reported result (MediaPipe running in the browser), not a server-side biometric verification.** The backend only checks that the client claims a valid detection — it never re-validates the uploaded photo against the employee's identity. Treat it as an anti-mistake UX signal, not a security control, until real server-side face matching is implemented.
- idempotency for the photo-punch path is enforced via `ClockPunchAttempt.requestId` (unique); the legacy DNI/employee-id clock-in/out paths have no request-level idempotency key, but concurrent double-submits are still blocked at the database level by the partial unique index `WorkShift_one_open_per_employee` (mapped to a clean 409, not a 500)

### Device token (`x-clock-device-token`) — status and pending risks

Product decision (2026-08): the fichador does not need a final production security solution at this stage. It stays functional for **demo / controlled internal use**; whether it later becomes a separate kiosk app consuming the legajos/fichadas API is a future decision, not implemented now. Do not build biometrics, VPN, IP allowlisting, or a separate kiosk app for this until that decision is made.

What exists today (`backend/src/middlewares/clockDeviceAuth.ts`): all `/clock/*` routes require a shared secret in the `x-clock-device-token` header (`CLOCK_DEVICE_TOKEN` / `VITE_CLOCK_DEVICE_TOKEN`), compared with `crypto.timingSafeEqual`. **This is an explicitly temporary mitigation, not final production security.**

- If `CLOCK_DEVICE_TOKEN` is unset in `NODE_ENV=production`, the middleware **fails closed**: every `/clock/*` request is rejected (`503 CLOCK_DEVICE_NOT_CONFIGURED`) instead of silently running the fichador with no device control.
- If unset in development/test/demo, requests are still allowed through (logged once as a warning) so local/demo setup isn't blocked.
- Legacy `POST /clock/in` and `/clock/out` remain in place alongside `/clock/in-by-dni` and `/clock/out-by-dni` — not retired yet.

Pending risks, left open on purpose for this stage:
- The fichador may migrate to a separate kiosk app later — this token scheme is not meant to survive that migration as-is.
- The token embedded in the frontend bundle is **not a strong secret**: anyone with access to the kiosk's served bundle or network traffic can read it.
- For real production use, device authentication, network restriction (VPN/IP allowlist), or a separate kiosk architecture still needs to be defined — none of that is implemented yet.

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

- Nivel 3 no accede al legajo integral ni a documentación; los endpoints operativos que necesita devuelven datos redactados.
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
