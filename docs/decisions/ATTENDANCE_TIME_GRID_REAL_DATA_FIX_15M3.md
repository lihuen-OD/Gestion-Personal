# Etapa 15M.3 — Diagnóstico con datos reales y corrección definitiva Asistencia ↔ Carga Horaria

Fecha: 2026-09-17
Estado: causa raíz confirmada con datos reales, fix implementado y testeado, pendiente de aprobación para commitear
Continúa: `docs/decisions/ATTENDANCE_AUTO_BREAKDOWN_SYNC_15M2.md` (15M.1/15M.2, auditoría + primer fix, ambos aún sin commitear), `docs/decisions/CLOCK_PHOTO_PUNCH_EXIT_TRANSACTION_13F.md` (etapa donde se introdujo la regresión real)

## 1. Resumen ejecutivo

15M.1/15M.2 diagnosticaron y corrigieron correctamente que Motor B (`HourConceptBreakdown`) no se disparaba automáticamente. Esta etapa investigó un síntoma **distinto y más grave**, confirmado con lectura real de la base (Neon, sólo `SELECT`): la propia **Hora normal** (`TimeEntry` NORMAL_BASE) puede perder minutos reales cuando una jornada fichada se clasifica en más de un `TimeSegment` de la misma fecha calendario (por ejemplo, porque el empleado tiene un concepto adicional `AUTOMATIC` con una regla horaria que sólo cubre parte del turno). La causa es un bug de acumulación en `closeOpenWorkShift` (`timeEntries.repository.ts`), introducido el **2026-09-02** en el commit `d47dcdd` ("feat: optimize closeOpenWorkShift transaction to prevent timeout errors", Etapa 13F) — confirmando la sospecha del usuario de que "esto antes andaba bien". Se corrigió agrupando los minutos por fecha calendario antes de escribir `TimeEntry`, en vez de escribir una vez por tramo sobre una referencia `existing` que quedaba stale entre tramos.

## 2. Estado Git inicial

`main`, 0 ahead/0 behind. 15M.2 seguía sin commitear (9 archivos modificados + `ATTENDANCE_AUTO_BREAKDOWN_SYNC_15M2.md` sin trackear) — se preservó íntegro, no se hizo `reset` de nada.

## 3. Base consultada

`backend/.env` → `DATABASE_URL` apunta a Postgres real en Neon (`ep-gentle-resonance-aiftcbel-pooler.c-4.us-east-1.aws.neon.tech`, base `neondb`, `sslmode=require`). Es la misma base compartida ya usada en auditorías previas (8F, 11A). No se imprimieron credenciales.

## 4. Método read-only utilizado

Script temporal `backend/tmp-15m3-diagnose.ts` (Prisma Client, sólo `findFirst`/`findMany`/`groupBy`), ejecutado con `npx tsx`, **borrado al terminar** — no quedó ningún rastro (confirmado con `git status`). Cero `UPDATE`/`DELETE`/`INSERT`/`migrate deploy` contra Neon en toda la etapa.

## 5. Legajo 30 localizado

`Employee { legajo: "30" }` → 1 fila, `status: ACTIVO`. Referido como "Empleado legajo 30" en todo este documento; no se expone nombre/DNI/CUIL.

## 6. AttendancePunch real (16/09/2026)

4 fichadas reales, en 2 pares:

| # | Tipo | Hora ART | Fuente |
|---|---|---|---|
| 1 | INGRESO | 07:47:06 | PUBLIC_CLOCK_PHOTO |
| 2 | SALIDA | 07:48:32 | PUBLIC_CLOCK_PHOTO |
| 3 | INGRESO | 07:50:46 | PUBLIC_CLOCK_PHOTO |
| 4 | SALIDA | 11:59:36 | PUBLIC_CLOCK_PHOTO |

Los pares 1-2 son una fichada accidental de 1 minuto (probable doble tap); 3-4 es la jornada real de ~4h.

## 7. WorkShift real (16/09/2026)

