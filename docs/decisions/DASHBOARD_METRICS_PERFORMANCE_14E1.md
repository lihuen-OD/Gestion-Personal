# Etapa 14E.1 — Diagnóstico y optimización de `GET /api/dashboard/metrics`

Fecha: 2026-09-07
Estado: implementado, validado, **pendiente de aprobación para commitear**
Alcance: exclusivamente `GET /api/dashboard/metrics` (`dashboard.service.ts`/`dashboard.repository.ts`) y el helper genérico de concurrencia que necesitó (`backend/src/shared/prisma/runInBatches.ts`). Sin cambios de schema/migraciones, sin cambios de contrato de respuesta, sin cambios de reglas funcionales de métricas, sin cambios de RBAC.

---

## 1. Diagnóstico (Parte 1 del pedido, 30 puntos)

### 1.1-1.4 Ruta, controller, service, repository

`dashboard.routes.ts`: `GET /metrics` → `requireAuth` + `requireAnyRole([rrhh, supervision, cargaHoraria])` + `validateQuery(dashboardMetricsQuerySchema)` → `dashboardController.metrics` → `dashboardService.metrics(query, user)` → (cache miss) `calculateMetrics(period, user)` → `dashboardRepository.*`.

### 1.5-1.9 Cantidad de queries, paralelismo, dependencias, `Promise.all`/`$transaction`

**Antes**: 15 queries Prisma, todas dentro de un único `Promise.all` (sin límite de concurrencia), ninguna usa `$transaction`. Todas son independientes entre sí (ninguna necesita el resultado de otra para armar su propio `where`) — dependen sólo de `accessWhere` (ya resuelto antes del batch) y de `period`/`year` (constantes de la request). Confirmado leyendo `calculateMetrics` completo antes de tocar nada.

### 1.10-1.15 Queries repetidas, agrupables, volumen, `count`/`findMany` innecesarios, includes pesados, selects faltantes

- **Agrupables**: `countTotal` + `countActive` son 2 `Employee.count` sobre el mismo modelo con `where` relacionado (uno es superconjunto del otro por `status`) — candidato directo a `groupBy(by: ["status"])`, exactamente el mismo patrón ya usado por `employeesRepository.summary()` (que además ya tenía un comentario señalando este mismo caso de `dashboard.service.ts` como comparable, ver `employees.repository.ts` justo antes de `summary()`).
- **No agrupables sin raw SQL**: las otras 6 `Employee.count` (`countExitsThisYear`, `countTransported`, `countEmployeesWithEntries`, `countEmployeesWithoutEntries`, `countEmployeesInReview`, `countMissingTimeResponsible`) tienen predicados relacionales distintos (`laborMovements.some`, `transport.usesCompanyTransport`, `timeEntries.some/none`, `assignments.none`) — no son particiones de una misma columna, `groupBy` no las puede colapsar sin agregación condicional (`CASE WHEN`) en SQL crudo, explícitamente desalentado por el pedido salvo necesidad justificada. No se intentó.
- **Volumen**: todas las queries ya filtran por `accessWhere` (scope de RBAC) y, donde corresponde, por `period`/`status` — ninguna hace fetch-all sin filtro.
- **Includes pesados**: `findActiveDashboardEmployees` (3 relaciones: `sector`, `companies`, `laborMovements` con `take:1`) y `findTransportedEmployees` (2 relaciones: `address`, `transport`) — ambos ya usan `select` explícito, ninguno trae campos de más. No se tocaron los `select` (mismo shape, mismo `select`).
- **Sin select**: no se encontró ninguna query sin `select`/proyección explícita salvo los `count`/`aggregate`, que no aplican.

### 1.16-1.19 Filtros de fecha/estado, RBAC, si se llama en login/inicio

