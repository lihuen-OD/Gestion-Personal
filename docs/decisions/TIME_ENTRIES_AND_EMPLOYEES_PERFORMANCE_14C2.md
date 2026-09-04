# Etapa 14C.2 ampliada — Performance funcional de Carga Horaria y Legajos

Fecha: 2026-09-03
Estado: diagnóstico completo, implementado, validado, pendiente de aprobación para commitear
Alcance: `time-entries` (guardado manual) y `employees`/`audit` (Legajos: carga/detalle, historial, guardado). Reemplaza/amplía el alcance de `docs/decisions/TIME_ENTRIES_PERFORMANCE_14C2.md` (que queda como referencia histórica de `period-employees`/`summary`, ya implementado antes de esta etapa). Sin cambios de schema/migraciones, sin cambios de contrato de API, sin cambios de reglas de Hora Normal/Conceptos Horarios/Horas Especiales/liquidación/fichador/permisos, sin eliminación de datos.

---

## 1. Diagnóstico

### 1.1 Carga Horaria — carga inicial (`/horas`)

Ya diagnosticado e implementado en la etapa previa (`docs/decisions/TIME_ENTRIES_PERFORMANCE_14C2.md`, no repetido acá): `findPeriodEmployees`/`summary` sacaron el `prisma.$transaction(...)` que forzaba ejecución serializada sobre una sola conexión. Esta etapa no vuelve a tocar esos dos endpoints — el diagnóstico de "carga inicial" ya estaba cerrado antes de que empezara la ampliada.

### 1.2 Carga Horaria — guardado manual (`POST`/`PATCH /time-entries`)

- **Validaciones secuenciales innecesarias.** `timeEntriesService.create()`/`update()` (`timeEntries.service.ts`, antes de esta etapa) ejecutaban `ensureEmployeeScope`/`ensureHourConceptEnabled`/`ensureDayIsNotBlocked`/`ensureNoDuplicate` con `await` uno detrás del otro. Cada una consulta una tabla distinta y ninguna depende del resultado de otra (confirmado leyendo las 4 funciones completas — `timeEntries.service.ts:111-152`) — son candidatas directas a paralelizar, pero un `Promise.all` ingenuo cambiaría cuál error ve el usuario cuando fallan varias a la vez (el orden de resolución de promesas no es el orden de prioridad del código secuencial anterior).
- **Invalidación de caché de más.** `create`/`update` llamaban `clearEmployeeReadCaches()` (`employees.controller.ts:26-33`), que limpia las 6 cachés de `employees` (detalle, listado, resumen, organigrama, opciones, grilla horaria) aunque un guardado manual de una hora sólo pueda afectar la grilla horaria de ESE empleado — nunca su legajo, el listado de Legajos, el resumen ni el organigrama (confirmado: ningún campo de `Employee` se escribe desde `timeEntries.repository.create/update`).
- **GET redundante en el frontend.** `timeEntryApiService.save()` (`frontend/src/services/api/timeEntryApiService.ts:488`, antes de esta etapa) hacía `getByEmployee()` (un `GET /time-entries` completo) para decidir si correspondía `create` o `update`, aunque el llamador (`EmployeeHoursPage.tsx`) ya tiene la grilla completa en estado local y puede resolver esa misma pregunta (`entryFor`, `EmployeeHoursPage.tsx:254-255`) sin red. Único call site de `save()` en todo el frontend (confirmado por `grep`), cambio de bajo riesgo.
- **Horas Especiales / recálculo de alcance**: revisado explícitamente `timeEntriesRepository.create()` (`timeEntries.repository.ts:~1673`) y su uso de `resolveDoubleHourMultiplierForManualEntry` — ya está acotado al empleado+fecha afectados, sin recalcular de más. No se encontró ningún problema en esta área (diagnóstico con resultado "sin hallazgo", no se tocó nada).

### 1.3 Legajos — carga/detalle (`GET /employees/:id` y afines)

