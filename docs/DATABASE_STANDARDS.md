# Database Standards

## Objective

Design databases that are consistent, reliable, auditable and prepared for real business use.

## General rules

- Use clear table and field names.
- Avoid ambiguous fields.
- Avoid unnecessary duplication.
- Use relations correctly.
- Use constraints.
- Use indexes for frequent searches.
- Use migrations.
- Avoid destructive changes without explicit approval.
- Consider audit/history for important data.
- Consider soft delete for important records.
- Keep data integrity in the database, not only in code.

## Modeling checklist

Before adding a table or field:
- Does this data already exist?
- Is this an entity or an attribute?
- Is it required or optional?
- Does it need uniqueness?
- Does it need a relation?
- Does it need history?
- Does it need soft delete?
- Does it need an index?
- Will it be used in reports?
- Who can read or modify it?

## Employee must never be physically deleted (added 2026-08-14, Etapa 1 / Bloque 3)

`Employee` is the root of years of legal/payroll-relevant history: labor movements, field/block history, time entries, work shifts, attendance punches, novelties, documents, monthly closures, shift assignments/alerts, double-hour rules, and clock-punch attempts all reference it.

- **Deactivation ("baja") is the only supported way to remove an employee from active use.** It is a status change (`LaborMovement` of type `BAJA` → `Employee.status = INACTIVO`), never a row deletion. There is no `DELETE /employees/:id` route and no `employeesRepository`/`employeesService` `delete`/`remove` method — do not add one without a separate, explicit decision (this was deliberately scoped out of the current schema-hardening pass).
- As of migration `20260814120000_restrict_employee_cascades` (backend/prisma/migrations), every foreign key that pointed at `Employee` with `onDelete: Cascade` was changed to `onDelete: Restrict`. If any code ever calls `prisma.employee.delete()` while related rows exist (which is effectively always, for a real employee), Postgres will reject it instead of silently cascading the delete through the employee's entire history.
- `StorageFile.employeeId` remains `onDelete: SetNull` (files can outlive the employee reference) and `User.employeeId` remains as-is — neither was in scope for this change.
- Regression guard: `backend/src/modules/employees/employees.noHardDelete.test.ts` asserts there is no `DELETE` route on `/employees` and no `delete`/`remove` method on the repository or service. If you need a real "purge" capability in the future (e.g. GDPR-style erasure), treat it as its own reviewed feature — do not just relax these constraints.

## Dates and instants: TIMESTAMPTZ vs DATE, single shared helper (added 2026-08-18)

The schema draws a deliberate line between "something that happened at a specific moment" and "a calendar day/period," and every date-producing module must reuse the same helper instead of computing Argentina-local dates by hand.