| WorkShift | status | startAt→endAt (ART) | totalMinutes |
|---|---|---|---|
| A | PROCESADO | 07:47:06→07:48:32 | 1 |
| B | PROCESADO | 07:50:46→11:59:36 | 249 |

`Σ WorkShift.totalMinutes (PROCESADO) = 250`.

## 8. TimeSegment real (16/09/2026)

| WorkShift | Tramo (ART) | minutos | Concepto | conceptStatus |
|---|---|---|---|---|
| A | 07:47:06→07:48:32 | 1 | Hora normal | SIN_CONCEPTO_COMPATIBLE |
| B | 07:50:46→09:00:00 | 69 | Hora normal | SIN_CONCEPTO_COMPATIBLE |
| B | 09:00:00→11:00:00 | 120 | **Prueba** (AUTOMATIC) | SUGERIDO |
| B | 11:00:00→11:59:36 | 60 | Hora normal | SIN_CONCEPTO_COMPATIBLE |

`Σ TimeSegment.minutes = 250` — coincide exacto con `Σ WorkShift.totalMinutes`. Motor A clasificó correctamente: el WorkShift B quedó partido en 3 tramos porque el empleado tiene "Prueba" (concepto adicional `AUTOMATIC`) habilitado con una regla horaria 09:00-11:00 que sólo cubre parte del turno.

## 9. HourConcept NORMAL_BASE

`{ id: "be6897f6-...", code: "HC-NORMAL", name: "Hora normal", status: ACTIVO }` — un único canónico, como exige el `@unique` de `systemRole`.

## 10. TimeEntry real (16/09/2026)

**Una sola fila** para ese día:

```
hourConcept: Hora normal (NORMAL_BASE)
hours: "1.02"
totalMinutes: 61
actualMinutes: 61
status: APROBADO
workShiftId: <WorkShift B>
timeSegmentId: <tramo 11:00→11:59:36, el ÚLTIMO tramo de B>
observation: "Generado por fichada de ingreso/salida.\nFichada <B>: generado por ingreso/salida."
```

Respuestas puntuales:
- A/B. Un solo `TimeEntry` NORMAL_BASE ese día.
- C. No hay duplicados ese día específico (sí los hay en otras fechas del mismo empleado, ver §20).
- D. Sí, 1.02h está realmente persistido en la base — no es un problema de lectura/cache.
- E/F/G. Ver trazado matemático exacto en §19: `timeSegmentId` apunta exactamente al último tramo de B (60 min), y `61 = 1 (arrastrado de A) + 60 (último tramo de B)` — los tramos de 69 y 120 minutos se perdieron.
- H. Sí — el vínculo `workShiftId`/`timeSegmentId` quedó sobrescrito 3 veces (una por cada tramo de B), y sólo sobrevivió el de la última escritura.

## 11. HourConceptBreakdown real (16/09/2026)

`count = 0`. Ningún desglose automático de "Prueba" existe para ese día, a pesar de que la regla y el turno matchean perfectamente (120 minutos). Esto es exactamente lo esperado dado que **15M.2 (el fix que dispara Motor B automáticamente) todavía no está commiteado/desplegado** — el backend real que procesó esta fichada el 16/09 corría el código anterior a 15M.2, sin ningún disparo automático. No es un bug nuevo; confirma la causa raíz ya diagnosticada en 15M.1.

## 12. EmployeeHourConcept / loadMode

Legajo 30 tiene habilitado exactamente un concepto adicional: **"Prueba"**, `loadMode: AUTOMATIC`, `status: ACTIVO`, `deletedAt: null`, con 1 regla activa (09:00–11:00, sin cruce de medianoche).

## 13. Reglas activas

`HourConceptRule { hourConceptId: Prueba, startTime: "09:00", endTime: "11:00", crossesMidnight: false, status: ACTIVO }` — coincide exactamente con el tramo de 120 min clasificado por Motor A (§8).

## 14. Total WorkShift

250 minutos (1 + 249), ambos `PROCESADO`.

## 15. Total TimeSegment

250 minutos — coincide con §14.

## 16. Total TimeEntry

