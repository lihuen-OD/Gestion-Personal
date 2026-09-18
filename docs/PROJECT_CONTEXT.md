# Project Context

> Etapa 15M.14: corrección global de scroll vertical en el App Shell.
> `.page-wrap` (`frontend/src/app/AppShell.tsx`) es el único propietario del
> scroll vertical de toda la aplicación; `html`/`body`/`#root`/`.app-shell`/
> `.workspace` no scrollean. Causa raíz: `.page-wrap` no tenía `contain:
> layout`, y contenido real con `display:grid`/columnas `auto` (ej.
> `.shift-alert-journey-header`, `.notification-row`) podía inflar el
> scrollHeight del documento por encima de lo que `.page-wrap` reportaba —
> generando un segundo scroll de página compitiendo con el de `.page-wrap`
> (scroll vacío después del contenido real, sidebar aparentando
> desacoplarse). Se agregó `contain: layout` a `.page-wrap`, lo que a su vez
> exigió portar `Modal` (`components/ui/Modal.tsx`) a `document.body` (ya lo
> hacía `AppDialogHost`) para que los modales sigan cubriendo todo el
> viewport. `AppShell` ahora resetea `.page-wrap.scrollTop` a `0` en cada
> cambio de ruta (antes no había ninguna política de scroll restoration). Ver
> `docs/PROJECT_UI_CONTEXT.md` "Política de scroll vertical" para la cadena
> completa y las reglas para código nuevo. No se tocó negocio/generación de
> alertas/cálculos.

> Etapa 15M.13: Alertas de turnos usa `workShiftId` como unidad visual de
> empleado + jornada. Cada card deriva en frontend la severidad máxima activa
> y el estado Pendiente/Parcialmente resuelta/Resuelta; conserva prioridad y
> resolución individual, y marca tipos legacy como “Registro anterior”. No se
> modificó generación, matching ni persistencia de alertas.

> Etapa 15M.12: el modal de carga/corrección horaria usa una composición
> explícita: resumen superior, aviso administrativo transversal y contenido
> fluido de formulario/novedad. Ya no depende de las columnas implícitas que
> podía crear `.form-wide`/`.form-actions`. Los valores editables mantienen el
> contrato de horas decimales y muestran simultáneamente su equivalencia
> humana en horas y minutos.

> Etapa 15M.11: la UI operacional no expone UUID, códigos de error ni enums
> internos. Las observaciones históricas generadas por fichadas se humanizan
> al presentarlas, sin migrar ni perder el dato persistido; las nuevas ya se
> guardan sin identificadores técnicos. Ver
> `docs/decisions/USER_FACING_TEXT_POLICY_15M11.md`.

> Etapa 15M.7C/15M.7C.1: `WorkRegime.kind` define la obligación de turno.
> `SIN_TURNO` y `TURNO_FLEXIBLE` no producen alertas por ausencia o
> incompatibilidad de turno; `TURNO_OBLIGATORIO` conserva ese control y sin
> régimen rige el fallback conservador. `POSIBLE_OLVIDO_SALIDA`,
> `JORNADA_EXTENDIDA` y `FALTA_SALIDA` siguen siendo controles de jornada
> independientes. Create/update y WorkRegimesPage normalizan configuraciones
> nuevas para evitar `alertOnOutOfShift=true` en kinds que no exigen turno.

> Etapa 15M.7D: una jornada cerrada con cero solapamiento contra su turno
> propio habilitado genera `JORNADA_FUERA_DE_TURNO` (`ADVERTENCIA`). La
> comparación usa intervalos reales semicerrados y contempla cross-midnight.
> Al confirmarse, las alertas pendientes de puntualidad de esa jornada se
> resuelven automáticamente sin borrar historial; duración, conceptos, horas
> reales y Horas Especiales permanecen independientes.

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
* Access complete documentation — since the 15D.4 stage (`docs/decisions/DOCUMENT_CATEGORY_AUTHORIZATION_15D4.md`), this is enforced per `DocumentCategory` (`viewRoles`/`uploadRoles`) rather than a blanket block: Nivel 3 can only view/upload documents in categories explicitly configured to allow their role, and always within their own employee scope. Categories not explicitly configured for Nivel 3 stay inaccessible to them, same practical effect as before that stage.
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

A user's real role/level (`User.role` — Nivel 1 RRHH / Nivel 2 Supervisión / Nivel 3 Administrativo de Carga Horaria) is managed **only** from Usuarios/Roles and is the single source of truth for permissions. Assigning someone as Responsable de carga horaria (`EmployeeAssignment`) never redefines or duplicates that role — the assignment modal (2026-09-15) has no role selector and shows no role at all, editable or informational; a lookup by name (`personName`) against `User` is not reliable enough (names are not a unique key) to justify one. If a real, ID-based need to show that role ever comes up, it must be read from `User.role` of the linked person (never hardcoded, never inferred from the fact that they were assigned) and stay strictly read-only.

### 7. Carga Horaria

Working hour entry must be employee-based, not cost-center-based.

Correct flow:

1. Select period.
2. Search employee by legajo, DNI, CUIL, first name or last name.
3. Show employee data.
4. Load the employee's real worked time in Horas normales and, when applicable, its additional concept breakdowns and/or novelties.
5. Save records linked to employeeId.