`employeeDetailSelect` (`employees.repository.ts`, antes de esta etapa) anidaba ~9 relaciones (`address`, `transport`, `sector→area→establishment→businessUnit`, `costCenter`, `position` con su propia cadena de sector, `companies`, `laborMovements`, `assignments`, `hourConcepts`, `novelties`, `documents`) dentro de un único `findFirst`/`update`/`findUniqueOrThrow`. Sin `previewFeatures = ["relationJoins"]` (no activado, fuera de alcance de esta etapa), Prisma resuelve cada relación como un round-trip separado — y sin partir el select explícitamente, esos round-trips no se ejecutan concurrentemente. Mismo patrón exacto ya diagnosticado y resuelto para `employeeOverviewCoreSelect`/`findOverviewDetailsById` en la Etapa 14C.1 (`docs/decisions/EMPLOYEE_PERFORMANCE_14C1.md`).

Este select tenía **8 call sites**: `create`, `findById`, `updateContact`, `upsertAddress`, `upsertTransport`, `replaceAssignments`, `replaceHourConcepts`, `createLaborMovement`, `createDocument`. `create()` se dejó afuera a propósito (§6) — las relaciones ahí se están creando en la misma llamada, partir el select no evita ningún round-trip porque las filas no existen todavía.

Se descartó explícitamente recortar la RESPUESTA de los endpoints de guardado (misma idea que en 14C.1 para el listado): el frontend reemplaza el estado local completo del empleado con `mapEmployeeFromApi(response.data)` en cada guardado (`employeeApiService.ts`), así que devolver menos campos rompería la UI tras guardar. La única optimización segura es "mismos datos, menos round-trips" — exactamente el patrón core+batch-paralelo.

### 1.4 Legajos — historial (`SectionChangeHistory`, tab "Historial de Eventos")

Ese tab se alimenta de `auditApiService.getAll({ entityId, take: 200 })` → `GET /audit` → `auditRepository.findMany()` (`audit.repository.ts`). Antes de esta etapa, `findMany` + `count` corrían dentro de `prisma.$transaction([...])` (forma-array) — mismo antipatrón ya diagnosticado y corregido dos veces en esta misma etapa (`employees.summary()` en 14C.1, `findPeriodEmployees`/`summary` en la 14C.2 previa): la forma-array de `$transaction` ejecuta sus queries sobre una única conexión, serializadas, no en paralelo real. `findMany`/`count` son dos lecturas independientes (un listado y un conteo para paginar) sin ninguna escritura entre medio — no necesitan una foto transaccional consistente entre sí.

`EmployeeDetailPage.tsx` ya hace lo correcto en el resto del flujo: `getOverviewById`/`getOverviewDetailsById` se disparan en paralelo (no uno esperando al otro) y el historial de auditoría sólo se pide una vez por legajo (`auditLoaded`, guard ya existente) y sólo si la pestaña correspondiente está activa — no se encontró ningún fetch redundante ahí, sólo el `$transaction` del lado del repositorio.

`findFieldHistory` (`GET /employees/:id/field-history`, historial de campos editados) es un único `findMany` sin `count`/paginación pareada — ya es una sola consulta, sin nada que paralelizar.

### 1.5 Legajos — guardado (contacto, domicilio, transporte, asignaciones, conceptos horarios, movimientos laborales, documentos)

Los 7 endpoints de guardado listados en §1.3 hacían, cada uno, una escritura seguida de una relectura con el mismo `employeeDetailSelect` gigante para dar forma a la respuesta — la causa es la misma de §1.3, sólo que aplicada después de un `create`/`update`/`$transaction` de escritura en vez de antes de un `GET`. `replaceAssignments`/`replaceHourConcepts`/`createLaborMovement`/`createDocument` ya habían sacado esa relectura pesada de la transacción interactiva en etapas anteriores (6Q/7A, por timeouts de Prisma bajo latencia de Neon) — esta etapa no toca esa decisión, sólo hace la relectura en sí más rápida.

---

## 2. Reglas funcionales verificadas intactas

