# Etapa 14C.2 — Optimización de performance en Carga Horaria / `time-entries/period-employees`

> **Nota (2026-09-03):** el alcance de "14C.2" quedó ampliado por la Etapa
> 14C.2 ampliada, que agrega Legajos (carga/detalle/historial/guardado) y
> guardado manual de Carga Horaria. Ver
> `docs/decisions/TIME_ENTRIES_AND_EMPLOYEES_PERFORMANCE_14C2.md` para el
> alcance combinado — este documento se conserva tal cual (diagnóstico y
> cambios de `period-employees`/`summary`, ya implementados) como referencia
> histórica de esa parte.

Fecha: 2026-09-03
Estado: diagnóstico completo, implementado, validado, pendiente de aprobación para commitear
Alcance: backend (`backend/src/modules/time-entries/timeEntries.repository.ts`) únicamente. Sin cambios de schema, sin migraciones, sin cambios de contrato de API, sin cambios de cálculo de horas reales/liquidables, sin cambios de frontend (justificado en §1.2/§4.B).

---

## 1. Diagnóstico (Parte 1 del pedido, con evidencia real archivo:línea)

### 1.1 Componentes frontend en `/horas`

`frontend/src/pages/HoursPage.tsx`. Al montar, 4 efectos independientes (confirmados por lectura completa, sin solapamiento):
- **A) Grilla principal** (`!pendingOnly`, líneas 310-336): `timeEntryApiService.getPeriodEmployees({ period, search, costCenterId, page, take })` → `GET /time-entries/period-employees`.
- **B) Bandeja de revisión** (`pendingOnly`, líneas 341-374): `listByEmployee`/`list` → otro endpoint, fuera de esta etapa.
- **C) Resumen + pendientes** (línea ~379 en adelante): `timeEntryApiService.getSummary(period)` → `GET /time-entries/summary` (siempre) + `pendingApiService.getAll(...)` (sólo `pendingOnly`).
- **D) Catálogo de centros de costo**: `orgStructureApiService.getCatalog()`, cacheado 10min, deps `[]`.

### 1.2 Endpoints disparados en `/horas` (modo grilla, el caso reportado crítico)

`GET /time-entries/period-employees`, `GET /time-entries/summary`, `GET /org-structure` (cacheado, no vuelve a pedirse en navegaciones dentro del TTL).

### 1.3 ¿Requests duplicadas reales o sólo StrictMode?

**Sólo StrictMode.** Los 3 efectos relevantes (`A`, `C`, `D`) tienen dependencias correctas y guards de "no blanquear si ya hay datos" (línea 314: `if (!periodRows.length) setGridLoading(true)`, patrón ya validado desde 14B.1). No se encontró ningún efecto con dependencia faltante ni doble llamada real dentro del componente. Mismo criterio ya aplicado y confirmado en la Etapa 14C.1 para `EmployeesPage`/`EmployeeDetailPage`: `React.StrictMode` (`frontend/src/main.tsx:15`) duplica el montaje de efectos sólo en desarrollo, nunca en build de producción — no se trata como bug ni se agrega deduplicación artificial.

### 1.4-1.5 Qué endpoints disparan `period-employees` y `summary`

`timeEntriesController.periodEmployees` (`timeEntries.controller.ts:86-93`) → `timeEntriesService.periodEmployees` → `timeEntriesRepository.findPeriodEmployees` (`timeEntries.repository.ts:613-849`).
`timeEntriesController.summary` (`timeEntries.controller.ts:77-84`) → `timeEntriesService.summary` → `timeEntriesRepository.summary` (`timeEntries.repository.ts:489-552`).
Ambos cacheados backend 20s (`timeEntries.cache.ts:5-6`) por usuario+rol+URL.

### 1.6-1.7 Qué datos trae `period-employees` / ¿trae más de lo necesario?