The responsible user must only see employees assigned to them as responsible for working hour entry.

### Semántica de segmentos de conceptos horarios (Etapa 15M.7A)

Hora normal es la base universal y conserva la duración real completa de la jornada. Los conceptos horarios adicionales son desgloses aditivos. Si ninguna regla adicional cubre un tramo, ese tramo sigue siendo Hora normal sin concepto adicional: no requiere revisión y no genera una nueva alerta `SEGMENTO_SIN_CLASIFICAR`. El estado interno `SIN_CONCEPTO_COMPATIBLE` permanece temporalmente como metadata neutral por compatibilidad; las alertas históricas siguen siendo legibles. Motor A aporta evidencia técnica y no determina totales pagables; Motor B continúa siendo el dueño de `HourConceptBreakdown`.

### Elegibilidad automática de conceptos (Etapa 15M.7B)

Motor A y Motor B comparten la misma semántica de elegibilidad automática: concepto habilitado al empleado, activo, no eliminado, `loadMode = AUTOMATIC | BOTH` y regla activa. Un concepto `MANUAL` nunca se presenta como detección automática, aunque exista una regla histórica activa; sigue disponible exclusivamente para su flujo manual. `BOTH` conserva ambos flujos. Los `TimeSegment` históricos no se migran.

Centro de costo can be displayed as information or secondary filter, but it must not be the main axis of the loading process.

Working hour records must be prepared for future BioTime integration. The official functional model is additive: Horas normales is always the base grid and the only source for the real worked total; additional hour concepts are overlapping breakdowns and must never replace or increase that total.

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

The current persisted/API shape may still express the previous per-concept classification model. That is implementation debt, not the business rule to preserve. See "Modelo oficial de Conceptos Horarios" below and `docs/decisions/CONCEPTOS_HORARIOS_ADITIVOS.md`.

**Monthly closure integrity (Etapa 15E, `docs/decisions/TIME_CLOSURE_CONSISTENCY_15E.md`):** once a period's `MonthlyTimeClosure` is `ENVIADO`/`APROBADO`/`CORRECCION_PENDIENTE`, no role — RRHH included — can create a brand-new `TimeEntry` for that employee/period through the normal flow; the backend rejects it (`409 MONTHLY_CLOSURE_LOCKED`). Editing an *existing* entry still follows the pre-existing rule: Supervisión/Nivel 3 must go through a formal `TimeCorrectionRequest`, while RRHH can correct it directly but must supply a reason (`correctionReason`), and that correction is auto-approved and audited. The same RRHH-with-reason rule now also applies to manual `HourConceptBreakdown` corrections, so a closed period behaves consistently whether the change is to Horas normales or to an additional concept breakdown.