Se revisó cada cambio contra la lista completa de 18 reglas del pedido (Hora normal = total real trabajado; Conceptos Horarios aditivos, nunca inflan el total real; Horas Especiales multiplican sólo el liquidable, nunca las horas reales; `totalLiquidable = normalLiquidable + conceptLiquidable`; no mezclar conceptos con Horas Especiales; no tocar aprobación/revisión/permisos; no inventar fichadas; no tocar semántica de `WorkShift`/`AttendancePunch`/`TimeEntry`; no romper historial/trazabilidad/auditoría; no mostrar datos fuera de alcance/permiso; no cambiar estado laboral/responsable de carga/encargado directo; no romper documentos; no romper contratos de API). Ninguna de esas reglas vive en el código tocado (selects Prisma, envoltorio de `$transaction`→`Promise.all`/`Promise.allSettled`, invalidación de caché, un parámetro opcional de frontend) — el cálculo de horas, el motor de aprobación, el cálculo de estado laboral (`resolveLaborStatus`) y el registro de auditoría (`auditService.register`, snapshots `find*AuditSnapshot`) son código separado, no modificado, y siguen cubiertos por su suite de tests preexistente (verde, ver §8).

---

## 3. Endpoints involucrados

| Endpoint | Causa principal | Cambio aplicado |
|---|---|---|
| `POST /time-entries`, `PATCH /time-entries/:id` | 4 validaciones independientes en `await` secuencial + invalidación de 6 cachés por un cambio que sólo afecta 1 | Validaciones paralelizadas con orden de prioridad preservado (`Promise.allSettled`); invalidación acotada a `employeeTimeGridCache` |
| `timeEntryApiService.save()` (frontend) | GET redundante antes de decidir create/update | Nuevo parámetro opcional `knownExistingId`; único call site actualizado para pasar el id ya conocido desde el estado local |
| `GET /employees/:id` (+ 6 endpoints de guardado que devuelven el legajo completo) | `employeeDetailSelect` con ~9 relaciones anidadas, resueltas como round-trips serializados sin `relationJoins` | Split en `employeeDetailCoreSelect` (escalares + to-one) + `attachEmployeeDetailRelations` (6 `findMany` en `Promise.all`) |
| `GET /audit` (Historial de Eventos de Legajos + módulo Auditoría) | `findMany`+`count` en `prisma.$transaction([...])` (forma-array, misma conexión) | `$transaction([...])` → `Promise.all([...])` |

---

## 4. Cambios aplicados

### 4.A Backend — Carga Horaria (guardado manual)

1. **`timeEntries.service.ts`** — nueva función `runValidationsInPriorityOrder` (línea 168): corre las validaciones con `Promise.allSettled` y, si alguna falló, relanza la del primer índice rechazado — o sea, exactamente la misma prioridad de error que el `await` secuencial anterior, pero pagando el costo de red de las 4 en paralelo en vez de uno por uno.
   - `create()` (línea 925): `[ensureEmployeeScope, ensureHourConceptEnabled, ensureDayIsNotBlocked, ensureNoDuplicate]`.
   - `update()` (línea 1592): `[ensureHourConceptEnabled, ensureDayIsNotBlocked, ensureNoDuplicate]` (sin `ensureEmployeeScope`: el empleado ya se resolvió al buscar la entrada existente).
2. **`employees.controller.ts`** — nueva función `clearEmployeeTimeGridCache()` (línea 44), que limpia únicamente `employeeTimeGridCache` (antes, `clearEmployeeReadCaches()` limpiaba las 6).
3. **`timeEntries.controller.ts`** — `create`/`update` pasan a llamar `clearEmployeeTimeGridCache()` en vez de `clearEmployeeReadCaches()` (líneas 155/193). El resto de los handlers (`submit`, `approve`, `reject`, `returnForCorrection`, `resolveAttendanceObservation`, fichador) **no se tocó** — siguen usando la caché amplia, a propósito: sólo `create`/`update` son "guardado manual" según el diagnóstico de §1.2; los demás son flujo de aprobación/fichador, fuera del alcance pedido para esta etapa.

### 4.B Backend — Legajos (carga/detalle/guardado)