Por página (`take`, default acotado por schema): lista de empleados (`periodEmployeeSelect`, `timeEntries.repository.ts:90-103`) + para esos empleados (batch, nunca por-fila): `TimeEntry` del período, `HourConceptBreakdown` del período, `Novelty` vigente en el rango.

**`periodEmployeeSelect` traía más de lo necesario**: incluía `sector` y `position` (relaciones to-one) y los escalares `dni`/`cuil`. Confirmado por lectura completa de `HoursPage.tsx` (la grilla real, líneas ~1092-1115): sólo renderiza `displayLegajo(employee)`, `fullName(employee)`, `employee.company` (requiere `companies`, se mantiene), `employee.costCenter` (se mantiene) y `employee.timeResponsibles`/`employee.timeResponsible` — **este último ya viene vacío hoy** (el select nunca incluyó `assignments`, de donde sale ese campo vía el mapper compartido) — comportamiento preexistente, no introducido ni corregido en esta etapa (fuera de alcance: no es un problema de performance, es una posible brecha funcional preexistente de otra etapa). `sector`/`position`/`dni`/`cuil` no se usan en ningún lado de esta pantalla.

### 1.8 ¿Período demasiado amplio por defecto?

No. `period = searchParams.get("period") || currentMonthPeriod()` (`HoursPage.tsx:231`) — un único mes calendario por defecto, igual que el resto del proyecto.

### 1.9-1.10 Paginación / filtros obligatorios

Paginación real (`skip`/`take`, `timeEntries.repository.ts:615,625`), filtros (`search`, `costCenterId`) resueltos en `buildPeriodEmployeeWhere` (DB), no en memoria. Sin fetch-all. Sin hallazgos nuevos — ya estaba correcto desde la Etapa 9F/11A.

### 1.11 ¿Totales calculados en memoria después de traer demasiados datos?

Los totales se calculan en memoria (`for (let day=1; day<=dayCount; day++)`, líneas 812-830) pero **sobre datos ya acotados a una sola página de empleados** (`take` de la query, no todo el período/toda la base) — es agregación en memoria de un volumen pequeño y predecible (≤ `take` empleados × ≤31 días), no un problema de performance. El costo real no está en este loop (CPU, microsegundos) sino en las consultas de red que lo alimentan (ver §1.14).

### 1.12-1.13 N+1 / loops `employee × day × concept × specialHour`

**No hay N+1 ni loops de consulta por empleado/día.** Confirmado leyendo la función completa: las 3 consultas de detalle (`TimeEntry`, `HourConceptBreakdown`, `Novelty`) ya están *batcheadas* con `employeeId: { in: employeeIds }` — una sola consulta por tabla para **todos** los empleados de la página, no una por empleado. El loop `day × concept × specialHour` (líneas 693-769) es 100% en memoria sobre esos 3 arrays ya traídos — no dispara ninguna query adicional. Esto ya cumple exactamente la regla de diseño pedida ("preferir consultas agregadas o batch queries") desde antes de esta etapa.

### 1.14 Consultas secuenciales que pueden paralelizarse — **causa raíz real**

Las 5 consultas (`employee.findMany`, `employee.count`, `timeEntry.findMany`, `hourConceptBreakdown.findMany`, `novelty.findMany`) ya estaban agrupadas en dos `Promise.all` (líneas 619, 631) — a primera vista, ya "paralelas". **Pero las 5 corren dentro de un único `prisma.$transaction(async (tx) => {...}, { timeout: 15_000 })`** (línea 618, cierra en 848) — una transacción interactiva usa **una sola conexión** a la base durante toda su duración. Un `Promise.all` de queries que comparten la misma conexión (`tx.a()`, `tx.b()`) no logra concurrencia real a nivel de red — el driver serializa los round-trips sobre esa única conexión, aunque las Promises se hayan creado "en paralelo" desde JavaScript. Esto es distinto de un `Promise.all` sobre el cliente `prisma` global (sin `tx`), que sí saca conexiones del pool y permite ejecución concurrente real — el mismo patrón ya usado y validado en `dashboard.service.ts` y aplicado en la Etapa 14C.1 (`employees.summary()`).

