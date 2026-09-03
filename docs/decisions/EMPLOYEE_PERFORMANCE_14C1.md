# Etapa 14C.1 — Optimización de performance en Legajos / Empleados

Fecha: 2026-09-03
Estado: diagnóstico completo, implementado, validado, pendiente de aprobación para commitear
Alcance: backend (`backend/src/modules/employees/`) únicamente. Sin cambios de schema, sin migraciones, sin cambios de contrato de API, sin cambios funcionales, sin cambios de frontend (justificado en §7).

---

## 1. Diagnóstico (Parte 1 del pedido, con evidencia real archivo:línea)

### 1.1 Componentes frontend en `/legajos`

`frontend/src/pages/EmployeesPage.tsx`. Al montar dispara, en 3 efectos independientes (sin duplicados entre sí):
1. `employeeApiService.list({ page, take: pageSize, search: debouncedSearch, companyId, sectorId, costCenterId })` → `GET /employees` (línea ~50-58).
2. `employeeApiService.getSummary()` → `GET /employees/summary` (línea ~78-80).
3. `orgStructureApiService.getCatalog()` → `GET /org-structure` (línea ~93-96, deps `[]`, una sola vez).

### 1.2 Endpoints disparados en `/legajos`

`GET /employees`, `GET /employees/summary`, `GET /org-structure` (cacheado 10min en frontend, así que en navegaciones repetidas dentro del TTL no vuelve a pedirse).

### 1.3 Requests duplicadas

Ninguna real detectada en `EmployeesPage.tsx` — 3 efectos, 3 endpoints distintos, sin solapamiento. (El "duplicado" real está en el Detalle de legajo, ver §1.11-1.12 — no en el listado).

### 1.4 Qué endpoint dispara `GET /api/employees`

`employeesController.list` (`employees.controller.ts:35-41`) → `employeesService.list` → `employeesRepository.findMany` (`employees.repository.ts:717-730`).

### 1.5 Qué datos trae `GET /api/employees`

Antes de esta etapa, `employeeListSelect` (`employees.repository.ts:33-64`) traía: `id, legajo, legajoFinnegans, cuil, dni, firstName, lastName, birthDate, gender, civilStatus, nationality, status, createdAt, updatedAt`, más las relaciones `sector` (to-one), `costCenter` (to-one), `position` (to-one), `companies` (to-many, con join a `Company`), `laborMovements` (to-many, `take:5`, con join a `User` vía `createdBy`).

### 1.6 ¿Trae más relaciones de las necesarias para el listado?

**Sí, confirmado contra el contrato de producto y el código real del frontend.** `docs/PROJECT_CONTEXT.md` → "Legajos / Personas" es explícito: *"Main list must show only: Legajo, CUIL, Apellido, Nombre, Centro de costo, Estado, Acción"*. Confirmado leyendo la tabla real (`EmployeesPage.tsx`, filas del `<table>`): sólo renderiza `displayLegajo(employee)`, `employee.cuil`, `employee.lastName`, `employee.firstName`, `employee.costCenter` (vía `OverflowCell`), `employee.status`, y un link a `/legajos/:id`. **`sector` y `position` no se renderizan en ningún lado del listado** — confirmado por lectura completa del archivo. `companies` sólo alimenta `companyOptions` (dropdown de filtro), que ya tiene una fuente completa y autoritativa independiente (`orgStructureApiService.getCatalog().companies`, ya fetcheada por el mismo efecto de catálogo) — la unión con `employeeCompanies(employee)` (`utils/employee.ts:11-13`) es redundante en la práctica (cualquier empresa con un empleado activo ya está en el catálogo de `org-structure`, que es la fuente de verdad organizacional del proyecto).

**Lo que si hay que preservar**: la regla de negocio *"Employee status is calculated from labor movements"* (`docs/PROJECT_CONTEXT.md`). El mapper compartido `mapEmployeeFromApi` (`employeeApiService.ts:247-261`) calcula `status` así: `laborMovements.length ? calculateLaborStatus(laborMovements).status : toFrontendStatus(item.status)` — si se sacara `laborMovements` del select del listado, el badge de Estado pasaría a mostrar siempre la columna cruda `Employee.status` en vez del valor calculado, lo que **violaría la regla de negocio explícita**. Por eso `laborMovements` (ya acotado a `take:5` con un join liviano) se mantiene en el select del listado — no se toca.