- Todas las queries relevantes filtran por `period` (mes) y/o `status` según corresponda.
- **RBAC ya existente y correcto**: `employeeAccessWhere(user)` resuelve el scope real por rol (RRHH sin restricción, Supervisión/Carga Horaria filtrados por `assignments.some.{type:TIME_RESPONSIBLE, userId}`) — se pasa igual a las 14 queries, sin cambios.
- **Sí se llama en login/inicio**: `DashboardPage.tsx` es la pantalla de aterrizaje tras autenticarse (`/`) y dispara `dashboardMetricsApiService.getMetrics()` al montar — por eso el journey de Legajos (que hace login y aterriza ahí antes de navegar a `/legajos`) captura este endpoint dentro de la acción "Login".

### 1.20-1.23 Tolerancia a cache/stale, cache backend/frontend existente, degradación parcial

- **Cache backend YA EXISTÍA**: `dashboard.cache.ts` — `createTtlCache` con TTL 30s (`DASHBOARD_METRICS_CACHE_MS`), clave `JSON.stringify({period, userId, role, companyId, sectorId})` — **ya scopeada correctamente por usuario/rol/scope**, confirmado leyendo el código antes de asumir que faltaba. No se agregó una cache nueva — se mantuvo la existente sin cambios de TTL ni de clave.
- **Cache frontend YA EXISTÍA**: `cachePolicies.dashboardMetrics` (familia `"dashboard"`, TTL 30s, `sensitive: true`, no persistida) + `dashboardMetricsApiService.getMetrics()` ya usa `cachedData` (dedupe in-flight + TTL, mismo mecanismo de 14D.5) — confirmado, sin cambios necesarios.
- **Por qué el cache no evitaba el 500**: el TTL de 30s no ayuda al **primer** llamado después de un período de inactividad (exactamente el caso de un login fresco) — ahí siempre es cache-miss y se paga el costo completo de las 15 queries concurrentes. El cache resuelve "no repetir el cálculo cada pocos segundos", no "la primera vez sea segura bajo concurrencia" — por eso la causa raíz seguía sin resolverse pese a la cache ya existente.
- **Degradación parcial**: evaluada y descartada (Opción F) — el pedido prioriza corregir la causa raíz antes que esconder errores parciales, y no había ningún campo de "métrica parcial" en el contrato actual que agregar sin cambiarlo. No implementada.

### 1.24-1.27 Logs de 14B.2, error exacto, pooler, sólo Neon o también local

- **Error exacto confirmado en el log real del backend** (no supuesto): `PrismaClientKnownRequestError`, código **`P1017`**, mensaje `"Server has closed the connection"` — visto contra **distintos modelos en distintas corridas** (`EmployeeDocument` en una, `Employee` en otra) durante 14D.7, y reconfirmado en el log de esta etapa antes de corregir nada. Este patrón (mismo código de error, modelo distinto cada vez) es la firma característica de contención de pool, no de un bug funcional de una query puntual.
- **Pooler**: `DATABASE_URL` apunta a Neon vía su pooler (`*-pooler.c-4.us-east-1.aws.neon.tech`), confirmado.
- **¿Sólo Neon o también local?**: no se pudo probar contra una base Postgres local en este entorno (no hay una instancia local configurada en este proyecto — Neon es la única base disponible, dev y staging comparten el mismo Neon). Documentado como limitación, no inventado.

### 1.28-1.30 Necesidad de todos los datos en el primer render, endpoint liviano+pesado, índices

- **Necesita todo en el primer render**: sí — `DashboardPage.tsx` pinta las 9 `StatCard` + gráficos de un solo golpe, no hay una versión "liviana primero" en la UI actual. Partir el contrato en 2 endpoints (Opción E) habría requerido cambiar el consumo del frontend — explícitamente desalentado por el pedido como primer paso si el endpoint actual se puede arreglar (y se pudo).
- **Índices**: no se diagnosticaron candidatos específicos en esta etapa (fuera del foco explícito — "sólo diagnosticar, no crear migraciones"). Ningún `EXPLAIN` corrido; si una query individual demuestra ser consistentemente lenta más allá de lo que explica la concurrencia, sería el primer paso de una futura etapa.

