# Etapa 15M.19F — Reconciliación de obligaciones de turno: cross-midnight + backfill de falta de ingreso

## 1. Resumen ejecutivo

Bug real reportado por usuario: un empleado con turno nocturno (23:00-07:00)
que trabaja correctamente una noche, pero falta por completo a la obligación
de la noche SIGUIENTE mientras el backend estaba caído, nunca generaba
`FALTA_INGRESO` al volver el proceso. Causa raíz doble, confirmada en código:

1. `checkMissingExpectedEntries` (missingEntry.service.ts) sólo evalúa el día
   operativo de HOY, en cada tick de 60s — no tiene ningún mecanismo para
   volver a evaluar un día anterior una vez que "hoy" avanzó.
2. `findEmployeeIdsWithActivityEvidence` (evidencia usada por ese chequeo)
   responde "¿hubo CUALQUIER actividad ese día calendario?" — la fichada de
   SALIDA de la jornada anterior (que cruza medianoche) cae dentro de la
   ventana `[00:00,24:00)` del día siguiente y se contaba, incorrectamente,
   como evidencia de que la obligación NUEVA de esa noche fue cumplida.

Fix: (a) un catch-up con checkpoint durable propio para falta de ingreso,
mismo mecanismo que 15M.19A pero con su propia key; (b) una evidencia
específica de "ingreso para ESTA obligación puntual", basada en el mismo
cálculo de "a qué ocurrencia de turno pertenece una fichada" que ya usa el
sistema de alertas de puntualidad.

## 2. Por qué 15M.19E no cubría esto

15M.19E cerró la reconciliación de notificaciones/eventDate para
`AttendanceInactivityIncident` ya creados — no tocó ni auditó cómo o cuándo
se decide crear un incidente de `FALTA_INGRESO` en primer lugar. El bug vive
enteramente en la etapa anterior de la cadena (detección), no en la
notificación.

## 3. Comportamiento anterior — `missingEntry.service.ts`

`checkMissingExpectedEntries(now)` calculaba `dateKey =
todayArgentinaDateKey(now)` y sólo resolvía `resolveWorkObligationCandidates(dateKey)`
para ESE día. Nunca miraba hacia atrás. Si el proceso estuvo caído
exactamente durante la ventana en la que venció la tolerancia de una
obligación de un día anterior, esa obligación quedaba fuera del alcance de
esta función para siempre.

## 4. Comportamiento anterior — `detectAttendanceInactivity` (daily inactivity)