**Definitive export requires an approved closure (Etapa 15E.2, `docs/decisions/TIME_EXPORT_CLOSURE_GATE_15E2.md`):** `GET /time-entries/export(.csv)` — the export used for liquidación — only produces a file when every employee it would include has a `MonthlyTimeClosure` in `APROBADO` for that period; otherwise it rejects the whole request (`409 MONTHLY_CLOSURE_NOT_APPROVED`), never a partial file. The existing `includeInReview=true` query param is the preview path (includes `EN_REVISION` rows too) and is exempt from this gate; its response is explicitly marked `definitive: false`. Finnegans export (`/finnegans-export/*`) only exports novedades, never hours; since the Etapa 15L.3A below it has its own, separate monthly-closure gate (own error codes, own preview/definitive contract) — this rule (15E.2's) still does not apply there.

**Panel de revisión visual previo al cierre (Etapa 15K, `docs/decisions/MONTHLY_CLOSURE_REVIEW_PANEL_15K.md`):** `MonthlyClosuresPage.tsx` (`/cierres`) agrega una acción "Revisar horas" por fila, para los 3 niveles, que abre un panel read-only (`MonthlyClosureReviewPanel` + `MonthlyHoursReviewGrid`, ambos en `frontend/src/components/hours/`) con KPIs (horas reales, conceptos adicionales, valor liquidable si aplica, incidencias y novedades del período) y la grilla mensual del legajo — misma fuente (`GET /employees/:id/time-grid`, carga lazy sólo al seleccionar un empleado) y mismos helpers que `EmployeeHoursPage.tsx`, que no se modificó. El panel es puramente informativo: no agrega ningún bloqueo ni acción de cierre nueva — enviar/aprobar/devolver siguen siendo exactamente las mismas acciones de antes de esta etapa.

**Retiro controlado de campos legacy en Tipos de Novedad (Etapa 15L.6, `docs/decisions/NOVELTY_TYPE_LEGACY_REMOVAL_15L6.md`):** las etapas 15L.2A/B/C dejaron el modelo nuevo de `NoveltyType` (`timeEntryBehavior`/`allowsDateRange`/`finnegansValueUnit`/`finnegansRequiresValidity`) conviviendo con los campos legacy que reemplazaba, sincronizados por compatibilidad (`noveltyTypes.sync.ts`). Auditados uno por uno contra consumidores reales, se confirmó que ninguno tenía ya lectura productiva propia — se eliminaron `origin`, `allowsDateTo`, `hasValidity`, `blocksTimeEntry`, `setsWorkedHoursToZero`, `timeImpact` (campos y el enum `NoveltyTimeImpact`), y `noveltyTypes.sync.ts` completo (dead code sin nada más que sincronizar). `timeImpact="REGISTRA_HORAS_NO_TRABAJADAS"` se confirmó redundante con `allowsHours=true` en el único `NoveltyType` real que lo usaba — se eliminó la rama de UI (`NoveltyModal.tsx`/`EmployeeHoursPage.tsx`) sin inventar ningún reemplazo. `FinnegansNoveltyLink` (relación 1:N) se migró a 1:1 físico (`NoveltyType.finnegansCode`/`finnegansName`, mismo patrón que `finnegansValueUnit`/`finnegansRequiresValidity`) tras confirmar con datos reales que ningún tipo tenía más de un vínculo activo — la tabla se eliminó junto con `finnegansExport.principalLink.ts` (dead code). También se eliminaron, auditados como sin consumidor real: `Novelty.affectsSettlement` (frontend, alias puro de `exportsToFinnegans`) y `NoveltyType.history`/`NoveltyTypeHistoryRecord` (placeholder hardcodeado a `[]` desde 15L.2B, sin endpoint ni UI). Migración de Prisma generada pero no aplicada (mismo motivo que 15L.2A/15L.4: única base Neon real disponible) — copia primero el vínculo principal de cada tipo a las columnas nuevas antes de eliminar la tabla.

**Normalización de cantidades en Novedades — `quantityDays`/`quantityHours` (Etapa 15L.5, `docs/decisions/NOVELTY_QUANTITY_SEMANTICS_15L5.md`):** el backend pasa a ser la única autoridad de `quantityDays` — antes se calculaba en el frontend (`NoveltyModal.tsx`/`EmployeeHoursPage.tsx`, lógica duplicada) recortando el conteo al mes de `fromDate` (`30/07→02/08` daba `2` en vez de `4`). Nuevo helper compartido `calendarDaysInclusive` (`backend/src/shared/datetime/argentinaTime.ts`, junto a `periodFromCalendarDate`/`dayOfMonthFromCalendarDate`, mismo criterio de fecha-calendario-ya-normalizada) calcula días calendario inclusivos del rango real completo, sin recortar al mes de exportación (ese período lo sigue decidiendo sólo `fromDate`, 15L.3B.1, sin tocar). `novelties.service.ts::resolveQuantities` ignora y recalcula siempre `quantityDays` cuando `NoveltyType.allowsHours=false` (nunca confía en lo que mande el cliente); `quantityHours` sigue siendo 100% manual cuando `allowsHours=true`. Auditoría confirmó que `quantityDays` tiene un consumidor real fuera de Finnegans (bandeja de pendientes, listado de Novedades) — por eso se calcula siempre que `allowsHours=false`, no sólo cuando `finnegansValueUnit=DAYS`. Nueva validación en `noveltyTypes.service.ts`: `allowsHours=true + finnegansValueUnit=DAYS` queda prohibida (`400 NOVELTY_TYPE_HOURS_DAYS_CONFLICT`) — sin evidencia real de esa combinación y estructuralmente inviable (ese tipo nunca tendría `quantityDays` para exportar). El exportador Finnegans no se tocó — ya leía `quantityDays` tal cual, sólo que ahora ese valor es canónico. Frontend: nuevo `frontend/src/utils/noveltyDateRange.ts` (helper único, ya no duplicado) sólo para previsualización ("Cantidad de días: 4"); el payload de creación ya no manda ningún `quantityDays` calculado.

**Historial, versionado e idempotencia de exportaciones Finnegans (Etapa 15L.4, `docs/decisions/FINNEGANS_EXPORT_HISTORY_IDEMPOTENCY_15L4.md`):** cada exportación definitiva exitosa deja evidencia persistente — nuevos modelos `FinnegansExportBatch` (período, versión correlativa por período con `@@unique([period, version])`, formato, hash SHA-256 del contenido, motivo, `idempotencyKey` única, quién/cuándo, `previousBatchId`) y `FinnegansExportBatchItem` (snapshot de las 7 columnas exportadas como texto congelado, más `employeeName`/`detail` de presentación; `noveltyId` nullable con `onDelete: SetNull` para sobrevivir al hard-delete existente de `Novelty`). El endpoint definitivo pasó de `GET .../novelties` (sin preview) + `GET .../novelties.csv` (ambos retirados, sin caller real) a un único `POST /finnegans-export/novelties/export` (`{period, format, reexportReason?, idempotencyKey}`) — reexportar un período ya exportado es posible sin límite pero siempre explícito (motivo obligatorio, exigido por el backend) y protegido contra duplicados por doble click/retry (`idempotencyKey` única; mismo key devuelve el mismo batch ya creado, sin revalidar ni versionar de nuevo). `GET /finnegans-export/history?period=` y `GET /finnegans-export/history/:batchId` exponen el historial y el detalle con diff (`added`/`removed`/`modified`) contra la versión anterior — sin ids técnicos en ningún texto de presentación. Readiness y cierre mensual (15L.3A) y selección mensual por `fromDate` (15L.3B.1) quedan sin ningún cambio de regla — una reexportación revalida exactamente lo mismo que la primera. Migración de Prisma generada pero no aplicada (mismo motivo que 15L.2A: única base Neon real disponible).

**Propiedad mensual única de novedades en exportación Finnegans (Etapa 15L.3B.1, `docs/decisions/FINNEGANS_EXPORT_MONTHLY_OWNERSHIP_15L3B.md`):** el período de exportación de una novedad se determina exclusivamente por su `fromDate` — `toDate` ya no participa en la selección (`finnegansExport.repository.ts::buildWhere`: `fromDate: { gte, lte }` de los límites del mes, sin ninguna cláusula sobre `toDate`). Una novedad `30/07→02/08` se exporta una única vez, en julio, con el rango real completo (`Fecha desde=30/07`, `Fecha hasta=02/08`, sin recortar); una novedad abierta (`toDate=null`) se exporta una única vez, en el mes de su `fromDate`, sin repetirse en los meses siguientes. Como preview/definitivo/CSV ya compartían una única función de selección (15L.3A), el cambio (un solo archivo) se propaga automáticamente a los tres sin tocar `service.ts`/`controller.ts`. El gate de cierre mensual queda coherente sin ningún cambio de código: sólo se exige el cierre del mes dueño de cada novedad. Hallazgo documentado, no resuelto: el frontend (`NoveltyModal.tsx`/`EmployeeHoursPage.tsx`) ya recorta `quantityDays` al mes de `fromDate` al calcularlo (lógica duplicada, sin validación de backend contra el rango) — deuda técnica para una etapa futura.

**Exportación Finnegans sobre modelo normalizado + gate de cierre mensual (Etapa 15L.3A, `docs/decisions/FINNEGANS_EXPORT_NORMALIZED_15L3A.md`):** `finnegans-export/*` migró de los campos legacy (`hasValidity` OR, `quantityHours→quantityDays→"1"`) a `NoveltyType.finnegansValueUnit`/`finnegansRequiresValidity` (15L.2A), sin ningún `if` por nombre de tipo. `GET /finnegans-export/novelties?period=YYYY-MM&preview=true` sólo informa (nunca exige cierre, nunca audita); sin `preview` (y siempre `.novelties.csv`) es la exportación definitiva: revalida todo, exige que **cada fila** esté lista (vínculo Finnegans activo, unidad de Valor 1, cantidad, vigencia — si no, `409 FINNEGANS_EXPORT_NOT_READY`) y que el `MonthlyTimeClosure` de **cada empleado incluido** (sólo los que tienen alguna novedad candidata, nunca toda la nómina) esté `APROBADO` (si no, `409 FINNEGANS_MONTHLY_CLOSURE_NOT_APPROVED`) — nunca una exportación parcial. La respuesta trae un objeto `readiness` (`ready`/`totalRows`/`readyRows`/`blockedRows`/`reasons` humanos, sin ids) y cada fila un `estado` (sólo para la UI de preview, nunca en el CSV/XLSX). `FinnegansExportPage.tsx` separó preview (carga automática al cambiar de período) de definitivo (sólo al click en "Exportar", siempre vuelve a pedirle el resultado al backend — nunca genera el `.xlsx` con filas de preview ni filtradas por búsqueda). Legacy sin tocar: columnas de `NoveltyType`, `FinnegansNoveltyLink` (sigue 1:N), historial/idempotencia de exportaciones (15L.4). La semántica de solapamiento mensual (mencionada como deuda al cerrar esta etapa) quedó resuelta por la Etapa 15L.3B.1 (bullet de arriba).

**Migración de consumidores al modelo normalizado (Etapa 15L.2C, `docs/decisions/NOVELTY_TYPE_CONSUMER_MIGRATION_15L2C.md`):** `findBlockingNovelty` (`time-entries/timeEntries.repository.ts`) pasó de un OR entre 3 campos legacy a una única condición `noveltyType.timeEntryBehavior === "BLOQUEA_NUEVA_CARGA"`. `noveltyCoversDay`, `attendanceInactivity.service.ts`, `novelties.service.ts` (validaciones de fecha/vigencia) y las pantallas operativas `NoveltyModal.tsx`/`EmployeeHoursPage.tsx` migraron sus lecturas de `allowsDateTo`→`allowsDateRange` y `hasValidity`→`finnegansRequiresValidity`. `origin` se confirmó sin ningún consumidor productivo (antes y después). Quedan deliberadamente sin migrar (documentado, no un olvido): el valor `timeImpact="REGISTRA_HORAS_NO_TRABAJADAS"` (sin equivalente en el enum nuevo de 2 valores) y todo uso de `hasValidity` dentro de `finnegans-export/*` (fuera de alcance). Se eliminó `NoveltyTypeHistoryTab.tsx` (huérfano, sin imports ni tests). Cero columnas de Prisma eliminadas, cero cambios al exportador Finnegans.

**Rediseño frontend de Tipos de Novedad (Etapa 15L.2B, `docs/decisions/NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md`):** `/configuracion/tipos-novedades` (creación, detalle y listado) se rediseñó sobre el modelo normalizado de 15L.2A: ya no muestra `origin` ni los 3 campos horarios legacy (usa un único selector "Comportamiento" = `timeEntryBehavior`), la sección Finnegans trabaja con un solo "vínculo principal" (aunque `FinnegansNoveltyLink[]` sigue siendo 1:N sin tocar) con unidad de Valor 1 explícita (`finnegansValueUnit`), y se quitó la pestaña "Historial" (seguía hardcodeada vacía). `NoveltyModal` (creación de novedades) ahora filtra el catálogo por `allowedLoadRoles` del usuario. Cambios de backend mínimos para sostener esto: `exportConcept` deja de ser obligatorio, el enum de colores quedó unificado 1:1 con el frontend, y se agregó una validación de coherencia (`exportsToFinnegans=true` exige vínculo + unidad definida). **Corrección posterior (Etapa 15L.2B.1):** `allowsHours` y `finnegansValueUnit` quedaron desacoplados por completo, en ambas direcciones — `NoveltyModal` decide qué cantidad enviar mirando únicamente `allowsHours` (nunca `finnegansValueUnit`, que sólo es la interpretación de exportación); ver `docs/decisions/NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md` §19.

**Normalización aditiva de Tipos de Novedad (Etapa 15L.2A, `docs/decisions/NOVELTY_TYPE_MODEL_NORMALIZATION_15L2A.md`):** `NoveltyType` gana un modelo nuevo, aditivo y sincronizado con el legacy (nunca lo reemplaza todavía): `timeEntryBehavior` (`NO_BLOQUEA`/`BLOQUEA_NUEVA_CARGA`, reemplaza en la práctica a `blocksTimeEntry`/`setsWorkedHoursToZero`/`timeImpact`), `allowsDateRange` (reemplaza `allowsDateTo`), `finnegansRequiresValidity` (reemplaza `hasValidity` a nivel de tipo), `finnegansValueUnit` (`HOURS`/`DAYS`/`UNIT`, nullable — nunca se infiere `DAYS`/`UNIT` sin evidencia) y `notes` (antes se editaba en el frontend y se perdía siempre al guardar; ahora persiste). Un create/update que manda cualquiera de los campos nuevos los trata como fuente de verdad y fuerza los legacy correspondientes a una combinación coherente; uno que sólo manda legacy los sincroniza igual (`noveltyTypes.sync.ts`) — nunca queda una combinación contradictoria, y `setsWorkedHoursToZero` nunca vuelve a escribirse `true` desde código nuevo. `requiresApproval` pasa a tener efecto real en `noveltiesService.create()`: RRHH sigue creando siempre `APROBADO`; para Nivel 2/3, `requiresApproval=false` autoaprueba (antes el campo era decorativo, sólo el rol de RRHH decidía). `quantityHours`/`quantityDays`: se rechaza mandar ambas cantidades a la vez (`NOVELTY_QUANTITY_UNIT_CONFLICT`) — la validación original de esta etapa también rechazaba según `finnegansValueUnit`, pero se quitó en la Etapa 15L.2B.1 por mezclar capacidad operativa con interpretación de exportación (ver `docs/decisions/NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md` §19); la capacidad operativa de cargar horas sigue dependiendo únicamente de `allowsHours` (`NOVELTY_HOURS_NOT_ALLOWED`, sin cambios). `NoveltyType.code` puede omitirse en `POST /novelty-types` — el backend genera el próximo correlativo con reintento ante colisión de concurrencia (antes sólo lo calculaba el frontend). Nada de esto tocó `TimeEntry`, `MonthlyTimeClosure`, la exportación Finnegans ni la relación 1:N con `FinnegansNoveltyLink` — quedan exactamente igual, ver el documento de decisión para el detalle completo y lo que queda pendiente para 15L.2B.

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

The backend has 22 modules under `backend/src/modules`. The following exist and are in production use but were missing from the numbered list above — check `backend/src/modules/<name>` and `docs/BACKEND_API_CONTRACTS.md` before assuming a module doesn't exist:

* **shifts** (`shiftTemplate`, `shiftAssignment`, `shiftAlert`) — turnos: plantillas de turno, asignación a empleados, alertas de jornada abierta/vencida. Added 2026-07-23.
* **work-regimes** (`WorkRegime`, `EmployeeWorkRegime`) — régimen laboral configurable por RRHH (turno obligatorio/flexible/sin turno; rollover automático o alerta crítica ante jornada abierta excedida) y su asignación a empleados con vigencia histórica. Instancias como Cosecha/Riego/Campaña son datos, no código. Added 2026-08-19.
* **workforce-management** — reglas de horas dobles, cierres mensuales, notificaciones internas del sistema.
* **finnegans-export** — exportación de novedades (nunca horas/liquidación) al sistema externo Finnegans; preview vs. definitivo con gate de cierre mensual propio (Etapa 15L.3A), selección mensual única por `fromDate` (Etapa 15L.3B.1), historial/versionado/idempotencia de exportaciones definitivas (Etapa 15L.4).
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
* `User.role` is the only source of truth for a user's real role/level; the Responsable de carga horaria assignment does not redefine or duplicate it (no editable role selector in that modal — fixed 2026-09-15, see `docs/BACKEND_API_CONTRACTS.md` "Responsables / asignaciones").
* Carga horaria is employee-based, not cost-center-based.
* Centro de costo is structural/reporting information, not the main access rule for time entry.
* Dashboard indicators are calculated by the backend (`GET /dashboard`) from real Prisma queries, cached briefly (see `docs/CACHING_STRATEGY.md`).
* The system already has a real backend/API; do not build new frontend-only mock flows for functionality the backend already implements.
* Do not add a new `*MockService.ts` without first checking whether a real `*ApiService.ts` under `frontend/src/services/api` already covers it.

## Modelo oficial de Conceptos Horarios

This section is the primary source of truth for working-hour concepts. If another document, an API contract, the current UI, or the current persistence model conflicts with it, this business decision prevails for future design and implementation. Existing behavior will be corrected incrementally; this documentation update does not claim that the application already complies.

### Horas normales: base obligatoria

* Every employee always has Horas normales; it is not optional and is not enabled through the employee file.
* Horas normales is the base grid and represents the employee's full real worked time.
* It may come from the fichador or be entered manually for clock failures or authorized adjustments.
* The worked total is calculated exclusively from Horas normales.

### Conceptos horarios adicionales: desgloses aditivos

* Sereno, Colectivo, Camioneta, Guardia and similar concepts are additional grids or breakdowns of time already included in Horas normales.
* They do not replace or compete with Horas normales and are not added to calculate the worked total.
* They are used for payroll/export preparation, analysis and control.
* Each additional concept is enabled per employee from the legajo. Only enabled concepts appear or can be loaded for that employee.

Example: if an employee worked 10 real hours and 6 of them were Sereno, the correct result is `Horas normales: 10` and `Sereno: 6`. `Horas normales: 4` plus `Sereno: 6` is incorrect.

### Modos de carga y reglas automáticas

Every additional concept must support one of these loading modes:

* Manual.
* Automático.
* Manual y automático.

Automatic concepts are derived from fichadas using an active/inactive time rule with hora desde, hora hasta and cruza medianoche. Sereno is a typical automatic case. Colectivo and Camioneta are typical manual cases: RRHH loads their breakdown in the grid, and doing so neither creates nor increases Horas normales.

The fichador records the real worked interval in Horas normales. Active automatic rules may additionally derive one or more overlapping concept breakdowns from that same interval. Additional concepts may overlap each other because they are independent classifications, not exclusive segments.

### Impacto en legajo, grilla, liquidación y cierres

* Legajo enables only additional concepts; Horas normales is always available by default.
* The grid always displays Horas normales plus the additional concepts enabled for that employee.
* Grid, summaries, exports and monthly closures must calculate the real worked total only from Horas normales. Additional concepts are shown separately and may feed payroll/export rules without increasing that total.
* Novedades remain separate employee/day-or-period events; they are not hour concepts.

### Modelo anterior de prioridad/exclusividad queda deprecado

The existing `priority` field and any rule where one concept “wins” a time overlap belong to the previous exclusive-classification model. They are deprecated and pending future removal. `countsAsWorked` must not be used to add additional concepts to the real worked total; under the official model that total comes from Horas normales. `hourConceptId` and `TimeSegment` may remain as current implementation details, but must not be interpreted as proof that a work interval can belong to only one concept.

Until the staged redesign is implemented, current backend, frontend, schema, migrations and historical technical documents may still reflect exclusive classification. Do not extend that behavior as if it were the target model. The migration path and compatibility decisions are recorded in `docs/decisions/CONCEPTOS_HORARIOS_ADITIVOS.md`.

**Etapa 15I update (`docs/decisions/ENABLED_HOUR_CONCEPT_CLASSIFICATION_15I.md`):** the legacy `TimeSegment` classifier (`hourConceptClassification.ts`) now only evaluates `HourConceptRule`s for concepts the employee actually has enabled (`classifySegmentsForEmployee`, `timeEntries.service.ts`, filters `activeRules` by `enabledHourConceptIds` before classifying) — working a night schedule no longer classifies a segment as an unassigned additional concept (e.g. Sereno) just because a matching rule exists somewhere in the system for a different population. Hora normal remains the universal fallback; `CONCEPTO_NO_HABILITADO` is unreachable through this path now and only remains as a defensive/legacy branch. This closes part of the exclusive-classification gap for `TimeSegment` specifically — `priority`, the "winning" concept semantics and the rest of the deprecated model described above are still present exactly as documented.

**Etapa 15M.2 update (`docs/decisions/ATTENDANCE_AUTO_BREAKDOWN_SYNC_15M2.md`):** closing a real `WorkShift` (fichador exit or an admin close/create) now automatically regenerates that employee/period's `HourConceptBreakdown` (`AUTOMATIC`/`BOTH`) — before this stage, the additive generator (`automaticHourConceptBreakdownsService`) had no real caller outside an explicit admin endpoint that, since Etapa 6L.4, did not even have a UI button left calling it; a correctly-closed shift could show up right in Asistencia (`TimeSegment`) while never appearing in the monthly hours grid. The engine itself, its eligibility rules (`HourConcept.loadMode`) and its idempotent replace-by-period persistence did not change; only the missing trigger was added, isolated so a Motor B failure (including a locked `MonthlyTimeClosure`) never reverts or blocks an already-persisted punch/close. The Motor A/`loadMode` gap described by that historical stage was closed in 15M.7B (`docs/decisions/MOTOR_A_LOAD_MODE_ALIGNMENT_15M7B.md`). The separate remaining gap is that a late punch can still update Hora normal on an already-closed period while its automatic breakdown stays stale until the closure reopens or a manual recalculation runs.

**Etapa 15M.3 update (`docs/decisions/ATTENDANCE_TIME_GRID_REAL_DATA_FIX_15M3.md`):** confirmed with a real, anonymized production case (read-only query against the Neon database) that Hora normal itself (`TimeEntry` `NORMAL_BASE`), not just the additive breakdown, could silently lose real minutes — a shift classified by Motor A into more than one `TimeSegment` of the same calendar date (e.g. because an `AUTOMATIC` additional concept's rule only covers part of the shift) had each segment overwrite the same stale in-memory snapshot inside `closeOpenWorkShift` instead of accumulating on top of the previous segment's write, so only the last segment's minutes (plus whatever existed before that call) survived. Root-caused to a specific commit (`d47dcdd`, 2026-09-02, "optimize closeOpenWorkShift transaction to prevent timeout errors", Etapa 13F) that replaced a fresh per-segment lookup with a single pre-loop snapshot for performance — confirming the regression was real and dated, not a `hours`/`totalMinutes` rounding issue and not a divergence between `GET /time-entries/period-employees` and `GET /employees/:id/time-grid` (both read the exact same `TimeEntry` rows with the exact same status/systemRole filter). Fixed by grouping segments by calendar date before writing `TimeEntry`, so exactly one row gets created/updated per date regardless of how many segments Motor A produced for it. The pre-existing, already-corrupted historical rows this left behind were diagnosed and partially repaired in Etapa 15M.4 (see below) — no longer purely a proposed backfill.

**Etapa 15M.4 update (`docs/decisions/ATTENDANCE_NORMAL_HOURS_RECONCILIATION_15M4.md`):** built a read-only-by-default reconciliation tool (`backend/scripts/reconcile-normal-hours.ts` + `backend/src/modules/time-entries/normalHoursReconciliation.*`) that recomputes each employee/date's real `TimeEntry` `NORMAL_BASE` total from `WorkShift`(`PROCESADO`)/`TimeSegment` — the only trustworthy source, since the corrupted `TimeEntry` rows can't be used to fix themselves — classifies every date (`OK`/`MISSING_TIME_ENTRY`/`UNDERCOUNT`/`OVERCOUNT`/`DUPLICATE`/`MIXED_STATUS`/`LEGACY_INCONSISTENT`), and only writes in an explicit `--mode=repair` (default is always `--mode=dry-run`, gated further by `APP_ENV=staging`). A global dry-run over September 2026 found the Etapa 13F regression was systemic (10 employees active that period, 12 of 26 employee-dates inconsistent); with the user's explicit approval after reviewing that dry-run, only legajo 30's three affected dates were actually repaired (duplicates consolidated into one canonical row with the extra row's minutes zeroed out rather than deleted — audited, never a hard delete; Motor B re-run automatically afterward to regenerate that employee/period's additive breakdown). The other employees the dry-run flagged were deliberately left untouched, pending a separate, explicitly-approved repair pass.

**Etapa 15M.4B update (same decision doc):** that separate pass ran next — a fresh global dry-run (never trusting the prior one) reconfirmed legajo 30 fully `OK` and found 9 remaining employee-dates across legajos 09/10/27/29/32 (2 `UNDERCOUNT`, 1 `OVERCOUNT`, 6 `DUPLICATE`). Using the same tool with no redesign and no policy change, `--mode=repair --period=2026-09` (no legajo filter, letting the tool's own dry-run decide scope) repaired all 9 in their own per-employee-date transactions — 0 errors, 0 rows hard-deleted, Motor B regenerated for all 5 affected employees, and a final dry-run came back with **0 inconsistencies of any kind across all 26 active employee-dates in September 2026**, with legajo 30 unchanged (16/09 still exactly 250 min).

**Etapa 15M.5 update (`docs/decisions/HUMAN_DURATION_FORMAT_15M5.md`):** separately from the 13F/15M.x data-correctness chain above, Gestión Horaria's UI (`HoursPage.tsx`, `EmployeeHoursPage.tsx`, `MonthlyHoursReviewGrid.tsx`, `MonthlyClosureReviewPanel.tsx`) and the dashboard's "Horas cargadas" KPI displayed every duration as a raw decimal-hours string (`formatHours`, just `.toFixed(2)`) — a reconciled, perfectly correct 141-minute shift (legajo 29, or legajo 30's 250 minutes from 15M.4) still rendered as `"2.35 h"`/`"4.17 h"`, which reads as "2 hours 35" but is mathematically 2h21min (`0.35 × 60 = 21`, not 35). Asistencia (`AttendancePage.tsx`) already had its own correct minutes-based formatter; this stage promoted a single canonical one (`formatDurationMinutes`, `frontend/src/utils/hours.ts`) that both screens now share, migrated every duration display in Carga Horaria and the dashboard KPI to it (preferring an already-available minutes field over converting from decimal wherever one exists), and deleted `formatHours` once it had zero remaining callers. Pure frontend/display-only — no backend endpoint, `TimeEntry`, `WorkShift`, `TimeSegment`, Motor A/B, export file (CSV/XLSX) or Finnegans logic changed; only how an already-correct number gets shown to a human.

**Etapa 15M.9 update:** monthly concept grids are explicitly treated as
high-density surfaces. They render the same real minute values through
`formatCompactDurationMinutes` (`10h 43m`, never decimal hours), keep each day
at 88 px on desktop, expose horizontal scrolling, and pin the concept column
while scrolling. Normal surfaces and KPI continue using the long formatter.

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

### Deudas deliberadamente pendientes después del saneamiento 2026-08

* Supervisión conserva PII completa por decisión actual; cualquier recorte requiere validar sus pantallas de gestión.
* La evidencia fotográfica de asistencia sigue disponible para Nivel 3 y requiere una decisión específica de producto/seguridad.
* El fichador mantiene una mitigación temporal mediante token de dispositivo; no constituye seguridad final de producción.
* El organigrama advierte cuando alcanza el límite de 1000 empleados, pero todavía no implementa paginación completa.
* La regla de conceptos horarios aditivos ya está definida, pero su implementación continúa pendiente y puede no coincidir con backend, frontend o esquema actuales.
* El tratamiento de solapamientos de novedades **entre tipos distintos** (p. ej. Ausencia + Llegada tarde, Vacaciones + Licencia médica) continúa pendiente de definición de negocio — la Etapa 15G.3 sólo resolvió el caso "mismo tipo" (ver bullet debajo).
* **Etapa 15G/15G.1** (`docs/decisions/NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md`): decisión funcional final — el fichador y la carga horaria manual son la única fuente de verdad de horas reales; Novedades es justificación administrativa. Una novedad nunca crea, modifica ni pone en 0 un `TimeEntry`, sin importar su `status` o los campos horarios de su tipo (`setsWorkedHoursToZero`/`blocksTimeEntry`/`timeImpact`); `timeImpact = REGISTRA_HORAS_NO_TRABAJADAS` sigue sin ningún efecto real (decorativo). Una novedad `APROBADA` con esos campos sólo puede impedir cargar manualmente una hora nueva ese día (bloqueo preventivo, no modificación). El descuento parcial de horas y la relación con Finnegans/liquidación siguen pendientes de decisión de negocio; el solapamiento de novedades del **mismo tipo** se resolvió en la Etapa 15G.3 (ver bullet siguiente) — entre tipos **distintos** sigue pendiente.
* **Etapa 15G.2** (`docs/decisions/ALERT_TO_NOVELTY_FLOW_15G2.md`): "Notificación/Alerta → Crear Novedad" ya está conectado, usando siempre el mismo endpoint/flujo normal de creación (sin endpoint nuevo para crear la novedad, sin tocar `schema.prisma`, sin vínculo estructurado en DB entre la alerta y la novedad — la trazabilidad es sólo textual, dentro de `Novelty.observation`) y sin `employeeApiService.getById` (el empleado mínimo ya viene resuelto en la notificación/alerta). **Punto único principal: `NotificationsPage.tsx`** (`SystemNotification`, agrega todas las notificaciones del fichador) — cubre los 4 casos pedidos: llegada tarde/salida temprana (`ALERTA_FICHADA`), falta de fichada/olvido de salida (`FALTA_SALIDA`) y **"no asistió"** (`SIN_ACTIVIDAD_REGISTRADA`), sólo cuando la notificación ya trae `employee` resuelto por el backend. Para lograr el caso "no asistió" se tocó backend puntualmente: `workforce.service.ts::notifications()` ahora también enriquece `entityType = "AttendanceInactivityIncident"` con `employee` mínimo (mismo patrón/`select` liviano ya usado para `ShiftAlert`/`WorkShift`/`Employee`). **`ShiftAlertsPage` ya NO tiene ninguna acción de crear novedad** (se quitó por completo, no quedó como secundaria) — sigue siendo sólo consulta/análisis de alertas de turno. `AttendancePage → Problemas de fichada` queda como acceso complementario (útil operativamente, no el flujo principal). Crear la novedad no cambia el estado de la alerta/notificación ni descuenta horas. **Ajuste UX (previo al commit):** la observación precargada nunca incluye un id/UUID técnico de la notificación/incidente/jornada de origen (regla general del proyecto: ningún texto operativo visible muestra ids técnicos) — es un texto puramente humano ("Origen: alerta del fichador...", ver `ALERT_TO_NOVELTY_FLOW_15G2.md` §3.3); como no hay vínculo estructurado en DB ni id textual, la trazabilidad técnica exacta queda como deuda futura si se necesita.
* **Etapa 15G.3** (`docs/decisions/NOVELTY_OVERLAP_DUPLICATE_RULES_15G3.md`): `noveltiesService.create()` bloquea (409) crear una novedad del **mismo `noveltyTypeId`** para el **mismo empleado** cuando su rango de fechas coincide exactamente con una novedad ya activa (`NOVELTY_DUPLICATE`) o se superpone parcialmente con ella (`NOVELTY_OVERLAP`) — `noveltiesRepository.findOverlapping()`, corrido antes de `createMany`. Ignora `RECHAZADO` (una novedad rechazada nunca bloquea); en carga masiva, un solo legajo en conflicto rechaza el lote completo, sin crear el resto en silencio. El mensaje de error identifica el tipo y el/los legajo(s) en conflicto, nunca un id/UUID técnico. **No** evalúa compatibilidad entre `NoveltyType` distintos (Ausencia + Llegada tarde, Vacaciones + Licencia médica siguen sin bloquearse) — el modelo actual no tiene ningún campo que permita inferir esa incompatibilidad con seguridad; queda documentado como deuda para una etapa futura si se define una matriz de compatibilidad real. No se tocó `schema.prisma` ni la lógica de horas/`TimeEntry`.

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
