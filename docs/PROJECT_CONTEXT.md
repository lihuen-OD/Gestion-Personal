# Project Context

This is the main file to customize for each specific project.

## Project name

Sistema Integral de Gestión de Personal y Control Horario.

## Business objective

The objective of this project is to build an internal enterprise system to centralize and professionalize the management of personnel, employee files, organizational structure, working hours, attendance records, absences, documentation, transport information, dashboards, audit history and future payroll/liquidation support.

The system is intended to replace fragmented Excel/Google Sheets workflows with a structured, scalable and auditable application.

**Current state (updated after the 2026-08 technical audit): the system is no longer a frontend-only/mock prototype.** There is a real, production backend (Node/Express + TypeScript + Prisma + PostgreSQL, 21 modules under `backend/src/modules`) that the frontend consumes over HTTP. It includes JWT auth, backend-enforced role/employee-scope permissions, a real audit log, file storage (Google Drive/Cloudinary/local), and a public unauthenticated fichador (time clock) flow. A handful of `*MockService.ts` files remain in `frontend/src/services` as leftovers from the original mock-only phase — they are legacy, not the current data source, and most have already been removed once confirmed unused (see `docs/BACKEND_API_CONTRACTS.md` for the real endpoints). Before assuming any part of the system is "mock only", check `backend/src/modules` and `frontend/src/services/api` first.

## Users and roles

The system must support the following role model:

### Nivel 1 - RRHH

Global access to the system.

Can:

* View and manage all employees/legajos.
* View and manage all companies, business units, establishments, cost centers, sectors and positions.
* Create, update and deactivate employee files.
* Manage labor status, alta/baja laboral, personal data and labor data.
* View and manage documentation, absences, transport, hourly configuration and liquidation configuration.
* View dashboards and global indicators.
* Access audit and event history.
* Review, approve and correct working hour records.
* Configure administrative catalogs (org structure, positions, salary categories, hour concepts, novelty types, document categories, audit parameters).

### Nivel 2 - Supervisión / Gestión

Management/supervision access limited to their assigned area, sector, establishment or business unit.

Can:

* View employees assigned to their area.
* View dashboards and indicators limited to their scope.
* Review working hours, absences and operational information for their area.
* View organization charts and assigned teams.
* View employee information needed for management.

Cannot:

* Access full system configuration.
* Access global audit information.
* Modify sensitive HR data unless explicitly allowed.

### Nivel 3 - Administrativo de Carga Horaria

Operational role focused on working hour entry.

Can:

* Search and view only employees assigned to them as responsible for working hour entry.
* Load working hours and related novelties/novedades.
* Review pending entries under their responsibility.
* Save and update working hour records according to permission rules.

Cannot:

* Access full employee files.
* Access complete documentation.
* Access global dashboards.
* Access system configuration.
* Access global audit.
* Modify organizational structure.

## Main modules

The system must include and connect the following modules:

### 1. Dashboard

Enterprise dashboard with HR and operational indicators.

Must show:

* Total employees.
* Active and inactive employees.
* New hires and terminations.
* Absences and novelty indicators.
* Pending working hour records.
* Employees without working hour responsible.
* Employees without direct manager.
* Documentation alerts.
* Transport indicators.
* Distribution by company, establishment, cost center, sector, category and position.

Dashboard data must come from the real backend (`GET /dashboard`, backend-computed from Prisma queries — see "Main business rules" below), not from isolated hardcoded numbers or mock/localStorage services.

### 2. Legajos / Personas

Core module of the system.

The employee file is the central entity and must feed the rest of the system.

Main list must show only:

* Legajo
* CUIL
* Apellido
* Nombre
* Centro de costo
* Estado
* Acción

The detail page must be full-page, not a simple modal.

Employee detail tabs:

1. Información General
2. Contacto y Domicilio
3. Datos Laborales
4. Responsables / Asignaciones
5. Transporte
6. Configuración Horaria y Liquidación
7. Ausentismo / Novedades
8. Gestión Documental
9. Historial de Eventos
10. Auditoría