No se modificó su semántica (sigue respondiendo correctamente "¿hubo alguna
actividad ese día?" para `SIN_ACTIVIDAD_REGISTRADA`) — el caso Sereno del
21/09 correctamente NO genera `SIN_ACTIVIDAD_REGISTRADA` ese día, porque sí
hubo actividad real (la cola del turno del 20/09). El bug nunca estuvo acá:
está en que esa misma actividad, mal reutilizada, ocultaba una obligación
DISTINTA (`FALTA_INGRESO`) de esa misma fecha.

## 5. Problema de `findEmployeeIdsWithActivityEvidence` por día calendario

Esta función (evidencia batch por `employeeId IN (...)`, ventana
`[00:00,24:00)`) es correcta para "sin actividad todo el día", pero
insuficiente para "¿se cumplió ESTA obligación puntual?": no distingue a qué
turno/ocurrencia pertenece cada fichada. Se preserva sin cambios para
`detectAttendanceInactivity`; se dejó de usar para `FALTA_INGRESO`.

## 6. Solución elegida

`findEmployeeIdsWithMatchingEntryEvidence` (attendanceInactivity.service.ts),
nueva:

- Sólo mira `AttendancePunch` de tipo `INGRESO` (nunca `SALIDA`, nunca
  `TimeEntry` — ver §7).
- Para cada punch candidato, reutiliza `closestOccurrence`
  (workShiftEvaluation.service.ts, ahora exportada) — el mismo cálculo de "a
  qué ocurrencia de turno (hoy/ayer/mañana) pertenece esta fichada" que ya
  usa `matchShiftForEmployee` para clasificar INGRESO_TARDE/TEMPRANO — en vez
  de mirar un rango `[00:00,24:00)` del día calendario.
- Compara el resultado contra `candidate.scheduledStartAt` exacto: sólo
  cuenta como evidencia si la fichada pertenece a LA MISMA ocurrencia que la
  obligación evaluada.

Esto resuelve el caso Sereno sin heurísticas nuevas: reutiliza matching de
turno ya existente y probado.

## 7. `TimeEntry` como evidencia de ingreso — decisión explícita

Una carga horaria (`TimeEntry`, manual o generada automáticamente por
`buildShiftSegments` al cerrar una jornada anterior) NUNCA cuenta como
evidencia de `FALTA_INGRESO`. Puede reflejar trabajo de una jornada distinta,
o haberse cargado por otro motivo, después. `findEmployeeIdsWithActivityEvidence`
(SIN_ACTIVIDAD_REGISTRADA) sigue considerando `TimeEntry` sin cambios — esa
pregunta ("¿hubo algo ese día?") sí es correcta ahí.

## 8. Mecanismo de reconciliación — checkpoint propio

`missingEntryScheduler.ts::runMissingEntryCatchUp`, mismo mecanismo que
`attendanceInactivityScheduler.ts` (15M.19A):

- Misma tabla `JobCheckpoint`, mismo `jobCheckpointRepository` (avanza sólo
  hacia adelante, seguro ante reinicios concurrentes).
- Misma función pura `buildPendingDateKeys` (reutilizada tal cual).
- Key propia: `"missing-entry-catchup"` — nunca `"attendance-inactivity-daily"`.
  Son checkpoints de negocio distintos (uno cubre el día completo para
  `SIN_ACTIVIDAD_REGISTRADA`, el otro obligaciones puntuales para
  `FALTA_INGRESO`) que deben avanzar de forma independiente.
- Mismo gate horario que el catch-up diario
  (`ATTENDANCE_INACTIVITY_CHECK_HOUR/MINUTE`, reutilizado, sin variable
  nueva): sólo procesa "ayer" (día ya completamente elapsado) después de esa
  hora.
- Bootstrap conservador: primera corrida nunca reprocesa histórico, arranca
  el checkpoint en "ayer".
- Tope por tick: `MISSING_ENTRY_MAX_CATCHUP_DATES` (env, default 14, mismo
  criterio que `ATTENDANCE_INACTIVITY_MAX_CATCHUP_DATES`).
- Cada fecha pendiente se evalúa con `checkMissingEntriesForElapsedDate`
  (nueva, missingEntry.service.ts): TODOS los candidatos de ese día cuentan
  como vencidos (el día ya pasó por completo, no hace falta filtrar por
  tolerancia) — crea incidentes Y resuelve los PENDIENTE existentes.

Efecto colateral correcto (no buscado explícitamente pero verificado): un
turno que cruza medianoche cuyo ingreso (tardío) recién se registra después
de las 00:00 del día siguiente queda resuelto automáticamente por el
catch-up cuando ese día se vuelve "ayer" — `checkMissingExpectedEntries` del
día siguiente nunca lo hubiera vuelto a mirar por sí solo (sólo evalúa SU
"hoy").

## 9. `checkMissingExpectedEntries` (hoy) — qué cambió y qué no

Sigue evaluando exclusivamente "hoy", en cada tick — su responsabilidad no
cambió. Lo único que cambió es la evidencia usada (`findEmployeeIdsWithMatchingEntryEvidence`
en vez de la genérica), corrigiendo el MISMO bug para obligaciones del día en
curso (no sólo para el backfill de días pasados) — ej. jornada 09:00-17:00,
alguien todavía terminando un turno nocturno anterior que se solapa con la
madrugada de hoy.

## 10. Identidad de `AttendanceInactivityIncident` (§22 del pedido)

`@@unique([employeeId, operationalDate])`, sin columna `type` (el
`type`/`title` sólo se usa para `SystemNotification`, nunca se persiste en el
incidente). Auditado: el dominio garantiza como máximo una obligación por
empleado por fecha operativa — `resolveWorkObligationCandidates` colapsa
explícitamente a "la de `scheduledStartAt` más temprano" cuando hay más de
una asignación aplicable ese día (ver `workObligation.service.test.ts`,
caso ya cubierto). La identidad actual es, por lo tanto, suficiente para el
modelo real — no se migra nada.

## 11. Cross-midnight (§19)

Casos 23:00→07:00 y 22:00→06:00 cubiertos: la comparación exacta contra
`candidate.scheduledStartAt` (vía `closestOccurrence`) nunca confunde la cola
de una jornada anterior con el cumplimiento de la obligación siguiente, sin
importar cuán cerca caigan en el reloj de pared. Ver tests A/B/C/K en
`missingEntryReconciliation.test.ts`.

## 12. Feriados / novedades / WorkRegime / SIN_TURNO / weekday (§14-18)

Sin cambios: `resolveWorkObligationCandidates` sigue siendo la única fuente
de "obligación real", reutilizada tal cual tanto por el chequeo de hoy como
por el catch-up — sus exclusiones (feriado sin convocatoria, weekday no
aplicable, SIN_TURNO, TURNO_FLEXIBLE sin asignación propia) ya están
cubiertas por `workObligation.service.test.ts` y no se duplicaron acá.
`findEmployeeIdsExcludedByNovelty` tampoco cambió.

## 13. Otros productores automáticos auditados (§31-34)

| Evento | Fuente | Disparo | Recuperable tras downtime | Gap encontrado | Fix |
|---|---|---|---|---|---|
| `FALTA_INGRESO` | `missingEntry.service.ts` | tick 60s, sólo "hoy" | **NO** (antes) | Sí — confirmado, causa raíz de este documento | Catch-up con checkpoint propio + evidencia precisa (este documento) |
| `SIN_ACTIVIDAD_REGISTRADA` | `attendanceInactivity.service.ts` (`detectAttendanceInactivity`) | catch-up diario con checkpoint (15M.19A) | Sí (ya tenía backfill) | No | No tocar |
| `POSIBLE_OLVIDO_SALIDA` | `openShiftMonitor.service.ts::checkMissingOutRisk` | tick 60s, escanea TODOS los `WorkShift` con `status=ABIERTO, endAt=null` (sin filtro de fecha) | Sí — el estado "abierto" persiste en la fila hasta cerrarse; cada tick re-evalúa el universo completo actual, sin ventana temporal que pueda perder una jornada vieja | No | No tocar |
| Expiración de `WorkShift` (`FALTA_SALIDA`) | `timeEntriesRepository.expireOpenWorkShifts` | tick 60s, `WorkShift` con `status=ABIERTO, endAt=null, startAt<now`, sin cota inferior de fecha, `take:100` ordenado por `startAt asc` (drena lo más viejo primero) | Sí — mismo argumento: el estado persiste hasta cerrarse, y la ausencia de cota inferior + orden ascendente garantiza que ninguna jornada vieja quede fuera, sólo se difiere entre ticks si hay más de 100 pendientes | No | No tocar |

Conclusión de la matriz: el patrón de bug ("sólo evalúa el instante actual, sin
backlog") es específico de `missingEntry.service.ts` — los demás productores
automáticos son ya "stateful" (dependen de una fila que persiste en estado
`ABIERTO`/`PENDIENTE` hasta resolverse, re-escaneada por completo en cada
tick), por lo que se auto-recuperan de una caída sin necesitar checkpoint.

No se tocó `clockInResolved`/`clockOutResolved` sin auditoría (deuda
documentada en `docs/PERFORMANCE_STANDARDS.md` §10/§15, fuera de alcance de
esta etapa — no es la deuda que este documento resuelve).

## 14. Performance

`runMissingEntryCatchUp` corre sólo una vez pasada la hora de corte diaria
(mismo gate que 15M.19A), procesa hasta `MISSING_ENTRY_MAX_CATCHUP_DATES`
fechas por tick, cada una vía una llamada a `resolveWorkObligationCandidates`
(acotada por headcount, no por historia) — misma clase de costo ya aceptada
por el catch-up diario existente (15M.19A), que hace exactamente el mismo
patrón de llamada por fecha pendiente.

## 15. Tests

- `missingEntryReconciliation.test.ts` (nuevo): caso Sereno end-to-end, SIN
  mockear `resolveWorkObligationCandidates` — atraviesa assignment →
  obligación → deadline → evidencia específica → incidente. Casos A, B, C, K,
  D del pedido.
- `missingEntryScheduler.test.ts` (nuevo): checkpoint propio, bootstrap,
  multi-día (E), fecha futura excluida (F), fallo parcial, segundo tick sin
  duplicar (L), reinicio (M), límite por tick, aislamiento del checkpoint de
  inactividad diaria.
- `argentinaTime.test.ts`/`workObligation.service.test.ts`: sin cambios,
  siguen cubriendo feriados/weekday/SIN_TURNO/novedades (G, H, I, J del
  pedido) transitivamente.
- `missingEntry.service.test.ts`: 4 fixtures existentes actualizados
  (agregado `timestamp` real a los mocks de `attendancePunch.findMany` que
  antes sólo llevaban `employeeId`) — comportamiento esperado sin cambios.
- `dailyVsMissingEntryIntegration.test.ts`, `attendanceInactivity.service.test.ts`:
  sin cambios, siguen verdes (no dependen de la forma exacta de la evidencia
  de `FALTA_INGRESO`).

## 16. Qué NO se tocó

- Semántica ni tests de `detectAttendanceInactivity`/`SIN_ACTIVIDAD_REGISTRADA`.
- `checkMissingOutRisk`/`expireOpenWorkShifts` (auditados, sin hueco
  demostrable — ver matriz §13).
- Frontend (NotificationsPage ya expone `eventDate` correctamente desde
  15M.19E; el endpoint no cambió de forma).
- `schema.prisma` (no hizo falta migración — identidad de
  `AttendanceInactivityIncident` confirmada suficiente, ver §10).
- El checkpoint `"attendance-inactivity-daily"` (nunca reutilizado).

## 17. Riesgos pendientes

- El catch-up de falta de ingreso y el catch-up de inactividad diaria pueden,
  en un mismo tick, llamar a `resolveWorkObligationCandidates` para las
  mismas fechas de forma independiente (una consulta duplicada por fecha
  solapada) — mismo orden de costo que ya existía sólo con el catch-up
  diario; no se agregó un cache compartido entre ambos jobs por no haber
  evidencia de que sea necesario (evitar complejidad sin necesidad
  confirmada).
- `findEmployeeIdsWithMatchingEntryEvidence` no filtra por
  `AttendancePunch.status` (VALIDA/OBSERVADA/RECHAZADA) — mismo criterio que
  la función genérica preexistente, que tampoco discrimina por status; no se
  amplió el alcance de este cambio a esa dimensión.
