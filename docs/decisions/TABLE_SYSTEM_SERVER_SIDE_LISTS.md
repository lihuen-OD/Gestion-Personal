# Sistema unificado de tablas: búsqueda, filtros, orden y paginación sobre el dataset completo

Fecha: 2026-09-30. Estándar resultante: `docs/FRONTEND_STANDARDS.md` §Tables → "Table system", `docs/BACKEND_API_CONTRACTS.md` → "Contrato de listados paginados", `docs/PERFORMANCE_STANDARDS.md` §6.

## Regla

> Buscar, filtrar y ordenar siempre sobre el conjunto completo de datos, nunca sólo sobre la página visible. Ningún listado que la UI presente como completo se trunca en silencio.

Pipeline server-side: `WHERE` (filtros + búsqueda) → `ORDER BY` (whitelist + desempate `id`) → `COUNT` → `OFFSET/LIMIT`.

## Inventario (42 `<table>` en 33 archivos)

### Server-side (paginadas)

| Tabla | Endpoint | Search | Filtros | Sort server-side | Estado |
|---|---|---|---|---|---|
| Legajos (`EmployeesPage`) | `GET /employees` | backend | empresa, sector, centro de costo | Legajo, CUIL, Apellido, Nombre, Estado | migrada |
| Documentación (`DocumentsPage`) | `GET /documents` | backend | — | Legajo, Empleado, Categoría, Archivo, Fecha carga, Vencimiento, Estado | migrada |
| Novedades (`NoveltiesPage`/`NoveltyTable`) | `GET /novelties` | backend | período | Legajo, Empleado, Novedad, Vigencia, Estado | migrada |
| Auditoría (`AuditPage`) | `GET /audit` | — | — | Fecha | migrada |
| Puestos (`PuestosPage`/`PuestoTable`) | `GET /positions` | backend | estado + 5 de ubicación/rango | Nombre, Estado | migrada |
| Horas — Personas habilitadas | `GET /time-entries/period-employees` | backend | período, centro de costo | Legajo, Empleado | migrada |
| Bandeja — Por registro | `GET /time-entries` | backend | período, estado, centro de costo | Legajo, Empleado, Día, Concepto, Horas, Estado | migrada |
| Bandeja — Por persona | `GET /time-entries?view=byEmployee` | backend | ídem | Legajo, Empleado | migrada |
| Bandeja — Novedades pendientes | `GET /pending?kind=novelties` | — | período | orden default (fecha) | paginada (antes truncada) |
| Bandeja — Desgloses pendientes | `GET /pending?kind=hourConceptBreakdowns` | — | período | orden default (fecha) | paginada (antes truncada) |
| Empleados asociados (`AssociatedEmployeesPanel`) | `/hour-concepts/:id/employees`, `/work-regimes/:id/employees` | backend | sector, centro de costo, empresa, vigencia | Legajo, Empleado | migrada |
| Puesto → Personas asignadas | `GET /positions/:id/employees` | — | — | Legajo, Apellido | paginada (antes `take: 500` sin meta) |
| Legajo → Auditoría (pestaña 10) | `GET /audit?entityId=` | — | — | Fecha | paginada (antes 200 compartidos) |
| Asistencia → Problemas de fichada | `GET /time-entries/attendance/observations` | backend | tipo, estado | orden fijo (cursor "Cargar más") | sin cambios (fichador, fuera de alcance) |

### Client-side (dataset completo cargado)

| Tabla | Fuente | Carga completa garantizada por | Sort local |
|---|---|---|---|
| Estructura organizacional (6 pestañas) | `GET /org-structure` | catálogo completo sin tope (antes 500/entidad) | sí |
| Usuarios | `GET /users` | `collectAllPages` (antes default 100) | sí |
| Regímenes laborales | `GET /work-regimes` | `collectAllPages` (antes 1 página) | sí |
| Conceptos horarios | `GET /hour-concepts` | `collectAllPages` + fallback de cache | sí |
| Categorías documentales | `GET /document-categories` | ídem | sí |
| Tipos de novedades | `GET /novelty-types` | ídem | sí |
| Parámetros de auditoría | `GET /audit-parameters` | `collectAllPages` (antes take 300) | sí (nuevo) |
| Turnos | `GET /workforce/shift-templates` | endpoint sin tope | sí |
| Feriados → candidatos | `GET /shifts/holiday-work/candidates` | `collectAllPages`, filtros/búsqueda server-side (antes take 300, meta ignorada) | no (planilla editable) |
| Cierres mensuales | `/workforce/closures` + `getAllOptions` | `collectAllPages` (antes take 1000) | no (acción masiva por fila) |
| Cierres → correcciones | `GET /workforce/corrections?period&status` | filtro server-side (antes 500 + filtro local) | no |
| Legajo → Documentación | `GET /documents?employeeId=` | `collectAllPages` (antes take 100) | no |
| Legajo → Novedades | `GET /novelties?employeeId=` | `collectAllPages` (antes take 100) | no |
| Legajo → Movimientos laborales | overview-details | sin tope (antes 50; el estado laboral se calcula sobre esta lista) | no |
| Detalle/paneles chicos (turnos del legajo, régimen, reglas de concepto, empleados de turno, tramos de asistencia, jornadas del día) | endpoints sin tope, acotados por entidad/día | — | no: listas cronológicas/operativas de pocas filas con orden de negocio fijo |
| Dashboard (cumpleaños, actividad reciente) | `/dashboard/metrics`, `/audit?take=5` | widgets acotados por diseño ("próximos 30 días", "últimos 5") | no |
| Grillas horarias (`EmployeeHoursPage`, `MonthlyHoursReviewGrid`) | `/employees/:id/time-grid` | matriz concepto × día, no un listado | no (no aplica) |
| Horario laboral → reglas de hora doble | `/workforce/double-hour-rules` | sin tope, catálogo chico | no |
| Exportación Finnegans (preview) | `/finnegans-export/novelties?period` | acotado por período (`take: 10000` documentado) | no — exportaciones fuera de alcance |