### 1.7 Qué endpoint dispara `GET /api/employees/:id/overview`

`employeesController.getOverviewById` (`employees.controller.ts:81-88`) → `employeesService.getOverviewById` → `employeesRepository.findOverviewById` (`employees.repository.ts:859-861`), select `employeeOverviewCoreSelect` (`employees.repository.ts:334-360`) — **ya era liviano antes de esta etapa**: sólo escalares de `Employee`, cero relaciones. No es el endpoint crítico reportado por 14B.3 (ese es `overview-details`).

### 1.8 Qué endpoint dispara `GET /api/employees/:id/overview-details`

`employeesController.getOverviewDetailsById` (`employees.controller.ts:90-97`) → `employeesService.getOverviewDetailsById` → `employeesRepository.findOverviewDetailsById` (`employees.repository.ts:863-865`), select `employeeOverviewSelect` (antes de esta etapa: `employees.repository.ts:269-332`).

### 1.9 Qué datos trae `overview-details`

Antes de esta etapa: todos los escalares de `employeeOverviewCoreSelect` + `address` + `transport` + `sector` (con cadena completa `area→establishment→businessUnit`) + `costCenter` + `position` (modelo completo, `position: true`) + `companies` (to-many, con `Company`) + `laborMovements` (to-many, `take:50`, con `createdBy`) + `assignments` (to-many, `take:100`, con `User`) + `hourConcepts` (to-many, filtrado por `assignableHourConceptsSelect`).

### 1.10 ¿Usa un select/include gigante tipo `employeeDetailSelect`?

No exactamente el mismo (`employeeDetailSelect`, usado por el `GET /employees/:id` plano, es un select distinto y aparte, con `novelties`+`documents` además de todo lo anterior — **no es el endpoint que 14B.3 marcó crítico**, y no se tocó en esta etapa por estar fuera del alcance medido). Pero `employeeOverviewSelect` (el que sí importa acá) es igual de "gigante" en términos de **cantidad de relaciones distintas en un único `findFirst`**: 8 relaciones (`sector`, `sector.area`, `sector.area.establishment`, `sector.area.establishment.businessUnit`, `costCenter`, `position`, `companies`→`company`, `laborMovements`→`createdBy`, `assignments`→`user`, `hourConcepts`→`hourConcept`) — 10 "saltos" de relación contando los niveles anidados de `sector`.

### 1.11 ¿Relaciones duplicadas o innecesarias para el render inicial?

No hay relaciones **duplicadas** dentro de `employeeOverviewSelect` en sí (a diferencia de `employeeDetailSelect`, que si tiene la cadena `sector` repetida una vez colgando de `employee.sector` y otra de `employee.position.sector` — confirmado en `employees.repository.ts:118-137` vs `161-179` — **no tocado en esta etapa**, no es el endpoint crítico). Lo que sí hay en `overview-details` es **una cantidad grande de relaciones genuinamente necesarias pero repartidas en un único `findFirst` sin paralelismo real** (ver §1.15).

### 1.12 ¿El detalle de legajo carga todo al inicio aunque haya pestañas cerradas?

**Sí, confirmado.** `EmployeeDetailPage.tsx:97-127` dispara `getOverviewById` **y** `getOverviewDetailsById` **en paralelo, siempre, sin condicionar por `tab` activo** — a pesar de que el propio archivo ya define `tabsThatNeedOverviewDetails = new Set([1, 2, 3, 4, 5])` (línea 61), ese set **sólo se usa para decidir qué loading/error mostrar dentro de una pestaña** (líneas 267-269), nunca para diferir el fetch en sí.