---

## 2. Tabla de flujo (Parte 1 del pedido)

| Métrica | Query/función | Modelo Prisma | Filtro | Paralela | Costo estimado | Necesaria en 1er render | Riesgo |
|---|---|---|---|---|---|---|---|
| total + active | `countTotalAndActive` (nueva, `groupBy`) | Employee | accessWhere | Sí (lote 1) | Bajo | Sí | Bajo |
| exits | `countExitsThisYear` | Employee | accessWhere + status + laborMovements.some | Sí (lote 1) | Bajo | Sí | Bajo |
| transported (count) | `countTransported` | Employee | activeWhere + transport | Sí (lote 1) | Bajo | Sí | Bajo |
| loadedHours | `sumLoadedHours` | TimeEntry (aggregate) | period + status + hourConcept | Sí (lote 1) | Bajo-medio | Sí | Bajo |
| headcountBySector/Company, averageAge/Tenure, upcomingBirthdays | `findActiveDashboardEmployees` | Employee (findMany, 3 relaciones) | activeWhere | Sí (lote 1) | **Alto** (el más pesado) | Sí | Medio — el más caro del batch |
| loadCoverage (numerador) | `countEmployeesWithEntries` | Employee | activeWhere + timeEntries.some | Sí (lote 2) | Bajo | Sí | Bajo |
| pendingLoads | `countEmployeesWithoutEntries` | Employee | activeWhere + timeEntries.none | Sí (lote 2) | Bajo | Sí | Bajo |
| reviewLoads | `countEmployeesInReview` | Employee | accessWhere + timeEntries.some(EN_REVISION) | Sí (lote 2) | Bajo | Sí | Bajo |
| absenceDays/absenceRate | `findPeriodAbsenceDateRanges` | Novelty (findMany) | accessWhere + kind + fechas | Sí (lote 2) | Bajo | Sí | Bajo |
| pendingNovelties | `countPendingNovelties` | Novelty | accessWhere + status | Sí (lote 2) | Bajo | Sí | Bajo |
| expiredDocuments | `countExpiredDocuments` | EmployeeDocument | accessWhere + status | Sí (lote 3) | Bajo | Sí | Bajo |
| expiringDocuments | `countExpiringDocuments` | EmployeeDocument | accessWhere + status | Sí (lote 3) | Bajo | Sí | Bajo |
| missingResponsible | `countMissingTimeResponsible` | Employee | activeWhere + assignments.none | Sí (lote 3) | Bajo | Sí | Bajo |
| transportByCity/transportRoutes | `findTransportedEmployees` | Employee (findMany, 2 relaciones) | activeWhere + transport | Sí (lote 3) | Medio | Sí | Bajo-medio |

---

## 3. Causa probable del 500 (root cause)

**Saturación/contención del pool de conexiones de Neon bajo fan-out concurrente sin límite**, no un bug funcional de ningún modelo puntual. Evidencia:

1. El error real observado (`P1017`, "Server has closed the connection") es un error de **transporte de conexión**, no de sintaxis/validación de query.
2. **Distintos modelos fallaron en distintas corridas** (`EmployeeDocument` una vez, `Employee` otra) — si fuera un bug de una query específica, siempre fallaría la misma.
3. El endpoint dispara **15 queries genuinamente concurrentes** (mismo instante, mismo `Promise.all`) contra un pool compartido con el resto de la aplicación — en el journey real, este momento coincide con el aterrizaje post-login, cuando el navegador también dispara `notifications-unread-count`, `audit`, y pronto después el listado de Legajos — es decir, el pico de concurrencia real contra Neon en ese instante es más alto que sólo las 15 de dashboard.
4. Nunca se reprodujo en un benchmark aislado de un solo proceso sin otra carga concurrente (medido en esta etapa, ver §6) — consistente con que la causa es contención bajo carga real, no un costo inherente de cada query individual.

