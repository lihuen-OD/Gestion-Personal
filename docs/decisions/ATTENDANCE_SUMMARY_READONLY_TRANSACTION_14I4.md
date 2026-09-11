# Etapa 14I.4 — Eliminación de la transacción read-only de `attendanceSummary`

## 1. Contexto

Etapa mecánica y quirúrgica dentro de Gestión Horaria: corrige exactamente el hallazgo **P1** identificado por el diagnóstico transversal 14I.1 (`docs/decisions/BACKEND_PERFORMANCE_INFRASTRUCTURE_DIAGNOSTIC_14I1.md` §4.3/§10) en `backend/src/modules/time-entries/timeEntries.repository.ts::attendanceSummary`, que envolvía 2 lecturas independientes en `prisma.$transaction(async (tx) => {...})` sin ninguna escritura dentro del callback. No se tocó ninguna otra función del archivo, ningún otro módulo, el Fichador, ni ningún contrato/RBAC/cache existente.

## 2. Relación con 14I.1

14I.1 (commit `3abb3c4`) clasificó este hallazgo como distinto de los 3 P0 ya corregidos en 14I.2 (`novelties`/`users`/`documents`, forma array) y de los 2 P2 sin caller real (`salaryCategories`/`hourConceptRules`, no tocados). `attendanceSummary` es la única instancia P1 restante del inventario de `$transaction`: forma callback (no array), con caller real confirmado, viviendo en `time-entries.repository.ts` — un archivo Gestión-Horaria/Fichador-adyacente que 14I.1 marcó explícitamente como "requiere el mismo cuidado que cualquier otro cambio a ese módulo". 14I.2 y 14I.3 dejaron este hallazgo fuera de su alcance a propósito, remitiéndolo a una etapa dedicada — esta es esa etapa.

## 3. Por qué es P1 y no P0

Los 3 P0 de 14I.2 vivían en módulos sin ninguna relación con el Fichador (`novelties`, `users`, `documents`). `attendanceSummary` vive en el mismo archivo (`timeEntries.repository.ts`) que 9 transacciones interactivas legítimas de escritura del Fichador/carga horaria (`clockInResolved`, `clockOutResolved`, `closeOpenWorkShift`, etc. — ver 14I.1 §4.4, lista `legitimateWriteTransactions`), lo que exige verificar con más cuidado que el cambio no cruce accidentalmente a esa zona. El fix en sí es mecánicamente idéntico al ya aplicado 18 veces antes (15 en 14C/14G/14H + 3 en 14I.2) — sólo la ubicación del archivo eleva el riesgo de revisión, no la complejidad del cambio.

## 4. Diagnóstico de `attendanceSummary`

Código exacto antes del cambio (`timeEntries.repository.ts:965-1094` previo a esta etapa):

```ts
attendanceSummary(input: { startAt: Date; endAt: Date; employeeAccessWhere: Prisma.EmployeeWhereInput }) {
  const employeeSelect = { /* ... */ };
  return prisma.$transaction(async (tx) => {
    const [workShifts, observedPunches] = await Promise.all([
      tx.workShift.findMany({ /* where + select ricos, incluye shiftTemplate/startPunch/endPunch/timeSegments/timeEntries */ }),
      tx.attendancePunch.findMany({ /* where + select de punches OBSERVADA/PENDIENTE sin turno asociado */ }),
    ]);
    return { workShifts, observedPunches };
  });
},
```

El callback del `$transaction` **no contiene ninguna escritura** — sólo envuelve un `Promise.all` de 2 lecturas ya independientes entre sí (`tx.workShift.findMany` y `tx.attendancePunch.findMany`), pinándolas innecesariamente a una única conexión reservada de Neon en vez de dejarlas correr sobre el cliente `prisma` global. Mismo antipatrón, en forma callback, que las 15 instancias en forma array ya corregidas en 14C/14G/14H, y que las 3 forma-array corregidas en 14I.2.

## 5. Endpoint/caller

