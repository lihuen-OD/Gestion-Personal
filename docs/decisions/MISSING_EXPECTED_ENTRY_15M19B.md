# Etapa 15M.19B — Obligación real de trabajar + falta de ingreso + exclusiones correctas + fix de overflow

Fecha: 2026-09-18
Estado: implementado, validado (typecheck/tests/build verdes, `prisma validate`/`migrate status` verdes contra Neon — **sin migración nueva**), pendiente de aprobación para commitear — no commiteado, no pusheado
Continúa: diagnóstico 15M.18 (§9-§14, §25), `docs/decisions/DURABLE_ATTENDANCE_INACTIVITY_SCHEDULER_15M19A.md`, `docs/decisions/WORK_REGIME_KIND_SHIFT_POLICY_15M7C.md`, `docs/decisions/OUT_OF_SHIFT_WORKDAY_15M7D.md`, `docs/decisions/HOLIDAY_INACTIVITY_NOTIFICATIONS_12E.md`, `docs/decisions/HOLIDAY_WORK_ASSIGNMENTS_12D.md`

## 1. Resumen ejecutivo

15M.18 encontró que la regla "turno esperado + tolerancia vencida + sin fichada" no existía en absoluto — el único mecanismo relacionado (`detectAttendanceInactivity`) era un chequeo de día completo, al día siguiente, que además nunca consultaba `ShiftAssignment`/`WorkRegime`, con riesgo real de falso positivo en descansos semanales. Esta etapa agrega el chequeo intradía que faltaba, corrige `detectAttendanceInactivity` para que respete la misma "obligación real de trabajar" antes de generar cualquier hallazgo, y corrige el bug de re-notificación de `flagOpenShiftOverflowForReview` ya identificado en 15M.18.

**Sin ninguna migración nueva.** `AttendanceInactivityIncident` (identidad `employeeId`+`operationalDate`, `notifiedAt`, `status` con `RESUELTA` ya en el enum) ya tenía exactamente la forma necesaria para representar también la señal intradía — se reutiliza el mismo modelo, no uno nuevo, para que una ausencia detectada primero por el chequeo intradía y luego revisitada por el chequeo diario sea, a propósito, la misma fila (nunca dos notificaciones para la misma ausencia).

**Archivos nuevos**: `shifts/workObligation.service.ts` (resolutor único de "¿obligación real de trabajar hoy?", reutilizado por ambos chequeos), `time-entries/missingEntry.service.ts` (chequeo intradía). **Archivos modificados**: `time-entries/attendanceInactivity.service.ts` (candidatos ahora resueltos por obligación real, no por "todo empleado activo"; se extraen 3 helpers reutilizables), `shifts/workShiftEvaluationRunner.ts` (fix del guard de `flagOpenShiftOverflowForReview`), `work-regimes/workRegimes.{repository,service}.ts` (versión batch de resolución de régimen, para no hacer N+1), `time-entries/clockPunchMaintenance.ts` (nueva fase, mismo `setInterval` de 60s). Suite completa: 118 archivos, 1876 tests, todos verdes (+27 netos respecto del cierre de 15M.19A — dos archivos de test nuevos, `attendanceInactivity.service.test.ts` reescrito sobre el nuevo pipeline, y el describe de `flagOpenShiftOverflowForReview` en `workShiftEvaluationRunner.test.ts` reemplazado para reflejar el comportamiento corregido, ver §19). `typecheck`/`build` verdes.

## 2. Principio funcional central — cómo se resolvió

```
¿Existe obligación real de trabajar hoy?  →  workObligation.service.ts::resolveWorkObligationCandidates
        ↓ SÍ (única fuente de verdad, reutilizada por los dos chequeos de abajo)
¿Pasó scheduledStart + entryToleranceAfterMinutes?  →  missingEntry.service.ts (intradía)
        ↓ SÍ
¿Existe fichada/jornada/hora cargada?  →  attendanceInactivity.service.ts::findEmployeeIdsWithActivityEvidence
        ↓ NO
¿Novedad vigente exime?  →  attendanceInactivity.service.ts::findEmployeeIdsExcludedByNovelty
        ↓ NO
→ AttendanceInactivityIncident (type FALTA_INGRESO)
```