### 3. Datos Laborales

Must include:

* Empresa
* Unidad de negocio
* Establecimiento
* Centro de costo
* Sector
* Puesto
* Categoría de recibo
* Categoría interna
* Convenio
* Jornada laboral
* Turno habitual

These fields must not be plain text if the value exists in a main catalog or module. They must be selected from the real backend catalogs (`org-structure`, `positions`, `salary-categories` — see `docs/BACKEND_API_CONTRACTS.md`), not typed as free text or sourced from a mock service.

Alta/Baja laboral must be handled as a single block, not as independent fields.

Labor movements must be stored as:

* ALTA
* BAJA

Each movement must include:

* effectiveFrom
* reason
* observation
* createdAt
* createdBy

Employee status must be calculated from labor movements.

### 4. Puestos

Reusable module for job positions.

A position is not free text. It is an entity selected from the employee file.

The position module must include:

* Position name / code / status
* Sector (`sectorId`) — this is the official source of a position's location; area, establishment, business unit and company are derived from the sector's hierarchy, not stored redundantly on Position (see `docs/DATABASE_STANDARDS.md`)
* Salary categories, via `PositionSalaryCategory` (a position can have more than one associated category; there is no single "suggested category" field)
* Mission/purpose
* Responsibilities
* Internal/external relations
* Competencies
* Work conditions
* Performance indicators
* Evaluation criteria
* Assigned people

There is no `reportsTo`/"supervises" field on Position today — organizational reporting lines are not modeled at the position level.

The “Assigned people” tab must read employees from the Legajos module.

### 5. Estructura Organizacional

The organizational structure must support:

* Empresa
* Unidad de negocio
* Establecimiento
* Centro de costo
* Sector
* Puesto
* Categoría de recibo
* Categoría interna

These values must be managed as selectable data through the real `org-structure` backend module (`GET/POST/PATCH /api/org-structure/*`), not mocks. Company → BusinessUnit → Establishment → Area → Sector is a singular-FK chain (each level references exactly one parent); only CostCenter uses real many-to-many join tables against the other five, because it is a genuine cross-cutting tag, not a duplicate of an existing FK (see `docs/DATABASE_STANDARDS.md`).

They must feed:

* Legajos
* Dashboard
* Organigramas
* Carga horaria filters
* Reports
* Novedades
* Future payroll/liquidation flows

### 6. Responsables / Asignaciones

The system must clearly separate:

#### Encargado directo

Hierarchical or functional manager.

Used for:

* Organization charts.
* Reporting lines.
* Supervision.
* Team structure.

#### Responsable de carga horaria

User/person responsible for loading or reviewing working hours for an employee.

Used for:

* Carga horaria access.
* Assignment of employees to working hour administrators.
* Operational control.

These two concepts can coincide but must not be treated as the same field.

### 7. Carga Horaria

Working hour entry must be employee-based, not cost-center-based.

Correct flow:

1. Select period.
2. Search employee by legajo, DNI, CUIL, first name or last name.
3. Show employee data.
4. Load working hours and/or novelties.
5. Save records linked to employeeId.

The responsible user must only see employees assigned to them as responsible for working hour entry.

Centro de costo can be displayed as information or secondary filter, but it must not be the main axis of the loading process.

Working hour records must be prepared for future BioTime integration.

Each time entry should support:

* employeeId
* date
* startTime
* endTime
* totalMinutes
* hourType
* source: MANUAL | BIOTIME | CORRECTION_MANUAL | IMPORTED
* status
* observation
* createdBy
* updatedBy
* sourceEventIds if applicable in the future

### 8. Control de Asistencia / Future BioTime Integration

The system may later integrate with BioTime/ZKTeco or another biometric attendance system.

The current frontend must be prepared conceptually for this future flow:

Biometric device → BioTime → API → attendance events → daily attendance → reviewed time entries.