**Por qué no se puede diferir sin más (evaluado y descartado por riesgo funcional)**: la cabecera (`detail-hero`, siempre visible sin importar la pestaña) muestra `currentEmployee.company`/`currentEmployee.costCenter` (línea ~231) y el badge de estado usa `calculateEmployeeStatus(currentEmployee)` que depende de `laborMovements?.length` (línea 217) — **ambos campos vienen de `overview-details`, no de `overview`**. Diferir el fetch de `overview-details` hasta que el usuario abra una pestaña 1-5 dejaría la cabecera (visible siempre, en cualquier pestaña) sin empresa/centro de costo/estado calculado hasta ese momento — una regresión funcional real, no sólo visual. Por esta razón, **esta etapa no reestructura el fetch del frontend** — reduce el costo del propio endpoint en el backend (ver §2), que es lo que resuelve el problema medido (6441ms) sin tocar el contrato ni el comportamiento. Reestructurar la cabecera para que dependa sólo de campos livianos (y mover `companies`/`assignments`/`hourConcepts` a fetch bajo demanda por pestaña) es un rediseño de UI/contrato más grande, documentado como candidato a una etapa futura (§7).

### 1.13-1.14 Queries Prisma / N+1

**No es N+1 en el sentido clásico** (no hay ningún loop de aplicación disparando una query por fila). Es un patrón distinto pero con el mismo síntoma de fondo: Prisma (sin `previewFeatures = ["relationJoins"]` — confirmado en `backend/prisma/schema.prisma`, generator block sin esa feature) resuelve un `select` con relaciones anidadas emitiendo **una consulta SQL separada por relación/nivel**, no un único `JOIN`. Para `findOverviewDetailsById`, eso son aproximadamente 10 consultas separadas para **un solo legajo** (ver §1.10). Cada una paga el round-trip completo hacia Neon (~300-600ms, medido y documentado desde la Etapa 13F). Contado: `~10 queries × ~500-600ms promedio ≈ 5000-6000ms` — coincide casi exactamente con los `6441ms`/`6021ms` medidos dos veces en el journey real de 14B.3.

### 1.15 ¿Hay queries secuenciales que pueden hacerse en paralelo?

**Sí — es la causa raíz principal.** Las ~10 consultas de `overview-details` se disparan dentro de un único `prisma.employee.findFirst({ select: {...} })` — Prisma las resuelve como un lote, pero sin `relationJoins` no hay garantía de que corran concurrentemente contra la conexión; el patrón ya validado en este proyecto (Etapa 13F, `dashboard.service.ts`) es separar explícitamente en consultas independientes y envolverlas en `Promise.all` a nivel de aplicación, que sí garantiza concurrencia real sin depender del comportamiento interno del motor de Prisma.

También en `employees.repository.ts:summary()` (línea ~730): 3 queries (`groupBy` status, `groupBy` de time entries pendientes, `count` de empleados sin responsable de horas) envueltas en `prisma.$transaction([...])` — la forma-array de `$transaction` en Postgres ejecuta las queries **secuencialmente dentro de la misma transacción**, no en paralelo. Esto contrasta con el patrón ya establecido y validado en `dashboard.service.ts:calculateMetrics` (15 queries en un único `Promise.all`, sin transacción, porque son datos agregados/de resumen donde la consistencia estricta entre queries no es un requisito de negocio — ver `docs/PERFORMANCE_STANDARDS.md` §2.E). `employees.summary()` es exactamente esa misma categoría de dato (contadores agregados para tarjetas de resumen) — usar `$transaction` en vez de `Promise.all` acá es una inconsistencia respecto al propio patrón ya elegido por el proyecto para este tipo de dato, no un requisito de exactitud real.

### 1.16 ¿Hay datos de configuración cacheables con TTL corto?

Ya lo están: `GET /employees`, `/summary`, `/overview`, `/overview-details` ya tienen cache backend (`createTtlCache`, `employees.controller.ts:11-16`) de 20-30s por usuario+rol+id, y `org-structure` ya está cacheado 60s backend + 10min frontend. No se identificó ningún dato adicional cacheable con seguridad en esta etapa — los datos de `overview-details` son operativos/de alta variación (asignaciones, movimientos laborales) y ya están bajo el TTL corto correcto.

