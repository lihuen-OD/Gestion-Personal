# Etapa 14A — Auditoría integral de performance, carga y guardado

Fecha: 2026-09-03
Estado: auditoría de solo diagnóstico, sin cambios de código, sin migraciones, sin commits
Alcance: toda la app (22 módulos funcionales / 22 módulos backend / ~60 pantallas frontend). Modo lectura únicamente — ningún archivo de `backend/` o `frontend/` fue modificado durante esta etapa.

---

## 1. Resumen ejecutivo

El backend está, en general, bien diseñado en el sentido que importa (paginación real en los listados operativos grandes, filtros server-side, cache con invalidación explícita en la enorme mayoría de los casos, transacciones acotadas en el camino crítico del fichador después de la Etapa 13F). No es una app "lenta por arquitectura" — es una app con **un puñado de puntos concretos, todos identificables y acotados**, que explican la lentitud percibida:

1. **Un cron sin límite de volumen** (`checkMissingOutRisk`, cada 60s) hace un `findMany` sin `take` sobre todas las jornadas abiertas del sistema y, dentro de un `for`, un `findUnique`+`createShiftAlert` por fila — escala con headcount fichado simultáneo, indefinidamente, para siempre.
2. **Dos operaciones en lote reales** (`novelties/bulk-approve`, `shiftAssignment.assign`/`holidayWorkAssignment.save`) procesan hasta 250-500 elementos **secuencialmente, uno por uno**, generando hasta ~1500-1750 round-trips a la base **en un solo request HTTP**.
3. **Una ruta de creación manual de jornada** (`createFromWorkShift`) nunca recibió el fix de la Etapa 13F que sí se aplicó a `closeOpenWorkShift` — mismo patrón que causó el `503` real documentado en esa etapa, sigue latente.
4. **`GET /workforce/notifications-unread-count` (~1s reportado) no tiene un problema de query ni de índice** — el índice correcto existe y la query lo usa. La causa más probable es **latencia de red hacia Neon** (pooler remoto, ~300-450ms por round-trip ya medido en la Etapa 13F) combinada con hasta 2 round-trips secuenciales (auth cache-miss + count) y posibles cold-starts del compute serverless. Esto no se arregla con código de este endpoint — es un problema de infraestructura/topología de red que necesita instrumentación real para confirmarse.
5. **El logger de requests está deshabilitado en producción** (`requestLogger.ts`: `if (isProduction) return next();`) — hoy **no existe ninguna telemetría real de duración por endpoint en el ambiente que importa**. Esta auditoría se hizo 100% por lectura de código porque no hay otra fuente; es, en sí mismo, el hallazgo más urgente de "Parte 1: Diagnóstico" de `docs/PERFORMANCE_NETWORK_OPTIMIZATION_PLAN.md`, que sigue sin resolverse.
6. **El frontend en general sigue el patrón correcto** ("no blanquear datos ya visibles durante un refresh"), pero **5 pantallas de configuración + 1 componente compartido nunca recibieron el fix que la Etapa 9B ya aplicó en 6 pantallas hermanas** — blanquean su tabla completa en cada guardado/activación/borrado.
7. **Índices de base de datos**: la cobertura es buena (más de 60 índices/uniques repasados), pero hay 3 gaps reales y accionables (`Employee.positionId`, `ShiftAlert.[status,createdAt]`, `ClockPunchAttempt.[status,completedAt]`) y una deuda ya resuelta que sólo necesita actualizar un comentario obsoleto.
8. **Cache**: el único cache backend sin ninguna función de invalidación es `timeGridCatalogCache` (acotado por su TTL de 120s, no es un dato incorrecto, es una inconsistencia de patrón). El mejor candidato nuevo a cachear es `HourConceptRule`, que hoy se lee sin cache en **cada clock-out de cada empleado**.

Ninguno de estos hallazgos requiere un rediseño. Todos son cambios acotados, ya priorizados en la Parte 13 de este documento.

---

## 2. Metodología

1. Lectura directa de los documentos obligatorios indicados: `docs/PERFORMANCE_STANDARDS.md`, `CLAUDE.md`, `AGENTS.md`, `docs/decisions/CLOCK_PHOTO_PUNCH_EXIT_TRANSACTION_13F.md`, `SHIFT_ENTRY_CLASSIFICATION_13A.md`, `SHIFT_EXIT_CLASSIFICATION_13B.md`, `SHIFT_EXIT_SINGLE_NOTIFICATION_POLICY_13G.md`, `SHIFT_ALERTS_GROUPED_VIEW_13H.md`, `WORK_REGIME_ASSIGNMENT_CONSISTENCY_13J.md`, `WORK_REGIME_ASSIGNMENT_RESPONSIVE_FIX_13J3.md`, más `docs/CACHING_STRATEGY.md`, `docs/DATABASE_STANDARDS.md`, `docs/ARCHITECTURE_STANDARDS.md`, `docs/PERFORMANCE_NETWORK_OPTIMIZATION_PLAN.md`, `docs/decisions/PERFORMANCE_DATA_LOADING_AUDIT_9A.md` (índice/resumen), `docs/decisions/ATTENDANCE_SHIFT_ALERTS_NOTIFICATIONS_AUDIT_10E.md`, `docs/PROJECT_CONTEXT.md`, `docs/BACKEND_API_CONTRACTS.md` (inventario de rutas).
2. Inventario mecánico de las ~120 rutas reales del backend (`grep`/`perl` sobre los 22 `*.routes.ts`) para tener el mapa exacto endpoint→módulo antes de auditar.
3. Seis líneas de investigación paralelas, de solo lectura (Read/Grep/Bash sin escritura), cada una con instrucciones explícitas de citar `archivo:línea` y de declarar explícitamente cuando algo no podía confirmarse (volumen real de filas, telemetría de producción):
   - **B1** — backend `time-entries/`, `shifts/`, `workforce-management/`, `dashboard/`, `pending/` (fichador, turnos, alertas, dashboard, notificaciones, bandeja).
   - **B2** — backend `employees/`, `org-structure/`, `positions/`, `work-regimes/`, `users/`, `audit/`, `audit-parameters/`, `salary-categories/`.
   - **B3** — backend `documents/`, `document-categories/`, `novelties/`, `novelty-types/`, `hour-concepts/`, `finnegans-export/`, `auth/`.
   - **F1** — frontend Dashboard, HoursPage, AttendancePage, ShiftAlertsPage, NotificationsPage, TimeClockPage, MonthlyClosuresPage, ReportsPage, AppShell (campanita).
   - **F2** — frontend Legajos (listado/alta/detalle), Puestos, OrgStructure, Organigramas, Users, Settings, WorkRegimes + componentes compartidos (`AssociatedEmployeesPanel`, `EmployeeRemoteSelector`, `Pagination`).
   - **D1** — DB (lectura completa de `schema.prisma`, cruce contra `where:` reales) + cache (backend `shared/cache` + frontend `services/cache`) + frontend restante (Shifts, HourConcepts/Horas Especiales, Novelties, NoveltyTypes, Documents, DocumentCategories, HolidayWorkAssignments, FinnegansExport, Audit, AuditParameters).
4. Cada agente reportó con formato uniforme (hallazgo → evidencia `archivo:línea` → severidad Crítico/Alto/Medio/Bajo) para poder consolidar sin perder trazabilidad.
5. Síntesis y deduplicación manual de los 6 reportes (algunos hallazgos aparecieron confirmados de forma independiente por dos agentes distintos, p. ej. el índice de `SystemNotification` — se tomó como señal de fiabilidad cruzada).

