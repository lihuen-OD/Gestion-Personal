# Backend - Sistema de Gestion de Personal

Backend API for the HR/personnel management system.

## Stack

- Node.js
- Express
- TypeScript
- PostgreSQL
- Prisma
- Neon

## Environments

Neon database branches expected:

- `development`: local backend development and testing.
- `demo`: demo/staging data.
- `production`: production data.

Local backend work should use the Neon `development` branch connection string in `DATABASE_URL`.

## Setup

```bash
cd backend
copy .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate:dev
npm run dev
```

Health check:

```txt
GET http://localhost:4001/api/health
```

If `4001` is already in use locally, set `PORT=4002` in `.env` and use:

```txt
GET http://localhost:4002/api/health
```

## Initial Auth

Seed user:

```txt
RRHH:
admin@losod.local / Admin1234!

Supervisor:
supervisor@losod.local / Admin1234!

Carga horaria:
carga@losod.local / Admin1234!
```

Endpoints available:

```txt
POST /api/auth/login
GET  /api/auth/me
GET  /api/users
GET  /api/users/:id
POST /api/users
PATCH /api/users/:id
POST /api/users/:id/reset-password
GET  /api/audit
GET  /api/hour-concepts
POST /api/hour-concepts
PATCH /api/hour-concepts/:id
GET  /api/novelty-types
POST /api/novelty-types
PATCH /api/novelty-types/:id
GET  /api/novelties
POST /api/novelties
POST /api/novelties/:id/approve
POST /api/novelties/:id/reject
GET  /api/org-structure
GET  /api/employees
GET  /api/employees/:id
POST /api/employees
PATCH /api/employees/:id
PUT  /api/employees/:id/contact
PUT  /api/employees/:id/address
PUT  /api/employees/:id/transport
PUT  /api/employees/:id/assignments
PUT  /api/employees/:id/hour-concepts
POST /api/employees/:id/labor-movements
POST /api/employees/:id/documents
GET  /api/finnegans-export/novelties
GET  /api/finnegans-export/novelties.csv
GET  /api/time-entries
POST /api/time-entries
GET  /api/time-entries/export
GET  /api/time-entries/export.csv
PATCH /api/time-entries/:id
POST /api/time-entries/:id/submit
POST /api/time-entries/:id/approve
POST /api/time-entries/:id/reject
GET  /api/pending
```

`/api/users/*` is protected and currently restricted to `NIVEL_1_RRHH`.
`/api/audit` is protected and restricted to `NIVEL_1_RRHH`.
`GET /api/hour-concepts` and `GET /api/novelty-types` require authentication.
`POST/PATCH /api/hour-concepts` and `POST/PATCH /api/novelty-types` are restricted to admin roles.
`GET/POST /api/novelties` require an authenticated operational role.
`POST /api/novelties/:id/approve` and `POST /api/novelties/:id/reject` are restricted to `NIVEL_1_RRHH`.
`GET /api/employees` and `GET /api/employees/:id` require an authenticated operational role.
`POST/PATCH /api/employees` is currently restricted to `NIVEL_1_RRHH`.
Employee write subresources are currently restricted to `NIVEL_1_RRHH`:

```txt
PUT  /api/employees/:id/contact
PUT  /api/employees/:id/address
PUT  /api/employees/:id/transport
PUT  /api/employees/:id/assignments
PUT  /api/employees/:id/hour-concepts
POST /api/employees/:id/labor-movements
POST /api/employees/:id/documents
```

Finnegans export endpoints are restricted to `NIVEL_1_RRHH`.
They export approved novelty records only by default. Use `includePending=true` only for review/pre-export checks.
Time entry endpoints require an authenticated operational role and respect employee scope.
Time entry approval/rejection is restricted to `NIVEL_1_RRHH` and `NIVEL_2_SUPERVISION`.
`GET /api/pending` returns a unified pending tray for novelties and time entries, respecting employee scope.

## Security Notes

- Do not commit real `.env` values.
- Permissions must be enforced on the backend, not only in the frontend.
- All incoming request bodies should be validated with schemas before reaching service logic.
- Sensitive actions must create audit records.