1. **`employees.repository.ts`** — nuevo `employeeDetailCoreSelect` (línea 317): mismos escalares + relaciones to-one que `employeeDetailSelect` (`address`, `transport`, `sector` con su cadena hasta `businessUnit`, `costCenter`, `position` con su propia cadena de sector y `salaryCategories`), sin `companies`/`laborMovements`/`assignments`/`hourConcepts`/`novelties`/`documents`.
2. **`attachEmployeeDetailRelations(employeeId)`** (línea 387): las 6 relaciones to-many que se sacaron del select, como 6 `findMany` independientes en un único `Promise.all` — filtran únicamente por `employeeId` (el control de acceso ya se resolvió en el core). `hourConcepts` reusa `assignableHourConceptsSelect` tal cual (misma fuente de verdad que ya comparten `findById` y `findOverviewDetailsById` desde la Etapa 6L.1/14C.1).
3. **`findEmployeeDetailById(id, accessWhere)`** (línea 424) y **`findEmployeeDetailByIdOrThrow(id)`** (línea 430): arman el objeto final (`{ ...core, companies, laborMovements, assignments, hourConcepts, novelties, documents }`) — shape idéntico al que devolvía `employeeDetailSelect`.
4. **8 call sites reconectados** (7 de ellos; `create` quedó afuera a propósito, ver §1.3): `findById` (línea 920) usa `findEmployeeDetailById`; `updateContact`/`upsertAddress`/`upsertTransport` (líneas 1352/1368/1384) pasan a hacer el `update` con `select: { id: true }` (ya no necesitan devolver el detalle completo desde el propio `update`) y después llaman `findEmployeeDetailByIdOrThrow`; `replaceAssignments`/`replaceHourConcepts`/`createLaborMovement`/`createDocument` (líneas 1400/1428/1462/1499) cambian su relectura final de `prisma.employee.findUniqueOrThrow({..., select: employeeDetailSelect})` por `findEmployeeDetailByIdOrThrow` — sin cambiar en absoluto qué queda dentro/fuera de sus transacciones interactivas (decisión de 6Q/7A, no tocada).
5. **`audit.repository.ts`** (línea 32): `findMany()` — `prisma.$transaction([auditLog.findMany, auditLog.count])` → `Promise.all([...])`, mismas queries, mismo `where`/`select`/`orderBy`/`skip`/`take`.

### 4.C Frontend

1. **`timeEntryApiService.ts`** (línea 488): `save(entry, options?)` — nuevo segundo parámetro opcional `{ knownExistingId?: string | null }`. Si se pasa, se usa directamente para decidir `update`/`create` y se salta el `getByEmployee()` interno; si no se pasa, se comporta exactamente igual que antes (compatibilidad hacia atrás — no hay otro call site en el proyecto, pero no se le exige el parámetro por si se agrega uno nuevo más adelante).
2. **`EmployeeHoursPage.tsx`** (línea 378): único call site de `save()`, actualizado para pasar `{ knownExistingId: selectedEntry?.id ?? null }` — `selectedEntry` ya se deriva de `entries` (estado local, la grilla ya cargada) con exactamente el mismo criterio de matching (`day` + `conceptId`/`type`) que usaba el `find()` interno de `save()` (`entryFor`, línea 254-255).

### 4.D No se tocó

- `create()` de empleados (sigue con `employeeDetailSelect` completo — ver justificación en §1.3).
- Ningún handler de aprobación/fichador de `time-entries` (`submit`/`approve`/`reject`/`returnForCorrection`/`resolveAttendanceObservation`/clock-in-out) — siguen con `clearEmployeeReadCaches()`, sin cambios.
- `findFieldHistory` (historial de campos) — ya era una sola consulta, nada que paralelizar.
- Ningún cálculo de horas, ninguna regla de aprobación, ningún select/where fuera de los explícitamente listados arriba.
- Schema/migraciones: cero cambios (`npx prisma validate` en verde, ver §7).

---

## 5. Cambios descartados y por qué