---

## 4. Causa raíz de la lentitud (más allá del 500)

Incluso cuando no falla, el endpoint es lento en frío porque:
1. **Cache de 30s no ayuda al primer llamado** tras inactividad (ver §1.20-1.23) — todo login fresco paga el cálculo completo.
2. **15 (ahora 14) queries reales contra Neon**, cada una con latencia de red real (~150-900ms según carga del pooler) — aunque corran en paralelo, el tiempo total está acotado por la más lenta del lote, y bajo contención esa latencia individual sube.
3. `findActiveDashboardEmployees` es la query más pesada (trae **todos** los empleados activos del scope, con 3 relaciones) — necesaria para 5 métricas distintas del payload (breakdown por sector/empresa, edad/antigüedad promedio, cumpleaños), no se pudo aligerar sin cambiar qué calcula el endpoint.

---

## 5. Solución elegida

**Combinación de Opción A (concurrencia limitada) + Opción B (agrupar `countTotal`+`countActive`) + confirmación de que Opciones C/D (cache) ya estaban bien implementadas.**

### 5.1 Opción A — Concurrencia limitada (prioridad 1 y 2 del pedido)

Nuevo helper genérico y sin dependencias externas, `backend/src/shared/prisma/runInBatches.ts` — ejecuta un array de tareas async en lotes de tamaño máximo configurable, preservando el orden de resultados (tipado con tupla variádica, igual que `Promise.all`, sin perder tipado fuerte en el caller). `calculateMetrics` pasó de 1 `Promise.all` de 15 a `runInBatches(..., 5)` de 14 en 3 lotes (5+5+4).

**Por qué 5 (no 3, no ilimitado)**: el pedido sugiere 3-5. Se eligió el extremo superior del rango porque:
- Reduce la concurrencia real contra el pool de 15 a 5 (**-67%**), suficiente margen para no saturar bajo el nivel de contención observado (journeys reales, sin necesitar ir tan agresivo como 3).
- Menos lotes = menos rondas secuenciales = menor impacto en tiempo total que un batch de 3 (que necesitaría 5 rondas en vez de 3).
- Es un valor fácil de ajustar (una constante, `DASHBOARD_METRICS_BATCH_SIZE`) si la evidencia de una futura etapa mostrara que hace falta bajarlo.

Los 2 `findMany` más pesados (`findActiveDashboardEmployees`, `findTransportedEmployees`) se distribuyeron en lotes **distintos** (1 y 3) para no acumular el costo más alto del batch completo en una sola ronda.

### 5.2 Opción B — Agrupar `countTotal`+`countActive` (prioridad 3)

`dashboardRepository.countTotalAndActive` (nuevo) reemplaza los 2 `Employee.count` separados por 1 `prisma.employee.groupBy({by: ["status"], where: accessWhere, _count: {_all: true}})` — mismo patrón exacto ya usado por `employeesRepository.summary()`. `total` = suma de todos los grupos, `active` = grupo `ACTIVO` (0 si no existe ningún activo en el scope — caso borde cubierto con test, ver §9). Reduce el fan-out de 15 a 14.

No se intentó agrupar las otras 6 `count` (ver §1.10-1.15) — habría requerido SQL crudo con agregación condicional, explícitamente desalentado sin necesidad justificada.

### 5.3 Opciones C/D — Cache — confirmadas correctas, sin cambios

Tanto el cache backend (`dashboard.cache.ts`, TTL 30s, clave scopeada por usuario/rol/período/companyId/sectorId) como el frontend (`cachePolicies.dashboardMetrics`, TTL 30s, dedupe in-flight vía `cachedData`) ya cumplían exactamente lo que el pedido pide de una implementación de cache correcta — **no se tocó ninguno de los dos**. El problema nunca fue la ausencia de cache, sino la seguridad del primer cálculo (cache-miss) bajo concurrencia real.