The system itself must not perform biometric recognition.

Future data model concepts:

* attendance_devices
* biometric_enrollments
* attendance_events
* daily_attendance
* attendance_exceptions

Manual working hour entry must remain possible even after future integration.

### 9. Novedades / Ausentismo

Novedades must always be linked to an existing employee.

Must support:

* Tipo de novedad
* Fecha desde
* Fecha hasta
* Cantidad
* Motivo
* Observación
* Impacta liquidación
* Estado

Novedades must be visible from:

* Employee detail
* Dashboard
* Working hour review
* Event history
* Audit

### 10. Transporte

Transport information must be linked to the employee file.

Must include:

* Uses company transport
* Origin locality/city
* Route
* Observations
* Effective date
* Reason for change

Transport must be handled as a block with history, not as isolated field history.

Transport data must feed dashboard indicators and reports.

### 11. Gestión Documental

Documents must be linked to employeeId.

Must support:

* Document type
* Document name
* Upload file (real storage backend: Google Drive/Cloudinary/local — see `docs/BACKEND_API_CONTRACTS.md` → Documentos/Storage)
* Expiration date if applicable
* Status
* Observations

Documents must appear in:

* Employee file
* Dashboard alerts
* Event history
* Audit

### 12. Organigramas

Organization charts must read employees from Legajos.

They must not use duplicated or hardcoded employees.

There must be two conceptual views:

1. Functional organization chart based on direct manager.
2. Category-based organization chart.

Hierarchy must come from:

* directManagerId
* directManagerName

It must not use working hour responsible as hierarchy.

Category-based layout must use:

1. Categoría interna
2. Categoría de recibo
3. Sin categoría

### 13. Auditoría / Historial

Every important change must generate audit/history when applicable.

Must support:

* Alta/Baja laboral
* Labor data changes
* Address changes
* Direct manager changes
* Working hour responsible changes
* Transport changes
* Hour configuration changes
* Novedades
* Documents
* Manual corrections

Domicilio must be handled as a single block history, not field-by-field.

### Modules implemented since this list was written

The backend has 21 modules under `backend/src/modules`. The following exist and are in production use but were missing from the numbered list above — check `backend/src/modules/<name>` and `docs/BACKEND_API_CONTRACTS.md` before assuming a module doesn't exist:

* **shifts** (`shiftTemplate`, `shiftAssignment`, `shiftAlert`) — turnos: plantillas de turno, asignación a empleados, alertas de jornada abierta/vencida. Added 2026-07-23.
* **workforce-management** — reglas de horas dobles, cierres mensuales, notificaciones internas del sistema.
* **finnegans-export** — exportación de novedades/horas al sistema externo de liquidación de sueldos (Finnegans).
* **audit-parameters** — configuración de qué se audita/notifica/retiene (nota: hoy es solo configuración, no controla aún el pipeline real de auditoría).
* **salary-categories**, **hour-concepts**, **novelty-types**, **document-categories** — catálogos configurables reales (tablas, no enums) que alimentan Legajos/Novedades/Documentación.
* **pending** — bandeja de pendientes ("Mis Pendientes") por usuario.
* **storage** — capa de almacenamiento de archivos (Google Drive/Cloudinary/local) compartida por documentos y evidencia fotográfica del fichador.
* **health** — endpoint de healthcheck.
* **dashboard** — métricas agregadas del home.

## Main business rules

* Legajos/Personas is the central module of the system.
* Main modules must feed secondary modules.
* Components must not invent data if the data already belongs to another module.
* No duplicated mock data inside visual components.
* Selectable business data must come from centralized mock services.
* Employee status is calculated from labor movements.
* Alta/Baja laboral is one business block.
* Domicilio is one business block.
* Encargado directo and Responsable de carga horaria are different concepts.
* Carga horaria is employee-based, not cost-center-based.
* Centro de costo is structural/reporting information, not the main access rule for time entry.
* Dashboard indicators are calculated by the backend (`GET /dashboard`) from real Prisma queries, cached briefly (see `docs/CACHING_STRATEGY.md`).
* The system already has a real backend/API; do not build new frontend-only mock flows for functionality the backend already implements.
* Do not add a new `*MockService.ts` without first checking whether a real `*ApiService.ts` under `frontend/src/services/api` already covers it.