**61 minutos** — el valor persistido real. Coincide exactamente con lo que muestra la grilla (1.02h), confirmando que **el bug es de persistencia, no de lectura/cache/agregación**.

## 17. Valor `/time-entries/period-employees`

No se levantó el servidor local para esta verificación puntual: dado que `findPeriodEmployees` suma `entry.hours` de **todos** los `TimeEntry` con `systemRole=NORMAL_BASE` y `status ∈ {APROBADO, EN_REVISION}` (confirmado leyendo el código, §25), y el único `TimeEntry` real de ese día ya tiene `hours="1.02"`, `status=APROBADO`, este endpoint **debe** devolver 1.02h para el 16/09 — el dato de entrada ya está corrupto antes de llegar a este endpoint.

## 18. Valor `/employees/:id/time-grid`

Mismo razonamiento que §17: `buildAdditiveTimeGrid` suma exactamente los mismos campos (`hours`, `systemRole=NORMAL_BASE`, `status APROBADO/EN_REVISION`) del mismo `TimeEntry`. Debe devolver 1.02h también. **Ambas grillas leen la misma fila corrupta — no hay divergencia de lógica entre ellas** (ver §25).

## 19. Origen exacto de 1.02h — trazado matemático completo

`1.02h = 61 min`. Se reconstruyó exactamente cómo se llegó a ese número, tramo por tramo, contra el código de `closeOpenWorkShift` **antes de esta etapa**:

```
WorkShift A cierra primero (07:48:32) → no existe TimeEntry ese día → CREATE
  TimeEntry.totalMinutes = 1 (el único tramo de A)

WorkShift B cierra después (11:59:36), con 3 tramos (69, 120, 60):
  existingByDate = { 16/09: <TimeEntry con actualMinutes=1> }   -- leído UNA sola vez, antes del loop

  tramo 1 (Hora normal, 69 min):
    existing = existingByDate.get(16/09) = actualMinutes=1 (snapshot ORIGINAL)
    nextRealMinutes = 1 + 69 = 70
    UPDATE TimeEntry → totalMinutes=70   (pero existingByDate NO se refresca)

  tramo 2 (Prueba, 120 min):
    existing = existingByDate.get(16/09) = SIGUE siendo actualMinutes=1 (el mismo snapshot stale)
    nextRealMinutes = 1 + 120 = 121
    UPDATE TimeEntry → totalMinutes=121   (pisa el resultado del tramo 1; 70 se pierde)

  tramo 3 (Hora normal, 60 min):
    existing = existingByDate.get(16/09) = SIGUE siendo actualMinutes=1
    nextRealMinutes = 1 + 60 = 61
    UPDATE TimeEntry → totalMinutes=61   (pisa el resultado del tramo 2; 121 se pierde)

RESULTADO FINAL: totalMinutes = 61, timeSegmentId = tramo 3 (el último)
```

`61/60 = 1.01666...` → `Decimal(8,2)` redondea a **`1.02`** — coincide exactamente con el valor real persistido en `TimeEntry.hours` y con lo que muestra la UI. Trazado 100% determinístico, sin ninguna suposición: se explica con el propio código anterior a esta etapa más los datos reales de §6-§10.

## 20. Duplicados

`GROUP BY employeeId, date, hourConceptId HAVING COUNT(*) > 1` (global, sólo lectura): **8 grupos, 5 empleados distintos**. Legajo 30 tiene 2 grupos duplicados: 14/09 y 15/09 (no en 16/09 — ahí el bug se manifestó como pérdida de minutos, no como duplicado; ver §21 para la explicación de por qué el mismo bug produce dos síntomas distintos según haya o no una fila previa ese día).