Contado: 5 queries efectivamente secuenciales × ~500-900ms/round-trip (Neon, ya documentado desde la Etapa 13F) ≈ 2500-4500ms, más variabilidad real de staging — consistente con los `6447ms` medidos en el journey real de 14B.3/14C.1.

`summary()` (`timeEntries.repository.ts:489-540`) tiene el mismo patrón: 5 queries independientes (3 counts + 1 groupBy + 1 aggregate) en `prisma.$transaction([...])` (forma-array, mismo problema de fondo: ejecución secuencial dentro de una única transacción/conexión) — coincide con los `2250ms` medidos.

### 1.15-1.16 Breakdown de conceptos / cálculo de especial para días no mostrados

No aplica ningún cálculo para días fuera del período pedido — `periodRange(query.period)` acota el mes exacto, y el loop de días (`dayCount`) sólo cubre ese mes. No se trae ni calcula nada de meses adyacentes.

### 1.17 ¿Se resuelve info de empleado pesada cuando alcanza con fila liviana?

Sí — ver §1.7 (`sector`/`position` no usados, recortados en esta etapa).

### 1.18 Includes/selects grandes innecesarios

Sólo los ya identificados en §1.7 (`sector`, `position` en `periodEmployeeSelect`). Los `select` de `TimeEntry`/`HourConceptBreakdown`/`Novelty` ya son livianos y puntuales (campos específicos, no `include` amplios) — sin hallazgos adicionales.

### 1.19 ¿Filtros de permisos/RBAC en DB o en memoria?

En DB, confirmado: `employeeAccessWhere(user)` se pasa directo al `where` de Prisma en las 5 consultas (`buildPeriodEmployeeWhere`, `timeEntry.findMany({where:{...employeeId:{in:employeeIds}}})` — los `employeeIds` ya vienen filtrados por acceso desde el paso anterior). La única redacción en memoria es `redactPiiForRole` (`timeEntries.service.ts:651`), que oculta campos de la respuesta ya autorizada — no es un filtro de acceso, es enmascarado de PII para Nivel 3, sin cambios en esta etapa.

### 1.20 ¿Índices actuales alcanzan?

Sí, confirmado contra `schema.prisma` antes de decidir no crear ninguna migración:
- `TimeEntry`: filtra por `period`+`employeeId:{in}` → cubierto por `@@index([period, employeeId])`.
- `HourConceptBreakdown`: filtra por `period`+`employeeId:{in}`+`status` → cubierto razonablemente por `@@index([period, status])` (el `IN` de `employeeId` se resuelve sobre el resultado ya acotado por período+status).
- `Novelty`: filtra por `employeeId:{in}`+`fromDate`+`status` → cubierto por `@@index([employeeId, status, fromDate])`.
- `summary()`: mismos índices de `TimeEntry` (`[period,status]`, `[period,status,employeeId]`) cubren los `count`/`groupBy`/`aggregate` por `period`+`status`.

**No se encontró ningún índice faltante que justifique una migración** — cumple la condición explícita del pedido.

### 1.21 ¿Datos cacheables con TTL corto?

Ya lo están: ambos endpoints cacheados 20s backend (`timeEntries.cache.ts`), coherente con la categoría "datos operativos" de `docs/PERFORMANCE_STANDARDS.md` §2.C. No se identificó ningún dato adicional cacheable con seguridad — el catálogo de centros de costo (única config relativamente estable en este flujo) ya está cacheado 10min vía `org-structure`.

### 1.22 ¿Qué parte del tiempo es DB, CPU, payload o render?