## Tech stack

Frontend:

* React 18 + TypeScript + Vite + react-router-dom.
* No global state library — a single `AuthContext` plus page-local state.
* `frontend/src/services/api/*ApiService.ts` are the real data layer (calls the backend over HTTP).
* `frontend/src/services/cache` implements a stale-while-revalidate cache (LRU memory + IndexedDB) used by most API services.
* Route-level code splitting (`React.lazy`) for every page; heavy libs (`xlsx`, `leaflet`/`react-leaflet`, `@mediapipe/tasks-vision`) are dynamically imported only where used.

Backend:

* Node.js + Express + TypeScript, under `backend/src`.
* Modular monolith: 21 modules under `backend/src/modules`, each generally following controller → service → repository → schemas (zod) → routes.
* JWT auth (`backend/src/modules/auth`), role/employee-scope authorization enforced server-side (`backend/src/middlewares/authorization.ts` + per-module `employeeAccessWhere`), a generic audit-log helper (`backend/src/modules/audit`), and a shared TTL cache (`backend/src/shared/cache`).

Database:

* PostgreSQL, accessed via Prisma (`backend/prisma/schema.prisma`, 54+ models, 31+ enums).
* Migrations live in `backend/prisma/migrations`; run `npm run prisma:migrate:dev` from `backend/` to apply new ones locally.
* Do not model new persistent business data in frontend TypeScript interfaces/mocks — add it to the Prisma schema and a backend module instead.

Deployment:

* See `docs/DEVOPS_DEPLOYMENT_STANDARDS.md` and `docs/LOCAL_DEVELOPMENT.md` for the current setup.

External services:

* Current phase should avoid production external services.
* Geolocation/address APIs may be prototyped only if explicitly requested.
* Future possible integrations:

  * BioTime/ZKTeco for biometric attendance.
  * Georef Argentina for geographic administrative data.
  * OpenStreetMap/Leaflet for maps.
  * Future payroll/ERP integration.

## Architecture notes

Required principles:

* Components should not own business data directly — fetch through the relevant `*ApiService`.
* Business logic that must always be enforced (validation, permissions, calculations that affect payroll) belongs in the backend; frontend checks are UX-only.
* Types/interfaces must be explicit and reusable.
* Use IDs to connect modules.
* Avoid hardcoded business data inside components.
* Avoid overengineering.
* Reuse an existing shared service/util before writing a new one — grep for the concept first.

Real data services (current, under `frontend/src/services/api`):

* employeeApiService
* positionApiService
* timeEntryApiService
* noveltyApiService
* documentApiService / documentCategoryApiService
* userApiService
* auditApiService
* orgStructureApiService, salaryCategoryApiService, hourConceptApiService, noveltyTypeApiService, shiftAssignmentApiService, and others — one per backend module, see `docs/BACKEND_API_CONTRACTS.md`.

A small number of `*MockService.ts` files remain under `frontend/src/services` (legacy, pre-backend). Before adding a new one, confirm no real `*ApiService` already exists for that data, and confirm the mock you're about to touch isn't dead code (check for real importers first).

## Data model notes

Field-level model shapes are not duplicated here — they drift from the real schema every time it changes (this section previously listed field names that had not matched the real models for several stages). For the authoritative field list of any model (`Employee`, `Position`, `TimeEntry`, `Novelty`, `EmployeeDocument`, `AuditLog`, etc.), read `backend/prisma/schema.prisma` directly; for the request/response shapes exposed over the API, read `docs/BACKEND_API_CONTRACTS.md`. Do not guess a field name from memory or from this file — grep the schema.