### 1.17-1.19 Paginación / filtros / fetch completo

`GET /employees` ya pagina de verdad (`$transaction([findMany({skip,take}), count])`, `employees.repository.ts:717-730`), con `take` acotado por schema (`employees.schemas.ts`, máx documentado en 14A). El frontend (`EmployeesPage.tsx`) **sí** pide con `page`/`take` (`pageSize` fijo, `Pagination.tsx` real) — nunca fetch-all. Los filtros (`search`, `companyId`, `sectorId`, `costCenterId`) se resuelven en el `where` del backend (`buildWhere`), no en memoria. Sin hallazgos nuevos acá — ya estaba correcto (Etapa 9E).

### 1.20 ¿Índices adecuados según el schema actual?

Sí, para los filtros reales usados por estos 4 endpoints: `Employee.[status]`, `[status,sectorId]`, `[status,costCenterId]`, `[sectorId]`, `[costCenterId]`, `[lastName,firstName]` (`schema.prisma`, confirmado en la Etapa 14A) cubren `buildWhere`. `LaborMovement.[employeeId,effectiveFrom]`, `EmployeeAssignment.[employeeId,type]`, `EmployeeHourConcept` (PK compuesta `[employeeId,hourConceptId]`, prefijo izquierdo cubre `employeeId` solo), `EmployeeCompany` (PK compuesta `[employeeId,companyId]`, mismo criterio) — **todos con índice de soporte real para un filtro por `employeeId` solo**, confirmado leyendo `schema.prisma` antes de decidir separar `findOverviewDetailsById` en consultas independientes (§2) — separar esas relaciones en `findMany` propios no introduce ningún table scan nuevo. No se identificó ningún índice faltante que justifique una migración en esta etapa (cumple la condición explícita del pedido: "no crear migraciones sin diagnóstico previo" — el diagnóstico no encontró ninguna necesaria).

### 1.21 ¿Qué parte del tiempo es DB y qué parte es frontend/render?

Prácticamente todo es backend/red hacia la base (Neon, remota) — confirmado por el propio reporte de 14B.3: `headerVisibleMs` (cuándo aparece el `<h1>`, proxy de render) fue de 832ms para el detalle de legajo, mientras que `networkIdleMs` (proxy de "terminó de traer datos") fue de 7016ms — la diferencia (~6200ms) es tiempo de red/DB esperando las respuestas de `overview`/`overview-details`, no render de React. El frontend ya pinta el shell de la pantalla rápido; lo lento es exclusivamente la espera de datos.

### 1.22 Riesgos de tocar cada endpoint

- **`employeeListSelect`**: bajo. Ningún campo removido se renderiza en la tabla ni se usa en lógica de negocio del listado (confirmado por lectura completa de `EmployeesPage.tsx` y del mapper compartido). Único efecto secundario posible: el dropdown de filtro "Empresa" podría, en un caso de borde muy improbable (una empresa inactiva/no catalogada pero con un empleado activo vinculado), dejar de listar esa empresa puntual — documentado, aceptado, no es una regla funcional documentada en ningún lado.
- **`employees.summary()` de `$transaction` a `Promise.all`**: bajo. Mismo patrón ya usado y validado en `dashboard.service.ts` para la misma categoría de dato (agregados de resumen, no transaccionales por naturaleza).
- **`findOverviewDetailsById` split en `Promise.all`**: medio-bajo. Requiere preservar exactamente el mismo `where`/filtro de `hourConcepts` (ya centralizado en `assignableHourConceptsSelect`, reusado tal cual) y preservar el control de acceso (`accessWhere`) — mitigado verificando primero el registro "núcleo" con `accessWhere`, y sólo si existe, disparando las 4 consultas hijas por `employeeId` (que nunca necesitan `accessWhere` propio, porque ya se validó el acceso al padre). Riesgo cubierto con tests actualizados (§8).

---

## 2. Endpoints involucrados