`detectAttendanceInactivity` (chequeo diario, ya existente desde antes de 15M.19A) usa el MISMO primer paso (`resolveWorkObligationCandidates`) y las MISMAS dos últimas preguntas — sólo cambia la ventana de tiempo (todo el día ya transcurrido, no "tolerancia vencida ahora").

## 3. `resolveWorkObligationCandidates` — la única fuente de "obligación real"

Nuevo: `backend/src/modules/shifts/workObligation.service.ts`. Para una fecha operativa dada, resuelve el universo de empleados con obligación real de trabajar, exigiendo TODAS estas condiciones (auditadas contra el modelo real, ninguna inventada):

| Condición | Campo real | Dónde se aplica |
|---|---|---|
| `ShiftAssignment` propia | `ShiftAssignment.employeeId` (la query arranca en este modelo, no en `Employee`) | query base |
| HABILITADA | `ShiftAssignment.status = "HABILITADO"` | `where` |
| Turno ACTIVO | `ShiftTemplate.status = "ACTIVO"` | `where` (relación) |
| Empleado ACTIVO | `Employee.status = "ACTIVO"` | `where` (relación) |
| Vigente para la fecha | `effectiveFrom <= fecha <= effectiveTo` | `isShiftAssignmentActiveOnDate` (reutilizada de `workShiftEvaluation.service.ts`, sin reimplementar) |
| Día de la semana incluido | `ShiftAssignment.weekdays` (vacío = todos los días) | `isShiftAssignmentApplicableOnWeekday` (misma función reutilizada) |
| Régimen no `SIN_TURNO` | `WorkRegime.kind` vía `EmployeeWorkRegime` vigente | filtro final tras resolver régimen en batch |
| Feriado → convocatoria explícita | `HolidayWorkAssignment.status = "ACTIVA"` para esa fecha exacta | mismo patrón de 12D/12E, sin tocar esa lógica |

**Por qué `TURNO_FLEXIBLE` NO se excluye en bloque**: 15M.7D ya estableció, para la alerta análoga `JORNADA_FUERA_DE_TURNO`, que "`TURNO_FLEXIBLE` mantiene la semántica previa: sólo se evalúa si tiene una referencia explícita habilitada" — una `ShiftAssignment` propia HABILITADA y aplicable ES esa referencia explícita, nunca "una plantilla global". Como el punto de partida de esta función ya es exactamente esa `ShiftAssignment` propia, `TURNO_FLEXIBLE` con una asignación real entra igual que `TURNO_OBLIGATORIO`; sin ninguna asignación, nunca llega a evaluarse régimen — la lista de candidatos ya viene vacía para ese empleado (test explícito: "TURNO_FLEXIBLE sin ninguna ShiftAssignment propia: nunca es candidato").

**Por qué no se reutiliza `shouldSuppressMissingShiftAlert`**: esa función también suprime cuando `alertOnOutOfShift = false` — pero ese flag gobierna específicamente "no pude identificar/matchear un turno" (`TURNO_NO_IDENTIFICADO`/`SHIFT_NOT_ENABLED_FOR_EMPLOYEE`), una pregunta distinta de "sé exactamente qué turno le corresponde (hay una `ShiftAssignment` real) y no fichó". Aplicar ese opt-out acá habría dejado a RRHH sin poder desactivar solo la alerta de "turno no identificado" mientras conserva la de "no fichó", una distinción que el propio 15M.7C nunca contempló para este caso porque la regla no existía todavía.

**Batch, no N+1**: una consulta a `ShiftAssignment` (todas, con `include: shiftTemplate`), una a `EmployeeWorkRegime` (nueva, `findActiveEmployeeWorkRegimesForDate` — versión batch de la ya existente `findActiveEmployeeWorkRegime`), y (sólo en feriado) una a `HolidayWorkAssignment` — nunca una consulta por empleado, sin importar cuántos candidatos haya (verificado con test).

## 4. Régimen — versión batch nueva (sin migración)

