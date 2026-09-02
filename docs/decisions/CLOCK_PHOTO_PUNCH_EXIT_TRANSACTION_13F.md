# Etapa 13F — Optimización de la transacción de salida del fichador con foto

Fecha: 2026-09-02
Estado: implementado, validado, pendiente de aprobación para commitear
Alcance: sólo `timeEntriesRepository.closeOpenWorkShift` (backend, `timeEntries.repository.ts`) — la transacción que cierra una jornada abierta y genera `TimeEntry`/`TimeSegment`/`SpecialHourRuleApplication`. No se tocó entrada, Horas Especiales (motor de matching/prioridad/scope), Conceptos Horarios, liquidación, grilla/export/bandeja, frontend, ni ninguna migración.

## 1. Resumen ejecutivo

La salida del fichador con foto (`POST /api/time-entries/clock/photo-punch`) fallaba con `503 CLOCK_TEMPORARY_FAILURE` cuando la transacción de Prisma que cierra la jornada (`closeOpenWorkShift`) superaba el timeout por defecto de 5000ms y Prisma la abortaba a mitad de camino (`Transaction already closed`). La causa: esa transacción hacía, además de las escrituras indispensables (cerrar `WorkShift`, crear `AttendancePunch`, crear/actualizar `TimeEntry`/`TimeSegment`), **3 lecturas de configuración de sistema** (scope del empleado, reglas de Horas Especiales activas, conceptos nocturnos) que no tenían ninguna necesidad de correr dentro de esa transacción, más **un `findFirst` de `TimeEntry` por cada segmento** de la jornada (evitable agrupándolos en una sola consulta). Cada round-trip a la base (Neon, pooler remoto) suma latencia real al presupuesto de 5000ms; con varios segmentos y reglas de Horas Especiales, el total observado llegó a 9451ms de `queryTime` en 21 queries — muy por encima del timeout.

Fix aplicado (Opción A + B del pedido, combinadas): las 3 lecturas de configuración se resuelven con `prisma` (no `tx`) **antes** de abrir la transacción — exactamente el mismo patrón ya usado sin tx por `resolveDoubleHourMultiplierForManualEntry` (carga manual) en el mismo archivo — y el chequeo de `TimeEntry` existente pasa de N `findFirst` (uno por segmento) a un único `findMany` agrupado por fecha, ejecutado dentro de la transacción (sin cambiar su semántica: cada segmento tiene una fecha calendario distinta por diseño, así que agruparlos no altera ningún resultado). Además, como defensa en profundidad (Opción D, secundaria, nunca la solución sola), el timeout explícito de la transacción sube de 5000ms (default de Prisma, nunca configurado en este proyecto) a 10000ms. +6 tests backend, 985/985 verdes.

## 2. Log real que motivó la etapa

```
Invalid tx.timeEntry.create() invocation
Transaction already closed: A query cannot be executed on an expired transaction.
The timeout for this transaction was 5000 ms, however 5163 ms passed since the start of the transaction.

CLOCK_PHOTO_STORAGE_TIMING originalMs≈2983ms
POST /api/time-entries/clock/photo-punch 503 13220ms
queries=21
queryTime=9451ms
```

## 3. Causa raíz

`closeOpenWorkShift` (`backend/src/modules/time-entries/timeEntries.repository.ts`, antes de esta etapa) era una única `prisma.$transaction(async (tx) => {...})` que, además de las 3 escrituras indispensables (reclamar el `WorkShift`, crear el `AttendancePunch` de salida, linkear `endPunchId`), hacía dentro del mismo `tx`:

1. `tx.employee.findUnique` — scope del empleado (sector/centro de costo/puesto/empresas) para el filtro de alcance de Horas Especiales.
2. `tx.doubleHourRule.findMany` (con `include: { dates: true }`) — reglas activas de Horas Especiales que podrían aplicar.
3. `tx.hourConcept.findMany` — conceptos horarios de los segmentos, para detectar cuáles son "nocturnos".
4. Un loop por cada segmento de la jornada (1-3 según cruce de medianoche), y **dentro de cada iteración**: `tx.timeSegment.create`, un `tx.specialHourRuleApplication.create` por cada regla matcheada, `tx.timeEntry.findFirst` (buscar si ya existe un `TimeEntry` esa fecha) y finalmente `tx.timeEntry.create`/`update`.