Se verificó el mecanismo exacto para legajo 30/14-15 de septiembre: un único `WorkShift` nocturno (16:58 del 14/09 → 10:23 del 15/09, `totalMinutes=1044`) se clasificó en 4 `TimeSegment` (421 min "Hora normal" + 180 min "Sereno" + 180 min "Sereno" + 263 min "Hora normal"), de los cuales 2 tramos caen en la fecha calendario 14/09 (421+180=601) y 2 en la fecha 15/09 (180+263=443). Como **no existía ningún `TimeEntry` previo** para esas fechas, cada tramo tomó la rama `else` (creación) del mismo bug — el `Map` `existingByDate` nunca se actualiza dentro del loop, así que el segundo tramo de cada fecha no encontró al primero y creó una fila nueva en vez de acumular. Resultado: 2 filas por fecha en vez de 1, sumando igual (601 y 443 respectivamente coinciden con los totales reales) pero como **dos registros separados** — el mismo defecto de raíz, con síntoma distinto (duplicado en vez de pérdida) según si había o no una fila previa que pisar.

## 21. Statuses

Los `TimeEntry` de fichador (`closeOpenWorkShift`) siempre fuerzan `status: "APROBADO"` sin excepción (confirmado en el código, tanto antes como después del fix) — **no hay exclusión por status** en este caso: la fila de 61 min ya estaba `APROBADO`, igual que las de días 1/14/15. La hipótesis "una jornada quedó BORRADOR y la grilla sólo muestra APROBADO" se descarta con evidencia — todas las filas de fichador de legajo 30 en septiembre están `APROBADO`.

## 22. `hours` vs `totalMinutes` vs `actualMinutes`

Se verificó **globalmente** (71 `TimeEntry` en toda la base) que `round(hours*60) === totalMinutes` y `actualMinutes === totalMinutes` en el 100% de los casos — **cero mismatches**, incluido legajo 30. Esto descarta cualquier bug de conversión/redondeo (Etapa 8F sigue intacta) — el problema nunca fue una fórmula de conversión, siempre fue cuántos minutos reales terminaban escritos en la fila.

## 23. `workShiftId`/`timeSegmentId`

Confirmado en §19: cada `tx.timeEntry.update()` sobrescribe `workShiftId`/`timeSegmentId` con los del tramo que se está procesando en ese momento — por diseño, estos campos siempre reflejan sólo el **último** tramo tocado, nunca "todos". Esto ya era así antes de esta etapa y sigue siendo así después (es un campo de trazabilidad de un solo tramo por diseño de schema, no de cálculo) — lo que cambió es que ahora sólo hay **una escritura por fecha** (no una por tramo), así que el campo apunta al último tramo de esa fecha exactamente una vez, sin que tramos intermedios pisen `totalMinutes` en el camino.

## 24. Caché

No aplica como causa en este caso — se descartó explícitamente en §16-§18: la propia fila de `TimeEntry` en base ya tiene 61 min/1.02h. Ninguna caché (backend `employeeTimeGridCache`/`timeEntriesPeriodEmployeesCache`, ni el frontend) puede "inventar" un valor menor al que hay en base — sólo puede servir una versión vieja de un valor que en algún momento fue correcto, y acá el valor nunca llegó a ser correcto en primer lugar.

## 25. Comparación de las dos grillas

`findPeriodEmployees` (`GET /time-entries/period-employees`) y `getTimeGrid`/`buildAdditiveTimeGrid` (`GET /employees/:id/time-grid`) usan **exactamente la misma fuente y el mismo filtro**: `TimeEntry` con `hourConcept.systemRole === "NORMAL_BASE"` y `status ∈ {APROBADO, EN_REVISION}`, sumando `hours` (equivalente a `totalMinutes/60`) agrupado por día — confirmado leyendo ambas implementaciones línea por línea. **No hay divergencia de lógica entre ambas grillas** — la hipótesis de la Etapa 34 del pedido (¿usan fórmulas distintas?) se descarta con evidencia de código: ambas leen la misma tabla, el mismo filtro de status, el mismo campo. No hizo falta unificar nada porque nunca estuvieron desalineadas.

## 26. Commit/etapa que introdujo la regresión