## Truncados silenciosos encontrados y resolución

| Caso | Antes | Ahora |
|---|---|---|
| Usuarios | `GET /users` sin take → default 100 | `collectAllPages` |
| Regímenes / Conceptos / Categorías documentales / Tipos de novedad / Parámetros de auditoría | 1 página (200/300) | `collectAllPages` |
| Cache "sin filtros" de 5 catálogos (puestos, conceptos, tipos de novedad, categorías documentales, categorías salariales) | `take: 500` + `total = filas cacheadas` | `REPOSITORY_LIST_CACHE_MAX_ROWS + 1`; si se supera, consulta paginada real con `count` |
| Estructura organizacional | `take: 500` por entidad | catálogo completo documentado |
| `GET /positions/options` (tarjetas de Puestos, selects de Legajos) | default 300 | sin `take` = completo |
| Puesto → personas asignadas | `take: 500`, sin meta | paginado + `meta.total` |
| Bandeja → pendientes | `kind=all&take=300`, `summary.total = filas traídas` | paginación por fuente + totales `count` reales |
| Bandeja → subtítulo de horas en revisión | largo de la página (≤25) | `meta.total` |
| Feriados → candidatos | `take: 300`, meta ignorada | `collectAllPages` |
| Cierres → empleados / Usuarios → empleado vinculado | `getOptions({take:1000})` | `getAllOptions` (`collectAllPages`) |
| Cierres → correcciones | últimas 500 de todos los períodos + filtro local | `period`/`status` en el `where` |
| Legajo → documentos | `take: 100` | `collectAllPages` |
| Legajo → novedades (`noveltyApiService.getAll`) | 1 página de 100 | `collectAllPages` |
| Legajo → movimientos laborales | `take: 50` | sin tope |
| Legajo → auditoría | 200 compartidos por 3 vistas | pestaña Auditoría paginada; la línea de tiempo avisa "Últimos N eventos" si hay más |
| Horario laboral → puestos activos (`positionApiService.getAll`) | take 300 | `collectAllPages` |

## Bugs de filtros corregidos en el camino

- Puestos: Área + Establecimiento + Unidad de negocio eran spreads de la misma key `sector` — el último pisaba a los anteriores. Ahora `AND`.
- Categorías documentales: `mandatory` + `expires` pisaban la misma key `rules`. Ahora `AND` (el test existente codificaba el bug).
- `z.coerce.boolean()` convierte `"false"` en `true` en 8 filtros de listado → `queryBoolean()` estricto.

## Decisiones

- **Contrato**: se mantiene `page`/`take` + `meta {total,page,pageSize,hasMore}` (convención previa, `totalPages` se deriva en `Pagination`). Se agrega `sortBy`/`sortOrder`.
- **Whitelist**: `z.enum` por endpoint → 400 `VALIDATION_ERROR` estándar; el mapa key→`orderBy` vive en el repositorio. Sin `sortBy`, orden de negocio previo intacto.
- **Relaciones opcionales no ordenables** (centro de costo, sector, usuario): Prisma no admite `nulls` en relaciones → en DESC los vacíos irían primero, violando "vacíos al final".
- **Collation**: la base es `C.UTF-8`. Orden server-side por bytes (mayúsculas/acentos no normalizados). Corregirlo requiere migración de collation ICU (`es-x-icu`) por columna — no se hizo (etapa sin migraciones); queda como propuesta.
- **Índices**: no se agregaron. Los órdenes nuevos sobre `Employee` ya tienen `@@index([lastName, firstName])`/`[status, ...]`; el resto de las tablas tienen volumen bajo confirmado (32 legajos, 14 novedades, 1815 eventos de auditoría con índice por `createdAt`). Revisar con `EXPLAIN` si el volumen real crece.
- **Sin componente monolítico**: se mantiene la composición `DataTable` + `SortableHeader` + `Pagination`; no se introdujeron column definitions (no simplificaban las tablas existentes sin riesgo).

## Pendientes conocidos (fuera de alcance, documentados)

- Collation `es` server-side (migración ICU).
- Pendientes de Bandeja: sin `sortBy` (orden por fecha fijo).
- Asistencia → "Problemas de fichada": cursor `before` sin desempate por id (fichador, fuera de alcance).
- `?preview=false` (Finnegans), `?force=false` (borrado de concepto) e `includeInReview` usan `z.coerce.boolean()` fuera de listados — exportaciones/motor horario fuera de alcance.
- `SectionChangeHistory` (últimos 5 cambios por sección) se calcula sobre los 200 eventos más recientes.
- `EmployeeHoursPage`/`MonthlyHoursReviewGrid`: novedades que cruzan de mes se comparan por día del mes (lógica de grilla horaria, fuera de alcance).
- Búsqueda: `setPage(1)` inmediato + término debounceado 350 ms dispara un request intermedio descartado por el guard `mounted` (sin impacto funcional).