Ninguna de las 3 lecturas iniciales (1-3) depende de nada que esta transacción vaya a escribir — son configuración de sistema (reglas/conceptos) y un dato del empleado que ya se lee sin `tx` en otro lugar del mismo archivo. El `findFirst` por segmento (4) es redundante: cada segmento tiene una fecha calendario distinta (`buildShiftSegments` parte estrictamente por medianoche, nunca genera dos segmentos con la misma fecha), así que agruparlos en una sola consulta por rango de fechas da exactamente el mismo resultado con menos round-trips. Cada round-trip contra Neon (Postgres serverless, pooler remoto) suma latencia real — con varios segmentos y varias reglas de Horas Especiales matcheando, la suma fácilmente supera los 5000ms del timeout por defecto de Prisma (nunca configurado explícitamente en este proyecto, confirmado por lectura de `src/shared/prisma/client.ts` y de todos los `$transaction(...)` del repositorio: ninguno pasaba un segundo argumento de opciones antes de esta etapa). El problema es 100% de diseño transaccional/performance, no de frontend ni de la subida de la foto en sí (que ya corre fuera de cualquier transacción, ver §4.3).

## 4. Diagnóstico (Parte 1 del pedido, con evidencia)

1. **Dónde inicia la transacción**: `timeEntriesRepository.closeOpenWorkShift` (`timeEntries.repository.ts`), invocada desde `timeEntriesService.clockPhotoPunch` (rama `SALIDA`), `clockOutResolved` (fichador por DNI) y `closeWorkShiftManually` (cierre manual RRHH) — las tres comparten el mismo repositorio, así que el fix beneficia a las tres, no sólo al fichador con foto.
2. **Qué operaciones ocurrían dentro**: ver §3, puntos 1-4 (antes de esta etapa).
3. **Dónde se guarda la foto/evidencia**: `storeClockPunchPhoto` (`timeEntries.service.ts`), llamada **antes** de `closeOpenWorkShift` — nunca estuvo dentro de ninguna transacción. Sin cambios en esta etapa.
4. **Dónde se crea `AttendancePunch`**: `tx.attendancePunch.create`, dentro de la transacción — indispensable, sin cambios.
5. **Dónde se cierra `WorkShift`**: `tx.workShift.updateMany` (reclamo optimista por `status: "ABIERTO"`) + `tx.workShift.update` (linkea `endPunchId`) — ambos dentro de la transacción, indispensables, sin cambios.
6. **Dónde se crea `TimeEntry`**: `tx.timeEntry.create`/`update` por segmento, dentro de la transacción — es el registro real de horas trabajadas (con `appliedMultiplier` de Horas Especiales ya resuelto), no un efecto secundario diferible; se mantiene dentro (ver §6 sobre por qué).
7. **Dónde se clasifican los Conceptos Horarios**: **antes** de `closeOpenWorkShift`, en `classifySegmentsForEmployee` (`timeEntries.service.ts`) — ya corría fuera de cualquier transacción desde antes de esta etapa (Etapa 6L/13D), sin cambios.
8. **Dónde se consultan `EmployeeHourConcept`/`HourConceptRule`**: dentro de `classifySegmentsForEmployee` (punto 7), vía `hourConceptsRepository.findActiveRules()`/`findEnabledConceptIds()` — ya corrían con `prisma` (no `tx`), **antes** de la transacción, sin cambios en esta etapa. No confundir con `DoubleHourRule`/`HourConcept` (punto 3 de arriba), que es Horas Especiales, un motor completamente distinto.
9. **Dónde se evalúan alertas de salida**: `evaluateShiftExitSafely` (`timeEntries.service.ts`), llamada **después** de que `closeOpenWorkShift` ya retornó — ya es best-effort desde la Etapa 13B (nunca propaga una excepción), sin cambios en esta etapa.
10. **Dónde se crean `SystemNotification`**: dentro de la evaluación de alertas (punto 9) y de `notifyMissingExit` — ambos ya best-effort desde 10E/13B, fuera de cualquier transacción, sin cambios.
11. **Qué usa `tx` y qué usa `prisma` global (después de esta etapa)**: `tx` — `workShift.updateMany`/`update`, `attendancePunch.create`, `timeEntry.findMany`/`create`/`update`, `timeSegment.create`, `specialHourRuleApplication.createMany`. `prisma` (global, antes de abrir la transacción) — `employee.findUnique`, `doubleHourRule.findMany`, `hourConcept.findMany`.
12. **Qué se podía mover fuera**: las 3 lecturas de configuración (punto 11) — confirmado que no dependen de ningún dato que esta transacción escriba, y que ya existía el mismo patrón sin tx para carga manual (`resolveDoubleHourMultiplierForManualEntry`, mismo archivo, líneas ~216-232).
13. **Qué es indispensable para confirmar la fichada**: reclamar el `WorkShift`, crear el `AttendancePunch`, y crear/actualizar `TimeEntry`/`TimeSegment`/`SpecialHourRuleApplication` — es el registro real y verificable de que la persona trabajó esas horas, con el multiplicador correcto ya aplicado. Sin esto, la jornada quedaría cerrada sin ningún dato de horas, un estado inconsistente peor que fallar.
14. **Qué es derivado/recalculable**: las alertas de salida (`SALIDA_ANTICIPADA`/`JORNADA_INSUFICIENTE`/etc.) y las notificaciones — ya se recalculan de forma segura si se reevalúa la misma jornada (upsert por `[workShiftId, type]`, Etapa 10B/13B), por eso ya corrían fuera del bloque crítico desde antes de esta etapa.
15. **¿El procesamiento de imagen ocurre antes, dentro o después de la transacción?**: antes, siempre — `storeClockPunchPhoto` se llama antes de `closeOpenWorkShift` en `clockPhotoPunch`. Nunca estuvo dentro de la transacción.
16. **Por qué el storage de foto tarda ~3 segundos**: es una llamada de red a un proveedor de almacenamiento externo (Google Drive, a juzgar por `driveWebViewLink`/`storageKey` en `storeClockPunchPhoto`) — la subida del archivo original (`storageService.uploadManaged`) es una operación de red genuina, no una consulta a la base. Fuera del alcance de esta etapa optimizarla (requeriría cambiar cuándo se confirma la fichada respecto de cuándo se sube la foto — un cambio de arquitectura/frontend explícitamente fuera de lo pedido); documentado como candidato futuro en §12.
17. **¿El thumbnail ya está diferido?**: sí, desde antes de esta etapa — `scheduleClockThumbnail` usa `setTimeout(750ms)` con `timer.unref()`, corre después de responder al cliente. Lo que **no** estaba diferido era el trabajo dentro de la transacción crítica (el objeto de esta etapa).
18. **¿El timeout de 5000ms es default de Prisma o configurado?**: default de Prisma — confirmado por el propio mensaje de error (`"The timeout for this transaction was 5000 ms"`) y por lectura de `src/shared/prisma/client.ts` (sin ninguna configuración global de `$transaction`) y de los ~10 call sites de `prisma.$transaction(...)` en el repositorio (ninguno pasaba opciones antes de esta etapa).
19. **¿Riesgo de doble creación en reintentos?**: no — `tx.workShift.updateMany({ where: { status: "ABIERTO" } })` es un reclamo optimista: si `claimed.count !== 1` (la jornada ya no está `ABIERTO`, sea porque otro intento la cerró o porque el timeout anterior hizo rollback de todo), lanza `WORK_SHIFT_ALREADY_CLOSED` **antes** de crear ningún `AttendancePunch`/`TimeEntry` — confirmado con test nuevo (§9).
20. **¿`ClockPunchAttempt` ya permite idempotencia real?**: sí, sin cambios en esta etapa — `requestId` único, estados `PROCESSING`/`COMPLETED`/`FAILED`, con `createClockPunchAttempt` protegido por `P2002` (mismo `requestId` en vuelo devuelve 409 `CLOCK_ATTEMPT_PROCESSING`; ya completado devuelve la respuesta guardada sin reprocesar; ya fallido re-lanza el error guardado) — mecanismo de la Etapa 10E/anteriores, confirmado con los tests existentes de `clockPhotoPunchIdempotent` (sin tocar).