Prácticamente todo es espera de red hacia Neon — igual conclusión que 14C.1: la Etapa 14B.3 midió `headerVisibleMs` bajo (shell de React renderiza rápido) contra `networkIdleMs` de ~7014ms — la diferencia es 100% espera de las 5 queries secuenciales dentro de la transacción, no CPU ni payload (el payload de una página de ≤25 filas es chico) ni render (React ya pinta rápido, confirmado en 14A/14B.3).

### 1.23 Riesgos de tocar cada parte

- **`periodEmployeeSelect` (recorte)**: bajo. Mismo análisis y mismo tipo de campos que en la Etapa 14C.1 (`employeeListSelect`) — ningún campo removido se renderiza ni se usa en cálculo alguno de esta pantalla.
- **Sacar el `$transaction` de `findPeriodEmployees`**: medio-bajo. Es una operación 100% de lectura (sin ningún `create`/`update`/`delete`) — no hay riesgo de atomicidad de escritura. El único riesgo real es una consistencia de snapshot ligeramente más débil entre "qué empleados devuelve la página" y "qué entradas/breakdowns/novedades se agregan" si, en el instante exacto entre queries, alguien aprueba/edita una entrada — riesgo ya aceptado con el mismo criterio en 14C.1 (`employees.summary()`) y en `dashboard.service.ts` desde antes. Mitigado además porque el endpoint ya está cacheado 20s (una inconsistencia de un instante se autocorrige en la próxima lectura/refresh).
- **`summary()` (mismo cambio)**: mismo riesgo, mismo criterio — 5 conteos/agregados independientes para tarjetas de resumen, no una operación transaccional de negocio.

---

## 2. Endpoints involucrados

| Endpoint | Antes (medido, 14B.3/14C.1) | Causa principal | Cambio aplicado |
|---|---|---|---|
| `GET /time-entries/period-employees` | 6447ms | 5 queries batcheadas correctamente, pero encerradas en `prisma.$transaction(async tx=>{})` (una sola conexión, sin concurrencia real) | Se saca el `$transaction`; las mismas 5 queries (sin cambiar su forma/filtros) pasan a usar el cliente `prisma` global en 2 `Promise.all` reales (empleados+total, luego detalle) |
| `GET /time-entries/summary` | 2250ms | Mismo patrón: 5 queries independientes en `prisma.$transaction([...])` (forma-array, misma conexión) | `$transaction([...])` → `Promise.all([...])`, mismo patrón ya aplicado en `employees.summary()` (Etapa 14C.1) |
| Pantalla Carga Horaria | `networkIdleMs` ≈ 7014ms | Consecuencia directa de lo anterior | Sin cambios de frontend — se beneficia automáticamente |

---

## 3. Plan de validación

1. `npx prisma validate` — cero cambios de schema.
2. Backend: `typecheck`, `test` (actualizar tests de `timeEntries.repository.test.ts` que mockean `prisma.$transaction` para estas dos funciones), `build`.
3. Frontend: sin cambios de código — se corre igual `typecheck:e2e`, `test`, `build` para confirmar que el contrato no cambió desde su perspectiva.
4. `npm run perf:journey` contra el entorno local real — comparar contra el reporte ya existente (post-14C.1) como baseline.
5. `git diff --check`.

Resultados reales: ver §6 más abajo.

---

## 4. Cambios aplicados (Parte 4 del pedido)

### 4.A Backend