`work-regimes/workRegimes.repository.ts`: `findActiveEmployeeWorkRegimesForDate(referenceDate)` — mismo `where`/`orderBy` que `findActiveEmployeeWorkRegime`, sin filtrar por `employeeId`. `work-regimes/workRegimes.service.ts`: `resolveActiveWorkRegimesForDate(referenceDate): Promise<Map<employeeId, ActiveWorkRegime>>` — agrupa por `employeeId`, "el primero que aparece gana" reproduce el mismo desempate (`effectiveFrom` más reciente) que `findFirst` en la versión de un solo empleado. Ningún cambio a la versión existente de un solo empleado (sigue usándose sin tocar en `workShiftEvaluationRunner.ts`).

## 5. Regla de falta de ingreso — semántica del borde y tolerancia

`entryToleranceAfterMinutes` de `ShiftTemplate` (el mismo campo que ya usa `evaluateEntryPunctuality` para `INGRESO_TARDE` — nunca hardcodeado). Deadline = `scheduledStartAt + entryToleranceAfterMinutes` minutos; "vencida" es `now >= deadline` (inclusive), la misma convención de borde que `evaluateEntryPunctuality` (`differenceMinutes > entryToleranceAfterMinutes` para tarde es estrictamente-mayor sobre la diferencia, que equivale a "en el minuto exacto de tolerancia todavía no es tarde" — acá, sobre un `>=` de instantes reales, el minuto exacto del deadline ya cuenta como vencido; test de borde: turno 08:00 + 10 min, evaluado a las 08:11 ART → vencida; a las 08:05 → no vencida). `scheduledStartAt` se calcula con `scheduledInstantForShiftTime` (`shared/datetime/argentinaTime.ts`), el mismo helper que usa todo el resto del sistema — nunca matemática de horario nueva.

## 6. Qué cuenta como fichada válida

Exactamente los mismos 3 modelos que ya usaba `detectAttendanceInactivity` desde antes de esta etapa — extraídos a `findEmployeeIdsWithActivityEvidence` (ver §8) y reutilizados tal cual por el chequeo intradía: `AttendancePunch.timestamp`, `WorkShift.startAt`, `TimeEntry.date`, todos dentro del rango del día operativo Argentina. No se auditaron intentos fallidos (`ClockPunchAttempt`) ni fichadas anuladas como evidencia — nunca lo fueron, y ampliar esa definición está fuera del alcance acordado (sólo se reutiliza la semántica ya vigente, no se inventa una nueva).

## 7. Novedades

Misma política ya vigente, sin cambios: `status != RECHAZADO` exime presencia (incluye `PENDIENTE`, `EN_REVISION`, `APROBADO`, `DEVUELTO` — no sólo `APROBADO`), usando `noveltyCoversDay` (`novelties/novelties.dateRange.ts`, ya existente, ahora reutilizada explícitamente en vez de reimplicarse inline) para la semántica de rango abierto/`allowsDateRange`. Extraído a `findEmployeeIdsExcludedByNovelty`.

## 8. Nombre/modelo del evento — por qué `AttendanceInactivityIncident`, no `ShiftAlert`

Auditado explícitamente antes de escribir código: `ShiftAlert.workShiftId` es `String` **requerido** (`@@unique([workShiftId, type])`, FK `onDelete: Cascade`) — una falta de ingreso, por definición, no tiene ninguna `WorkShift` (no hubo fichada). Usar `ShiftAlert` habría exigido hacer `workShiftId` opcional (migración con impacto en todos sus consumidores: `shiftAlert.controller.ts`, el enriquecimiento de notificaciones en `workforce.service.ts`, `ShiftAlertsPage` en frontend) — desproporcionado para esta etapa y fuera de lo pedido ("no rediseño del sistema de notificaciones"). `AttendanceInactivityIncident` ya tenía la forma exacta necesaria (identidad `employeeId`+`operationalDate`, `notifiedAt`, `status` con `RESUELTA` en el enum `AttendanceReviewStatus`) — **cero campos nuevos, cero migración**. Se reutiliza el mismo modelo para ambas señales (intradía y diaria) exactamente porque son, conceptualmente, la misma ausencia vista en dos momentos distintos (ver §12).