## 5. ¿Qué pasa exactamente cuando el timeout vence? (por qué la evidencia no queda huérfana)

Prisma gestiona el timeout de una transacción interactiva con un timer independiente del callback: al vencer, hace **rollback completo** de la transacción y cualquier query posterior contra `tx` lanza `Transaction already closed`. Es decir, cuando este bug se disparaba, **nada quedaba persistido** — ni el `AttendancePunch`, ni el cierre del `WorkShift`, ni ningún `TimeEntry`. El catch de `clockPhotoPunch` (`timeEntries.service.ts`) llama a `cleanupClockEvidence(evidence)` en ese escenario, y eso es **correcto**: no hay ninguna fila persistida que referencie la evidencia fotográfica en ese momento, así que borrarla no deja nada huérfano ni contradice la Regla 6 del pedido. El caso que sí sería un problema (salida guardada pero tratada como fallida) es el que ya había corregido la Etapa 13B para el post-proceso (`evaluateShiftExit`/alertas) — un bug distinto, ya resuelto, no reintroducido por este.

## 6. Política transaccional final (Parte 2/3 del pedido)

**Dentro de la transacción** (indispensable para que la salida quede confirmada de forma atómica):
- Reclamo optimista del `WorkShift` (`updateMany` con guardia de `status: "ABIERTO"`).
- Creación del `AttendancePunch` de salida.
- Link del `endPunchId` al `WorkShift`.
- Chequeo agrupado de `TimeEntry` existente (1 `findMany`, no 1 `findFirst` por segmento).
- Creación de `TimeSegment` por segmento (evidencia/trazabilidad de cómo se partió la jornada).
- Creación/actualización de `TimeEntry` por segmento — **se mantiene dentro**: es el registro real de horas trabajadas con el multiplicador de Horas Especiales ya resuelto, no un efecto secundario diferible (Regla 1/2 del pedido). Sacarlo de la transacción abriría una ventana real donde el `WorkShift` queda cerrado sin ningún `TimeEntry` — un estado peor que el actual, y contradice explícitamente el pedido ("si hoy es obligatorio para consistencia inmediata").
- Creación en lote de `SpecialHourRuleApplication` (1 `createMany` después del loop, no 1 `create` por regla por segmento).