- **`Promise.all` en vez de `Promise.allSettled` para las validaciones de `create`/`update`.** Descartado: `Promise.all` rechaza con el error de la PRIMERA promesa que falla en el tiempo, no la de mayor prioridad en la lista — con varias validaciones fallando a la vez, el usuario podría empezar a ver un mensaje de error distinto al que veía antes, dependiendo de qué tan rápido responda cada tabla. `Promise.allSettled` + relanzar el primer rechazo por índice preserva exactamente el orden de prioridad del código secuencial anterior.
- **Recortar la respuesta de los 7 endpoints de guardado de Legajos** (en vez de partir el select en core+batch). Descartado: el frontend reemplaza el estado local completo del empleado con la respuesta de cada guardado — recortar campos rompería la UI después de guardar (ver §1.3).
- **Tocar `create()` de empleados** con el mismo split. Descartado: esas relaciones se están creando en la misma llamada; partir el select ahí no evita ningún round-trip porque las filas no existen todavía — sólo agregaría complejidad sin beneficio medible.
- **Activar `previewFeatures = ["relationJoins"]`** para colapsar todo en una sola consulta SQL real. Descartado por alcance: es un cambio de infraestructura de Prisma con superficie de riesgo mucho mayor (afecta a todo el ORM, no sólo a estos módulos) — el pedido explícitamente prohíbe "cambios grandes de arquitectura sin documentar riesgos"; queda como candidato de una etapa dedicada (§9).
- **Ampliar la invalidación acotada (`clearEmployeeTimeGridCache`) a los handlers de aprobación/fichador.** Descartado: esos handlers están fuera del diagnóstico de "guardado manual" (§1.2) — tocarlos, aunque sólo fuera la invalidación de caché y no la lógica de negocio, se consideró un riesgo innecesario de alcance para esta etapa.

---

## 6. Tests agregados/modificados

**Backend:**

- `backend/src/modules/time-entries/timeEntries.service.test.ts` — **+4 tests nuevos** ("orden de prioridad de errores se mantiene igual al paralelizar validaciones"): confirman que, con varias validaciones fallando a la vez, `create()`/`update()` siguen lanzando el error de mayor prioridad (no el que gane la carrera de promesas) y que las validaciones de menor prioridad SÍ se ejecutan igual (no se cortocircuitan) — la prueba concreta de que ahora corren en paralelo. 62/62 en el archivo.
- `backend/src/modules/time-entries/timeEntries.controller.test.ts` — reescrito para la nueva `clearEmployeeTimeGridCache`: `create`/`update` verifican que se llama esa función y **no** `clearEmployeeReadCaches`; `submit`/`approve`/`reject`/`returnForCorrection` verifican que siguen llamando `clearEmployeeReadCaches` sin cambios. 7/7.
- `backend/src/modules/employees/employees.repository.test.ts` — adaptado a `findEmployeeDetailById`/`findEmployeeDetailByIdOrThrow`: `findById` confirma que el core ya no pide `hourConcepts` anidado (se resuelve aparte, mismo where/select que `findOverviewDetailsById`) y que el resultado final mergea las 6 relaciones; `replaceAssignments`/`replaceHourConcepts`/`createLaborMovement`/`createDocument` confirman que el delete+create/create sigue dentro de `$transaction` y la relectura pesada sigue corriendo después, sobre `prisma` directo (mismo criterio 6Q/7A, ahora con el helper nuevo). 17/17.
- `backend/src/modules/audit/audit.repository.test.ts` — **archivo nuevo, 6 tests**: shape de respuesta (`[registros, total]`), filtrado por `entityId` (no mezcla historiales de distintos legajos), no filtra por campos ausentes, paginación (`skip`/`take`), `orderBy`/`include` del autor, y confirmación explícita de que ya no usa `prisma.$transaction`.
- `backend/src/modules/time-entries/timeEntries.repository.test.ts` — sin cambios en esta etapa (ya estaba en 104/104 desde la etapa 14C.2 previa; no se tocó `findPeriodEmployees`/`summary` en esta etapa).

**Frontend:**

- `frontend/src/services/api/timeEntryApiService.test.ts` — **+5 tests nuevos**: `knownExistingId` string → `update` sin `getByEmployee`; `knownExistingId: null` → `create` sin `getByEmployee`; sin `options` → compatibilidad hacia atrás (sigue consultando `getByEmployee`); status "En revisión" sigue disparando `submit()` con `knownExistingId`. 9/9 en el archivo.
- `frontend/src/pages/EmployeeHoursPage.test.tsx` — 3 aserciones existentes actualizadas para esperar el segundo argumento `{ knownExistingId: null }` (los 3 escenarios cubiertos no tienen una entrada previa para ese día/concepto). 24/24 sin cambios de comportamiento — mismo flujo de guardado, mismo resultado.