1. **`periodEmployeeSelect`** (`timeEntries.repository.ts`) — recortado: se sacaron `sector`, `position` (relaciones to-one no usadas por la grilla) y `dni`/`cuil` (escalares no usados). Se mantuvieron `costCenter` y `companies` (ambos se muestran/alimentan `employee.company` vía el mapper compartido).
2. **`findPeriodEmployees`** — se sacó el `prisma.$transaction(async (tx) => {...}, { timeout: 15_000 })` que envolvía las 5 queries. Las mismas 5 queries, con exactamente los mismos `where`/`select`/`take`, ahora corren sobre el cliente `prisma` global en los mismos 2 `Promise.all` que ya existían — sin ese cambio, esos `Promise.all` no lograban concurrencia real porque `tx.*` comparte una única conexión.
3. **`summary()`** — mismo cambio de patrón que en `employees.summary()` (Etapa 14C.1): `prisma.$transaction([...])` → `Promise.all([...])`.
4. **No se tocó**: ningún cálculo de horas reales/liquidables/Horas Especiales/Conceptos Horarios — el loop de agregación en memoria (líneas ~693-845 del archivo) es exactamente el mismo código, byte por byte, sólo movido fuera del callback de la transacción. Ningún `where`/`select`/`take`/`orderBy` de las 5 queries cambió — se verificó con tests que el shape de cada llamada es idéntico al de antes (§5).

### 4.B Frontend

**Ningún cambio.** `HoursPage.tsx` ya seguía las reglas de diseño pedidas (guard de no-blanqueo desde 14B.1, período default de un mes, filtros server-side, sin duplicados reales) — confirmado por lectura completa antes de decidir no tocar nada. Las "duplicaciones" del journey (`/workforce/notifications-unread-count` dos veces) son `React.StrictMode`, mismo criterio que 14C.1.

### 4.C Documentación

Este documento. Antes/después real en §6. Qué quedó fuera en §7.

---

## 5. Tests agregados/modificados (Parte 7 del pedido)

Todos en `backend/src/modules/time-entries/timeEntries.repository.test.ts` (+7 tests nuevos; 104/104 en el archivo tras adaptar 37 referencias de `mockedPrisma.__tx.*` a `mockedPrisma.*` en los 16 tests preexistentes de `findPeriodEmployees`, que seguían mockeando el `tx` que ya no se usa):

1. **Select liviano**: confirma que `employee.findMany` para la grilla pide exactamente `id/legajo/legajoFinnegans/firstName/lastName/status/costCenter/companies`, sin `sector`/`position`/`dni`/`cuil` — cubre el ítem 1 del pedido.
2. **Permisos**: confirma que `accessWhere` se sigue combinando en el `where.AND[0]` tanto de `findMany` como de `count` — cubre el ítem 2.
3. **Paginación/filtros/período**: confirma `skip`/`take` correctos y que `TimeEntry`/`HourConceptBreakdown` siguen acotados exactamente al `period` pedido — cubre el ítem 3.
4. **Sin `$transaction`**: confirma que `findPeriodEmployees` ya no llama a `prisma.$transaction` en absoluto, y que las 5 queries se disparan como llamadas directas al cliente global — cubre el ítem 9 (protección contra reintroducir el patrón secuencial).
5. **Guard de página vacía**: confirma que si la página de empleados viene vacía, las 3 consultas de detalle nunca se disparan (ya existía este guard, ahora protegido explícitamente contra una regresión al restructurar).
6. **`summary()` usa `Promise.all`, no `$transaction`** + **mismo cálculo**: dos tests nuevos, mismo patrón que 14C.1.

**Los ítems 4, 5, 6, 7 del pedido** ("mantiene reglas de hora normal", "mantiene breakdown de conceptos adicionales", "mantiene cálculo de horas especiales/liquidables", "no infla total real") **ya tenían cobertura exhaustiva preexistente** (16 tests de las Etapas 6M/11A/11A.1 — casos A-G de Horas Especiales, conflicto de prioridad, breakdown huérfano, etc.) que se preservó intacta, sólo adaptando el mock target de `tx` a `prisma` sin tocar ninguna aserción de negocio. Correr esta suite completa (verde, 104/104) es en sí mismo la prueba de que el refactor no cambió ningún resultado de cálculo.

**Ítem 10** ("si se modifica frontend, testear doble fetch/loading/error/empty"): no aplica — no se tocó frontend (§4.B).

---

## 6. Comparación de performance — antes/después (Parte 6 del pedido)

