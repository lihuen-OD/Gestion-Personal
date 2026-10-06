# DevOps and Deployment Standards

## Objective

Make projects deployable, observable and stable in production.

## Performance and network plan

Before production deploy, review:

- `docs/PERFORMANCE_NETWORK_OPTIMIZATION_PLAN.md`

This plan defines how to measure endpoint latency, reduce network transfer, optimize database access, cache stable data and repeat the same process when new modules are added.

## Deployment checklist

Before deploy:
- build passes
- tests pass when available
- environment variables are configured
- database migrations are ready
- CORS is correct
- frontend points to correct backend
- backend connects to correct database
- logs do not expose secrets
- production error handling is enabled
- static files work if applicable

## Continuous Integration (CI)

### Where it lives

`.github/workflows/ci.yml` — three independent jobs, `backend`, `frontend` and `fichador`, run in parallel on every GitHub Actions run.

### When it runs

- Every push to `main`.
- Every pull request (against any base branch).

### What it validates

**`backend` job** (working directory `backend/`):
1. `npm ci` — install dependencies from the committed lockfile.
2. `npx prisma validate` — the Prisma schema is syntactically valid and internally consistent.
3. `npx prisma generate` — the Prisma Client can be generated from the current schema (this is what makes the TypeScript types used everywhere in `backend/src` resolve correctly).
4. `npm run typecheck` — the whole backend compiles under `tsc --noEmit`, no type errors.
5. `npm run test` — the full Vitest suite (unit tests; the repository/service layer is exercised through mocked Prisma clients, never a real database — see "No real database" below).
6. `npm run build` — the backend compiles to `dist/` the same way it would for a real deploy.

**`frontend` job** (working directory `frontend/`):
1. `npm ci`.
2. `npm run test` — the Vitest suite.
3. `npm run build` — runs `tsc -b && vite build`; there is no separate `typecheck` script in the frontend, so type-checking happens as the first half of this same step.

**`fichador` job** (working directory `fichador/`, standalone kiosk app since F1 of `docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md`):
1. `npm ci`.
2. `npm run test` — the Vitest suite.
3. `npm run typecheck:e2e` — the Playwright spec compiles (the e2e itself is not run in CI, same as the frontend journeys).
4. `npm run build` — `tsc -b && vite build`, then `scripts/check-bundle-isolation.mjs`, which fails the job if the kiosk imports anything outside `fichador/src` or its bundle contains admin modules.

If any job fails, the run is reported as failed on the commit/PR. **A failing CI run must be fixed before merging** — it means one of the checks above broke, not that anything was deployed or changed on any real environment (this workflow never deploys and never touches a real database, see below).

### No real database, no real secrets, no migrations

- `DATABASE_URL`, `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` in the `backend` job are **placeholder values hardcoded directly in the workflow file** (e.g. `postgresql://ci:ci@localhost:5432/ci_dummy`) — not real secrets, and there is nothing at `localhost:5432` in the runner for them to connect to. They exist only so that `backend/src/config/env.ts` (which validates these as required at import time) doesn't throw, and so `prisma validate`/`prisma generate` have a syntactically valid connection string to parse. The test suite mocks the Prisma client module-by-module (`vi.mock("../../shared/prisma/client", ...)`) and never opens a real connection, confirmed by running the full suite locally with these same dummy values.
- CI never runs `prisma migrate deploy` / `prisma migrate dev`, never seeds data, and never connects to the real Neon database used by local development or production.
- CI never deploys anything anywhere. It is a validation gate only.

### What to run locally before pushing

Backend (`cd backend`):
```bash
npm run typecheck
npm run test
npm run build
```
(`prisma validate`/`prisma generate` are worth running too if you touched `prisma/schema.prisma`: `npx prisma validate && npx prisma generate`.)

Frontend (`cd frontend`):
```bash
npm run test
npm run build
```

If all of these pass locally with your real `.env` in place, CI should pass too — the only behavioral difference is that CI uses placeholder env values instead of your real `.env`.

## Environment variables

Document every required variable:
- name
- purpose
- example value without secret
- required/optional
- used by frontend/backend
- production notes

Never commit real secrets.

### Variables por app y entorno (F2 del fichador standalone)

Tres apps desplegadas por separado (`docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md` §20): admin (`frontend/`), fichador (`fichador/`), backend (`backend/`). Cada frontend tiene sus propias variables en su propio sitio; cambiar una sólo requiere redeploy de ese sitio. **Toda variable `VITE_*` es pública** (Vite la inlinea en el JavaScript). Sin valores reales acá.