### 5.4 Mejora de logging (tarea del pedido, no una de las 7 opciones)

`withQueryErrorLog` (local a `dashboard.service.ts`) envuelve cada una de las 14 tareas — si una falla, loguea `{level:"warn", event:"dashboard_metrics_query_error", query, period, role, message}` (sin `userId`/email/nombre — mismo criterio que `performanceLogger.ts`) y **re-lanza** el error sin modificarlo. Antes, identificar qué query específica había fallado requería leer el stack completo de Prisma en el log; ahora queda identificado por su nombre en una sola línea JSON buscable. Nunca se atrapa el error para esconderlo — sigue propagándose y el endpoint sigue devolviendo 500 si de verdad falla (ver test dedicado, §9).

### 5.5 Opciones descartadas

- **Opción E (endpoint liviano + pesado)**: descartada — habría exigido cambiar el contrato/consumo del frontend, y el problema se resolvió sin necesidad de ese cambio mayor.
- **Opción F (degradación parcial)**: descartada — no hay campo de "parcial" en el contrato actual, y el pedido prioriza corregir la causa raíz antes que esconder fallos parciales.
- **Opción G (índices)**: no se diagnosticaron candidatos concretos en esta etapa — ninguna query individual mostró ser lenta más allá de lo explicado por la concurrencia. Queda como candidato abierto si una futura medición aislada (sin contención) muestra una query consistentemente lenta por sí sola.

---

## 6. Medición — antes/después con números reales

### 6.1 Benchmark aislado (repositorio directo, sin otra carga concurrente) — hallazgo honesto

Medido con un script temporal (`tmp-14e1-dashboard-bench.ts`, eliminado al terminar) llamando `dashboardService.metrics()` directamente, 3 veces con cache limpiado en cada corrida, **antes** (`git stash`, código sin batching) y **después** (código de esta etapa):

| Estado | min | avg | max |
|---|---|---|---|
| Antes (15 queries, 1 Promise.all) | 372ms | 1321ms | 3210ms |
| Después (14 queries, 3 lotes de ≤5) | 1131ms | 2074ms | 3945ms |

**El batching es más lento en un proceso aislado sin contención real** — esto es exactamente el trade-off que el pedido anticipó explícitamente ("puede aumentar un poco tiempo total... pero evita 500"). Se documenta sin esconderlo: en un entorno sin presión real sobre el pool, 15-en-paralelo gana en velocidad pura. El beneficio de esta etapa no es velocidad en aislamiento — es **seguridad bajo concurrencia real**, medida en §6.2.

### 6.2 Journey real end-to-end (`npm run perf:journey:employees`) — la medición que importa para esta etapa

**4 corridas consecutivas** (dev server reiniciado en frío antes de la primera, para garantizar código + Prisma Client consistentes):

| Corrida | `GET /api/dashboard/metrics` status | Duración | Acción "Login" — network idle |
|---|---|---|---|
| Antes (commit `c28deda`, 14D.7) | **500** | 6581ms | 8613ms (Crítico) |
| Después — corrida 1 | 200 | 4053ms | (no capturada individualmente) |
| Después — corrida 2 | 200 | 1268ms | 3317ms (Crítico) |
| Después — corrida 3 | 200 | 1630ms | 4665ms (Crítico) |
| Después — corrida 4 (final, en los archivos entregados) | 200 | 3901ms | (ver reporte) |

**Tabla obligatoria — Métrica | Antes | Después | Mejora | Comentario**:

