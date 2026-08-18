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

## Organizational hierarchy: singular FK chain, CostCenter as the M:N exception (added 2026-08-18)

`Company → BusinessUnit → Establishment → Area → Sector` is modeled as a singular-FK chain: each level has exactly one parent FK, and the chain is the single source of truth for "where does this sector/position/employee sit in the org." There is no separate join table duplicating this chain, and no second parent FK on any of these five models.

- `Employee.sectorId` and `Position.sectorId` are each a single FK into this chain — company/business unit/establishment/area are derived by walking up from `sectorId`, not stored as separate redundant FKs on `Employee`/`Position`.
- `CostCenter` is the one deliberate exception: it uses real many-to-many join tables against the other five levels (a cost center can legitimately apply across multiple business units/establishments/areas/sectors at once). This is not an inconsistency — a cost center is a cross-cutting financial tag, not a duplicate of an existing FK, so M:N is the correct shape for it specifically. Do not "simplify" `CostCenter` back into a singular FK, and do not add a second parent FK to `Company`/`BusinessUnit`/`Establishment`/`Area`/`Sector` to solve a problem that `CostCenter`'s M:N tables already solve correctly.

## Position: sectorId and PositionSalaryCategory as the official sources (added 2026-08-18)

`Position` previously stored denormalized location text (`areaDepartment`, `sectorName`, `businessUnitName`, `establishmentName`, and their plural/array variants) and a `salaryRangeCategories` array, in parallel with real relations. These legacy fields have been removed from the schema (migration `20260818090000_drop_position_legacy_fields`).

- `Position.sectorId` is the only source of a position's location; area/establishment/business unit/company are derived from the sector's parent chain (see the org-hierarchy section above).
- `PositionSalaryCategory` (a join table against `SalaryCategory`) is the only source of a position's salary category/categories — a position can have more than one. There is no single "suggested category" scalar field on `Position`.
- `Position.areaId` was also removed as vestigial: the business decision is that an operational position belongs to a `Sector`, not directly to an `Area`.
- Do not reintroduce any denormalized name/array field on `Position` to "make a query easier" — join through `sectorId`/`PositionSalaryCategory` instead.

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