1. **Endpoint**: `GET /time-entries/attendance` → `timeEntriesRouter.get("/attendance", requireAnyRole(operationalRoles), validateQuery(attendanceSummaryQuerySchema), timeEntriesController.attendanceSummary)` (`timeEntries.routes.ts:60`).
2. **Controller**: `timeEntriesController.attendanceSummary` (`timeEntries.controller.ts:104-111`) — lee/escribe `attendanceSummaryCache` (ver §12), delega en `timeEntriesService.attendanceSummary`.
3. **Service**: `timeEntriesService.attendanceSummary(query, user)` (`timeEntries.service.ts:682-720`) — resuelve el rango del día (`argentinaDayRange`), llama al repositorio, y hace **todo su procesamiento posterior en JS puro** (`map`/`filter`/`sort`/`reduce` sobre el resultado ya resuelto) — nunca dentro de la promesa del repositorio.
4. **Caller frontend real**: `attendanceApiService.getSummary(date)` (`frontend/src/services/api/attendanceApiService.ts:187-196`), consumido por `AttendancePage.tsx:330` (`attendanceApiService.getSummary(date)` dentro de un `useEffect`) — la pantalla de Asistencia, poblando el resumen diario de turnos abiertos/cerrados/observados y las fichadas sin turno asociado. No se modificó ningún archivo de este caller — sólo se leyó para confirmar el consumidor real.

## 6. Qué hacía la transacción

Ejecutar, dentro de una única conexión reservada de Neon vía `prisma.$transaction(async (tx) => {...})`, un `Promise.all` de exactamente 2 lecturas:
- `tx.workShift.findMany(...)` — turnos (`WorkShift`) del rango de fecha solicitado (`startAt < endAt` y `endAt` nulo o `>= startAt`), con un `select` rico (turno + plantilla + fichadas de entrada/salida + segmentos + horas cargadas).
- `tx.attendancePunch.findMany(...)` — fichadas (`AttendancePunch`) con `status: "OBSERVADA"`, `reviewStatus: "PENDIENTE"`, sin turno de inicio/fin asociado (`startWorkShifts: { none: {} }`, `endWorkShifts: { none: {} }`), acotadas al mismo rango de fecha por `timestamp`.

Ninguna escritura, ningún `create`/`update`/`delete`, ningún paso que dependiera del resultado del otro dentro del callback.

## 7. Por qué no se necesita transacción

- **Las 2 lecturas son independientes**: distinto modelo (`WorkShift` vs `AttendancePunch`), distinto `where`, ninguna depende del resultado de la otra — ya corrían en paralelo vía `Promise.all` *dentro* del callback, la transacción sólo agregaba una reserva de conexión sin aportar atomicidad real.
- **El procesamiento posterior no depende de un snapshot transaccional**: `timeEntriesService.attendanceSummary` (§5.3) arma `shifts`/`openShifts`/`observedShifts`/`closedShifts`/`totals` con operaciones puras de array **después** de que ambas promesas ya resolvieron — no hay ningún camino de código que vuelva a leer la base entre las 2 queries, ni que necesite que ambas reflejen exactamente el mismo instante de la base de datos.
- **No hay escritura en el callback** — se confirmó por lectura directa del código (§4) y por grep (`grep -n "tx\."` sobre el rango de la función, cero resultados de `create`/`update`/`delete`).
- **El riesgo de carrera es el mismo ya aceptado 18 veces antes**: en el peor caso, un `WorkShift` cambia de estado o una `AttendancePunch` se resuelve en la fracción de segundo entre ambas lecturas — esto podría, como máximo, hacer que un turno recién cerrado siga apareciendo como "abierto" en esta respuesta puntual, o que el contador de observados quede desviado en 1 durante esa misma fracción de segundo. Es exactamente la misma clase de inconsistencia transitoria ya documentada y aceptada en 14I.2 §5 para `novelties`/`users`/`documents`, y en 14G.2/14G.3 para `homeCounts`/`attendanceObservedCount`/`attendanceObservations` — el propio endpoint se vuelve a consultar en el próximo poll/refresh (frontend cachea sólo 10-20s, ver §12), nunca produce un dato permanentemente incorrecto ni afecta ninguna escritura real (este endpoint no escribe nada).
- **No es un dato de categoría D** (`PERFORMANCE_STANDARDS.md` §2.D): `attendanceSummary` es un resumen de solo lectura de la pantalla de Asistencia, no una confirmación de fichada ni una aprobación/cierre — la regla de "consistencia antes que velocidad" de §10 aplica al Fichador en sí (`clockInResolved`/`clockOutResolved`/`closeOpenWorkShift`, todos intactos, ver §9), no a este resumen derivado.

## 8. Cambio aplicado