`SystemNotification.type` es un `String` libre (no un enum de Prisma) — se usa un valor nuevo, `"FALTA_INGRESO"`, distinto de `"SIN_ACTIVIDAD_REGISTRADA"`, sin ninguna migración: título y mensaje ya difieren entre ambos casos, y el frontend (`NotificationsPage.tsx`) renderiza `title`/`message` tal cual, sin ramificar por `type` — cero impacto de frontend.

## 9. Falta de ingreso vs. `INGRESO_TARDE` — lifecycle

Son señales de modelos distintos y coexisten sin conflicto: `INGRESO_TARDE` (`ShiftAlert`, vía `evaluateShiftEntry`) sigue disparando exactamente igual que siempre cuando el empleado finalmente ficha, sin ningún cambio de código en ese camino. Lo que sí se agregó es la resolución automática de la falta de ingreso cuando eso ocurre: `missingEntry.service.ts::resolvePendingMissingEntries`, corrido en cada tick, busca incidentes `PENDIENTE` de la fecha de hoy cuyo empleado ya tenga evidencia de actividad y los marca `RESUELTA` con `reviewedAt`/`reviewNote` auditable (`reviewedByUserId` queda `null` a propósito — es una resolución del sistema, no de una persona, mismo criterio que `resolveOpenShiftOverflowAlert` nunca pide usuario). No se borra historial — mismo principio ya establecido por 15M.7D para la resolución automática de alertas de puntualidad.

## 10. Idempotencia y concurrencia

Reutiliza integramente el mecanismo ya existente y verificado en 15M.19A: `createMany({ skipDuplicates: true })` sobre `@@unique([employeeId, operationalDate])`, más `notifiedAt: null` como guardia de "ya se avisó", dentro de una transacción por incidente (`persistAndNotifyInactivityIncidents`, extraída de `detectAttendanceInactivity`, ahora compartida). Cada tick de 60s puede reevaluar candidatos y volver a llamar `createMany` — es un no-op real en DB, y la notificación nunca se duplica porque `pendingNotification` sólo trae incidentes con `notifiedAt: null`. Sin cambios de concurrencia adicionales más allá de los ya documentados en 15M.19A (Render corre una sola instancia hoy).

## 11. Fix de `flagOpenShiftOverflowForReview` (hallazgo 15M.18, secciones 35-37)

Antes: sin ningún guard, cada tick de 60s volvía a `upsert`ear la fila con `status: "PENDIENTE"` incondicional (efecto colateral de `createShiftAlert`), reabriendo cualquier alerta ya `RESUELTA`/`DESCARTADA` por RRHH y reenviando la `SystemNotification`. Fix: mismo guard que ya usa su alerta hermana `checkMissingOutRisk` (`openShiftMonitor.service.ts`) — `shiftAlert.findUnique({workShiftId_type})` antes de crear; si ya existe una fila (cualquier `status`), no se toca. Primera detección crea y notifica una vez; el siguiente tick no reenvía nada; si RRHH la resuelve, no se reabre; una `WorkShift` nueva (otro `workShiftId`) genera su propia alerta, sin interferencia. 3 tests nuevos en `workShiftEvaluationRunner.test.ts` (reemplazan al test anterior, que afirmaba como correcto exactamente el comportamiento que era el bug).

## 12. Relación con `SIN_ACTIVIDAD_REGISTRADA` — sin duplicación semántica

Ambas señales escriben la MISMA fila de `AttendanceInactivityIncident` (identidad `employeeId`+`operationalDate`). Si el chequeo intradía ya creó y notificó el incidente de hoy (mensaje "falta de ingreso"), cuando el chequeo diario evalúe esa misma fecha (al día siguiente, vía el catch-up de 15M.19A) verá que el candidato sigue calificando (cero evidencia todo el día) pero `createMany` no crea una segunda fila (`skipDuplicates`) y la notificación no se reenvía (`notifiedAt` ya seteado) — el mensaje/observation que queda es el de la detección temprana, más específico. Esto es exactamente el "escalamiento sin duplicar" pedido: la señal temprana (intradía) y la señal de cierre de día (diaria) son, a propósito, el mismo incidente — no se implementó ninguna máquina de estados nueva para lograrlo, es un efecto directo de compartir la misma identidad e idempotencia.