**Limitación explícita, declarada por los 6 agentes de forma independiente**: no hubo acceso a la base de datos real, a un entorno corriendo, ni a telemetría de producción (el logger de requests está deshabilitado en producción, ver hallazgo #5 del resumen ejecutivo). Todo conteo de queries es **inferido leyendo el código** (forma de los `select`/`include`, presencia de loops, `Promise.all` vs `await` secuencial), no medido. Donde existe un conteo de volumen real citado (p. ej. `Employee=12`), proviene de auditorías previas documentadas (`PERFORMANCE_DATA_LOADING_AUDIT_9A.md`) y puede estar desactualizado — se marca explícitamente cada vez que se usa.

---

## 3. Módulos auditados

Los 22 módulos pedidos, mapeados contra el código real:

| # | Módulo (pedido) | Backend real | Frontend real |
|---|---|---|---|
| 1 | Dashboard/Inicio | `dashboard/` | `DashboardPage.tsx` |
| 2 | Legajos | `employees/` | `EmployeesPage.tsx`, `EmployeeCreatePage.tsx` |
| 3 | Detalle de legajo | `employees/` (overview/overview-details) | `EmployeeDetailPage.tsx` + paneles por pestaña |
| 4 | Puestos | `positions/` | `PuestosPage.tsx`, `PuestoDetailPage.tsx`, `PuestoCreatePage.tsx` |
| 5 | Gestión horaria / Carga de horas | `time-entries/` | `HoursPage.tsx` |
| 6 | Asistencia | `time-entries/` (attendance) | `AttendancePage.tsx` |
| 7 | Alertas de turnos | `shifts/` (alerts) | `ShiftAlertsPage.tsx` |
| 8 | Bandeja de revisión | `pending/` + `time-entries` (EN_REVISION) | dentro de `HoursPage.tsx` |
| 9 | Cierres mensuales | `workforce-management/` (closures, corrections) | `MonthlyClosuresPage.tsx` |
| 10 | Novedades | `novelties/` | `NoveltiesPage.tsx` |
| 11 | Notificaciones | `workforce-management/` (notifications) | `NotificationsPage.tsx` + `AppShell.tsx` |
| 12 | Fichador | `time-entries/` (clock/*) | `TimeClockPage.tsx` |
| 13 | Exportación | `finnegans-export/` | `FinnegansExportPage.tsx` |
| 14 | Gestión documental | `documents/`, `document-categories/` | `DocumentsPage.tsx`, `DocumentCategoriesPage.tsx` |
| 15 | Organigramas | `employees/` (org-chart) | `OrganigramasPage.tsx`, `OrgStructurePage.tsx` |
| 16 | Usuarios y roles | `users/` | `UsersPage.tsx` |
| 17 | Configuración | (agrupador de navegación) | `SettingsPage.tsx` |
| 18 | Regímenes laborales | `work-regimes/` | `WorkRegimesPage.tsx` |
| 19 | Turnos | `shifts/` (templates vía workforce-management, assignments) | `ShiftsPage.tsx`, `ShiftCreatePage.tsx`, `ShiftDetailPage.tsx` |
| 20 | Horas Especiales | `workforce-management/` (double-hour-rules) | dentro de `WorkScheduleSettingsPage.tsx` + `SpecialHourRulesCalendarMonth.tsx` |
| 21 | Conceptos Horarios | `hour-concepts/` | `HourConceptsPage.tsx` |
| 22 | Asignaciones de feriados | `shifts/` (holiday-work) | `HolidayWorkAssignmentsPage.tsx` |

### Tabla resumen por módulo

Convenciones: ✅ = correcto/cumple el estándar del proyecto; ⚠️ = hallazgo Medio; 🔴 = hallazgo Alto/Crítico; — = no aplica.

| Módulo | Paginación real | Filtros server-side | Cache | Invalidación | Refetch tras guardar | Loading sin blanquear | Puntos lentos detectados |
|---|---|---|---|---|---|---|---|
| Dashboard | — (1 endpoint agregado) | — | ✅ 30s back+front | ✅ | — | ⚠️ blanquea (aceptable, sin polling) | Ninguno (bien resuelto) |
| Legajos (listado) | ✅ | ✅ | ✅ 20-30s | ✅ | Local, correcto | ✅ | Ninguno |
| Detalle de legajo | — | — | ✅ 30s, pero 2 endpoints la bypasean | ✅ | Local (update no refetchea) | — | `employeeDetailSelect` ~24 relaciones; `position-validation` sin cache; existence-checks pagan el fetch completo |
| Puestos | ✅ (desde 9E) | ✅ (desde 9E) | ✅ 2min (doc dice 5min) | ✅ | Refetch dirigido | ✅ | `GET /:id/employees` sin paginar |
| Gestión horaria/Carga de horas | ✅ (period-employees) | ✅ | ✅ 20s | ✅ puntual | Refetch completo de la vista visible | ✅ (guard por efecto) | Banner de error suelto; bandeja sin ErrorState propio |
| Asistencia | — (vista de un día) | ✅ | ✅ 10s resumen | — | Refetch completo | 🔴 tabla de observaciones sin guard | Blanqueo en cada filtro/resolución |
| Alertas de turnos | Cursor (`before`/`take`) | ✅ | Sin cache (correcto p/dato operativo) | — | Refetch completo | 🔴 sin guard | Blanqueo en cada filtro/resolución; sin índice de soporte para vista default |
| Bandeja de revisión | ⚠️ sólo `take` por fuente | ✅ | — | — | Local en `pending`, refetch en `HoursPage` | ✅ | `summary` puede subcontar bajo volumen |
| Cierres mensuales | ⚠️ cierres sí, correcciones no | ⚠️ parcial | — | — | Refetch completo (con guard) | ✅ | 🔴 `corrections()` fetch-all(500) sin período, filtrado client-side |
| Novedades | ✅ | ✅ + debounce | ✅ 15s back / no front | ✅ | Local/optimista | ✅ | `bulk-approve` 🔴 N+1 secuencial |
| Notificaciones | ✅ (feed "cargar más") | ✅ | Sin cache (deliberado) | — | Local puntual | ✅ | Ninguno (pantalla de referencia) |
| Fichador | — (no aplica) | — | Sin cache (correcto, categoría D) | — | — | — | `evaluateShiftExit` cadena secuencial; storage de foto ~3s (ya diagnosticado, fuera de alcance) |
| Exportación | — (vista previa acotada por período) | ✅ | — | — | — | ✅ | `take:10000` sin comentario de justificación; auditoría en cada preview |
| Gestión documental | ✅ | ✅ + debounce | ✅ 10min (catálogo) / 20s (docs) | ✅ | Local/optimista | ✅ (Documents) / 🔴 (DocumentCategories) | Alta de documento duplica fetch pesado de legajo x2 |
| Organigramas | — (tope 1000, con aviso) | — | — | — | — | ✅ | Fallback a 200 sin aviso de límite |
| Usuarios y roles | ⚠️ backend soporta, frontend no lo usa | — | Sin cache | — | Refetch completo | ✅ | Sin paginación visible, depende de default no documentado |
| Configuración | — (navegación pura) | — | — | — | — | — | Ninguno |
| Regímenes laborales | ⚠️ listado no, modal sí | ✅ (modal) | ✅ 10min (listado) | ✅ | Local (modal) | ✅ | Listado principal fetch-all(200) sin justificación de volumen |
| Turnos | — (catálogo chico) | Client-side | Sólo backend (30s) | ✅ | Refetch (con guard) | ✅ | `ShiftDetailPage` trae lista completa para 1 registro |
| Horas Especiales | — (calendario por mes) | ✅ | Sólo backend (30s) | ✅ | Refetch completo tras mutar | ✅ | Ninguno crítico (patrón de calendario de referencia intacto) |
| Conceptos Horarios | — (catálogo, ~5 filas) | — | ✅ 10min | ✅ | Refetch completo | 🔴 sin guard | Blanqueo en cada guardado/activación |
| Asignaciones de feriados | ✅ candidatos | ✅ + debounce | — | — | Refetch dirigido | ✅ | `save()` masivo 🔴 N+1 hasta 500 elementos |

---

## 4. Hallazgos backend

### 4.1 `time-entries/` (fichador, carga horaria, asistencia)

- `closeOpenWorkShift` (salida del fichador): **confirmado optimizado y vigente** — Etapa 13F sin drift. 3 lecturas de configuración fuera de la transacción, `findMany` agrupado en vez de `findFirst` por segmento, `createMany` en batch, timeout explícito 10s. `backend/src/modules/time-entries/timeEntries.repository.ts:1885-2089`.
- **`createFromWorkShift` (alta manual de jornada completa, RRHH) — mismo patrón que causó el 503 real de 13F, sin el fix**: 3 lecturas de configuración dentro de la transacción (`:1741-1757`), `findFirst` por segmento (`:1794`), `create` por regla por segmento (`:1782-1792`). Mitigado parcialmente con timeout más alto (20s) pero la causa raíz sigue presente. Severidad **Crítico** (condicional al volumen de segmentos/reglas de un alta puntual).
- Endpoints de listado (`GET /time-entries`, `/summary`, `/period-employees`, `/export`, `/attendance`, `/attendance/observations`) — **todos con paginación real, filtros server-side, `Promise.all`/`$transaction` correctos, sin N+1**. Confirmado línea por línea.
- **`evaluateShiftEntry`/`evaluateShiftExit` — cadena de hasta ~21 queries mayormente secuenciales en cada fichada de salida** (`backend/src/modules/shifts/workShiftEvaluationRunner.ts:487-561`). Es best-effort (no compromete la corrección del dato), pero es latencia real percibida por el empleado antes de la confirmación en pantalla. 4 de esas llamadas (líneas 543-561) son mutuamente independientes y podrían ir en `Promise.all`.
- Búsqueda de empleados (`contains`+insensitive) sin índice trigram en 4 endpoints — irrelevante hoy (`Employee≈12`), a vigilar si el headcount crece.
- `attendanceInactivity.service.ts:126-151` — una transacción completa por incidente de inasistencia detectado, secuencial, 1 vez/día. Batcheable.
- `AttendanceInactivityIncident` sin índice para `operationalDate` sola y sin política de retención — crece indefinidamente.

### 4.2 `shifts/`

- **`checkMissingOutRisk` (cron cada 60s) — N+1 sin límite de volumen, el hallazgo más severo de todo el backend**: `findMany` sin `take` sobre *todas* las jornadas `ABIERTO` del sistema (`backend/src/modules/shifts/openShiftMonitor.service.ts:31-34`), seguido de `Promise.all` de resolución de régimen (línea 40, no batcheado) y un `for` que hace `prisma.shiftAlert.findUnique` **secuencial dentro del loop** (línea 48) más `createShiftAlert` (hasta 4 queries) por fila en riesgo (línea 53). Escala linealmente con headcount fichado simultáneo, cada 60s, para siempre. Severidad **Crítico**.
- **`shiftAssignmentService.assign` / `holidayWorkAssignmentService.save` — hasta ~1500 round-trips secuenciales en un único request**: loop de `findExisting`+`create`/`update`+`auditService.register` por elemento (hasta 500 empleados por el límite de schema), sin batching. `backend/src/modules/shifts/shiftAssignment.service.ts:61-112`, `holidayWorkAssignment.service.ts:76-111`. Severidad **Crítico**.
- `workShiftEvaluationRunner.ts` no usa el cache de `ShiftTemplate` ya existente (`workforce.cache.ts`) — consulta Prisma directo en cada fichada. Severidad Medio.
- `GET /shifts/alerts` (vista por defecto, `status="PENDIENTE"` sin `employeeId`) sin índice de soporte — ver Parte 12. Severidad Medio→Alto (ligado al índice faltante).
- `GET /shifts/assignments` sin paginación real. Severidad Medio.

### 4.3 `workforce-management/`

- Sin capa de repository (llama Prisma directo desde el service) — deuda arquitectónica ya documentada en `docs/ARCHITECTURE_STANDARDS.md`, sin impacto de tiempo de ejecución.
- **`GET /workforce/notifications-unread-count` — investigación dedicada, ver §0 del reporte técnico y resumen ejecutivo #4**: query e índice correctos y confirmados; causa más probable es latencia de red/infraestructura, no código.
- **`corrections()` — antipatrón pre-9I no migrado**: `take:500` fijo, sin período, sin `page`, sin `count()` real (`workforce.service.ts:136`) — es exactamente el patrón que `notifications()` tenía antes de la Etapa 9I y que sí se corrigió ahí, pero nunca se extendió a `corrections()`. Alimenta directamente el hallazgo frontend de `MonthlyClosuresPage` (§5.1). Severidad Alto (por el efecto combinado con el frontend).
- `closures()`/`doubleRules()` — fetch-all deliberado y ya documentado, dentro de límites razonables.
- `calendarPreview` — sin N+1, sólo una ineficiencia menor de cómputo duplicado en memoria.

### 4.4 `dashboard/`

Confirmado vigente sin drift: 1 endpoint agregado, 15 queries en un único `Promise.all`, cache 30s backend+frontend, sin N+1. El único hueco es el ya documentado y aceptado (clock-in/out sin auditoría no invalida el cache — acotado a 30s, deuda intencional del fichador).

### 4.5 `pending/`

Un solo endpoint, 3 queries en paralelo, sin N+1. **Hallazgo real**: sin paginación por conteo real — el `summary` se calcula sobre el array ya capado por `take` de cada fuente, así que puede subcontar bajo volumen alto sin ningún indicio visual. Severidad Medio.

### 4.6 `employees/`

- Listado, options, summary, org-chart: bien resueltos, paginados, cacheados. Única discrepancia: TTLs reales (20-30s) son más cortos que lo documentado en `docs/CACHING_STRATEGY.md` (60s) — el código es más conservador, no un bug.
- **`employeeDetailSelect` — ~24 rutas de relación anidadas para un solo legajo**, incluyendo la cadena `sector→area→establishment→businessUnit` **duplicada** (una vez colgando de `employee.sector`, otra de `employee.position.sector`). Mitigado por cache de 30s en el controller, pero el costo pleno se paga en cada cache-miss y se reutiliza tal cual en 4 endpoints de escritura sólo para dar forma a la respuesta. Severidad **Alto**.
- **`GET /employees/:id/position-validation` bypassea el cache** — dispara el fetch completo sin pasar por `employeeDetailCache`, a diferencia de su endpoint hermano (`employees.controller.ts:157-160`). Severidad Alto si se llama en cada carga de formulario.
- **`listFieldHistory`/`listBlockHistory` pagan el detalle completo como mero existence-check** (`employees.service.ts:836-838,855-858`) — un `findFirst({select:{id:true}})` bastaría. Severidad Medio.
- **`createDocument` paga el `employeeDetailSelect` completo dos veces** (antes y después de la escritura) por cada documento subido, además de la llamada de red al proveedor de storage — ~20-25 queries + 1 llamada externa por subida. Severidad Medio.
- **`POST /employees/sync-labor-statuses` — N updates seriales en loop** en vez de `updateMany` agrupado (`employees.repository.ts:1098-1124`). Severidad Medio.
- **Índice faltante: `Employee.positionId`** — ver Parte 12. Severidad Alto.

### 4.7 `positions/`

- Listado ya corregido en 9E (paginación real, filtros server-side, incluida la corrección histórica de los 3 filtros de jerarquía que antes se aceptaban sin traducirse a `where`).
- **`GET /positions/:id/employees` sin paginación alguna** — ni `page`/`take` en el schema ni `meta.total` en la respuesta, `take:500` fijo, inconsistente con el endpoint estructuralmente idéntico de `work-regimes` que sí pagina. Severidad Medio-Alto.
- Re-fetch pesado post-escritura tras crear/editar/eliminar puesto — bajo impacto por el volumen chico del catálogo.

### 4.8 `org-structure/`, `salary-categories/`, `users/`, `audit-parameters/`

- `org-structure`: 6 queries en paralelo, cache 60s (no 10min como dice `CACHING_STRATEGY.md`), invalidación explícita en los 10 métodos de escritura. `take:500` por colección sin confirmación de volumen — riesgo de truncamiento silencioso si alguna colección superara 500 filas, no confirmado hoy.
- `salary-categories`: mismo patrón fetch-all(500)+cache(2min, no 5min como dice el doc) — catálogo probablemente chico (~26 categorías fijas) pero sin comentario de volumen confirmado en código.
- `users`: CRUD limpio, sin hallazgos de queries. Frontend sin paginación visible (ver §5.2).
- `audit-parameters`: catálogo de configuración chico, sin hallazgos.

### 4.9 `audit/`

- Índices correctos para `entity`/`entityId`/`userId`/`action`. **Sin filtro de rango de fecha en la API** — sólo `entity/entityId/userId/action/page/take`. Sobre una tabla que crece con casi cualquier mutación del sistema, sin filtro de fecha ni política de retención visible, la paginación por `skip`/`take` clásico degrada al navegar históricos profundos (limitación conocida de `OFFSET` en Postgres, no falta de índice). Severidad Medio.

### 4.10 `novelties/`

- `GET /novelties`: paginación real, cache 15s, índices completos, sin N+1.
- **`POST /novelties` (creación en lote) — riesgo de timeout de transacción**: cuando el tipo de novedad `setsWorkedHoursToZero`, `syncZeroTimeEntries` hace un doble loop `empleados × días del rango` sin límite de rango de fechas en el schema, dentro de una transacción **sin override de `timeout`** (default de Prisma = 5000ms). Un caso realista (50 empleados × 10 días) puede superar cómodamente ese presupuesto. Severidad **Crítico (condicional al volumen real de uso, no confirmado)**.
- **`POST /novelties/bulk-approve` — el hallazgo más severo de este módulo**: hasta 250 ids procesados secuencialmente, uno por uno, sin transacción ni batch — cada aprobación individual hace ~5-7 round-trips, para un total estimado de **~1250-1750 queries secuenciales en un único request** en el caso máximo (100-350 con lotes normales de 20-50). Severidad **Crítico/Alto**.

### 4.11 `document-categories/`, `novelty-types/`, `hour-concepts/`, `salary-categories/`

- Los 4 comparten el mismo patrón: cache doble (repository 120s + controller 60s), ambas invalidadas correctamente. Es la deuda de "4 patrones de cache backend distintos conviviendo" ya reconocida en `PERFORMANCE_STANDARDS.md §15`, confirmada exacta.
- El comentario con volumen real confirmado que `PERFORMANCE_STANDARDS.md §6` afirma que existe en el código **no se encontró** (grep sin resultados en los 4 repositorios) — la justificación de fetch-all vive sólo en la documentación de decisiones, no en el código como se afirma. Discrepancia a corregir en la documentación, no un bug de performance.
- `hourConceptRules/` (submódulo separado): paginación real siempre, sin el patrón fetch-all — correcto.
- `HourConceptBreakdown`/`SpecialHourRuleApplication` no viven en `hour-concepts/` — su lógica real está en `employees/`, `time-entries/`, `pending/`, `workforce-management/`, `shifts/`, `dashboard/`.

### 4.12 `documents/`

- `GET /documents`: paginación real, cache 20s, include de 3 niveles justificado, sin N+1.
- Ver hallazgo de `createDocument` en §4.6 (vive en `employees/`, no en `documents/`).

### 4.13 `finnegans-export/`

- Vista previa acotada por período/empleado/estado, exportación 100% client-side (XLSX generado en el navegador desde filas ya traídas) — cumple la regla "exportación bajo acción del usuario".
- `take:10000` sin comentario de justificación (a diferencia del `take:5000` de `time-entries.repository.ts`, que sí cita la Etapa 8F). Condición `toDate: null` nunca expira por antigüedad — riesgo de truncamiento silencioso a futuro, no un problema actual.
- **Auditoría en cada carga de la vista previa** (no sólo en la exportación real), lo que además invalida el cache de dashboard más seguido de lo necesario. Severidad Bajo.
- `GET /finnegans-export/novelties.csv` sin llamador conocido en el frontend — posible endpoint muerto.

### 4.14 `auth/`

Sin hallazgos — `getCurrentUser` (invocado en cada request autenticado vía `requireAuth`) ya está cacheado 5s en memoria, justificado por su altísima frecuencia de invocación.

---

## 5. Hallazgos frontend

### 5.1 Pantallas que blanquean su tabla en cada guardado/filtro (patrón repetido, la Etapa 9B ya lo corrigió en otras 6 pantallas)

El guard correcto (`if (!items.length) setLoading(true)`) ya existe y funciona en `EmployeesPage`, `PuestosPage`, `NoveltiesPage`, `DocumentsPage`, `AuditPage`, `ShiftsPage`, `WorkScheduleSettingsPage`, `NotificationsPage`, `MonthlyClosuresPage` — pero **nunca se aplicó** en:

- `ShiftAlertsPage.tsx:183` (efecto con deps `[...filtros, refresh]`, línea 198; `refresh` se incrementa al resolver una alerta, línea 229) — la única bandeja de esta pantalla parpadea a skeleton completo en cada filtro y en cada "Resolver".
- `AttendancePage.tsx:352` (asimetría real: el efecto hermano del resumen, 20 líneas antes, sí tiene el guard en línea 328) — la tabla "Problemas de fichada" parpadea en cada filtro y en cada resolución.
- `HourConceptsPage.tsx:88` (efecto `[refresh]`, línea 104; incrementado en guardar/activar/eliminar, líneas 135/159/182/203).
- `NoveltyTypesPage.tsx:52` (efecto `[refresh]`, línea 68; incrementado en `toggle()`, línea 81).
- `DocumentCategoriesPage.tsx:88` (efecto `[refresh]`, línea 102; incrementado en guardar, línea 115).
- `AuditParametersPage.tsx:76` (efecto `[refresh]`, línea 93; incrementado en guardar, línea 120).
- `AssociatedEmployeesPanel.tsx:193` (componente compartido, reusado por `HourConceptsPage` y `WorkRegimesPage` entre otros) — sin guard al cambiar página/filtro dentro del modal.

Severidad **Alto** (es el mismo fix mecánico ya validado 9 veces en el proyecto, aplicado de forma inconsistente).

### 5.2 `MonthlyClosuresPage.tsx` — paginación falsa sobre correcciones post-cierre

`workforceApiService.corrections()` no acepta ni envía parámetro de período; el backend tampoco lo aplica (`take:500` fijo, sin `where` de fecha — ver §4.3). El frontend filtra client-side por período sobre el array completo (`MonthlyClosuresPage.tsx:77`). Es el antipatrón exacto de "recortar en el frontend un array ya fetcheado completo" que `PERFORMANCE_STANDARDS.md §6` prohíbe explícitamente. Hoy funciona porque el volumen histórico probablemente esté bajo 500; en cuanto lo supere, empezarán a desaparecer silenciosamente correcciones de meses anteriores. Severidad **Alto**.

### 5.3 Refetch completo tras acciones puntuales de bandeja

`HoursPage.tsx` (aprobar/rechazar/devolver, líneas 482-567), `AttendancePage.tsx` (resolver observación, líneas 394-395) y `ShiftAlertsPage.tsx` (resolver alerta, línea 229) incrementan un contador `refresh` que dispara un refetch completo de la lista visible en vez de actualizar el ítem localmente. No rompe nada (donde hay guard, no blanquea), pero es tráfico de red evitable en bandejas donde se procesan varios ítems seguidos. Severidad Medio.

### 5.4 `ShiftDetailPage.tsx` — trae la lista completa de turnos para mostrar uno

No existe `GET /workforce/shift-templates/:id`; la pantalla trae todos los templates y filtra por id en cliente (`ShiftDetailPage.tsx:39-43`). Hallazgo ya documentado en la Etapa 9A (§4.11), confirmado sin corregir. Severidad Medio.

### 5.5 Invalidación de cache de empleado excesivamente amplia

`invalidateEmployeeDependentCaches()` (`employeeApiService.ts:570-577`) invalida las familias `employees`+`dashboard`+`positions` en los 8 mutadores del servicio, incluidos `updateTransport`/`updateAddress`/`replaceAssignments`, que no tocan puesto ni dashboard. Contradice el principio de "invalidar sólo lo relacionado" — impacto acotado por TTLs cortos (30s-5min), no es un dato incorrecto. Severidad Medio.

### 5.6 `WorkRegimesPage.tsx` y `UsersPage.tsx` — listados principales sin paginación real ni volumen documentado

- `WorkRegimesPage`: `getAll()` sin filtros, `take` default 200, filtrado 100% client-side, sin `<Pagination>`. Sin el comentario de volumen confirmado que sí tienen HourConcepts/NoveltyTypes/DocumentCategories.
- `UsersPage`: `getAll()` sin `page`/`take`, sin cache de cliente, dependiendo del default del backend (100) sin que el frontend lea `meta`.

Severidad Medio en ambos casos — bajo impacto hoy por ser catálogos/tablas administrativas de bajo volumen, pero silenciosos si algún día se supera el límite.

### 5.7 Confirmado correcto (sin hallazgos de severidad relevante)

`DashboardPage`, `ReportsPage`, `NotificationsPage` (pantalla de referencia — feed paginado, filtro server-side, mark-as-read local puntual, sin cache deliberado), `TimeClockPage` (sin cache, sin optimistic update, polling de verificación sólo ante fallo de red — cumple al 100% las reglas de categoría D), `EmployeesPage`, `PuestosPage`/`PuestoDetailPage`, `EmployeeCreatePage`, `EmployeeDetailPage` (fan-out del mount acotado, paneles 100% lazy por pestaña), `OrgStructurePage`, `SettingsPage`, `NoveltiesPage`, `DocumentsPage`, `HolidayWorkAssignmentsPage`, `FinnegansExportPage`, `AuditPage`, `SpecialHourRulesCalendarMonth` (patrón de calendario de referencia intacto), `ShiftsPage`, `ShiftCreatePage`, `NoveltyTypeDetailPage`, flujo "Empleados con régimen" de `WorkRegimesPage` (vigencia default, paginación, catálogos diferidos hasta abrir el modal).

### 5.8 `OrganigramasPage.tsx` — fallback sin aviso de límite

Si `getOrgChart()` falla, cae a `getAll()` (tope 200) y fija `reachedEmployeeLimit=false` incondicionalmente, aunque ese fallback trae menos que el límite normal (1000) — sólo visible en doble falla, frecuencia esperada muy baja. Severidad Bajo.

---

## 6. Guardados lentos

| Guardado | Endpoint | Queries aprox. | Transacción | Dentro de la tx | Refetch frontend | Invalidación | ¿Responder antes + postprocesar? | ¿Update local posible? |
|---|---|---|---|---|---|---|---|---|
| Crear legajo | `POST /employees` | ~24 (usa `employeeDetailSelect` para la respuesta, mayormente vacío en alta) | No | — | Navega a detalle (fetch nuevo justificado) | `employees`+`dashboard`+`positions` | Sí — la respuesta podría usar un select liviano | N/A (alta) |
| Editar legajo | `PATCH /employees/:id` | ~4 (ya optimizado, Etapa 6Q) | No | — | **No** — update local | Puntual | Ya optimizado | ✅ ya implementado |
| Asignar régimen laboral | `POST /employees/:id/work-regimes` | ~5 | **No** (check-then-write sin aislamiento) | — | Local (sólo el panel) | Puntual | — | ✅ ya implementado |
| Finalizar régimen laboral | `PATCH .../close` | 3 | No | — | Local | Puntual | — | ✅ ya implementado |
| Crear/editar turno (plantilla) | `POST/PATCH /workforce/shift-templates` | No detallado por queries (catálogo chico) | No | — | Refetch completo (con guard) | ✅ backend 30s | — | Podría ser local |
| **Asignar turno (masivo)** | `POST /shifts/assignments` | **hasta ~1500** (N×2-3 secuencial) | No | — | Refetch | Puntual | **Sí — es el hallazgo crítico #2** | — |
| Crear/editar Horas Especiales | `POST/PATCH /workforce/double-hour-rules` | Pocas, cacheado | No | — | Refetch completo (`load()`) | ✅ backend 30s | — | Podría ser local |
| Crear/editar concepto horario | `POST/PATCH /hour-concepts` | Pocas | No | — | Refetch completo (sin guard, blanquea) | ✅ doble capa | — | Sí — es hallazgo §5.1 |
| Cargar horas (manual) | `POST /time-entries` | Acotado (1-3 segmentos) | Parcial | Chequeos de bloqueo | Refetch de grilla/página visible | Puntual | — | Podría ser local por fila |
| **Aprobar/rechazar en bandeja (novedades, lote)** | `POST /novelties/bulk-approve` | **~1250-1750 en el peor caso** | **No** | — | Local/optimista (frontend ya correcto) | Puntual | **Sí — es el hallazgo crítico #1** | — |
| Aprobar/rechazar (horas, individual) | `POST /time-entries/:id/approve\|reject` | Pocas | No | — | Refetch completo de la vista | Puntual | — | Sí — hallazgo §5.3 |
| Registrar fichada (con foto) | `POST /time-entries/clock/photo-punch` | ~9 dentro de tx (post-13F) + ~21 post-tx (best-effort) | ✅ 10s timeout | Sólo lo indispensable (13F) | — (fichador, sin refetch) | N/A (sin cache) | Ya optimizado (13F); cadena post-tx es candidata a `Promise.all` | N/A (categoría D) |
| Crear novedad (lote) | `POST /novelties` | Variable, **riesgo de exceder 5s** si `setsWorkedHoursToZero` | ✅ pero sin override de timeout | Doble loop empleados×días | Local/optimista | Puntual | **Sí — es el hallazgo crítico #3** | — |
| Guardar documento | `POST /employees/:id/documents` | ~20-25 + 1 llamada externa | No (fuera de tx por diseño, Etapa 6Q/7A) | — | Local (prepend si aplica) | Puntual | Sí — evitar el doble `employeeDetailSelect` | — |
| Crear usuario/rol | `POST /users` | ~3 | No | — | Refetch completo (bajo volumen) | — | — | Bajo impacto |
| Acciones de cierre mensual | `POST /workforce/closures/*`, `corrections/:id/approve\|reject` | Pocas por acción | No | — | Refetch completo (con guard) | Puntual | — | La lentitud real está en la **lista** de correcciones (§5.2), no en la acción |

---

## 7. Queries lentas (por diseño de código, no medidas)

- `checkMissingOutRisk`: `findMany` sin `take` + `findUnique` secuencial por fila — crece con headcount fichado simultáneo.
- `bulk-approve` de novedades: ~5-7 round-trips × hasta 250 ids.
- `shiftAssignment.assign`/`holidayWorkAssignment.save`: 2-3 round-trips × hasta 500 elementos.
- `createFromWorkShift`: hasta ~14 queries secuenciales dentro de una tx (mismo conteo que `closeOpenWorkShift` tenía antes de 13F).
- `GET /employees/:id` (cache-miss): ~24 rutas de relación anidadas en un solo `select`.
- `createDocument`: ~20-25 queries (doble `employeeDetailSelect`).

## 8. N+1 detectados

1. `checkMissingOutRisk` — `shiftAlert.findUnique` dentro de un `for` sobre jornadas abiertas (`openShiftMonitor.service.ts:48`). **Crítico**.
2. `novelties.bulk-approve` — `approve()` completo dentro de un `for` (`novelties.service.ts:163-169`). **Crítico**.
3. `syncZeroTimeEntries` — `findFirst`+`update`/`create` dentro de un doble loop empleados×días (`novelties.repository.ts:106-160`). **Crítico (condicional)**.
4. `shiftAssignmentService.assign` / `holidayWorkAssignmentService.save` — `findExisting`+escritura dentro de un loop por empleado. **Crítico**.
5. `createFromWorkShift` — `findFirst`+`create` dentro de un loop de segmentos/reglas. **Alto** (mismo patrón que 3F corrigió en su hermano).
6. `employees.repository.ts:1114-1119` (`sync-labor-statuses`) — `update` secuencial dentro de un `for`. **Medio**.
7. `attendanceInactivity.service.ts:126-151` — una transacción por incidente, dentro de un `for`. **Medio**.
8. `clockPunchMaintenance.ts:24-34` — `notifyMissingExit` secuencial por jornada auto-cerrada (acotado a ≤100/tick). **Bajo**.

## 9. Transacciones largas

- `closeOpenWorkShift` (`time-entries.repository.ts:1885-2089`) — **ya optimizada** (13F), timeout 10s, ~9 queries en el caso simple.
- `createFromWorkShift` (`time-entries.repository.ts:1682-1861`) — **no optimizada**, mismo patrón que causó el 503 real, timeout 20s como defensa pero sin resolver la causa.
- `novelties.createMany` + `syncZeroTimeEntries` (`novelties.repository.ts:193-232`) — sin override de timeout (default Prisma 5000ms), con un doble loop sin límite de rango de fechas dentro. Riesgo real de `P2028` (transaction timeout) no confirmado en producción pero estructuralmente posible.
- `assign()` de régimen laboral — **al revés del problema habitual**: el chequeo de solape y el insert **no están** envueltos en una transacción/aislamiento, a diferencia de un patrón equivalente (`saveManualHourConceptBreakdown`) que sí usa `Serializable`. Riesgo de concurrencia, no de latencia.

## 10. Paginación / filtros

Cobertura general **buena** — la gran mayoría de los listados operativos (time-entries, novelties, documents, positions, employees, audit, notifications, shift-alerts) ya tiene paginación real server-side con `meta` consistente y filtros resueltos en el `where`, no en memoria. Excepciones reales:
- `GET /positions/:id/employees` — sin paginar.
- `GET /shifts/assignments` — sin paginar.
- `corrections()` (workforce-management) — sin paginar ni filtrar por período.
- `WorkRegimesPage`/`UsersPage` (frontend) — el backend soporta o podría soportar paginación, el frontend no la usa.
- Catálogos fetch-all(500) sin comentario de volumen confirmado: `positions`, `org-structure` (6 colecciones), `salary-categories`, `work-regimes` (listado principal).

## 11. Cache e invalidaciones

### Backend (`backend/src/shared/cache/ttlCache.ts` + 3 patrones adicionales)

18 caches TTL confirmadas (dashboard 30s, time-entries 10-20s, employees 20-30s, hour-concepts/novelty-types/document-categories/salary-categories 60s+120s doble capa, audit/novelties/documents 15-20s, workforce shiftTemplates/doubleRules 30s). Todas con invalidación explícita verificada **excepto una**:

- **`timeGridCatalogCache` (`employees/employees.repository.ts:469-494`) — el único cache backend del proyecto sin ninguna función de invalidación.** Cachea NoveltyType(ACTIVO)+HourConcept(ACTIVO) por 120s; ni `noveltyTypesService.create/update` ni `hourConceptsService.create/update/remove` lo invalidan. Acotado por su propio TTL (nunca queda stale más de 120s), pero rompe el patrón "enumerar mutadores + invalidar" que el resto del proyecto sigue de forma consistente. Severidad **Alto** (por ser la única excepción, no por el impacto de negocio).

### Frontend (`frontend/src/services/cache/`)

16 familias de cache confirmadas con TTL real (catálogos 5-10min con IndexedDB, operativos 30-60s en memoria). Hallazgos:
- La familia `"novelties"` está declarada y se invalida desde `noveltyApiService`, pero **ningún** `cachePolicies.*` la usa nunca — no-op inofensivo, código muerto.
- `apiClient.ts` tiene un flag `apiCache`/`cacheTtlMs` marcado `@deprecated` sin efecto real, seguido pasando en decenas de llamadas — ruido de código, no un bug funcional.
- Sin cache de cliente para `shiftTemplates()`/`doubleHourRules()` (`workforceApiService`) — cada apertura de las 4 pantallas que los usan dispara un round-trip HTTP nuevo (absorbido por el TTL de 30s del backend, pero tráfico evitable).

### Candidato real a agregar cache

- **`HourConceptRule`** — sin cache en ningún lado, pese a que `findActiveRules()` se ejecuta **en cada clock-out de cada empleado** (`timeEntries.service.ts:245`, dentro de `classifySegmentsForEmployee`). Mismo criterio ya aplicado en la Etapa 9C a `shiftTemplatesCache`/`doubleRulesCache` (config de escritura cerrada y poco frecuente). No es dato crítico del fichador (es config, no el instante de la fichada), así que §10 de `PERFORMANCE_STANDARDS.md` no lo bloquea. Severidad **Medio**, buen quick-win.

### Asimetrías menores

`WorkRegime` y `AuditParameter` cacheados sólo en frontend (10min), sin cache backend — inconsistente con sus catálogos hermanos, que tienen ambas capas. Severidad Bajo.

### Deuda ya aceptada, reconfirmada sin cambios

`clockInResolved`/`clockOutResolved`/`expireOpenWorkShifts` no invalidan `dashboardMetricsCache` por no pasar por `auditService.register()` — documentado como deuda intencional en `PERFORMANCE_STANDARDS.md §10/§15`, acotado a 30s, **no tocar fuera de una etapa dedicada al fichador**.

### Discrepancias de TTL entre `docs/CACHING_STRATEGY.md` y el código real

El código es, en los 4 casos encontrados, **más conservador** (TTL más corto) que lo documentado — no es un riesgo, es un doc desactualizado: org-structure (doc 10min / real 60s), positions (doc 5min / real 2min), salary-categories (doc 5min / real 2min), employees options/summary/org-chart (doc 60s / real 20-30s).

---

## 12. Posibles índices

No se creó ninguna migración — sólo se documentan las propuestas.

| # | Tabla | Columnas propuestas | Endpoint afectado | Razón | Riesgo | Prioridad |
|---|---|---|---|---|---|---|
| 1 | `Employee` | `positionId` | `GET /positions/:id/employees`, `GET /employees/org-chart` (filtro opcional) | Único filtro de igualdad frecuente de `Employee` sin índice propio — sus pares (`sectorId`, `costCenterId`, `status`) ya lo tienen | Bajo (tabla de escritura poco frecuente) | **Alto** |
| 2 | `ShiftAlert` | `[status, createdAt]` | `GET /shifts/alerts` (vista por defecto, sin `employeeId`) | Los índices existentes (`[employeeId,status,createdAt]`, `[severity,status]`) no cubren la vista global por estado+fecha, que es la más usada | Bajo (`ShiftAlert` se escribe por evaluación de turnos, no por request) | **Alto** |
| 3 | `ClockPunchAttempt` | `[status, completedAt]` | Job de limpieza `deleteClockPunchAttempts` (cron cada 60s, `clockPunchMaintenance.ts:98-99`) | El `where` de poda (`status IN (...) AND completedAt < X`) no tiene índice de soporte; corre para siempre en producción | Medio (tabla de escritura alta — una fila por intento de fichada) | **Alto** |
| — | `EmployeeWorkRegime` | `[workRegimeId, effectiveFrom]` | `GET /work-regimes/:id/employees` | **Ya existe** (`schema.prisma:1267`, migración `20260819173317`) — sólo falta corregir el comentario obsoleto en `workRegimes.repository.ts:154-158` que todavía dice que falta | — | Bajo (housekeeping) |
| — | `EmployeeDocument` | `[status, expiresAt]` | — | Índice existente sin consumidor confirmado (ninguna query filtra por `expiresAt`) — no se propone eliminar sin confirmar antes | — | Bajo (a confirmar) |
| — | `StorageFile` | `attendancePunchId` | — | Índice existente, posible vestigio (sólo se escribe, no se filtra por él en el código revisado) — a confirmar antes de tocar | — | Bajo (a confirmar) |

**Nota sobre `AuditLog`**: el problema real no es de índice (`[createdAt]`, `[entity,entityId]`, `[userId]`, `[action,createdAt]` ya cubren bien los filtros existentes) — es la ausencia de un filtro de rango de fecha en la API combinada con paginación `OFFSET` clásica sobre una tabla que crece con cualquier mutación del sistema. Es un cambio de API (agregar `fromDate`/`toDate` a `listAuditQuerySchema`), no una migración.

---

## 13. Ranking de problemas

### Crítico

**1. `checkMissingOutRisk` — N+1 sin límite de volumen, corre cada 60s para siempre**
- Módulo/endpoint: `shifts` / cron interno (`clockPunchMaintenance.ts` → `openShiftMonitor.service.ts:checkMissingOutRisk`).
- Síntoma: consumo de conexiones/CPU creciente con headcount fichado simultáneo, sin cota.
- Causa probable: `findMany` sin `take` + `findUnique` secuencial dentro de un `for`.
- Evidencia: `backend/src/modules/shifts/openShiftMonitor.service.ts:31-34,40,43-61`.
- Impacto usuario: indirecto (degradación general del backend en horario pico), impacto técnico directo (presión sobre el pool de conexiones cada minuto).
- Propuesta de solución (no implementada): batchear el `findUnique` en un único `findMany({ workShiftId: { in: [...] } })` antes del loop.
- Riesgo de tocar: bajo (lógica de lectura + creación de alerta, ya con test coverage existente del módulo).
- Etapa sugerida: 14B.

**2. `novelties/bulk-approve` — hasta ~1750 queries secuenciales en un request**
- Módulo/endpoint: `novelties` / `POST /novelties/bulk-approve`.
- Síntoma: operación usada activamente por RRHH para aprobar en lote, con latencia probablemente de varios segundos con lotes de 20-50 ids.
- Causa probable: loop secuencial `for (const id of uniqueIds) await this.approve(id, ...)`, sin transacción ni batch.
- Evidencia: `backend/src/modules/novelties/novelties.service.ts:163-169`.
- Impacto usuario: alto (acción frecuente, percibida como "se cuelga").
- Propuesta de solución: `updateMany` + una sola auditoría agregada (evaluar impacto en trazabilidad antes de implementar).
- Riesgo de tocar: medio (cambia semántica de auditoría por-item a agregada — requiere decisión de producto sobre qué debe quedar en `AuditLog`).
- Etapa sugerida: 14B.

**3. `shiftAssignment.assign` / `holidayWorkAssignment.save` — hasta ~1500 round-trips por request**
- Módulo/endpoint: `shifts` / `POST /shifts/assignments`, `PUT /shifts/holiday-work/assignments`.
- Síntoma: guardado masivo de asignaciones puede tardar varios segundos a minutos.
- Causa: loop secuencial de `findExisting`+escritura+auditoría por elemento, hasta 500 elementos.
- Evidencia: `backend/src/modules/shifts/shiftAssignment.service.ts:61-112`, `holidayWorkAssignment.service.ts:76-111`.
- Impacto usuario: alto si se usa con selecciones grandes (no confirmado el volumen típico real de uso).
- Propuesta: batchear con `createMany`/`updateMany` donde no haya validación por fila que lo impida.
- Riesgo de tocar: medio (hay lógica de reactivación/validación por fila que debe preservarse).
- Etapa sugerida: 14B.

**4. `createFromWorkShift` — mismo patrón que ya rompió producción una vez (13F), sin el fix**
- Módulo/endpoint: `time-entries` / `POST /time-entries/work-shifts`.
- Síntoma: riesgo de `503 Transaction already closed` bajo jornadas con varios segmentos/reglas.
- Causa: 3 lecturas de configuración + `findFirst`/`create` por segmento/regla dentro de la transacción.
- Evidencia: `backend/src/modules/time-entries/timeEntries.repository.ts:1741-1801`; riesgo ya documentado en `docs/decisions/CLOCK_PHOTO_PUNCH_EXIT_TRANSACTION_13F.md §12`.
- Impacto usuario: bajo en frecuencia (alta manual de RRHH, no el fichador diario), alto en severidad si ocurre.
- Propuesta: aplicar exactamente el mismo fix de 13F (hoisting de las 3 lecturas + `findMany` agrupado + `createMany`).
- Riesgo de tocar: bajo (patrón ya validado y testeado en su hermano).
- Etapa sugerida: 14B.

**5. `syncZeroTimeEntries` — riesgo de timeout de transacción en creación de novedades masivas**
- Módulo/endpoint: `novelties` / `POST /novelties` (tipos que ponen horas en cero).
- Síntoma: la creación de una novedad puede fallar completa (sin crearse) si el lote de empleados/rango de días es grande.
- Causa: doble loop `empleados × días` sin límite de rango, transacción sin override de timeout (default 5000ms).
- Evidencia: `backend/src/modules/novelties/novelties.repository.ts:106-232`; `backend/src/shared/prisma/client.ts` sin configuración global de timeout.
- Impacto usuario: alto si ocurre (la novedad "no se crea" sin explicación clara), no confirmado con qué frecuencia se dan lotes grandes en uso real.
- Propuesta: agrupar el `findFirst` por rango (como se hizo en 13F) y/o acotar el rango de fechas permitido en el schema.
- Riesgo de tocar: bajo-medio.
- Etapa sugerida: 14B.

### Alto

**6. `GET /workforce/notifications-unread-count` (~1s reportado) — infraestructura, no código**
- Síntoma: contador que debería ser instantáneo tarda hasta ~1s.
- Causa probable (no confirmable sin telemetría real): latencia de red hacia Neon (~300-450ms/round-trip ya medido en 13F) + hasta 2 round-trips secuenciales (auth cache-miss + count) + posible cold-start de compute serverless.
- Evidencia: query e índice correctos (`backend/src/modules/workforce-management/workforce.service.ts:196`, `schema.prisma:1091`); `docs/decisions/CLOCK_PHOTO_PUNCH_EXIT_TRANSACTION_13F.md §10` mide el round-trip real.
- Impacto usuario: alto en percepción (endpoint llamado cada 60s por cada pestaña abierta).
- Propuesta: **instrumentar antes de tocar código** — reactivar/ampliar el logger de requests en producción (ver hallazgo #7) para confirmar dónde se va el tiempo; revisar configuración de Neon (autosuspend, tier de compute, región del backend).
- Riesgo de tocar: ninguno (es diagnóstico, no cambio).
- Etapa sugerida: 14B (diagnóstico), no requiere cambio de código de este endpoint.

**7. Logger de requests deshabilitado en producción — sin telemetría real**
- Síntoma: no existe forma de confirmar con datos reales ninguno de los hallazgos de esta auditoría en el ambiente que importa.
- Causa: `backend/src/middlewares/requestLogger.ts` corta temprano si `isProduction`.
- Evidencia: confirmado por el agente B1 durante la investigación del hallazgo #6.
- Impacto: bloquea la validación de cualquier optimización futura ("medir antes de tocar", principio #2 de este pedido).
- Propuesta: reactivar un logging liviano de duración/queries por endpoint en producción, sin exponer secretos ni PII (ya especificado en `docs/PERFORMANCE_NETWORK_OPTIMIZATION_PLAN.md` Fase 1, nunca implementado en producción).
- Riesgo de tocar: bajo (logging, no lógica de negocio) — revisar cuidadosamente que no loguee tokens/datos personales.
- Etapa sugerida: 14G (pero desbloquea todo el resto — considerar adelantarla).

**8. `ShiftAlertsPage`/`AttendancePage` (observaciones) — blanqueo de tabla en cada filtro/resolución**
- Ya detallado en §5.1. Impacto usuario: alto (uso frecuente de RRHH, pérdida de contexto visual en cada acción).
- Propuesta: aplicar el guard `if (!items.length) setLoading(true)` ya usado en 9 pantallas hermanas.
- Riesgo: muy bajo (mismo fix mecánico ya validado).
- Etapa sugerida: 14C.

**9. `MonthlyClosuresPage` — paginación falsa sobre correcciones**
- Ya detallado en §5.2/§4.3. Riesgo de desaparición silenciosa de datos históricos si el volumen crece.
- Propuesta: agregar filtro de período server-side a `corrections()` (mismo patrón que `notifications()` desde 9I).
- Riesgo: medio (decisión de producto pendiente sobre "seleccionar todos", ya documentada desde 9E/9G).
- Etapa sugerida: 14D.

**10. `Employee.positionId` sin índice / `ShiftAlert.[status,createdAt]` / `ClockPunchAttempt.[status,completedAt]`**
- Ya detallado en §12. Impacto creciente con headcount y con el tiempo (el cron de limpieza corre para siempre).
- Etapa sugerida: 14F.

**11. `employeeDetailSelect` — fan-out de ~24 relaciones, incluida una cadena duplicada**
- Ya detallado en §4.6. Impacto: cada cache-miss de legajo (primer acceso, o tras cualquier escritura) paga el costo completo.
- Etapa sugerida: 14E.

**12. `GET /employees/:id/position-validation` sin cache**
- Ya detallado en §4.6. Etapa sugerida: 14E.

### Medio

13. `timeGridCatalogCache` sin invalidación (§11) — 14B/14F.
14. `HourConceptRule` sin cache pese a leerse en cada clock-out (§11) — 14B.
15. `GET /positions/:id/employees` sin paginar (§4.7) — 14E.
16. `corrections()` sin filtro de período en el backend (§4.3) — 14D.
17. Refetch completo tras acciones individuales de bandeja (§5.3) — 14C.
18. Invalidación de cache de empleado demasiado amplia (§5.5) — 14C.
19. `WorkRegimesPage`/`UsersPage` sin paginación real ni volumen documentado (§5.6) — 14E.
20. `ShiftDetailPage` trae lista completa para un registro (§5.4) — 14E.
21. `listFieldHistory`/`listBlockHistory` pagan el detalle completo como existence-check (§4.6) — 14E.
22. `sync-labor-statuses` con updates seriales (§4.6) — 14B.
23. `GET /audit` sin filtro de fecha, paginación OFFSET sobre tabla que crece sin retención (§4.9) — 14G (decisión de producto sobre retención).
24. `assign()` de régimen sin transacción/aislamiento en el check-then-write (§9) — 14E (riesgo de concurrencia, no de latencia).

### Bajo

25. Discrepancias de TTL entre `CACHING_STRATEGY.md` y el código real (§11) — actualizar documentación, sin código.
26. `finnegans-export`: `take:10000` sin comentario, auditoría en cada preview (§4.13) — 14D.
27. `WorkRegime`/`AuditParameter` cacheados sólo en frontend (§11) — 14B (opcional).
28. Familia de cache `"novelties"` muerta (§11) — limpieza menor.
29. `OrganigramasPage` fallback sin aviso de límite (§5.8) — 14E (opcional).
30. Comentario obsoleto en `workRegimes.repository.ts:154-158` (§12) — housekeeping.

---

## 14. Plan de etapas 14B+

**14B — Backend crítico**
- Batchear `checkMissingOutRisk` (eliminar el `findUnique` dentro del loop).
- Rediseñar `novelties/bulk-approve` (batch/transacción, decidir semántica de auditoría agregada).
- Batchear `shiftAssignment.assign`/`holidayWorkAssignment.save`.
- Aplicar el fix de 13F a `createFromWorkShift`.
- Acotar/batchear `syncZeroTimeEntries` (novedades con horas en cero).
- Instrumentar producción (reactivar logging liviano de duración por endpoint) para confirmar la causa de `notifications-unread-count` antes de cualquier cambio de código sobre ese endpoint.
- Agregar `invalidateTimeGridCatalogCache()` o eliminar ese cache reutilizando uno ya existente.
- Cachear `HourConceptRule` (mismo patrón que `workforce.cache.ts`).
- `sync-labor-statuses`: reemplazar el loop de `update` por `updateMany` agrupado.

**14C — Frontend crítico**
- Aplicar el guard "no blanquear" a `ShiftAlertsPage`, `AttendancePage` (observaciones), `HourConceptsPage`, `NoveltyTypesPage`, `DocumentCategoriesPage`, `AuditParametersPage`, `AssociatedEmployeesPanel`.
- Acotar `invalidateEmployeeDependentCaches()` para que `updateTransport`/`updateAddress`/`replaceAssignments` no invaliden `positions`/`dashboard`.
- Evaluar reemplazar refetch completo por actualización local puntual en `HoursPage`/`AttendancePage`/`ShiftAlertsPage` tras acciones de bandeja individuales.

**14D — Carga horaria y bandeja**
- Agregar filtro de período server-side a `corrections()` (mismo patrón ya usado por `notifications()` desde 9I) y conectar `MonthlyClosuresPage` a él.
- Revisar `finnegans-export`: comentar/justificar el `take:10000`, mover la auditoría sólo a la exportación real (no a cada preview).
- Definir la decisión de producto pendiente de "seleccionar todos" bajo paginación para `MonthlyTimeClosure` (deuda ya documentada desde 9E/9G).

**14E — Legajos/configuración**
- Reducir el fan-out de `employeeDetailSelect` (evaluar separar overview liviano de detalle completo por pestaña, o eliminar la duplicación de la cadena `sector→area→establishment→businessUnit`).
- Conectar `position-validation` al cache existente.
- Reemplazar los existence-checks de `listFieldHistory`/`listBlockHistory` por un `findFirst` liviano.
- Agregar paginación real a `GET /positions/:id/employees` (mismo patrón que `work-regimes`).
- Agregar `GET /workforce/shift-templates/:id` y conectar `ShiftDetailPage`.
- Agregar paginación real (o justificar volumen) a `WorkRegimesPage`/`UsersPage`.
- Envolver `assign()` de régimen laboral en la misma transacción/aislamiento que ya usa `saveManualHourConceptBreakdown`.

**14F — Índices y DB**
- Migración aditiva: `Employee.positionId`, `ShiftAlert.[status,createdAt]`, `ClockPunchAttempt.[status,completedAt]`.
- Corregir el comentario obsoleto en `workRegimes.repository.ts:154-158`.
- Confirmar si `EmployeeDocument.[status,expiresAt]` y `StorageFile.attendancePunchId` tienen consumidor real antes de considerar removerlos.

**14G — QA performance**
- Medición antes/después de cada cambio de 14B-14F con el logging de producción ya reactivado (14B).
- Actualizar `docs/CACHING_STRATEGY.md` con los TTLs reales confirmados.
- Agregar `fromDate`/`toDate` a `GET /audit` (decisión de producto sobre retención de `AuditLog`).
- Pruebas de regresión de paginación/cache/invalidación para cada cambio, siguiendo el patrón ya establecido en `PERFORMANCE_STANDARDS.md §4`.

---

## 15. Métricas objetivo

Basadas en las del pedido, ajustadas con la evidencia real de infraestructura encontrada en esta auditoría (Neon pooler remoto, ~300-450ms/round-trip medido en 13F — no es un entorno de latencia despreciable):

| Tipo de operación | Ideal | Aceptable | Nota |
|---|---|---|---|
| Pantallas principales (primera carga útil) | < 1.5s | < 2.5s | Alcanzable hoy para Dashboard/Notificaciones/TimeClock; Legajos-detalle puede exceder esto en cache-miss por el fan-out de §4.6 |
| Guardados simples | < 500ms | < 1s | Alcanzable para la mayoría (edición de legajo, novedad individual) |
| Guardados complejos | — | < 2s | No alcanzable hoy para bulk-approve/asignación masiva — ver hallazgos críticos |
| Fichador (sin foto) | < 1s | — | Ya cumple tras 13F |
| Fichador (con foto) | < 2.5s | — | El componente dominante es la subida a storage (~3s), documentado y fuera de alcance de esta etapa |
| Contador de notificaciones | < 200ms | < 500ms | **No confirmable como alcanzable sin cambiar la topología de red/infra** — con ~300-450ms de round-trip medido hacia Neon, un solo round-trip ya consume la mayor parte del presupuesto "ideal". Ajustar el objetivo a "aceptable" salvo que se resuelva la latencia de infraestructura (14B, diagnóstico primero) |
| Endpoints críticos (queries) | 5-8 máx | — | Cumplido en la enorme mayoría; excepciones: `employeeDetailSelect` (~24 relaciones), `evaluateShiftExit` (~21 queries) |
| Transacciones críticas | < 1s | < 3s | Cumplido en `closeOpenWorkShift` (post-13F); no cumplido en `createFromWorkShift` ni en `syncZeroTimeEntries` bajo volumen alto |

**Nota explícita pedida**: el entorno de base de datos remoto (Neon, pooler) introduce una latencia base real (~300-450ms/round-trip) que ningún cambio de código de aplicación puede eliminar — sólo reducir la cantidad de round-trips por request, o acercar backend/DB, o cambiar de estrategia de conexión para endpoints latencia-sensibles. Esto se documenta acá porque cambia qué objetivos son realmente alcanzables sin tocar infraestructura.

---

## 16. Riesgos

- **Sin telemetría de producción**: todos los conteos de queries de este documento son inferidos leyendo código, no medidos. Antes de implementar cualquier fix de 14B+, se recomienda confirmar con datos reales (una vez reactivado el logging) que el problema se manifiesta como se describe.
- **Volumen real de uso no confirmado** para varios hallazgos condicionales (lotes típicos de `bulk-approve`/asignación masiva, rango de fechas típico de novedades con horas en cero, cantidad real de filas en catálogos fetch-all(500)). El código permite el peor caso citado; no hay evidencia de que ese peor caso ocurra hoy en producción.
- **`bulk-approve` y asignación masiva tocan lógica de auditoría** — cualquier rediseño a batch debe decidir explícitamente qué queda en `AuditLog` (una fila agregada vs. una por ítem), es una decisión de producto, no sólo técnica.
- **`assign()` de régimen sin aislamiento** es un riesgo de concurrencia real pero de baja probabilidad (requiere dos requests simultáneos sobre el mismo empleado) — no es urgente, pero no debe descartarse silenciosamente.
- **Cualquier cambio a `createFromWorkShift`/`syncZeroTimeEntries`/`bulk-approve` toca el mismo código de negocio que las Etapas 13A-13J ya endurecieron con tests dedicados** — requiere la misma disciplina de tests que esas etapas, no un parche aislado.

## 17. Qué NO se implementó

Ningún archivo de `backend/` ni de `frontend/` fue modificado. No se creó ninguna migración. No se cambió ningún schema. No se tocó ninguna configuración de cache, índice, paginación ni transacción. No se ejecutó ningún build/test/typecheck. No se hizo ningún commit. Esta etapa es exclusivamente diagnóstico — todas las "propuestas de solución" citadas en la Parte 13 son sugerencias para etapas futuras (14B en adelante), no cambios ya hechos.