**Fuera de la transacción** (ya lo estaban, o se movieron en esta etapa):
- Resolución de scope del empleado, reglas de Horas Especiales activas y conceptos nocturnos — **movido en esta etapa**, con `prisma` antes de abrir el `tx`.
- Clasificación de Conceptos Horarios (`classifySegmentsForEmployee`) — ya estaba fuera.
- Evaluación de alertas de salida (`evaluateShiftExitSafely`) — ya era best-effort, fuera del bloque crítico, desde 13B.
- Notificaciones (`SystemNotification`) — ya eran best-effort desde 10E/13B.
- Subida de la foto original — ya corría antes de la transacción.
- Subida del thumbnail — ya diferida (`setTimeout`) desde antes de esta etapa.
- Auditoría (`scheduleClockAudit`) — ya diferida desde antes de esta etapa.

## 7. Idempotencia (Parte 4 del pedido)

Sin cambios de código en esta etapa — el mecanismo ya cumplía las 5 reglas pedidas, confirmado con evidencia y tests (nuevos y preexistentes):

1. **Mismo `requestId` no duplica salida**: `ClockPunchAttempt.requestId` es único; un segundo intento con el mismo `requestId` mientras el primero está `PROCESSING` recibe 409 sin ejecutar nada; uno ya `COMPLETED` devuelve la respuesta guardada sin reprocesar (test preexistente, `clockPhotoPunchIdempotent`).
2. **Tarea secundaria falla, la fichada igual queda confirmada**: `evaluateShiftExitSafely` nunca propaga (13B); el `ClockPunchAttempt` se marca `COMPLETED` con la respuesta real apenas `clockPhotoPunch` retorna, sin esperar a la evaluación de alertas.
3. **No se borra evidencia ya asociada a un punch confirmado**: `cleanupClockEvidence` sólo se llama en las ramas de error **antes** de que la transacción haya committeado (ver §5) — nunca después de un `closeOpenWorkShift` exitoso.
4. **Falla antes de crear el punch → intento fallido**: `claimed.count !== 1` lanza `WORK_SHIFT_ALREADY_CLOSED` antes de tocar `AttendancePunch`/`TimeEntry` — mapeado a 409 `CLOCK_ALREADY_CLOSED` (mensaje: "La salida ya fue registrada por otro intento."), no a un 503 genérico.
5. **El mensaje refleja si quedó confirmada o no**: `clockPhotoPunchIdempotent` distingue explícitamente `COMPLETED` (devuelve la respuesta real), `FAILED` (re-lanza el error guardado, con su código/mensaje/status originales) y `PROCESSING` (409 "La fichada todavía se está procesando.") — sin ambigüedad, sin cambios en esta etapa.