| Métrica | Antes | Después | Mejora | Comentario |
|---|---|---|---|---|
| Status code de `dashboard/metrics` | 500 (intermitente, confirmado en `c28deda`) | **200 en 4/4 corridas consecutivas** | Objetivo cumplido (Prioridad 1) | Ideal del pedido era 2 corridas sin 500 — se corrieron 4 por la intermitencia histórica del bug. |
| Duración de `dashboard/metrics` | 6581ms (corrida con 500) / 1869ms (corrida con 200, log de 14D.5) | 1268-4053ms (rango de 4 corridas, min-max) | Variable, con mejora clara en el peor caso (6581→4053 máx) | Ruido real de Neon documentado, no una mejora puntual inventada. |
| Errores HTTP del recorrido completo (56 acciones) | 1 (`dashboard/metrics` 500) | **0** en las 4 corridas | -100% | Confirmado en el resumen ejecutivo de cada corrida. |
| Errores de consola | 1 | **0** en las 4 corridas | -100% | Mismo origen que el HTTP error. |
| "Login" — network idle | 8613ms (Crítico) | 3317-4665ms (Crítico, 2 corridas capturadas) | **~46-61%** | Sigue en rango Crítico (>3000ms) — el aterrizaje agrega varios requests de ~1000-1400ms cada uno (documents, novelties, block-history, la propia dashboard/metrics), ninguno dominante por sí solo. Ver §7 "qué quedó pendiente". |
| `dashboard/metrics` en Top 10 requests del journey | 1er lugar (500, 6581ms) | Sigue apareciendo (1er-3er lugar según la corrida) pero **siempre 200**, nunca por encima de ~4050ms | Mejora real de fiabilidad, mejora parcial de velocidad | Ya no es un error — sigue siendo de los más lentos, pero exitoso. |
| Acciones en rango Crítico del recorrido completo | 1 (Login, con 500 adentro) | 1 (Login, sin ningún 500 adentro) | Se mantiene en Crítico por idle agregado, no por error | Ver comentario de la fila de arriba. |
| "Entrar a /legajos" — network idle | No medido específicamente antes (no era el foco) | 1275-1501ms (Medio, 2 corridas capturadas) | No comparable directamente | No hay baseline específico de esta acción en los reportes previos a 14E.1 — Legajos no era el módulo bajo prueba en la comparación de dashboard. |
| `queryCount`/`queryTimeMs` (log del backend, request real) | 15-16 (14D.7: 15 dashboard + 0-1 de auth cacheado), `queryTimeMs` 10814-30649ms | 14-15 (14E.1: 14 dashboard + 0-1 de auth cacheado), `queryTimeMs` 5460-10403ms | `queryTimeMs` bajó a la mitad o menos en las corridas comparables | El `+1` ocasional es la propia query de `requireAuth` (`authService.getCurrentUser`, cache de 60s aparte, no tocada esta etapa) — no es un query de `calculateMetrics`. Explicado en detalle en §6.3. |

### 6.3 Nota sobre `queryCount` variable (15 vs 14) — explicado, no un error

El log estructurado (`performanceLogger.ts`) cuenta **todas** las queries Prisma de la request completa, no sólo las de `calculateMetrics` — incluye la query de `requireAuth` (`authService.getCurrentUser`, que tiene su propio cache TTL de 60s, no tocado en esta etapa). Cuando ese cache está frío (login reciente, aún no cacheado), se ve `queryCount:15` (14 de dashboard + 1 de auth); cuando está tibio, se ve `queryCount:14` (sólo las de dashboard). Confirmado leyendo `auth.service.ts:getCurrentUser` — no es una inconsistencia de esta etapa.

### 6.4 Concurrencia máxima estimada

- **Antes**: 15 queries Prisma disparadas en el mismo instante (1 `Promise.all`).
- **Después**: máximo 5 en simultáneo, verificado con test dedicado que mide `inFlight` real durante la ejecución (`dashboard.service.test.ts`, ver §9) — no es una estimación, es una medición directa del propio test.

---

## 7. Correctness / shape (Parte 7 del pedido)