| Endpoint | Antes (medido, 14B.3) | Causa principal | Cambio aplicado |
|---|---|---|---|
| `GET /employees/:id/overview-details` | 6021-6441ms | ~10 relaciones anidadas en un único `findFirst`, sin paralelismo garantizado | Split en 1 `findFirst` (core + relaciones to-one) + `Promise.all` de 4 `findMany` independientes (companies/laborMovements/assignments/hourConcepts) |
| `GET /employees` | 4273ms | Relaciones no usadas por el listado (`sector`, `position`, `companies`) sumando round-trips + escalares no usados | Select trimeado a lo que el listado realmente muestra/calcula |
| `GET /employees/summary` | 1521ms | 3 queries agregadas en `$transaction` (secuencial), no `Promise.all` | Cambiado a `Promise.all`, mismo patrón que `dashboard.service.ts` |
| `GET /org-structure` | 2264ms | Catálogo compartido (no exclusivo de Legajos), ya paralelizado (`Promise.all` de 6 queries) y cacheado 60s backend / 10min frontend desde antes de esta etapa | **No tocado** — fuera del alcance quirúrgico de "Legajos/Empleados" (lo consumen 10+ pantallas), sin cambio seguro adicional identificado sin evidencia nueva. Ver §7. |

---

## 3. Plan de validación

1. `npx prisma validate` — confirmar cero cambios de schema.
2. Backend: `typecheck`, `test` (incluye actualizar `employees.repository.test.ts` para el nuevo shape de `findOverviewDetailsById`), `build`.
3. Frontend: sin cambios de código — igual se corre `typecheck:e2e`, `test`, `build` para confirmar que el contrato no cambió desde su perspectiva.
4. `npm run perf:journey` contra el entorno local real (mismo backend/frontend ya corriendo, misma base de staging) — comparar contra el reporte real ya existente de 14B.3 como baseline.
5. `git diff --check`.

Resultados de la ejecución real: ver §6 abajo.

---

## 4. Cambios aplicados (Parte 3 del pedido)

### 4.A Backend

1. **`employeeListSelect`** (`employees.repository.ts`) — recortado: se sacaron `sector`, `position`, `companies` (relaciones no usadas por el listado) y `dni`/`birthDate`/`gender`/`civilStatus`/`nationality`/`createdAt`/`updatedAt` (escalares no usados). Se mantuvieron `costCenter` (se muestra) y `laborMovements` (take:5, regla de negocio de Estado calculado).
2. **`employees.summary()`** — `prisma.$transaction([...])` → `Promise.all([...])`, mismo patrón que `dashboard.service.ts:calculateMetrics` para la misma categoría de dato (agregados de resumen).
3. **`findOverviewDetailsById`** — de 1 `findFirst` con ~10 relaciones/niveles anidados, a 1 `findFirst` (núcleo: escalares + relaciones to-one: `sector`→`area`→`establishment`→`businessUnit`, `costCenter`, `position`) + `Promise.all` de 4 `findMany` independientes (`employeeCompany`, `laborMovement`, `employeeAssignment`, `employeeHourConcept`) filtrados por `employeeId`, ejecutados sólo si el núcleo existe y es accesible (`accessWhere`). `hourConcepts` sigue reusando `assignableHourConceptsSelect` (misma fuente de verdad que `findById`, sin reintroducir el bug de la Etapa 6L.1). El objeto devuelto tiene el mismo shape exacto que antes.
4. **No se tocó**: `findById`/`employeeDetailSelect` (endpoint `GET /employees/:id` plano, no marcado crítico por 14B.3), `findOverviewById`/`employeeOverviewCoreSelect` (ya era liviano), `GET /org-structure` (catálogo compartido, ya optimizado, fuera del alcance quirúrgico de Legajos/Empleados), `GET /employees/options` (`employeeOptionSelect`, ya liviano desde antes).

### 4.B Frontend