Antes: reporte real post-14C.1 (`docs/performance/PERFORMANCE_JOURNEY_14B3.md`). Después: `npm run perf:journey` corrido de nuevo, mismo entorno local, inmediatamente después de aplicar estos cambios.

| Endpoint / pantalla | Antes | Después | Mejora estimada | Comentario |
|---|---|---|---|---|
| `GET /api/time-entries/period-employees` | 6447ms | 4138ms | ~36% | Sigue en "Crítico" (>3000ms), pero es ahora el más bajo de ese grupo. El `findFirst`/`findMany` del núcleo sigue pagando varios round-trips reales (empleados+count, luego 3 detalle) — sin `relationJoins` (fuera de alcance), no se puede colapsar más sin cambiar filtros/datos. |
| `GET /api/time-entries/summary` | 2250ms | 616ms | ~73% | Pasó de "Alto" a "Medio" — la mejora más grande de esta etapa, consistente con eran 5 queries independientes totalmente serializadas antes. |
| Pantalla Carga Horaria (`networkIdleMs`) | 7014ms | 4709ms | ~33% | Consistente con la suma de las dos mejoras de arriba. |
| Cantidad de requests en `/horas` | 4 | 4 | sin cambio (esperado) | No se tocó nada de frontend; ninguna request nueva ni eliminada — la mejora es 100% de duración, no de cantidad. |
| Endpoints que siguen críticos | — | `audit`, `dashboard/metrics`, `employees/:id/overview-details`, `positions`, `shifts/alerts`, `time-entries/period-employees` | — | Los primeros 5 son de otros módulos (fuera de alcance de esta etapa); `period-employees` mejoró pero no salió del rango crítico — ver §7. |

**Aclaración explícita pedida**: ambas corridas contra la base real de staging (Neon, remota) — la latencia varía entre corridas (documentado desde la Etapa 13F). Los porcentajes son de una única corrida antes/después cada uno, no promedios de laboratorio. No se infló ninguna cifra.

---

## 7. Qué quedó fuera de esta etapa (candidatos futuros)

- **`GET /time-entries/period-employees` sigue en rango Crítico** (4138ms) — la reducción de round-trips ya aplicada (quitar el `$transaction`, recortar el select) resolvió la causa arquitectónica identificada, pero el endpoint sigue haciendo, como mínimo, 2 round-trips secuenciales reales (primero resolver `employeeIds`, después las 3 consultas de detalle que dependen de esa lista) — no se puede paralelizar más sin cambiar el orden de dependencia de los datos (las 3 consultas de detalle NECESITAN `employeeIds` primero). Ir más allá requeriría `relationJoins` de Prisma o una vista/consulta SQL agregada a medida — cualquiera de las dos es un cambio de mayor alcance, evaluado y descartado para esta etapa quirúrgica (mismo criterio que 14C.1 §7).
- **`GET /dashboard/metrics`, `GET /positions`, `GET /shifts/alerts`, `GET /audit`**: aparecen en Crítico en el journey real, pero son de otros módulos — fuera del alcance de "Carga Horaria". Candidatos directos para etapas 14C.3+.
- **`GET /org-structure`**: catálogo compartido, mismo criterio de 14C.1 — no tocado.
- **`findMany(view=byEmployee)`** (bandeja de revisión agrupada por persona, el otro modo de `HoursPage.tsx` cuando `pendingOnly=true`) — usa el mismo patrón `prisma.$transaction(async (tx) => {...})` que `findPeriodEmployees` tenía antes de esta etapa. No fue medido como crítico por el journey (que sólo recorre el modo grilla, no `pendingOnly`), así que no se tocó — documentado como candidato a revisar en una etapa futura si se confirma que también es lento en uso real.
- **Colapsar `sector`/`position` también en otros selects de `time-entries`** (ej. `findManyByEmployeeGrouped`, usado por la bandeja) — no evaluado en esta etapa por no ser el endpoint medido como crítico.
