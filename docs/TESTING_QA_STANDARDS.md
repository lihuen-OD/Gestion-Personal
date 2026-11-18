# Testing and QA Standards

## Objective

Ensure changes are reliable, safe and verifiable.

## Testing mindset

Every important change should answer:
- What can break?
- How do we prove this works?
- What edge cases exist?
- What permissions matter?
- What data states matter?
- What should happen on error?

## Minimum manual QA

For every feature:
- happy path
- required validations
- error state
- unauthorized/forbidden state when applicable
- empty state
- mobile view if frontend
- desktop view if frontend
- backend validation
- database persistence
- reload behavior
- regression of related flows

## Automated tests recommended for

- business rules
- permissions
- calculations
- data transformations
- critical endpoints
- authentication
- role-based access
- imports/exports
- payment/financial logic
- date/time logic

## Backend test checklist

- valid request
- invalid request
- unauthorized request
- forbidden request
- not found
- duplicate/conflict
- database error handling
- transaction behavior
- returned fields do not expose sensitive data

## Base de datos en tests (guard global, 2026-11-13)

Un test unitario nunca abre Prisma contra una base real tomada del `.env`, que puede ser Neon u otra compartida. Motivo: el 2026-11-13 un test unitario sin mock de Prisma se conectó por accidente a la base Neon del `.env`. Fueron sólo lecturas y locks que fallaron, sin escrituras confirmadas (`docs/decisions/NOVELTY_COVERAGE_ENGINE.md` §10).

- `backend/vitest.config.ts` fija `DATABASE_URL` en una URL local inalcanzable (puerto 1 de loopback). Como `dotenv` no pisa una variable ya definida, el `.env` nunca entra a los tests.
- `backend/src/shared/prisma/testDatabaseGuard.ts` lo verifica bajo vitest (`VITEST=true`). Sólo deja pasar una base PostgreSQL **local** de integración con prefijo `clock_it*`, `deletion_it*` o `reorg_it_m2*`.
- En cualquier otro caso, `client.ts` apunta Prisma al puerto inalcanzable y corta toda consulta de modelo antes de conectar, con un mensaje que no incluye la URL ni credenciales. Fuera de vitest no hace nada.
- **Tests unitarios:** mockean `shared/prisma/client`. Si no lo hacen, fallan rápido y nunca llegan a una base.
- **Suites de integración opt-in** (`*_IT_DATABASE_URL`): fijan explícitamente `process.env.DATABASE_URL` en su base local descartable antes de importar el cliente, y siguen verificando `current_database()`.
- Tests del guard: `backend/src/shared/prisma/testDatabaseGuard.test.ts`.

## Frontend test checklist

- component renders
- loading state
- error state
- form validation
- submit success
- submit failure
- role-based UI
- empty state
- responsive behavior
- no visual overlap
- desktop layout quality

## Regression checklist

Before finishing:
- build still passes
- types still pass
- main routes still work
- auth still works
- existing features still work
- no console errors introduced
- no server errors introduced
- no obvious UI regressions introduced