- **Nombres de campos, tipos, arrays, nulls**: sin cambios — el `return` de `calculateMetrics` es exactamente el mismo objeto literal que antes (mismas claves, mismo orden de construcción). Verificado además con `dashboard.service.test.ts` nuevo (16 tests, ver §9) que fija el shape y los valores esperados por campo.
- **`total`/`active`/`inactive`**: antes se leían de 2 `count()` directos (siempre `number`, nunca ausentes); ahora se derivan de un `groupBy` que **puede no incluir un grupo** si no hay filas de ese `status` en el scope — cubierto explícitamente con 2 tests de caso borde (ningún grupo ACTIVO; ningún grupo en absoluto) que confirman `0`, nunca `undefined`/`NaN`.
- **Valores dependientes de fecha/datos reales**: `absenceDays`, `averageAge`, `averageTenure`, `headcountBySector/Company`, `upcomingBirthdays` dependen de los datos reales de staging (Neon) — no se compararon valores exactos antes/después contra la base real (cambia con el tiempo), se comparó el **shape** y la **lógica de cálculo** (sin tocar ninguna fórmula) más el comportamiento con datos mockeados controlados en los tests nuevos.
- **Permisos**: `employeeAccessWhere(user)` se sigue llamando exactamente igual, con el mismo resultado, pasado sin transformar a las 14 queries — confirmado con tests que verifican que el `where` real de RRHH/Supervisión llega intacto a las queries (ver §9).

---

## 8. RBAC / PII

- **RBAC intacto**: `requireAnyRole([rrhh, supervision, cargaHoraria])` en la ruta no se tocó. `employeeAccessWhere(user)` no se tocó. Confirmado con tests que verifican el `where` real por rol llegando a las queries batcheadas.
- **PII**: no se agregó ningún campo nuevo a la respuesta ni a ningún log. El nuevo log de error (`dashboard_metrics_query_error`) sólo incluye `query` (nombre de la operación Prisma, ej. `"Employee.count(exitsThisYear)"`), `period`, `role` y `message` del error — nunca `userId`, email, nombre ni DNI. Confirmado con test dedicado que verifica que el string logueado no contiene el `userId` de prueba.

---

## 9. Tests agregados

**`backend/src/shared/prisma/runInBatches.test.ts`** (nuevo, 11 tests): orden de resultados preservado independientemente del orden de resolución; nunca más de `batchSize` tareas en simultáneo (medido con contador real de `inFlight`); un lote no arranca hasta que el anterior termina; un error se propaga (no se traga); `batchSize >= cantidad de tareas` se comporta igual que `Promise.all`; array vacío no ejecuta nada; **`batchSize` inválido (0, negativo, no entero) lanza un error explícito en vez de colgarse en un loop infinito** — hallazgo de la revisión previa al commit: la implementación original no protegía `batchSize <= 0` (`start += batchSize` nunca hubiera avanzado), corregido con una guarda al inicio de la función antes de commitear.

**`backend/src/modules/dashboard/dashboard.repository.test.ts`** (+2 tests): `countTotalAndActive` arma el `groupBy` correcto respetando `accessWhere` (incluido el caso vacío de RRHH).

**`backend/src/modules/dashboard/dashboard.service.test.ts`** (nuevo — el módulo **no tenía ningún test de servicio** antes de esta etapa, 16 tests):
- Llama exactamente a las 14 funciones del repositorio (no 15) — cubre que `countTotal`/`countActive` quedaron colapsadas.
- Nunca dispara más de 5 queries del repositorio en simultáneo (medido con `inFlight` real, no un supuesto).
- `total`/`active`/`inactive` correctos vía `groupBy`, incluidos los 2 casos borde (sin grupo ACTIVO; sin ningún grupo).
- Cada métrica independiente llega al campo correcto de la respuesta (valores distintos y reconocibles por métrica, para detectar si alguna se mezclara con otra).
- Cache: cache-miss en la 1ª llamada, cache-hit en la 2ª con el mismo usuario+rol+período; usuario distinto, rol distinto, período distinto y `companyId`/`sectorId` distinto **no** comparten cache (5 tests, uno por dimensión de la clave).
- RBAC: el `where` real de RRHH (vacío) y de Supervisión (scopeado) llega igual a las queries.
- Un error real se propaga (no cachea ceros falsos), no queda cacheado (el siguiente intento vuelve a pegarle al repositorio), y se loguea con contexto sin PII.