Los ítems del pedido sobre reglas de negocio ("mantiene cálculo real/liquidable", "no rompe auditoría", "no rompe estados de aprobación", "estado laboral calculado sigue correcto", "responsables/asignaciones siguen correctos", "no rompe documentos") ya tenían cobertura exhaustiva preexistente en las suites de `timeEntries.service.test.ts`/`employees.service.test.ts`/`employees.repository.test.ts` (Horas Especiales, `resolveLaborStatus`, snapshots de auditoría) que se preservó intacta — correr la suite completa en verde (ver §7) es en sí mismo la evidencia de que ningún resultado de negocio cambió.

---

## 7. Validaciones ejecutadas

- `npx prisma validate` → schema válido, cero cambios.
- Backend: `npm run typecheck` (limpio), `npm test` → **72 archivos, 1075 tests, todos verdes**, `npm run build` (limpio).
- Frontend: `npm run typecheck:e2e` (limpio), `npm test` → **67 archivos, 560 tests, todos verdes**, `npm run build` (limpio), `npm run perf:journey` (ver §8).
- `git diff --check` → sin errores de espacios en blanco.

---

## 8. Comparación de performance — antes/después

Antes: `docs/performance/PERFORMANCE_JOURNEY_14B3.md`, corrida 2026-09-03T17:38:32Z (previa a todos los cambios de esta etapa). Después: misma corrida repetida 2026-09-03T18:18:51Z, mismo entorno local (staging real vía Neon), inmediatamente después de aplicar todos los cambios.

| Endpoint / métrica | Antes | Después | Comentario |
|---|---|---|---|
| `GET /api/audit` (7 llamadas: login, dashboard, detalle de legajo, Auditoría) | máx 3080ms, prom 1636ms | máx 1302ms, prom 753ms | **Único endpoint de esta etapa que el journey ejercita directamente** (no hace guardados). Mejora real de ~54-58%, consistente con haber sacado el `$transaction([...])` serializado. |
| Pantalla "Detalle de un legajo existente" (`networkIdleMs`) | 5102ms | 3681ms | Mejora indirecta: la misma pantalla dispara `GET /audit` para precargar el historial; `overview-details` (3103-3105ms después, 4119-4528ms antes) es un endpoint DISTINTO ya optimizado en 14C.1, no tocado en esta etapa — su variación es ruido normal de latencia de Neon entre corridas, no un efecto de esta etapa. |
| `GET /api/time-entries/period-employees`, `GET /api/time-entries/summary`, pantalla Carga Horaria | 4138ms / 616ms / 4709ms | 4344ms / 993ms / 4916ms | Sin cambios de esta etapa en estos endpoints — la variación es ruido de latencia real de Neon entre corridas (documentado desde la Etapa 13F), no una regresión: esta etapa no tocó `findPeriodEmployees` ni `summary`. |

**Lo que el journey NO puede medir, y no se inventó ningún número para eso:**

- **Guardado manual de Carga Horaria** (`POST`/`PATCH /time-entries`): el journey navega pantallas, no llena formularios ni hace submit. No hay una medición real antes/después de esta llamada en esta etapa. El razonamiento de por qué debería ser más rápido es de código, no de medición: antes, 4 validaciones en `await` secuencial pagaban 4 round-trips completos uno detrás del otro; ahora, las mismas 4 corren en paralelo real (`Promise.allSettled` sobre el cliente `prisma` pooled, no una transacción) — el tiempo total pasa de "suma de las 4" a "la más lenta de las 4". Bajo la latencia de Neon ya documentada (~500-900ms/round-trip), eso es una reducción teórica de hasta ~75% en el peor caso (las 4 corriendo), pero **no se midió en vivo esta etapa** — medirlo requeriría un guardado real contra staging, que se evitó a propósito para no escribir datos de prueba en la base real como parte de una medición.
- **Guardado de Legajos** (contacto, domicilio, transporte, asignaciones, conceptos horarios, movimiento laboral, documento): mismo motivo — el journey no hace guardados, y medirlo en vivo implicaría escribir sobre legajos reales de staging. El razonamiento de código: antes, cada guardado hacía 1 escritura + 1 relectura con ~6-9 relaciones anidadas resueltas en serie; ahora, la misma relectura se resuelve como 1 consulta núcleo + 6 consultas en un único `Promise.all` — mismo número total de consultas, pero las 6 de relación pasan de seriadas a concurrentes.
- **`GET /employees/:id` (`findById`) en sí mismo**: no tiene un call site propio en el recorrido del journey (`EmployeeDetailPage` usa `overview`/`overview-details`, no este endpoint) — sólo lo usa `DocumentUploadModal` y, internamente, los 7 endpoints de guardado de Legajos (que tampoco mide el journey). No se midió en vivo esta etapa por el mismo motivo que el punto anterior.