A few structural decisions worth knowing before you read the schema:

* Employee's location comes from a single `sectorId` FK; company/business unit/establishment/area are derived by walking the sector's parent chain, not stored redundantly on Employee.
* Position's location works the same way — `sectorId` is the official source, see `docs/DATABASE_STANDARDS.md`.
* Position's salary category is a many-to-many via `PositionSalaryCategory`, not a single field.
* Authorship fields (`createdByUserId`, `approvedByUserId`, `uploadedByUserId`, etc.) are real optional FKs to `User` with `onDelete: SetNull` — see `docs/DATABASE_STANDARDS.md`.

## Security rules specific to this project

Current state (backend already enforces this — see `docs/SECURITY_STANDARDS.md`):

* Roles and employee-scope access are enforced server-side (`backend/src/middlewares/authorization.ts` + `employeeAccessWhere` per module), not only hidden in the UI.
* Do not expose sensitive employee data unnecessarily in UI, even though the backend already scopes it.
* The public fichador endpoints (`/time-entries/clock/*`) are intentionally unauthenticated but carry their own rate limiter and only expose active employees — see `docs/SECURITY_STANDARDS.md` → "Public clock endpoints".
* Face-liveness validation on the photo-punch flow is client-reported (MediaPipe in the browser), not a server-side biometric verification — do not treat it as a security control.
* Sensitive changes (employee edits, time-entry corrections, novelty approvals, monthly closures, correction requests, login, permission-denied attempts, document access) go through `auditService.register` — see `backend/src/modules/audit`.
* Employee documents/photos are stored via the storage module (Google Drive/Cloudinary/local) with server-side mime/extension/size validation; do not bypass it with ad-hoc upload handling.
* Biometric data: only face-detection metadata (status/score) and the punch photo evidence itself are stored; no raw biometric templates.

## Important flows

### Employee creation

1. RRHH creates new employee file.
2. System initializes complete employee object.
3. Labor movement ALTA is created.
4. Employee status becomes active.
5. Audit/event history is created.
6. Employee becomes available to related modules.

### Employee labor status

1. RRHH creates ALTA or BAJA movement.
2. System stores movement with effective date and reason.
3. Employee status is calculated from movements.
4. History and audit are updated.

**Employee must never be physically deleted** (see `docs/DATABASE_STANDARDS.md` for the full rationale). "Baja" is always this status-change flow, never a `DELETE`/`prisma.employee.delete()`. Since 2026-08-14 the database enforces this too: every FK pointing at `Employee` is `onDelete: Restrict`, not `Cascade` — a physical delete would be rejected by Postgres while any related record (time entries, documents, novelties, history, etc.) exists.

### Address update

1. User opens Domicilio actual.
2. User selects Modificar domicilio.
3. System requests effective date and reason.
4. User updates full address block.
5. System saves new current address.
6. Address history is created.
7. Audit is created.

### Position assignment

1. User selects position from Puestos module.
2. System stores positionId and positionName.
3. Employee file updates labor data.
4. Position module can show assigned people from Legajos.

### Working hour entry

1. User selects period.
2. User searches employee.
3. System only shows employees assigned to that user if role is Nivel 3.
4. User loads hours.
5. Time entry is saved with source MANUAL.
6. Record can be reviewed, approved, corrected or rejected according to permissions.

### Future BioTime attendance flow

1. Employee clocks in/out on biometric device.
2. BioTime stores attendance transaction.
3. Future backend imports attendance events.
4. System creates daily attendance summary.
5. Time entries are preloaded.
6. Administrative user reviews exceptions.
7. Approved records feed working hour/liquidation flow.

### Organization chart

1. System reads employees from Legajos.
2. Hierarchy uses direct manager.
3. Category view uses internal/receipt category.
4. Filters use organizational structure data.

## Environment variables

See `backend/.env.example` and `frontend/.env.example` for the real, current list (DB connection, JWT secrets, storage provider credentials, rate-limit tuning, `VITE_API_URL`, etc.). Both `.env` files are gitignored; never commit real secrets.