**Ningún cambio.** Evaluado explícitamente (§1.12): diferir `getOverviewDetailsById` hasta que el usuario abra una pestaña 1-5 rompería la cabecera del legajo (empresa/centro de costo/estado calculado, siempre visibles) porque esos datos vienen de `overview-details`, no de `overview`. La optimización de backend (§4.A.3) resuelve el problema medido sin ese riesgo, preservando el contrato exacto — el frontend no necesitó ni un solo cambio de código para beneficiarse.

Sobre las requests duplicadas observadas en el journey real (`/overview` y `/overview-details` cada uno llamado 2 veces): confirmado que es `React.StrictMode` (`frontend/src/main.tsx:15`, activo sólo en desarrollo, nunca en build de producción) — mismo patrón ya documentado y descartado como bug real en la Etapa 14A (auditoría F1). No se agregó ninguna lógica de deduplicación de requests para esto: sería tratar un comportamiento intencional de React 18 en desarrollo como si fuera un bug de producción, y podría enmascarar un futuro doble-fetch real. `GET /workforce/notifications-unread-count` (también visto "dos veces" en el journey) es la misma causa (StrictMode remontando `AppShell`) — documentado, no tocado, tal como pedía explícitamente la consigna ("documentarlo pero no mezclarlo salvo que sea mínimo y seguro").

### 4.C Documentación

Este documento. Antes/después esperado documentado en §6. Endpoints que quedaron fuera del alcance de esta etapa, documentados en §7.

---

## 5. Tests agregados/modificados (Parte 6 del pedido)

Todos en `backend/src/modules/employees/employees.repository.test.ts` (+7 tests, 17/17 en el archivo):

1. **`findOverviewDetailsById` — regresión 6L.1 reubicada**: confirma que `hourConcepts` sigue usando exactamente el mismo `where`/`select` que `findById` (`assignableHourConceptsSelect`), ahora en su nueva ubicación (`employeeHourConcept.findMany` en vez de anidado en el `findFirst`).
2. **`findOverviewDetailsById` — split en paralelo**: confirma que el `findFirst` del núcleo ya NO pide `companies`/`laborMovements`/`assignments`/`hourConcepts` (el select gigante quedó desarmado), que sigue pidiendo las relaciones to-one que la cabecera necesita, que las 4 consultas hijas filtran sólo por `employeeId`, y que el objeto final devuelto tiene el mismo shape exacto que antes (Parte 6, ítem 4 del pedido).
3. **`findOverviewDetailsById` — permisos**: si el núcleo no existe o `accessWhere` no matchea, nunca se disparan las 4 consultas hijas — cubre el ítem 5 del pedido ("no se rompe permisos por rol").
4. **`findMany` — select del listado**: confirma que `sector`/`position`/`companies`/`dni`/`birthDate` no viajan más, y que `id`/`legajo`/`legajoFinnegans`/`cuil`/`firstName`/`lastName`/`status`/`costCenter`/`laborMovements` sí — cubre los ítems 1 y 2 del pedido.
5. **`findMany` — paginación/filtros**: confirma `skip`/`take` correctos y que `accessWhere` se sigue combinando en el `where.AND` — cubre el ítem 6 del pedido.
6. **`summary()` — usa `Promise.all`, no `$transaction`**: confirma el cambio de mecanismo.
7. **`summary()` — mismo cálculo**: confirma que `total`/`active`/`inactive`/`missingTimeResponsible`/`pendingTimeLoads` se siguen calculando igual con datos de ejemplo.

**Ítems 7 y 8 del pedido** ("si se evita doble fetch frontend, testearlo" / "si se carga una pestaña bajo demanda, testear loading/error/empty"): no aplican — no se tocó frontend en esta etapa (§4.B).

---

## 6. Comparación de performance — antes/después (Parte 5 del pedido)

Antes: reporte real de la Etapa 14B.3/14B.3.1 (`docs/performance/PERFORMANCE_JOURNEY_14B3.md`, corrida previa a este cambio). Después: `npm run perf:journey` corrido de nuevo, mismo entorno local (mismo backend/frontend ya levantados, misma base de staging), inmediatamente después de aplicar los cambios de esta etapa.