`backend/src/modules/time-entries/timeEntries.repository.ts::attendanceSummary` — se reemplazó:

```ts
attendanceSummary(input) {
  ...
  return prisma.$transaction(async (tx) => {
    const [workShifts, observedPunches] = await Promise.all([
      tx.workShift.findMany({...}),
      tx.attendancePunch.findMany({...}),
    ]);
    return { workShifts, observedPunches };
  });
},
```

por:

```ts
async attendanceSummary(input) {
  ...
  const [workShifts, observedPunches] = await Promise.all([
    prisma.workShift.findMany({...}),
    prisma.attendancePunch.findMany({...}),
  ]);
  return { workShifts, observedPunches };
},
```

Mismo mecanismo ya aplicado en `homeCounts`/`attendanceObservedCount` (mismo archivo, 14G.2) y en los 3 P0 de 14I.2: se retira el wrapper `$transaction`, las 2 queries pasan de `tx.<model>` al cliente `prisma` global, la función pasa a `async` (antes retornaba directamente la promesa del `$transaction`). `where`/`select`/`orderBy` de ambas queries — byte a byte idénticos a los de antes, sólo se corrigió la indentación resultante de quitar un nivel de anidamiento.

## 9. Qué NO se cambió

- `findById`, `findMany` (Bandeja), `attendanceObservations`, `homeCounts`, `attendanceObservedCount`, `findPeriodEmployees`, `findManyByEmployeeGrouped` — ninguna otra función de `timeEntries.repository.ts` fue tocada.
- El Fichador: `clockInResolved`, `clockOutResolved`, `clockPhotoPunch`/salida con foto, `createFromWorkShift`, `closeOpenWorkShift`, `rolloverExpiredOpenWorkShift`, `expireOpenWorkShifts` (cron) — cero cambios. Las 9 transacciones interactivas de escritura que 14I.1 §4.4 confirmó como legítimas siguen exactamente igual.
- Escrituras de `AttendancePunch`, `WorkShift`, `TimeEntry`, `SpecialHourRuleApplication` — ninguna tocada (esta función nunca escribió ninguna).
- Conceptos horarios, horas especiales, `doubleHourRuleMatching` — sin cambios.
- `timeEntries.service.ts`, `timeEntries.controller.ts`, `timeEntries.routes.ts` — cero cambios de lógica (sólo se leyeron para el diagnóstico).
- `attendanceSummaryCache` (`timeEntries.cache.ts`) y su invalidación (`clearTimeEntriesReadCaches`) — cero cambios de TTL/key/invalidación.
- Prisma schema — cero cambios, cero migraciones.
- `relationJoins`/`relationLoadStrategy` — sin cambios.
- Frontend — cero archivos productivos tocados (`AttendancePage.tsx`/`attendanceApiService.ts` sólo se leyeron para confirmar el caller).
- Cualquier otro módulo backend (`novelties`, `users`, `documents`, `positions`, `hour-concepts`, `novelty-types`, `document-categories`, `salary-categories`, `employees`, etc.) — ninguno forma parte de esta etapa.

## 10. Contrato API preservado

`GET /time-entries/attendance` — mismo método, misma ruta, mismo query param (`date`, opcional), mismo shape de respuesta (`{ data: { date, totals, openShifts, closedShifts, observedShifts, observedPunches } }`, con `redactPiiForRole` aplicado igual que antes). El cambio es interno al repositorio: mismas 2 queries, mismo resultado, sólo cambia cómo Prisma las ejecuta (sobre el cliente global en paralelo real, en vez de pinadas a una conexión de transacción).

## 11. RBAC/scope preservado

- Ruta gateada por `requireAnyRole(operationalRoles)` (`timeEntries.routes.ts:60`) — sin cambios.
- `employeeAccessWhere(user)` se sigue resolviendo en el service (`timeEntries.service.ts:687`) y se sigue pasando sin modificar a ambas queries del repositorio (`where.employee: input.employeeAccessWhere` en `workShift.findMany`, mismo campo en `attendancePunch.findMany`) — verificado con test dedicado (§14).
- `redactPiiForRole` se sigue aplicando en el service sobre el resultado ya armado — el repositorio nunca decidía nada de RBAC, sólo ejecutaba las 2 queries; ese reparto de responsabilidades no cambió.

## 12. Cache/invalidation preservada