**Confirmado con `git log -S"existingByDate"`:** commit `d47dcdd96351f162f4c4cb1b70b66457f82a5f11`, **2026-09-02**, `"feat: optimize closeOpenWorkShift transaction to prevent timeout errors"` (Etapa 13F, `docs/decisions/CLOCK_PHOTO_PUNCH_EXIT_TRANSACTION_13F.md`). Ese commit reemplazó, por rendimiento (reducir round-trips dentro de la transacción crítica del fichador), un `tx.timeEntry.findFirst` **fresco por segmento** por un único `tx.timeEntry.findMany` **antes del loop**, cacheado en un `Map` nunca refrescado. Antes de ese commit, cada segmento releía el estado recién escrito por el segmento anterior (misma transacción, lecturas frescas) y acumulaba correctamente. El commit está en `main` desde el 2 de septiembre — 14 días antes de la fecha del caso reportado (16 de septiembre) — consistente con la afirmación del usuario de que "esto antes andaba bien". `createFromWorkShift` (alta manual RRHH) **nunca tuvo este bug**: mantiene su `tx.timeEntry.findFirst` fresco por segmento hasta el día de hoy, y se confirmó por trazado manual que acumula correctamente incluso con múltiples tramos de la misma fecha.

## 27. Causa raíz exacta

**"La causa raíz es que `closeOpenWorkShift` (`timeEntries.repository.ts`) construye el `Map` `existingByDate` una sola vez antes del loop de tramos (optimización de la Etapa 13F, commit `d47dcdd`, 2026-09-02) y nunca lo refresca entre tramos de la misma jornada — porque cuando una jornada se clasifica en más de un `TimeSegment` de la misma fecha calendario (por un concepto adicional AUTOMATIC/BOTH cuya regla horaria sólo cubre parte del turno, como 'Prueba' 09:00-11:00 en un turno 07:50-11:59), cada tramo recalcula `TimeEntry.totalMinutes` a partir del MISMO snapshot stale tomado antes del loop en vez de partir del resultado que el tramo anterior acaba de escribir, y la última escritura sobreescribe por completo a las anteriores en vez de acumularlas — demostrado exactamente con datos reales de legajo 30, 16/09/2026: 250 minutos reales (WorkShift+TimeSegment) terminaron persistidos como 61 minutos (1.02h) en `TimeEntry`, con trazabilidad matemática exacta tramo por tramo en §19."**

Sin "probablemente", sin "parece" — reconstruido con datos reales y con el código exacto vigente en ese momento.

## 28. Fix implementado

`closeOpenWorkShift` (`backend/src/modules/time-entries/timeEntries.repository.ts`):

1. El loop de tramos sigue creando un `TimeSegment` por tramo (evidencia técnica, sin cambios) y acumulando `SpecialHourRuleApplication` (sin cambios).
2. En vez de escribir `TimeEntry` dentro de ese mismo loop, ahora acumula, por fecha calendario: `dailyNormalMinutes` (suma de minutos de TODOS los tramos de esa fecha), `lastSegmentByDate` (para el vínculo de trazabilidad `timeSegmentId`/`segmentStartAt`/`segmentEndAt`) y `dailyMultiplier` (multiplicador/reglas de Horas Especiales — estable por fecha, ver nota abajo).
3. **Después** de terminar de crear todos los `TimeSegment`, un segundo loop (uno por fecha distinta, no por tramo) hace exactamente **un** `tx.timeEntry.update`/`create` por fecha, usando el total acumulado de esa fecha.
4. Se agregó `orderBy: { createdAt: "asc" }` a la consulta `existingEntries` — si existiera un duplicado histórico real (ver §20) para una fecha, el `Map` (que sólo puede quedarse con una fila por clave) se queda determinísticamente con la más reciente en vez de depender del orden no garantizado de Postgres sin `ORDER BY`.

Nota sobre Horas Especiales: `DoubleHourRule` matchea por fecha calendario completa, nunca por franja horaria (`docs/decisions/HOURS_GRID_SPECIAL_HOURS_LIQUIDABLE_11A1.md`), así que todos los tramos de una misma fecha ya comparten el mismo `multiplier`/reglas — agruparlos por fecha no cambia ningún resultado de Horas Especiales, sólo corrige la acumulación de minutos reales.

## 29. Por qué el fix es general