| Endpoint / pantalla | Antes | Después | Mejora estimada | Comentario |
|---|---|---|---|---|
| `GET /api/employees/:id/overview-details` | 6021-6441ms | 3903-4243ms | ~34-36% | Sigue en rango "Crítico" (>3000ms) — el split en `Promise.all` redujo el trabajo secuencial real, pero el `findFirst` del núcleo todavía resuelve una cadena `sector→area→establishment→businessUnit` de 4 niveles sin `relationJoins` (fuera de alcance de esta etapa, ver §7). Mejora real y medida, no total. |
| `GET /api/employees` | 4273ms | 2394ms | ~44% | Pasó de "Crítico" a "Alto". |
| `GET /api/employees/summary` | 1521ms | 714ms | ~53% | Pasó de "Alto" a "Medio". |
| `GET /api/org-structure` | 2264ms | 2390ms | ~sin cambio (dentro de la variación esperada) | No tocado a propósito (§7) — la pequeña diferencia es ruido de latencia de Neon entre corridas, no una regresión. |
| Pantalla Legajos / Empleados (`networkIdleMs`) | 4838ms | 2979ms | ~38% | Consistente con la mejora de `GET /employees` + `summary`. |
| Pantalla Detalle de un legajo existente (`networkIdleMs`) | 7016ms | 4815ms | ~31% | Consistente con la mejora de `overview-details`; `GET /audit` (1359-1374ms, sin cambios, no es de este módulo) sigue siendo parte del tiempo total de esta pantalla. |

**Aclaración explícita pedida**: ambas corridas se hicieron contra la base real de staging (Neon, remota) — la latencia de red entre el backend local y Neon varía entre corridas (ya documentado desde la Etapa 13F, ~300-600ms por round-trip, con variación real observada). Los porcentajes de arriba son de una única corrida antes/después cada uno, no un promedio de múltiples corridas — se reportan como una mejora real y medida, no como un valor de laboratorio controlado. No se infló ni se redondeó ninguna cifra.

---

## 7. Qué quedó fuera de esta etapa (candidatos futuros)

- **`GET /org-structure`**: catálogo compartido por 10+ pantallas, no exclusivo de Legajos — ya paralelizado (`Promise.all` de 6 queries) y cacheado (60s backend, 10min frontend) desde antes de esta etapa. Sin evidencia nueva de una mejora segura y quirúrgica específica; cualquier cambio ahí tiene un radio de impacto mucho mayor que este módulo.
- **`employeeDetailSelect`/`GET /employees/:id` (endpoint plano, no `/overview`)**: tiene la cadena `sector` duplicada (una vez colgando de `employee.sector`, otra de `employee.position.sector`) documentada desde la Etapa 14A — no se tocó porque 14B.3 no lo marcó como crítico (no está en el camino real que usa `EmployeeDetailPage.tsx`).
- **Evaluar `previewFeatures = ["relationJoins"]` en Prisma**: resolvería de raíz el patrón de "una query por relación/nivel" para TODA la app (no sólo Legajos), colapsando selects anidados en un único `JOIN` SQL. Es un cambio de motor con radio de impacto global (afecta cualquier query con relaciones anidadas en todo el backend) — requiere su propia etapa de evaluación dedicada (medir antes/después en varios módulos, no sólo Legajos), no algo para decidir dentro de una etapa "quirúrgica" de un solo módulo.
- **Rediseño de `EmployeeDetailPage.tsx` para diferir pestañas pesadas**: separar la cabecera (empresa/centro de costo/estado) de los datos de pestañas 1-5 requeriría un endpoint nuevo o un contrato distinto para la cabecera — evaluado y descartado para esta etapa por el riesgo de romper el contrato/comportamiento actual sin necesidad, dado que la optimización de backend ya resuelve la mayor parte del problema medido.
- **`GET /dashboard/metrics`, `GET /positions`, `GET /shifts/alerts`, `GET /time-entries/period-employees`**: aparecen en Crítico en el journey real, pero son de otros módulos — fuera del alcance de "Legajos/Empleados" (ya lo eran en 14A). Candidatos directos para una etapa 14C.2/14C.3.