---

## 9. Riesgos pendientes

- **Consistencia de snapshot ligeramente más débil** en `findEmployeeDetailById`/`findEmployeeDetailByIdOrThrow`: el core y las 6 relaciones ya no se leen dentro de una única transacción/snapshot — si alguien edita una de esas relaciones en el instante exacto entre el core y el batch, es teóricamente posible ver una combinación de datos de dos instantes distintos. Mismo riesgo ya aceptado con el mismo criterio en `findOverviewDetailsById` (14C.1) y en `dashboard.service.ts` — es una lectura para mostrar/confirmar un guardado, no una operación de negocio que dependa de esa atomicidad, y el detalle de legajo ya está cacheado 30s (`employeeDetailCache`), por lo que una inconsistencia de un instante se autocorrige en la próxima lectura.
- **`audit.repository.findMany` sin transacción**: mismo tipo de riesgo, mismo criterio — un `count` que no refleje exactamente la misma foto que el `findMany` bajo escritura concurrente extrema (alguien crea un registro de auditoría en el medio) puede, en el peor caso, desalinear la paginación por un registro. Aceptado: es un listado de sólo lectura para un tab de historial, no una operación transaccional de negocio.
- **Guardado manual y guardado de Legajos no se midieron en vivo esta etapa** (ver §8) — la mejora ahí está fundamentada en el mismo patrón ya medido y confirmado dos veces esta sesión (`GET /audit`, `GET /time-entries/summary` en la etapa previa), pero no hay un número propio para estos dos flujos todavía.

---

## 10. Próximas mejoras sugeridas (fuera de esta etapa)

- Medir en vivo el guardado manual de Carga Horaria y los 7 guardados de Legajos contra los logs JSON de la Etapa 14B.2 en el backend real (buscar `path`/`method` con `slow:true` para `POST/PATCH /time-entries` y `PATCH /employees/:id/*`) una vez que haya tráfico real acumulado — sin necesidad de escribir datos de prueba.
- `GET /api/employees/:id/overview-details` sigue en rango "Crítico" (3103-3105ms) — ya optimizado en 14C.1, sigue siendo candidato si logs reales confirman que sigue siendo un cuello de botella (fuera de alcance de "Legajos: carga/detalle" tal como se diagnosticó en esta etapa, que se centró en `findById`, no en `overview-details`).
- `GET /api/positions`, `GET /api/shifts/alerts`, `GET /api/dashboard/metrics` — aparecen en "Crítico"/"Alto" en el journey, pero son de otros módulos, fuera del alcance explícito de esta etapa (Carga Horaria + Legajos).
- Activar `previewFeatures = ["relationJoins"]` de Prisma sería el siguiente salto real para colapsar el core+batch de `employeeDetailCoreSelect`/`attachEmployeeDetailRelations` en una sola consulta SQL — evaluado y descartado para esta etapa por ser un cambio de infraestructura de mayor alcance (ver §5).
- `findManyByEmployeeGrouped` (bandeja de revisión agrupada por persona, modo `pendingOnly` de `HoursPage.tsx`) sigue usando `prisma.$transaction(async (tx) => {...})` — no medido como crítico por el journey (que sólo recorre el modo grilla), documentado como candidato si logs reales confirman que también es lento en uso real (mismo candidato ya señalado en la etapa 14C.2 previa, todavía sin resolver).