No se tocó nada específico de legajo 30 — el fix corrige la función `closeOpenWorkShift`, que es **el único camino real de cierre de jornada vía fichador** para todos los empleados (`clockPhotoPunch` salida y `clockOutResolved`, usados por `clockOut`/`clockOutByEmployee`). Cualquier empleado con un concepto adicional `AUTOMATIC`/`BOTH` habilitado, o cuya jornada cruce medianoche con más de un tramo por fecha, se beneficia del mismo fix. Los 5 empleados con duplicados encontrados en §20 dejarán de generar nuevos duplicados a partir de este fix (los duplicados/pérdidas ya existentes no se tocan — ver §40/§41, backfill separado y no aplicado).

## 30. Tests — múltiples WorkShift/tramos

`timeEntries.repository.test.ts`, nuevo describe `"Etapa 15M.3 — múltiples TimeSegment de la MISMA fecha no se pisan entre sí"`:
- Sin `TimeEntry` previo: 3 tramos de la misma fecha (69+120+60=249) → 3 `TimeSegment.create`, pero **1 solo** `TimeEntry.create` con `totalMinutes=249` (nunca 3 filas, nunca sólo el último tramo).
- Con un `TimeEntry` previo (1 min, de otra jornada cerrada antes ese día): acumula exactamente una vez → `1+69+120+60=250` (reproduce el caso real de legajo 30 — antes del fix daba 61, confirmado revirtiendo el fix y viendo fallar el test, ver §35).
- El `TimeEntry` final queda vinculado al último `TimeSegment` de la fecha (trazabilidad), sin que eso reduzca los minutos acumulados.

Los tests preexistentes de `closeOpenWorkShift` (cruce de medianoche real, 2 fechas distintas → 2 `TimeEntry`) siguen exactamente iguales y en verde, sin ninguna modificación — confirman que el fix no altera el comportamiento correcto ya existente para fechas distintas.

## 31. Tests — ambas grillas

No se agregó un test nuevo de "ambas grillas dan el mismo total" porque **§25 demostró con lectura de código que ya comparten exactamente la misma fuente/filtro/agregación** — no había ninguna divergencia que un test debiera blindar más allá de lo que ya cubren `timeEntries.repository.test.ts` (`findPeriodEmployees`) y `employees.service.test.ts` (`buildAdditiveTimeGrid`), ambos ya verdes y sin cambios de esta etapa.

## 32. Tests — breakdown

Sin cambios — Motor B (`automaticHourConceptBreakdowns.*`) no fue tocado en esta etapa; sus tests (incluidos los agregados en 15M.2, aún sin commitear) siguen verdes.

## 33. Tests — datos legacy

El nuevo test "con un `TimeEntry` previo" (§30) reproduce exactamente la forma histórica encontrada en producción (fila previa de otra jornada + jornada nueva partida en varios tramos de la misma fecha). No se creó un fixture separado de "duplicado ya existente" porque el `orderBy` agregado (§28.4) es una hardening determinística, no una lógica de fusión — el manejo de un duplicado real existente queda para el backfill propuesto (§42), no para el código de escritura.

## 34. 15M.2 preservado

No se tocó nada de 15M.2 (`automaticHourConceptBreakdowns.service.ts`, los 4 puntos de sincronización en `timeEntries.service.ts`, ni la invalidación de caché en `timeEntries.controller.ts`). Se confirmó explícitamente:
- `syncAutomaticBreakdownsAfterProcessedShift` deriva períodos desde `classifiedSegments` (no desde `created.entries`), así que el cambio de forma de `entries` (de 15M.3) no lo afecta.
- Los tests de 15M.2 (control de los 4 caminos, cross-month, aislamiento de errores) siguen verdes sin ninguna modificación.

## 35. Resultados backend

`npx prisma validate` OK · `npx prisma generate` OK · `npm run typecheck` limpio · `npm test` → **1740/1740** (112 archivos; 1737 previos de 15M.2 + 3 nuevos de 15M.3) · `npm run build` limpio.