- `attendanceSummaryCache` (`timeEntries.cache.ts:7`, `createTtlCache`, 10s, `userScopedCacheKey`) — capa de cache a nivel **controller**, completamente ajena a esta función de repositorio. Cero cambios de TTL, key o invalidación. Sigue limpiándose desde `clearTimeEntriesReadCaches()` (`timeEntries.cache.ts:33`), mismos ~15 call sites que ya invalidaban antes.
- Cache frontend (`cachedData` + `cachePolicies.timeEntriesAggregates`, `attendanceApiService.ts:192-195`) — capa completamente independiente del backend, no tocada.
- Ninguna de las 2 capas de cache dependía de que la lectura subyacente estuviera envuelta en una transacción — ambas cachean el resultado ya resuelto (el objeto `{ date, totals, ... }`), no el mecanismo de ejecución de las queries.

## 13. Semántica de asistencia preservada

- Mismo `where` de `workShift.findMany`: `employee: employeeAccessWhere`, `startAt: { lt: endAt }`, `OR: [{ endAt: null }, { endAt: { gte: startAt } }]` — el mismo criterio de "turno que se solapa con el rango del día" de antes.
- Mismo `where` de `attendancePunch.findMany`: `employee: employeeAccessWhere`, `status: "OBSERVADA"`, `reviewStatus: "PENDIENTE"`, `startWorkShifts: { none: {} }`, `endWorkShifts: { none: {} }`, `timestamp: { gte: startAt, lt: endAt }` — mismo criterio de "fichada observada, pendiente de revisión, sin turno asociado, dentro del día".
- Mismo `select` en ambas queries (turno con plantilla/fichadas/segmentos/horas; fichada con datos de evidencia/rostro), mismo `employeeSelect` compartido (`id`/`legajo`/`dni`/`firstName`/`lastName`/`status`/`sector`/`position`).
- Mismo `orderBy`: `[{ status: "asc" }, { startAt: "desc" }]` en turnos, `{ timestamp: "desc" }` en fichadas.
- Mismo procesamiento posterior en el service (workedMinutes/workedHours, clasificación open/observed/closed, `computeOpenShiftRisk`, `totals`) — cero líneas tocadas ahí.

## 14. Tests agregados/modificados

**Modificados (4 tests existentes, actualizados de `tx.*` a `prisma.*`)** en `timeEntries.repository.test.ts` (describe `"attendanceSummary / attendanceObservations — select unificado..."`, Etapa 8F): los 4 tests que verifican el select de `timeSegments`/`timeEntries`/`specialHourRuleApplications` y el paso de datos sin recorte usaban `mockedPrisma.__tx.workShift.findMany`/`mockedPrisma.__tx.attendancePunch.findMany` (mocks del callback `tx` de la transacción). Se migraron a `mockedPrisma.workShift.findMany`/`mockedPrisma.attendancePunch.findMany` (mocks del cliente `prisma` global) para reflejar que la función ya no pasa por `tx`. Ninguna aserción de contenido cambió — sólo el objeto mockeado.

**Nuevos (5 tests)**, mismo describe block:
1. `"attendanceSummary no envuelve las 2 queries en $transaction — corren sobre el cliente prisma global (Promise.all real, Etapa 14I.4)"` — `expect(mockedPrisma.$transaction).not.toHaveBeenCalled()` + ambas queries llamadas exactamente 1 vez sobre `prisma`.
2. `"attendanceSummary preserva employeeAccessWhere en ambas queries"` — confirma que el mismo objeto `employeeAccessWhere` llega a `where.employee` de `workShift.findMany` y de `attendancePunch.findMany`.
3. `"attendanceSummary preserva el rango de fechas..."` — confirma `workShift.where.startAt: { lt: endAt }` + `OR: [{ endAt: null }, { endAt: { gte: startAt } }]`, y `attendancePunch.where.timestamp: { gte: startAt, lt: endAt }` + `status: "OBSERVADA"` + `reviewStatus: "PENDIENTE"`.
4. `"attendanceSummary preserva el select de employee/sector/position en ambas queries"` — confirma el `employeeSelect` compartido idéntico en ambas queries.
5. `"attendanceSummary sin datos devuelve { workShifts: [], observedPunches: [] }, mismo shape que antes"` — caso sin resultados.