## 13. `detectAttendanceInactivity` corregido — qué cambió y qué no

Cambió: el universo de candidatos, de "todo `Employee` con `status=ACTIVO`" a "candidatos de `resolveWorkObligationCandidates`" (ver §3) — ahora exige `ShiftAssignment` propia vigente/aplicable y régimen distinto de `SIN_TURNO`. No cambió: el resto del pipeline (evidencia de todo el día, exclusión por novedad, mensaje feriado/normal, `createMany`/`notifiedAt`) — mismo comportamiento exacto, sólo con un universo de entrada más preciso. Los 12 tests reescritos de `attendanceInactivity.service.test.ts` cubren exactamente los mismos casos que antes (feriado convocado/no convocado, mensaje exacto, anti-duplicado, sin N+1) más los nuevos de evidencia/novedad ahora expresados como consultas batch independientes.

## 14. Fin de semana / SIN_TURNO / TURNO_FLEXIBLE — casos obligatorios (§26-28 del pedido)

Los tres casos resuelven en la MISMA capa (`resolveWorkObligationCandidates`), reutilizada por ambos chequeos — no hay una regla separada para "fin de semana" y otra para "SIN_TURNO": un empleado Lunes-Viernes evaluado un sábado sin `weekdays` que lo incluya nunca aparece en `candidates`, así que ni el chequeo intradía ni el diario lo evalúan. Verificado con test explícito en `workObligation.service.test.ts` ("weekdays NO incluye el día real de dateKey").

## 15. Performance

Por corrida (chequeo intradía o diario), sin importar cuántos empleados existan: 1 consulta a `HolidayWorkAssignment`/`workforceService.holidayDatesInRange` (sólo si feriado), 1 a `ShiftAssignment`, 1 a `EmployeeWorkRegime` (batch), y — sólo sobre los candidatos que ya pasaron el filtro anterior — hasta 3 consultas de evidencia (`AttendancePunch`/`WorkShift`/`TimeEntry`, cada una con `distinct: ["employeeId"]`) y 1 de `Novelty`. Cero consultas dentro de un loop por empleado — verificado con test ("sin N+1"). El chequeo intradía corre en cada tick de 60s sin gateo horario adicional (a diferencia del diario, que sigue detrás de `isInactivityCheckDue`), porque `resolveWorkObligationCandidates` + el filtro de tolerancia ya deciden rápido si hay algo que hacer, y las consultas son las mismas del resto del cron.

## 16. Logs

```
MISSING_EXPECTED_ENTRY_CHECKED { candidates, due, created, resolved }
MISSING_EXPECTED_ENTRY_CHECK_FAILED { severity: "critical", error }
```

Sin nombres/legajos/UUIDs en el log — sólo contadores, mismo criterio ya usado por el resto de `clockPunchMaintenance.ts`.

## 17. Schema / migración

**Ninguna.** No se agregó ningún modelo, campo, ni valor de enum de Prisma. `prisma validate` y `prisma migrate status` (ambos de sólo lectura, contra Neon) confirman que la única migración pendiente sigue siendo la de 15M.19A (`20260918100000_add_job_checkpoint`) — sin cambios de esta etapa.

## 18. Frontend

Sin tocar. `NotificationsPage` sigue sin polling propio (15M.19C) — una `FALTA_INGRESO` recién creada tarda en verse hasta el próximo F5/renavegación, comportamiento esperado y ya documentado en 15M.19A.

## 19. Tests