| App | Variable | Local | Testing | Producción futura | Notas |
|---|---|---|---|---|---|
| Admin | `VITE_API_URL` | `http://localhost:4002/api` | `https://<backend-test>/api` | `https://<api>/api` | URL absoluta del backend compartido |
| Admin | `VITE_DEMO_MODE` | `false` (`true` sólo en `.env.local` para accesos rápidos) | `false` | `false` | `true` publica credenciales demo en el bundle |
| Admin | `VITE_DEMO_*_EMAIL` / `_PASSWORD` | sólo `.env.local` | no definir | no definir | ídem |
| Fichador | `VITE_API_URL` | `http://localhost:4002/api` | `https://<backend-test>/api` | `https://<api>/api` | en el hosting el build exige `https://` |
| Fichador | `VITE_APP_VERSION` | opcional | opcional | opcional | versión informativa que ve el panel de RRHH; nunca autentica |
| Fichador | `NODE_VERSION` | — | `22` (en `fichador/netlify.toml`) | `22` | misma mayor que CI |
| Backend | `CORS_ORIGIN` | `http://localhost:5174,http://localhost:5175` | `https://<admin-test>,https://<fichador-test>` | `https://gestion.<dominio>,https://fichador.<dominio>` | lista explícita, sin `*` ni comodines de subdominio |
| Backend | `CLOCK_RATE_LIMIT_MAX` / `CLOCK_IP_RATE_LIMIT_MAX` / `CLOCK_RATE_LIMIT_WINDOW_MS` | `30` / `300` / `300000` | ídem salvo medición | ídem salvo medición | cupo de `/time-entries/clock/*` por dispositivo autenticado y, antes de autenticar, por IP |
| Backend | `TRUST_PROXY_HOPS` | `0` | medido (§18.5) | medido | nunca copiado de documentación |
| Backend | `CLIENT_IP_DIAGNOSTICS_ENABLED` | `false` | `false` (`true` sólo durante la medición) | `false` | |
| Backend | `NODE_ENV` / `APP_ENV` | `development` / `local` o `staging` | `production` / `staging` | `production` / `production` | |
| Backend | resto (`DATABASE_URL`, `JWT_*`, `TZ`, almacenamiento, límites) | ver `backend/.env.example` | base de testing | base de producción | |

`APP_ENV` y `VITE_APP_ENV` en `frontend/.env.example` no los lee el código del admin.

### `TZ` (backend, added 2026-08-14)

- **Purpose:** process timezone. Defense-in-depth mitigation found during the Fechas/Timezone audit: `backend/src/shared/datetime/argentinaTime.ts` already uses an explicit `America/Argentina/Cordoba` timezone for every Argentina-aware calculation and does not depend on this variable, but setting it protects against any future code that uses process-local `Date` methods (`setHours`, `getDate`, `toLocaleDateString` without an explicit `timeZone`) instead of the shared helper.
- **Example:** `TZ=America/Argentina/Cordoba`
- **Required/optional:** optional but strongly recommended in every environment (local, CI, staging, production).
- **Used by:** backend only.
- **Production notes:** set it in the actual process/container environment (Docker `ENV`, systemd unit, hosting platform's environment config panel), not only in a `.env` file loaded by `dotenv` at runtime — some Node.js/V8 versions do not reliably re-resolve the process timezone from a value set after the process has already started reading dates. Most cloud/container base images default to UTC, not Argentina time, if this is left unset.

## Frontend deploy

Two independent static sites (F2 of `docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md`): the admin (base directory `frontend`) and the fichador (base directory `fichador`, versioned config in `fichador/netlify.toml`, headers generated into `dist/_headers`). Never build both in one site nor serve the fichador under an admin path. Fichador deploy previews and branch deploys stay off while the temporary shared token is in its bundle.

Check:
- correct build command
- correct output directory
- SPA fallback/rewrite configured
- public environment variables
- API base URL
- assets
- cache behavior

## Backend deploy

Check:
- correct start command
- correct port handling
- production environment
- database connection
- migrations
- CORS origins
- **blocking before the first real backend deploy:** `TRUST_PROXY_HOPS` measured on that environment's real proxy chain (never taken from docs or examples; see `docs/SECURITY_STANDARDS.md` → "Client IP behind proxies" and `docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md` §18.5), spoofing check passed, and `CLIENT_IP_DIAGNOSTICS_ENABLED` back to `false`
- file upload storage
- external service credentials
- health endpoint if available

## Database deploy

Check:
- migration order
- destructive changes
- backup before risky migrations
- indexes
- permissions
- connection pooling
- SSL when required

## Observability

Production systems should have:
- useful logs
- error tracking when possible
- health checks when possible
- clear failure messages
- monitoring for critical services when possible

## Rollback thinking

Before risky deploys:
- know what changed
- know how to revert
- backup important data
- separate schema migration from app change if needed