Ningún test depende de tiempos exactos (usan `Date` fijas del `baseInput` ya existente, sin `Date.now()`/temporizadores reales). Ningún mock oculta si se usa `$transaction`: el mock global de `prisma.$transaction` (`timeEntries.repository.test.ts:57-59`) sigue activo y disponible para cualquier test que quiera afirmarlo — el test #1 lo afirma explícitamente. No se tocó ningún test no relacionado con `attendanceSummary`.

## 15. Validaciones

- `npx prisma validate` ✅ schema válido, sin cambios.
- `npm run typecheck` ✅ sin errores.
- `npm test` ✅ **1306/1306** (87 archivos, +5 tests nuevos vs. los 1301 de cierre de 14I.3).
- `npm run build` ✅ sin errores.
- `npm run perf:journey:workforce` ✅ passed (~1.0min) — journey obligatorio de esta etapa (toca Gestión Horaria).
- `npm run perf:journey:admin-config` ✅ passed (~43.8s) — smoke de regresión transversal.
- `npm run perf:journey:employees` ✅ passed (~40.9s) — smoke de regresión transversal.
- Los 3 journeys regeneraron como efecto colateral `docs/performance/{WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1,ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1,EMPLOYEES_PERFORMANCE_JOURNEY_14D1}.{md,json}` — restaurados (`git restore`) de inmediato, mismo protocolo ya establecido en 14H.7/14H.8/14I.2/14I.3.
- `git diff --check` ✅ sin errores de espacios en blanco.
- `git status --short` / `git diff --stat`: cambios acotados a 2 archivos (`timeEntries.repository.ts`, `timeEntries.repository.test.ts`).
- Ninguna escritura real fue ejecutada por esta etapa — los 3 journeys son de solo lectura/navegación para esta función específica (no se disparó ninguna mutación de `WorkShift`/`AttendancePunch`/`TimeEntry` como parte de la validación de `attendanceSummary`).

## 16. Riesgos pendientes

- Ninguno introducido por este cambio — mismo patrón mecánico ya validado 18 veces antes (15 en 14C/14G/14H + 3 en 14I.2), ahora aplicado a la única instancia P1 en forma callback.
- La doble capa de cache (`createTtlCache` de controller + `repositoryListCache` de repositorio) documentada en 14I.3 para `hour-concepts`/`novelty-types`/`document-categories`/`salary-categories` sigue existiendo, sin relación con este cambio.
- `salaryCategories.repository.ts` sigue con su `$transaction` P2 en la rama filtrada, sin caller real — sin cambios, documentado desde 14I.1/14I.2/14I.3.
- `hourConceptRules.repository.ts` sigue con su `$transaction` P2, sin caller real — sin cambios.
- `employeeOrgChartSelect` (Legajos, P1 de 14I.1) — cadena de 4 niveles en un listado, sigue pendiente, requiere autorización explícita para tocar `employees`.

## 17. Recomendación para 14I.5

Con los 3 P0 (14I.2), la Forma B de cache (14I.3) y el único P1 en forma callback (`attendanceSummary`, esta etapa) cerrados, el inventario de `$transaction` de 14I.1 queda reducido a únicamente los 2 P2 sin caller real (`salaryCategories`/`hourConceptRules`, documentar-no-tocar por criterio ya establecido desde 14H.5). Candidatos remanentes para una futura 14I.5, en orden de evidencia (ninguno recomendado para iniciar sin autorización explícita adicional, todos ya nombrados por 14I.1/14I.3):
1. **Consolidar la doble capa de cache** (`createTtlCache` de controller + `repositoryListCache` de repositorio) en los 4 módulos que la tienen apilada — requiere decidir explícitamente cuál capa eliminar por módulo.
2. **`employeeOrgChartSelect`** (`employees.repository.ts:755-783`, P1 de 14I.1) — cadena de 4 niveles reusada por fila en un listado; el hallazgo de over-fetch de mayor impacto potencial del diagnóstico original, pero vive en Legajos y requiere autorización explícita para tocar ese módulo.
3. **Invalidación de `timeGridCatalogCache`** (`employees.repository.ts`, P1 de 14I.1) — sin ninguna invalidación explícita hoy, ventana de staleness acotada sólo por su TTL de 120s; mismo requisito de autorización para tocar `employees`.
4. Tests de aislamiento de cache faltantes en `documentsListCache`/`noveltiesListCache` y en las 6 caches de `employees.controller.ts` — bajo impacto, cobertura pura.