## 8. Manejo de evidencia

Sin cambios de código — confirmado que el flujo ya es correcto (§5, §7.3). La foto original se sube antes de la transacción; si la transacción falla (por cualquier motivo, incluido un timeout), no hay ninguna fila persistida que la referencie, así que `cleanupClockEvidence` no deja nada huérfano. Si la transacción tiene éxito, ningún camino de código llama a `cleanupClockEvidence` después — confirmado por lectura completa de `clockPhotoPunch` (sin cambios en esta etapa).

## 9. Tests (Parte 5 del pedido)

**Backend** (+6 tests nuevos sobre `timeEntries.repository.test.ts`, más 1 test existente corregido — "Caso H" pasó de esperar `specialHourRuleApplication.create` a `createMany`, reflejando el batching; 980 → 985 total, todos verdes):

Nuevo describe "`closeOpenWorkShift` — Etapa 13F":
1. Las 3 lecturas de Horas Especiales corren vía `prisma`, nunca vía `tx` (Parte 1 + Tests obligatorios #7).
2. La transacción se abre con `{ timeout: 10_000 }` (Parte 6).
3. Una jornada que cruza medianoche (2 segmentos, 2 fechas) consulta `TimeEntry` existente una sola vez agrupado, nunca un `findFirst` por segmento.
4. Si el `WorkShift` ya no está `ABIERTO` (reclamo optimista falla), lanza `WORK_SHIFT_ALREADY_CLOSED` sin crear `AttendancePunch`/`TimeEntry`/`TimeSegment` — nada se duplica (Tests obligatorios #4/#5/#11).
5. Un `TimeEntry` existente se reutiliza correctamente vía el mapa por fecha (mismo resultado que el `findFirst` de antes, ahora resuelto desde el `findMany` agrupado).
6. "Caso H" (preexistente, corregido): una regla + un segmento → una sola fila de `SpecialHourRuleApplication`, ahora vía `createMany` con un array de longitud 1 en vez de `create` — mismo resultado observable (sin duplicar), mecanismo distinto.

**Cobertura ya existente, no duplicada, confirmada sin regresión** (Tests obligatorios #1, #2, #3, #6, #8, #9, #10, corridos como parte de la suite completa, sin tocar):
- #1/#2 — "si `evaluateShiftExit` falla, la salida igual se confirma" / "un fallo creando una `ShiftAlert` no propaga la excepción" (`timeEntries.service.test.ts` Caso 9, `workShiftEvaluationRunner.test.ts`, ambos de la Etapa 13B) — la salida sigue confirmando aunque la evaluación secundaria falle, y ningún error de post-proceso se propaga como "Transaction already closed" ni ningún otro.
- #3 — `clockPhotoPunchIdempotent` "responde con la respuesta ya guardada si el intento está `COMPLETED`" — reintento del mismo `requestId` devuelve confirmado.
- #6 — confirmado por lectura de código (§8), no requiere un test nuevo: ningún camino de éxito llama a `cleanupClockEvidence`.
- #8 — toda la suite de entrada (`evaluateShiftEntry`, Etapas 13A/13E/13E.1) sigue verde, cero archivos de entrada tocados.
- #9 — "Caso A" y el resto de tests de `closeOpenWorkShift`/`createFromWorkShift` preexistentes (salida normal, sin regla especial) siguen verdes.
- #10 — tests de `SALIDA_ANTICIPADA` en `workShiftEvaluationRunner.test.ts` (Etapa 13B), sin tocar, best-effort confirmado.
- #11 — `clockOutByEmployee` "mapea un cierre concurrente (`WORK_SHIFT_ALREADY_CLOSED`) a un 409 prolijo" (`timeEntries.service.test.ts`), más el nuevo test #4 de esta etapa a nivel repositorio (mismo escenario, una capa más abajo).
- #12 — ningún archivo de liquidación (`TimeEntry.hours/totalMinutes/appliedMultiplier` como fórmula, `HourConceptBreakdown`, export) fue tocado; la suite completa de Horas Especiales/exportación sigue verde.

## 10. Performance (Parte 6 del pedido)

**Antes** (para una jornada con 2 segmentos y 1 regla de Horas Especiales matcheando cada uno, el caso más simple con Horas Especiales activas): dentro del `tx` — 3 (claim + punch + link) + 3 (scope + reglas + conceptos nocturnos) + 2×(1 `timeSegment.create` + 1 `specialHourRuleApplication.create` + 1 `timeEntry.findFirst` + 1 `timeEntry.create`/`update`) = 3 + 3 + 8 = **14 queries secuenciales dentro de la transacción** (el log real reportó 21 queries totales de la request completa, un caso con más segmentos/reglas). A ~300-450ms por round-trip contra un pooler remoto (Neon), 14-21 queries secuenciales cruzan cómodamente el presupuesto de 5000ms.

**Después**: dentro del `tx` — 3 (claim + punch + link) + 1 (`timeEntry.findMany` agrupado) + 2×(1 `timeSegment.create` + 1 `timeEntry.create`/`update`) + 1 (`specialHourRuleApplication.createMany`, una sola vez para ambos segmentos) = 3 + 1 + 4 + 1 = **9 queries dentro de la transacción** para el mismo caso — una reducción de 5 round-trips (~36%), con las 3 lecturas más pesadas (scope + reglas con `include: dates` + conceptos) completamente fuera del presupuesto del timeout. Para jornadas con más segmentos o más reglas matcheando, la reducción es proporcionalmente mayor (el `createMany` colapsa a 1 query sin importar cuántas reglas matcheen; el `findMany` agrupado colapsa a 1 query sin importar cuántos segmentos tenga la jornada).

**Por qué ya no debería vencer el timeout de 5s**: se eliminaron las 3 queries más costosas del presupuesto crítico (la de `doubleHourRule` en particular incluye un join a `dates`) y se convirtió el crecimiento del número de queries dentro del tx de **lineal en (segmentos × reglas)** a **lineal sólo en segmentos** para las escrituras indispensables (2 por segmento en vez de hasta 4). Combinado con el margen adicional del timeout (10000ms, defensa en profundidad, §6), el escenario que generó el 503 real (21 queries, 9451ms) ya no debería reproducirse con el mismo volumen de datos — y si lo hiciera, tiene el doble de margen antes de expirar.

**Timeout aumentado como defensa, no como solución**: confirmado explícitamente en el código (comentario en `closeOpenWorkShift`) y acá — el fix principal es la reducción de trabajo; el timeout de 10000ms es una segunda capa de margen ante variabilidad de latencia de Neon (cold starts del pooler, picos de red), no un intento de "esperar más" sin resolver la causa.

## 11. Qué NO se tocó

- Entrada (`evaluateShiftEntry`, `matchShiftForEmployee`, `createOpenWorkShift`, `rolloverExpiredOpenWorkShift`) — cero líneas tocadas. `createFromWorkShift` (alta manual de un día completo por RRHH) — comparte el mismo patrón de lecturas dentro de `tx` que tenía `closeOpenWorkShift` antes de esta etapa (mismo comentario en el código, "los dos únicos lugares que consultan `DoubleHourRule`"), pero **no fue tocado**: el pedido acota explícitamente esta etapa a "el error real actual del fichador de salida", y `createFromWorkShift` no es el camino de entrada del fichador (es una carga manual completa de RRHH, sin el mismo patrón de timeout reportado) — documentado como riesgo/candidato futuro en §12.
- El motor de matching/prioridad/scope de Horas Especiales (`doubleHourRuleScopeWhere`, `matchingDoubleHourRules`, `resolveWinningRules`) — funciones puras, reutilizadas tal cual, ninguna línea de su lógica de negocio modificada.
- Conceptos Horarios (`hourConceptClassification.ts`, `classifySegmentsForEmployee`) — sólo se leyó para el diagnóstico; ya corría fuera de cualquier transacción desde antes, ningún archivo tocado.
- Liquidación (`TimeEntry.hours/totalMinutes/actualMinutes/appliedMultiplier` como fórmula) — sin cambios; se preserva exactamente el mismo cálculo, sólo cambia cuántos round-trips hacen falta para llegar a él.
- Grilla/export/bandeja de revisión — ningún archivo tocado.
- Frontend — ningún archivo tocado (el pedido no lo permitía, y no hizo falta: el fix es 100% backend).
- `schema.prisma` — sin cambios, sin migraciones (el timeout de la transacción es un parámetro de la llamada a `$transaction`, no algo persistido).
- La subida de la foto original a storage (~2983ms) — diagnosticada (§4.16) pero no optimizada; no contribuye al timeout de la transacción (corre antes, fuera de cualquier tx) y su optimización implicaría un cambio de arquitectura (confirmar la fichada antes de subir la foto) fuera del alcance pedido.
- El thumbnail diferido y la auditoría diferida — ya optimizados desde antes de esta etapa, sin cambios.
- Permisos/RBAC — sin cambios.
- `clockPhotoPunch`/`clockPhotoPunchIdempotent`/`clockOutResolved`/`closeWorkShiftManually` (capa de servicio) — ningún archivo tocado; se benefician del fix automáticamente por compartir `closeOpenWorkShift`, sin necesitar ningún cambio propio.

## 12. Riesgos pendientes

- **`createFromWorkShift` no recibió el mismo fix** (§11) — comparte el patrón exacto de 3 lecturas dentro de `tx` que causaba el problema acá. Es el alta manual de un día completo por RRHH (no el fichador), así que el volumen/frecuencia de uso es mucho menor y no fue el origen del bug reportado — pero si en el futuro se reporta un timeout similar en esa vía, el mismo fix (hoisting de las 3 lecturas + batching del `findFirst`) aplica sin cambios conceptuales. Recomendado como próxima etapa si aparece un caso real.
- **Photo storage (~3s) sigue siendo el mayor componente de latencia de la request completa** (aunque no del timeout de la transacción) — si en el futuro se prioriza reducir el tiempo total de respuesta del fichador (no sólo evitar el 503), requeriría repensar cuándo se confirma la fichada respecto de cuándo se sube la foto original — cambio de arquitectura y potencialmente de frontend, fuera del alcance actual.
- **Timeout de 10000ms sigue siendo una constante fija, no configurable por variable de entorno** — si Neon (u otro proveedor futuro) tuviera picos de latencia más severos, ajustar este valor hoy requiere un cambio de código, no de configuración. No se justificó hacerlo configurable sin un caso real que lo pida.
- **El scope del empleado (sector/centro de costo/puesto) se lee antes de la transacción, no dentro de ella** — mismo riesgo ya aceptado por `resolveDoubleHourMultiplierForManualEntry` (carga manual) desde la Etapa 11A: si el sector de un empleado cambiara en la ventana de milisegundos entre esta lectura y el commit de la transacción, el multiplicador de Horas Especiales podría resolverse contra el scope viejo. Riesgo teórico, ya aceptado en un camino equivalente del mismo sistema, no nuevo.

---

No se tocó entrada, Horas Especiales (motor de negocio), Conceptos Horarios, liquidación, grilla/export/bandeja, frontend, ni se crearon migraciones. No commitear sin aprobación explícita del usuario.