Verificación adicional (no pedida por el checklist estándar, pero relevante para probar que los tests son reales): se revirtió temporalmente el fix con `git stash` y se corrieron sólo los 3 tests nuevos — **los 3 fallaron** exactamente como se esperaba (`TimeEntry.create`/`update` llamado 3 veces en vez de 1, total final de 69 en vez de 249) contra el código anterior, confirmando que capturan la regresión real. Se restauró el fix (`git stash pop`) y los 140 tests volvieron a pasar.

## 36. Resultados frontend

Sin cambios de código frontend. `npx tsc -b` limpio · `npx tsc -p tsconfig.e2e.json --noEmit` limpio · `npm test` → **953/953** (92 archivos) · `npm run build` limpio.

## 37. Documentación

Creado este archivo. Actualizados `docs/PROJECT_CONTEXT.md` y `docs/decisions/CONCEPTOS_HORARIOS_ADITIVOS.md` (nota de corrección: la Etapa 13F ya no es "sólo una optimización de performance sin cambio de comportamiento" — introdujo una regresión real corregida acá). `docs/decisions/ATTENDANCE_AUTO_BREAKDOWN_SYNC_15M2.md` no requirió cambios (nada de lo que documenta se vio afectado, ver §34).

## 38. Archivos modificados

- `backend/src/modules/time-entries/timeEntries.repository.ts` — fix de `closeOpenWorkShift`.
- `backend/src/modules/time-entries/timeEntries.repository.test.ts` — 3 tests nuevos.
- `docs/PROJECT_CONTEXT.md`, `docs/decisions/CONCEPTOS_HORARIOS_ADITIVOS.md`, este archivo.
- (Sin cambios adicionales a los ya pendientes de 15M.2, listados en su propio documento.)

## 39. Riesgos

- El fix cambia la forma de `entries` devuelta por `closeOpenWorkShift` (antes: uno por tramo, ahora: uno por fecha calendario) — se verificó que ningún consumidor real (backend ni frontend) depende de `entries.length === segments.length`; sólo se usa para responder el detalle de la fichada.
- El `orderBy: createdAt asc` agregado a `existingEntries` es una lectura adicional dentro de la transacción — impacto de performance despreciable (mismo `findMany`, sólo agrega un `ORDER BY` sobre una columna ya indexada indirectamente por PK/timestamps).

## 40. Deuda de datos legacy

Confirmada con lectura real (§20): **8 grupos de `TimeEntry` duplicados** (mismo `employeeId`+`date`+`hourConceptId`), **5 empleados afectados**, incluido legajo 30 (14/09 y 15/09 — no 16/09, que en cambio perdió minutos silenciosamente sin duplicar). Estos registros históricos **no se tocaron en esta etapa** — ver §41/§42 y, ahora, la Etapa 15M.4.

## 41. ¿Hace falta backfill?

Sí — resuelto en la **Etapa 15M.4** (`docs/decisions/ATTENDANCE_NORMAL_HOURS_RECONCILIATION_15M4.md`): se construyó y ejecutó una herramienta de reconciliación (dry-run/repair) que confirmó el problema como sistémico (10 empleados, 12 de 26 fechas de septiembre 2026 inconsistentes) y reparó, con aprobación explícita del usuario, las 3 fechas de legajo 30 descriptas acá. El resto de los empleados detectados sigue pendiente de una corrida separada.

## 42. Propuesta de backfill — implementada en 15M.4

La estrategia conceptual descripta originalmente acá (recalcular desde `WorkShift`/`TimeSegment`, consolidar duplicados sin borrar ni reasignar FKs, retirar las filas no-canónicas a `totalMinutes=0`) es exactamente la que terminó implementando y ejecutando la Etapa 15M.4 — ver ese documento para el detalle completo de la herramienta, el dry-run global y el resultado real del repair de legajo 30.

## 43. `git diff --check`

Sin errores de espacios en blanco.

## 44. Git status final

`main`, 0 ahead/0 behind. Working tree con los cambios de 15M.2 (preservados intactos) + los de 15M.3 (este documento), todos sin commitear.

## 45/46. No commit. No push.

Cumplido — nada fue commiteado ni pusheado en esta etapa.