- `workObligation.service.test.ts` (nuevo, 15 tests): día normal sin régimen (fallback conservador), weekday incluido/excluido, vigencia futura/pasada/vigente, query exige HABILITADO+empleado ACTIVO+turno ACTIVO, `SIN_TURNO` nunca candidato, `TURNO_FLEXIBLE` con asignación propia SÍ candidato, `TURNO_FLEXIBLE` sin ninguna asignación NUNCA candidato, `TURNO_OBLIGATORIO` candidato, feriado sin convocatoria (corta antes), feriado con convocatoria (scope por `employeeId`), dos asignaciones mismo empleado (gana la más temprana), dos empleados distintos sin mezclarse.
- `missingEntry.service.test.ts` (nuevo, 13 tests): sin candidatos, antes de tolerancia, tolerancia vencida sin fichada (genera una), fichada dentro de tolerancia, fichada después de vencida tolerancia (evidencia), novedad exime, candidatos vacíos ya filtrados por obligación, idempotencia de segundo tick (sin notificación duplicada), lifecycle (resuelve automático al fichar / no resuelve sin `PENDIENTE` / no resuelve sin evidencia), reinicio del proceso (detecta en el primer tick posterior sin depender de haber estado vivo exactamente a la hora de vencimiento), cross-midnight (turno 22:00, evaluado 22:11, una sola falta de ingreso).
- `attendanceInactivity.service.test.ts` (reescrito, 12 tests): mismo alcance que antes de esta etapa (feriado, mensajes exactos, anti-duplicado, sin N+1) sobre el nuevo pipeline basado en `resolveWorkObligationCandidates` + evidencia/novedad batch.
- `workShiftEvaluationRunner.test.ts` (3 tests nuevos/reescritos en el describe de `flagOpenShiftOverflowForReview`): segundo tick no reenvía, alerta `RESUELTA` no se reabre, jornada nueva sí genera alerta propia. Los 117 tests restantes del archivo, sin cambios, siguen verdes.

**Validación de infraestructura** (sólo lectura/local): `prisma validate` ✅, `prisma migrate status` ✅ (sin migración nueva de esta etapa), `npm run typecheck` ✅, `npm run test` ✅ (118 archivos, 1876 tests), `npm run build` ✅, `git diff --check` ✅.

**Frontend**: sin cambios, sin tests nuevos.

## 20. Qué NO se tocó

- `evaluateShiftEntry`/`evaluateShiftExit`/`INGRESO_TARDE`/`JORNADA_FUERA_DE_TURNO` y el resto de `workShiftEvaluationRunner.ts` (fuera del guard de `flagOpenShiftOverflowForReview`) — sin cambios.
- `HolidayWorkAssignment`/12D/12E — sólo consultado, cero cambios.
- `resolveActiveWorkRegime` (versión de un solo empleado) — sigue igual, sin tocar sus consumidores existentes.
- El `setInterval` de 60s — se agregó una fase más, no un scheduler nuevo.
- El scheduler durable de 15M.19A (`attendanceInactivityScheduler.ts`, `JobCheckpoint`) — sin cambios; el catch-up sigue llamando a `detectAttendanceInactivity(dateKey)` con la misma firma de siempre.
- Frontend completo — ningún archivo tocado.
- Liquidación, Conceptos Horarios, exportación Finnegans — ningún archivo tocado.

## 21. Riesgos pendientes

- **Concurrencia multi-instancia** de la notificación (`notifiedAt`) — mismo riesgo teórico ya documentado en 15M.19A, sin agravarse ni resolverse acá; sigue sin impacto mientras Render corra una sola instancia.
- **Ninguna alerta si el proceso está completamente apagado** — el chequeo intradía sólo corre mientras el proceso vive; si cae durante horas y no vuelve el mismo día, la ausencia la termina cubriendo igual el chequeo diario (ya durable desde 15M.19A) al día siguiente, con el mensaje genérico de "sin actividad" en vez del específico de "falta de ingreso" — comportamiento aceptado, documentado, no un bug.
- **Polling de `NotificationsPage`** sigue pendiente para 15M.19C — una `FALTA_INGRESO` puede tardar en verse sin F5.

## 22. Próximas etapas

- **15M.19C** — refresco en vivo de `NotificationsPage` (mismo polling que ya tiene la campana del topbar).
- **15M.19D** — regresión end-to-end fin de semana/recuperación, usando los escenarios A-I originales de 15M.18 como suite de aceptación.

---

No se commiteó, no se pusheó, no se aplicó ninguna migración (no hubo ninguna que aplicar). No se modificó `evaluateShiftEntry`/`evaluateShiftExit`, `HolidayWorkAssignment`, el scheduler durable de 15M.19A, ni ningún archivo de frontend.