- **Real instants** (a clock punch, a `WorkShift`'s `createdAt`/`updatedAt`, `approvedAt`/`rejectedAt`, etc.) are stored as `TIMESTAMPTZ(3)`. Postgres keeps these as absolute UTC instants; there is no ambiguity about what timezone they were written in.
- **Calendar-only fields** (a `Novelty`'s `fromDate`/`toDate`, a `TimeEntry.date`, a monthly closure `period`) are stored with `@db.Date` — they represent a day, not a moment, and must not carry a time-of-day or timezone component.
- `backend/src/shared/datetime/argentinaTime.ts` is the single shared helper for every Argentina-aware date/time calculation (current date/time in `America/Argentina/Cordoba`, day boundaries, formatting). Do not call `new Date()` + manual offset math, `toLocaleDateString` with an implicit timezone, or write a second helper in a module — import this one. If you find a module that still does its own date math, consolidate it into this helper rather than adding a fourth implementation.
- The backend process also sets `TZ=America/Argentina/Cordoba` (see `docs/DEVOPS_DEPLOYMENT_STANDARDS.md`) as defense-in-depth, but code must not rely on the process timezone instead of the explicit helper — the helper is authoritative even if `TZ` is ever misconfigured in some environment.

## Organizational structure: current model, target model and transition (updated 2026-10-07)

The organizational model is under an approved reorganization that is **not implemented yet**. The full decision record — current vs. target model, pending decisions, authorized cleanup scope, migration and rollout strategy — is `docs/decisions/ORG_LOCATION_REORGANIZATION.md`. Until its stages land, the schema and code still implement the **current model** below, and this section must be read together with that ADR.

### Current model (what `schema.prisma` and the code implement today)

- Chain: `Company → BusinessUnit → Establishment → Area → Sector` (added 2026-08-18 as a "singular-FK chain"). In reality:
  - `Establishment` has **two** parent FKs, `companyId` (required) and `businessUnitId?`.
  - `Area.establishmentId` and `Sector.areaId` are nullable, so walking up from a sector can stop partway.
- `Employee.sectorId` and `Position.sectorId` are single FKs into this chain.
- A sector's legacy/new classification is the persisted `Sector.isLegacy` column (A8-3, added 2026-10-08): frozen at creation with the criterion that applied at the time (`businessUnitId IS NULL`), backfilled once by migration `20261008110000_sector_org_classification` (not yet applied to any shared database), never editable through a common update. Do not re-derive it from `businessUnitId` or any other current parent — M2 changes those parents and would silently re-interpret special-hour history (ADR §20, hallazgo 1).
- An employee's companies do **not** come from walking up the chain. They come from the M:N `EmployeeCompany` (employer company + `isPrimary`).
- `onDelete` rules today:
  - `EmployeeCompany.companyId`, `PositionSalaryCategory` and every `CostCenter*` join are `CASCADE`.
  - `User.companyId/sectorId`, `Employee.positionId/sectorId/costCenterId`, `Position.sectorId`, `ClockDevice.sectorId` and **`DoubleHourRule.companyId/sectorId/costCenterId/positionId`** are `SET NULL`.
  - For a `DoubleHourRule`, `NULL` means "no restriction", so a `SET NULL` silently **widens** the rule.
- Do not extend the current model: no new consumers of the old chain, and no additional parent FK on these models.

### Target model (approved plan, not implemented)

- Two independent trees, each node with exactly **one required parent**:
  - **Organization:** `Company → BusinessUnit → Sector → Area`.
  - **Locations:** `Zone → Establishment`.
- An establishment has no company. Legal ownership of a place is not the organizational scope of a position.
- New parent FKs use `onDelete: Restrict`.
- Multi-parent relations are not introduced without a proven business need.
- `CostCenter` remains the only approved many-to-many against the structure (now against both trees). Do not "simplify" it into a singular FK.

### Rules that apply during the transition

- Schema changes to these models follow the ADR's staged expand (M1) / contract (M2) migrations, applied per environment via separate code releases (`prisma migrate deploy` cannot pick a single pending migration).
- Never use `CASCADE` or `SET NULL` as a cleanup shortcut.
- Never free a `DoubleHourRule` reference by setting its scope to `NULL`, and never delete the rule to free it. Both widen or erase special-hour history. See the ADR §6 for the only valid treatments.
- Legacy cleanup is authorized only on `development`, only for old-model records in a frozen inventory, and only through the ADR's gated transactional script. It never deletes or re-keys employees or touches person-related records (hours, novelties, documents, labor movements, histories). Production is out of scope.

## Position: salary categories and organizational scope (updated 2026-10-07)

`Position` previously stored denormalized location text (`areaDepartment`, `sectorName`, `businessUnitName`, `establishmentName`, and their plural/array variants) and a `salaryRangeCategories` array, in parallel with real relations. These legacy fields have been removed from the schema (migration `20260818090000_drop_position_legacy_fields`). `Position.areaId` was removed as vestigial at the same time.

- `PositionSalaryCategory` (a join table against `SalaryCategory`) is the only source of a position's salary category/categories. A position can have more than one. There is no single "suggested category" scalar field on `Position`.
- **Current model:** `Position.sectorId` is still the only stored location of a position. Area, establishment, business unit and company are derived from the sector's parent chain.
- **Target model (not implemented):** `Position.sectorId` is replaced by an organizational **scope**, `PositionOrgScope`.
  - A position has one or more nodes of the Organization tree.
  - A selected node covers its descendants, computed on read and never materialized.
  - Ancestor/descendant pairs are rejected as redundant.
  - Zones and establishments are never part of a position's scope.
  - All occupants of a position share exactly its scope. People with the same role but different scopes need different positions.
- Do not reintroduce any denormalized name/array field on `Position`, and do not copy a position's scope into editable employee fields.

## Authorship fields: real FK to User, never Cascade from User (added 2026-08-18)

Fields that record who performed an action (`createdByUserId`, `updatedByUserId`, `approvedByUserId`, `rejectedByUserId`, `reviewedByUserId`, `resolvedByUserId`, `uploadedByUserId`, `assignedByUserId`, `disabledByUserId`, etc.) are real, optional foreign keys to `User`, not bare unlinked ID columns.

- Every authorship FK uses `onDelete: SetNull`. A `User` row can be deactivated/removed without being blocked by, or silently destroying, historical records that reference it — the FK is set to null and the historical row survives.
- Never use `onDelete: Cascade` from `User` to a historical/audit-relevant record. Deleting a user must not delete the history of what they did.
- `AuditParameter.createdBy`/`updatedBy` are a special case: they were renamed to `createdByUserId`/`updatedByUserId` (real FK) plus new `createdByUserName`/`updatedByUserName` text snapshot fields. Pre-existing rows whose original value was the literal string `"Sistema"` were backfilled with `createdByUserId`/`updatedByUserId = null` and `createdByUserName`/`updatedByUserName = "Sistema"` — the snapshot preserves that label without inventing a fake user.
- When you need to show "who did this" in a UI list without an extra join (e.g. a table of hundreds of rows), prefer adding a text snapshot column (like `AuditParameter` above) over loosening the FK's `onDelete` behavior.

## Constraints

Use constraints for:
- required relationships
- uniqueness
- valid enum/status values
- non-null required fields
- referential integrity

## Indexes

Consider indexes for:
- foreign keys
- frequent filters
- search fields
- date ranges
- status fields
- user ownership fields
- report filters

Do not add indexes blindly. Every index has write/storage cost.

## Migrations

Migrations should:
- be reviewed before deploy
- avoid data loss
- include backfill strategy when needed
- be reversible when possible
- be documented if risky

## Audit and history

Use audit/history when:
- changing employee/user/business-critical data
- changing permissions
- changing financial values
- deleting important records
- changing statuses
- performing admin actions

Audit should capture:
- who changed it
- what changed
- previous value
- new value
- when it changed
- reason if applicable

## ClockDevice: identidad persistente del fichador (F4, 2026-10-06)

`ClockDevice` representa la identidad individual y revocable de cada equipo de
fichada. F4 deja listo el modelo persistente; la autenticación por dispositivo
todavía no está activa y el token compartido legacy continúa temporalmente.

- Estados exactos: `PENDING`, `ACTIVE`, `REVOKED`. `REVOKED` es terminal; un
  nuevo enrolamiento crea otro registro.
- Los secretos futuros son 256 bits aleatorios. Nunca se persisten en claro:
  `tokenHash` guarda SHA-256 y es único. La comparación futura usa
  `crypto.timingSafeEqual` sobre hashes. No se usa bcrypt/argon2 porque el
  secreto tiene alta entropía y no es una contraseña humana.
- El código de pairing tampoco se persiste en claro: sólo
  `pairingCodeHash` (SHA-256, unique) y su vencimiento. Ningún DTO público
  devuelve el hash.
- `sectorId` es metadata opcional, no un límite de autorización. Usa
  `onDelete: SetNull`: eliminar un sector conserva el dispositivo y su
  historia, pero lo deja sin ubicación. En el modelo objetivo (no
  implementado, `docs/decisions/ORG_LOCATION_REORGANIZATION.md`) esta
  ubicación pasa a `establishmentId?` del árbol de Ubicaciones, con el mismo
  carácter de metadata y sin restringir fichadas.
- `activatedByUserId` y `revokedByUserId` son autoría opcional con
  `onDelete: SetNull`.
- `AttendancePunch.deviceId` y `ClockPunchAttempt.deviceId` son FKs nullable
  con `onDelete: Restrict`. La historia anterior a F4 permanece en `NULL` y no
  se inventan dispositivos históricos.
- `AttendancePunch.kioskId` permanece temporalmente como columna legacy. F4 no
  la elimina ni la completa.
- F4 no cambia `AttendancePunch.source`; `WorkShiftSource.KIOSK` empezará a
  usarse cuando se implemente el flujo autenticado posterior.

La migración de F4 aborta antes de crear estructura si detecta cualquier
`AttendancePunch.deviceId` o `AttendancePunch.kioskId` histórico no nulo. Es
aditiva: no contiene inserts, backfills ni actualizaciones de `source`.

### Ciclo de vida operativo (F5)

F5 usa el modelo existente sin otra migración. El registro crea exclusivamente
un `ClockDevice(PENDING)`; nunca crea/backfillea fichadas ni intentos. La
activación es una transición condicional y atómica que exige el hash del código
vigente, asigna nombre/sector/autor y limpia `pairingCodeHash` y
`pairingExpiresAt`. Sólo `ACTIVE` puede pasar a `REVOKED`; `REVOKED` es terminal.
El único hard delete permitido es un `PENDING` sin `AttendancePunch` ni
`ClockPunchAttempt`. Desde F6 las fichadas e intentos nuevos guardan
`deviceId` del dispositivo autenticado (el histórico sigue en `NULL`); el
cambio de `AttendancePunch.source` a `KIOSK` corresponde a F7 (plan §25).