## Commands

Backend (`backend/`):

```bash
npm install
npm run dev              # tsx watch
npm run typecheck
npm run test             # vitest run
npm run build
npm run prisma:migrate:dev
npm run prisma:studio
```

Frontend (`frontend/`):

```bash
npm install
npm run dev              # vite
npm run test             # vitest run
npm run build            # tsc -b && vite build
```

## AI-specific instructions for this project

* Always read this file before making structural or functional changes — and cross-check it against `ls backend/src/modules` / `ls frontend/src` first, since this file has previously gone stale relative to the real code.
* Do not invent business rules, endpoints, tables or env vars without checking the codebase.
* This system has a real backend/database/production APIs already — do not propose building them "from scratch" or treat the system as frontend-only/mock.
* Any new `backend/src/modules/<name>` must be added, in the same change, to `docs/BACKEND_API_CONTRACTS.md` and to the module list in this file and in `docs/ARCHITECTURE_STANDARDS.md`.
* Do not change API contracts without reviewing frontend/backend impact.
* Do not modify the database schema without documenting the migration and its impact; avoid schema changes that aren't strictly necessary for the task at hand.
* No change to `employees`, `time-entries`, `novelties`, or `auth` business logic is complete without an accompanying test (see the patterns in each module's `*.service.test.ts`).
* Before adding a new `*MockService.ts`, check whether a real `*ApiService.ts` already covers it, and whether an existing mock with the same purpose has zero real importers (in which case delete it instead of adding a parallel one).
* Do not reimplement date/time/timezone math per module — `backend/src/shared/datetime/argentinaTime.ts` is the single shared helper for Argentina-aware date/time handling; reuse it instead of writing a new implementation. Real instants (things that happened at a point in time, e.g. clock punches) are stored as `TIMESTAMPTZ`; calendar-only fields (e.g. a novelty's `fromDate`/`toDate`) are stored as `@db.Date`. See `docs/DATABASE_STANDARDS.md`.
* Company → BusinessUnit → Establishment → Area → Sector is a singular-FK chain (each level has exactly one parent); do not add a second parent FK to any of these models. `CostCenter` is the one deliberate exception and uses real many-to-many join tables against the other five, because it is a cross-cutting tag, not a duplicate of an existing FK. See `docs/DATABASE_STANDARDS.md`.
* `Position.sectorId` is the official source of a position's location, and `PositionSalaryCategory` is the official source of its salary category/categories — do not reintroduce a denormalized area/establishment/business-unit/company name or a single "suggested category" field on `Position`. See `docs/DATABASE_STANDARDS.md`.
* Authorship fields (`createdByUserId`, `approvedByUserId`, `uploadedByUserId`, etc.) are real optional FKs to `User` with `onDelete: SetNull` — never `Cascade` from `User` to a historical record, and never delete a `User` row that has related history. See `docs/DATABASE_STANDARDS.md`.
* Do not add a new frontend caching mechanism without checking `frontend/src/services/cache` (SWR) and `backend/src/shared/cache` (TTL) first.
* Any public (unauthenticated) endpoint must declare its own abuse protection (rate limiting at minimum) — the global API rate limiter is not sufficient on its own.
* CI (`.github/workflows/ci.yml`) runs backend/frontend typecheck+test+build on every push to `main` and every pull request — see `docs/DEVOPS_DEPLOYMENT_STANDARDS.md`. It never deploys and never touches a real database; a failing run must be fixed before merging.
* Before starting any large feature (e.g. a new module like Turnos, or a schema-affecting change), do analysis + a written plan first, and only then implement; close the feature with tests, a successful `typecheck`/`test`/`build`, and a validation summary — do not skip straight to code on multi-step work.
* Document every assumption.
* Preserve compatibility with existing data.
* Prioritize professional enterprise UX; the system must feel integrated, not like isolated screens.