Total: **1142/1142 tests backend** (1113 previos + 29 nuevos), 74 archivos.

---

## 10. Riesgos

- **Lotes de 5 son un valor elegido, no derivado de un límite exacto medido del pool de Neon** (no se pudo obtener el límite exacto configurado del lado de Neon en este entorno) — si la contención real resultara ser peor de lo observado en estas 4 corridas, podría necesitar bajarse a 3-4. Es un cambio de una constante (`DASHBOARD_METRICS_BATCH_SIZE`), documentado explícitamente para facilitar el ajuste.
- **El batching añade latencia en el caso sin contención** (§6.1) — un entorno con Neon muy descargado verá el endpoint un poco más lento que antes en el mejor caso. Trade-off deliberado y documentado (seguridad > velocidad pura), consistente con la prioridad explícita del pedido.
- **`runInBatches` es nuevo y sin otro consumidor todavía** — sólo lo usa `dashboard.service.ts`. Si se reutiliza en otro módulo con un patrón de tareas distinto (por ejemplo, tareas que si dependen entre sí), hay que confirmar que la independencia entre tareas siga siendo cierta ahí también — el helper asume tareas independientes, no lo valida.
- **`queryCount`/`queryTimeMs` en los logs incluyen la query de auth** (§6.3) — quien lea el log sin este contexto podría malinterpretar por qué a veces son 14 y a veces 15. Documentado acá y en el propio comentario del código si hiciera falta ahondar más en una etapa futura de logging.
- **El batch de `findActiveDashboardEmployees` (lote 1) sigue siendo la query más pesada individual** — no se optimizó su `select` (ya era liviano) ni se paginó (trae todos los activos del scope) porque 5 métricas distintas del payload dependen de tenerlos todos en memoria de una vez. Si el headcount de la empresa creciera sustancialmente, esta sería la primera query a revisar.

---

## 11. Rollback

1. Revertir `dashboard.service.ts` y `dashboard.repository.ts` a su estado anterior (o `git revert` del commit de esta etapa).
2. Eliminar `backend/src/shared/prisma/runInBatches.ts` (y su test) si ningún otro módulo llegó a adoptarlo mientras tanto.
3. Revertir los tests nuevos/modificados de `dashboard.repository.test.ts`.
4. Eliminar `dashboard.service.test.ts` (o dejarlo si se decide mantener cobertura pese al rollback del código — evaluar en el momento).
5. Sin migración de base de datos involucrada — mismo criterio de rollback simple ya aplicado en 14D.6/14D.7.

---

## 12. Qué NO se tocó

Legajos, Carga Horaria, Fichador, Turnos, Horas Especiales, Conceptos Horarios, Puestos (no se encontró ninguna dependencia directa del dashboard hacia Puestos), schema/migraciones, contrato público de `GET /dashboard/metrics` (mismo shape de respuesta, mismos status codes), RBAC (`requireAnyRole`, `employeeAccessWhere`), `dashboard.cache.ts` (backend) y `cachePolicies.dashboardMetrics`/`dashboardMetricsApiService.ts` (frontend) — ambos ya correctos, confirmados sin necesidad de cambio, `DashboardPage.tsx` (ya maneja error/loading correctamente, sin blanquear pantalla, con retry — confirmado sin necesidad de cambio), `relationJoins` (no se tocó ni se extendió su uso más allá de lo ya aplicado en 14D.7 — ninguna query de dashboard tiene la cadena de relaciones profunda que justificaría evaluarlo).
