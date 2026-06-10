# Project Context

This is the main file to customize for each specific project.

## Project name

Sistema Integral de Gestión de Personal y Control Horario.

## Business objective

The objective of this project is to build an internal enterprise system to centralize and professionalize the management of personnel, employee files, organizational structure, working hours, attendance records, absences, documentation, transport information, dashboards, audit history and future payroll/liquidation support.

The system is intended to replace fragmented Excel/Google Sheets workflows with a structured, scalable and auditable application.

The current phase focuses only on the frontend experience, using mock data and localStorage. The goal is to validate the visual design, business flows, relationships between modules and user experience before implementing a real backend or database.

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
* Configure system mock data and administrative catalogs.

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

Dashboard data must come from mock/localStorage services, not from isolated hardcoded numbers.

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

These fields must not be plain text if the value exists in a main catalog or module. They must be selected from centralized mock services.

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

* Position name
* Area/department
* Sector
* Reports to
* Supervises
* Suggested category
* Mission/purpose
* Responsibilities
* Internal/external relations
* Competencies
* Work conditions
* Performance indicators
* Evaluation criteria
* Assigned people

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

These values must be managed as selectable data through centralized mocks/services.

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
* Upload/mock file
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
* Dashboard indicators must be calculated from existing mock/localStorage data.
* The system must be designed to support future backend/API integration.
* The current phase must not create real backend, database or production APIs.

## Tech stack

Frontend:

* Current focus only.
* Use the existing frontend framework of the project.
* Use TypeScript.
* Use reusable components.
* Use centralized mock services.
* Use localStorage where persistence is needed.
* Use clean state management appropriate to the existing stack.
* Keep architecture ready for future API replacement.

Backend:

* Not implemented in the current phase.
* Do not create a real backend yet.
* Do not create real endpoints.
* Do not introduce backend frameworks unless explicitly requested later.

Database:

* Not implemented in the current phase.
* Do not create a real database yet.
* Do not create Prisma/Sequelize/Supabase models yet.
* Model data in TypeScript interfaces and mock services only.

Deployment:

* Pending.
* Current priority is frontend validation.
* Do not add production deployment configuration unless explicitly requested.

External services:

* Current phase should avoid production external services.
* Geolocation/address APIs may be prototyped only if explicitly requested.
* Future possible integrations:

  * BioTime/ZKTeco for biometric attendance.
  * Georef Argentina for geographic administrative data.
  * OpenStreetMap/Leaflet for maps.
  * Future payroll/ERP integration.

## Architecture notes

The current architecture must prioritize frontend validation with future scalability.

Required principles:

* Components should not own business data directly.
* Mock data must be centralized in services.
* Services should be designed so they can later be replaced by API services.
* Types/interfaces must be explicit and reusable.
* Use IDs to connect modules.
* Avoid hardcoded business data inside components.
* Keep compatibility with existing localStorage data.
* Avoid overengineering.
* Do not build backend prematurely.

Recommended services:

* employeeMockService
* positionMockService
* organizationMockService
* timeEntryMockService
* noveltyMockService
* transportMockService
* documentMockService
* userMockService
* auditMockService

## Data model notes

Important relationship fields:

Employee:

* employeeId
* legajoInterno
* legajoFinnegans
* cuil
* dni
* firstName
* lastName
* status
* companyId
* businessUnitId
* establishmentId
* costCenterId
* sectorId
* positionId
* categoryReceiptId
* categoryInternalId
* directManagerId
* timeResponsibleUserId
* address
* transport
* laborMovements
* hourlyConfiguration
* liquidationConfiguration

Position:

* positionId
* positionName
* areaDepartment
* sectorId
* reportsToPositionId
* suggestedCategoryId
* mission
* responsibilities
* competencies
* indicators

TimeEntry:

* timeEntryId
* employeeId
* date
* startTime
* endTime
* totalMinutes
* hourType
* source
* status
* observation
* createdByUserId
* updatedByUserId

Novelty:

* noveltyId
* employeeId
* type
* dateFrom
* dateTo
* quantity
* reason
* observation
* affectsLiquidation
* status

Document:

* documentId
* employeeId
* documentType
* name
* status
* expirationDate

Audit:

* auditId
* entityType
* entityId
* employeeId
* action
* oldValue
* newValue
* createdAt
* createdByUserId

## Security rules specific to this project

Current phase:

* Security is simulated at frontend level.
* Roles and permissions may be mocked.
* Do not expose sensitive employee data unnecessarily in UI.
* Respect role visibility in mock flows.
* Audit-sensitive actions must be tracked conceptually.

Future phase:

* Backend must enforce permissions.
* Frontend restrictions alone are not enough.
* Employee personal data must be protected.
* Biometric data must not be stored in this system.
* If biometric integration is implemented, store only external biometric IDs and attendance events.
* Do not store raw face images, fingerprints or biometric templates.
* Sensitive changes must be auditable.

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

Current phase:

```bash
# No production environment variables required for frontend mock phase.
```

Future possible variables:

```bash
API_BASE_URL=
BIOTIME_API_URL=
BIOTIME_API_USERNAME=
BIOTIME_API_PASSWORD=
MAPS_API_KEY=
```

## Commands

Install:

```bash
npm install
```

Development:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Test:

```bash
npm test
```

Migrations:

```bash
# Not applicable in the current frontend-only phase.
```

## AI-specific instructions for this project

* Always read this file before making structural or functional changes.
* Do not invent business rules.
* Do not modify core flows without checking this file.
* Do not create backend, database, Prisma, Sequelize, Supabase or production APIs in the current phase.
* Do not change API contracts without reviewing frontend/backend impact.
* Do not modify future database schema without documenting migration impact.
* Document every assumption.
* Keep the current phase frontend-only unless explicitly instructed otherwise.
* Use mock services and localStorage for current data persistence.
* Centralize mocks in services.
* Do not hardcode business data inside components.
* Use selectors/autocomplete when a field depends on another module.
* Preserve compatibility with existing data.
* Prioritize professional enterprise UX.
* The system must feel integrated, not like isolated screens.
