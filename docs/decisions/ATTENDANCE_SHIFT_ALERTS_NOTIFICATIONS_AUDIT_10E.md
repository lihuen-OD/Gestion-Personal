# Etapa 10E — Auditoría integral de Asistencia, Alertas de Turnos y Notificaciones

Fecha: 2026-08-28
Estado: implementada, validada, pendiente de aprobación para commitear
Alcance: verificar si las fichadas problemáticas (en particular, faltas de salida) que aparecen correctamente en Asistencia también generan `ShiftAlert` y notificación; auditar la relación Asistencia↔Alertas de Turnos↔Notificaciones de punta a punta

## 1. Resumen ejecutivo

La sospecha del pedido era correcta: **un empleado sin turno asignado (o con un turno sin `missingOutAlertAfterMinutes` configurado) que no marca salida aparece correctamente en Asistencia, pero nunca generaba una `ShiftAlert` de `POSIBLE_OLVIDO_SALIDA`**, salvo que llegara al límite absoluto de 20h (donde se cierra en 0h sin alerta bajo régimen `ROLLOVER`, el default). La causa exacta: `evaluateOpenShiftRisk` calculaba `missingOutThresholdMinutes = null` en ese caso — sin fallback — mientras que el límite absoluto (`EXPIRED`) sí tenía un default fijo (1200 min). Como el cron que crea alertas tempranas (`checkMissingOutRisk`) sólo actúa en el nivel `MISSING_OUT` (nunca en `EXPIRED`, que maneja el cierre automático), ese hueco significaba que la alerta jamás se creaba en ningún momento del ciclo de vida de la jornada.

Se agregó un umbral por defecto (600 min, el mismo ya usado para `JORNADA_EXTENDIDA` sin turno) para `missingOutThresholdMinutes` cuando no hay ninguno configurado — suprimido sólo cuando el régimen vigente del empleado tiene `alertOnOutOfShift=false` (mismo campo y mismo criterio que ya suprime las 3 alertas de "fuera de turno" desde 10A/10B), para no reintroducir ruido en régimen flexible/cosecha. Un umbral explícito de un turno real nunca se suprime por régimen, sólo el fallback.

Además se encontraron y corrigieron 2 gaps secundarios de notificaciones no-best-effort en el camino en vivo del fichador, y un bug de copy (enum crudo) en "Problemas de fichada". Ningún cambio de schema, ninguna migración, ningún cambio al cálculo de horas reales.

## 2. Documentos leídos

`WORK_REGIME_SHIFT_ALERTS_AUDIT_10A.md`, `WORK_REGIME_SHIFT_ALERTS_10C.md`, `WORK_REGIME_SHIFT_ALERTS_10D.md`, `docs/PERFORMANCE_STANDARDS.md`, `CLAUDE.md`, `AGENTS.md`, más lectura directa de `timeEntries.service.ts`, `timeEntries.repository.ts`, `workShiftEvaluation.service.ts`, `openShiftMonitor.service.ts`, `workShiftEvaluationRunner.ts`, `clockPunchMaintenance.ts`, `workforce.service.ts`, `AttendancePage.tsx`, `ShiftAlertsPage.tsx`.

## 3. Mapa de fuentes de datos

| Pantalla | Endpoint | Fuente de datos | Independiente de |
|---|---|---|---|
| Asistencia → resumen (jornadas abiertas/cerradas) | `GET /time-entries/attendance` | `WorkShift` (status, `computeOpenShiftRisk` calculado en vivo) | `ShiftAlert` — no lo consulta |
| Asistencia → "Problemas de fichada" | `GET /time-entries/attendance/observations` | `WorkShift.status IN (OBSERVADO, FALTA_SALIDA, FALTA_INGRESO, INVALIDO)`, `AttendancePunch.status IN (OBSERVADA, RECHAZADA)`, `AttendanceInactivityIncident` | `ShiftAlert` — no lo consulta |
| Alertas de turnos | `GET /shift-alerts` | 100% `ShiftAlert` (12 tipos, ver 10A) | `WorkShift.status`/`AttendancePunch` — no los consulta directo, sólo referencia `workShiftId` |
| Notificaciones | `GET /workforce/notifications` | `SystemNotification` (7 tipos) | Sólo entrega — nunca decide de negocio; su contenido deriva de lo que `ShiftAlert`/`WorkShift` ya decidieron |

Esta separación es arquitectura deliberada (confirmada sin bug en 10C, reconfirmada acá): Asistencia es la cola operativa "qué necesita atención ahora mismo, jornada por jornada"; Alertas de Turnos es el historial de eventos de negocio ya clasificados y con severidad, pensado para seguimiento/auditoría; Notificaciones es sólo el canal de aviso. Que ambas pantallas usen fuentes distintas no es el bug — el bug era que, para el caso puntual de falta de salida sin turno, sólo una de las dos (Asistencia) recibía el dato.

## 4. Diferencia entre "problema de fichada", "alerta de turno" y "notificación"

- **Problema de fichada** (Asistencia): un hecho ya ocurrido sobre una fichada/jornada concreta (`WorkShift`/`AttendancePunch`/`AttendanceInactivityIncident` en un status problemático). Se resuelve marcando la fila (`resolveAttendanceObservation`).
- **Alerta de turno** (`ShiftAlert`): una clasificación de negocio con severidad y tipo (12 tipos), pensada para seguimiento por RRHH/responsables, con su propio ciclo de vida (`PENDIENTE`/`RESUELTA`/`DESCARTADA`).
- **Notificación** (`SystemNotification`): un aviso de que algo pasó, dirigido a destinatarios concretos (`attendanceRecipients`: RRHH nivel 1 + responsable de horarios del empleado). No tiene lógica propia, nunca decide nada — sólo entrega.
- Pueden coexistir para el mismo evento (ej. `POSIBLE_OLVIDO_SALIDA` genera una `ShiftAlert` **y** dispara `ALERTA_FICHADA`), o no (una fichada observada por foto rechazada es un "problema de fichada" en Asistencia sin ninguna `ShiftAlert` asociada — no hay tipo de `ShiftAlert` para eso, y no debería haberlo: es un problema de validación facial, no de negocio horario).

## 5. Flujo de falta de salida (hallazgo central)

1. Jornada abierta (`WorkShift.status=ABIERTO`, `endAt=null`).
2. Aparece en Asistencia (`openShifts`) inmediatamente, con `risk` calculado en vivo (`computeOpenShiftRisk`).
3. `checkMissingOutRisk` (cron cada 60s, `clockPunchMaintenance.ts`) evalúa cada jornada abierta con `evaluateOpenShiftRisk`. **Antes de esta etapa**: si no había turno matcheado o el turno no tenía `missingOutAlertAfterMinutes`, el nivel nunca pasaba de `NORMAL` — la `ShiftAlert` de `POSIBLE_OLVIDO_SALIDA` nunca se creaba. **Ahora**: usa un default de 600 min (salvo régimen con `alertOnOutOfShift=false`), ver §9.
4. Si el empleado fichó la salida antes del límite absoluto: `evaluateShiftExit` resuelve cualquier `POSIBLE_OLVIDO_SALIDA` pendiente (`resolveOpenShiftOverflowAlert`, 10B) y evalúa `SALIDA_ANTICIPADA`/`SALIDA_TARDIA`/`JORNADA_INSUFICIENTE`/`JORNADA_EXTENDIDA` sobre la jornada ya cerrada.
5. Si nunca ficha salida y llega al límite absoluto (1200 min = 20h): `expireOpenWorkShifts` la cierra según régimen (§7).
6. En Asistencia, la jornada cerrada sin salida real aparece en "Problemas de fichada" con `status=FALTA_SALIDA` — esto **nunca dependió del hallazgo de esta etapa**, ya funcionaba antes.

## 6. Flujo de jornada extendida

Sin cambios respecto a 10C/10D: se evalúa **sólo al cerrar** la jornada (`evaluateShiftExit` → `evaluateWorkedDuration`), comparando `totalMinutes` reales contra `régimen.extendedShiftAlertMinutes ?? turno.maximumInformativeMinutes ?? 600`. No compite con `POSIBLE_OLVIDO_SALIDA` (que sólo se evalúa mientras la jornada sigue **abierta**) — con la jornada ya cerrada, `evaluateOpenShiftRisk` no vuelve a correr para esa jornada.

## 7. Flujo de jornada abierta expirada

`expireOpenWorkShifts` (`timeEntriesRepository`, corrida dentro del mismo cron de 60s) para cada jornada que supera el límite absoluto (1200 min): resuelve el régimen vigente — `ALERT_ONLY` → no cierra, `flagOpenShiftOverflowForReview` (alerta crítica, jornada sigue abierta, visible en Asistencia y en Alertas); si no (`ROLLOVER`/sin régimen, el default) → cierra en 0h, `status=FALTA_SALIDA`, y resuelve automáticamente cualquier `POSIBLE_OLVIDO_SALIDA` pendiente (10B). Confirmado sin cambios en esta etapa: el default fallback de §9 nunca compite con este flujo porque actúa antes (en el nivel `MISSING_OUT`, siempre < 1200 min) — nunca después.

## 8. Flujo de rollover

`rolloverExpiredOpenWorkShift` se dispara cuando llega un nuevo ingreso mientras la jornada previa sigue abierta y excedida bajo régimen que permite rollover. Cierra la jornada vieja (`FALTA_SALIDA`/0h), resuelve cualquier `POSIBLE_OLVIDO_SALIDA` pendiente de la jornada vieja (10B) y notifica `FALTA_SALIDA` (`notifyMissingExit`) — este último paso corre **en vivo**, dentro de la misma request HTTP del fichador; ver el bug corregido en §10/§11.

## 9. Flujo de turno nocturno

Sin cambios de comportamiento respecto a 10C: `scheduledInstantForShiftTime` sigue resolviendo el cruce de medianoche igual. El nuevo default de §9(hallazgo) se comprobó explícitamente compatible con turnos nocturnos: un turno "sereno" (23:00–04:00) sin `missingOutAlertAfterMinutes` configurado ahora también entra en `MISSING_OUT` a los 600 min de jornada abierta, con `expectedExitAt` calculado igual que antes (test dedicado, §13).

## 10. Hallazgo puntual: ¿las faltas de salida llegan a Alertas de Turnos?

**Antes de esta etapa: no, en el caso más común** (empleado sin turno asignado, o con turno sin `missingOutAlertAfterMinutes` configurado) — que es exactamente la población de régimen flexible/cosecha que 10A-10D ya identificaron como la más propensa a no tener turno. **Con turno completo (horario + `missingOutAlertAfterMinutes`) sí funcionaba** — ese camino no tenía bug. **Después de esta etapa: sí, en todos los casos**, salvo que el régimen del empleado tenga `alertOnOutOfShift=false` (supresión deliberada, no un bug).

## 11. Bugs encontrados

1. **(Crítico, confirma la sospecha del pedido)** `evaluateOpenShiftRisk` sin fallback para `missingOutThresholdMinutes` → `POSIBLE_OLVIDO_SALIDA` nunca se generaba para jornadas sin turno matcheado o sin `missingOutAlertAfterMinutes` configurado, aunque Asistencia sí mostraba el problema correctamente. `workShiftEvaluation.service.ts`.
2. **(Robustez)** `createShiftAlert` no envolvía `notifyUsers` en try/catch — un fallo transitorio de notificación podía propagar y romper la fichada en vivo que ya se había confirmado. `workShiftEvaluationRunner.ts`.
3. **(Robustez, mismo patrón que #2)** `notifyMissingExit`/`notifyOpenShiftAttempt` tampoco envolvían `notifyUsers` — afecta 3 de sus 4 llamadores, todos dentro de la request en vivo del fichador (`clockInResolved` por app y por foto, camino de rollover e intento de ingreso con jornada abierta). `timeEntries.service.ts`.
4. **(Copy confuso)** "Problemas de fichada" mostraba `item.shift.status.replace(/_/g, " ")` crudo (ej. "FALTA SALIDA" en mayúsculas, sin acentos) en vez de un texto traducido. `AttendancePage.tsx`.
5. **(Copy confuso, menor)** La columna Severidad de Alertas de Turnos mostraba el enum crudo (`ADVERTENCIA`, `CRITICA` sin tilde) en vez de un label — el filtro de Severidad ya tenía labels correctos ("Informativa"/"Advertencia"/"Crítica") pero la tabla no los reutilizaba. `ShiftAlertsPage.tsx`.

No se encontraron bugs en: dedupe de alertas (upsert por `workShiftId_type` ya evita duplicados), resolución de alertas al cerrar jornada (10B), rollover dejando huérfanas (10B), separación `JORNADA_EXTENDIDA`/`POSIBLE_OLVIDO_SALIDA` (10C), prioridad de umbral régimen→turno→default (10D), cron de mantenimiento no corriendo (confirmado arrancado en `server.ts`).

## 12. Correcciones realizadas

1. `evaluateOpenShiftRisk` (`workShiftEvaluation.service.ts`): nuevo parámetro opcional `suppressMissingOutDefault`; si no hay umbral configurado (ni turno, ni `missingOutAlertAfterMinutes`), usa 600 min salvo que `suppressMissingOutDefault=true`. Un umbral explícito de turno nunca se suprime.
2. `checkMissingOutRisk`/`computeOpenShiftRisk` (`openShiftMonitor.service.ts`): `checkMissingOutRisk` resuelve el régimen vigente de cada jornada abierta (`resolveActiveWorkRegime`) y pasa `suppressMissingOutDefault = régimen?.alertOnOutOfShift === false`. `computeOpenShiftRisk` (usado también por `attendanceSummary` para el ranking de riesgo de Asistencia) recibe el parámetro como opcional — el llamador de Asistencia **no lo pasa a propósito**, para no acoplar el indicador operativo de Asistencia a una decisión de régimen; sigue siendo un "hace cuánto está abierta esta jornada" neutral.
3. `createShiftAlert` (`workShiftEvaluationRunner.ts`): `notifyUsers` envuelto en try/catch, log `SHIFT_ALERT_NOTIFY_FAILED` (best-effort, no bloquea la alerta ya persistida).
4. `notifyMissingExit`/`notifyOpenShiftAttempt` (`timeEntries.service.ts`): mismo patrón, logs `MISSING_EXIT_NOTIFY_FAILED`/`OPEN_SHIFT_ATTEMPT_NOTIFY_FAILED`.
5. `shiftProblemLabel` (`AttendancePage.tsx`): mapa de labels para los 4 status posibles de "Problemas de fichada" (`OBSERVADO`, `FALTA_SALIDA`, `FALTA_INGRESO`, `INVALIDO`), mismo patrón que `sourceLabel`/`faceStatusLabel` ya existentes en el archivo.
6. `SEVERITY_LABELS` (`ShiftAlertsPage.tsx`): mapa de labels reutilizado tanto en la tabla como en el filtro (antes duplicado como texto inline sólo en el filtro).

## 13. Qué NO se tocó

Cálculo de horas reales del fichador (ningún `totalMinutes`/`workedMinutes` cambia de valor); no se inventó ninguna salida automática; Conceptos Horarios, Horas Especiales (no se tocó ningún archivo de `hour-concepts`/`workforce-management` fuera de los dos fixes de notificación puntuales, ya acotados); `evaluateWorkedDuration`/prioridad régimen→turno→default de 10D (sin cambios); `resolveOpenShiftOverflowAlert`/dedupe/ciclo de vida de `ShiftAlert` de 10B (sin cambios); ningún schema, ninguna migración; ningún rediseño de `AttendancePage.tsx`/`ShiftAlertsPage.tsx` más allá de las 2 correcciones de copy puntuales; permisos.

## 14. Tests agregados

**Backend** (+16 tests, total 797):
- `workShiftEvaluation.service.test.ts` (+7): sin turno supera el default → `MISSING_OUT`; sin turno dentro del default → `NORMAL`; `suppressMissingOutDefault=true` mantiene `NORMAL` más allá del default; turno sin `missingOutAlertAfterMinutes` también usa el default; mismo caso + supresión por régimen; un umbral explícito de turno nunca se suprime por régimen; turno nocturno (sereno) sin `missingOutAlertAfterMinutes` también usa el default respetando el cruce de medianoche.
- `openShiftMonitor.service.test.ts` (+5, nuevo describe "Etapa 10E"): sin turno ni régimen genera `POSIBLE_OLVIDO_SALIDA` por el default (antes nunca se generaba); con régimen `alertOnOutOfShift=false` no la genera; con régimen `alertOnOutOfShift=true` explícito sí la genera; con turno pero sin `missingOutAlertAfterMinutes` también se beneficia del default; una jornada ya `EXPIRED` nunca se evalúa por este camino (sigue exclusivo de `expireOpenWorkShifts`).
- `workShiftEvaluationRunner.test.ts` (+2): un fallo de `notifyUsers` no impide que `createShiftAlert` devuelva la alerta ya creada/actualizada; un fallo de notificación no rompe `evaluateShiftEntry`.
- `timeEntries.service.test.ts` (+2, nuevo describe "Etapa 10E"): un fallo de `notifyUsers` durante el rollover automático no rompe el ingreso (se loguea `MISSING_EXIT_NOTIFY_FAILED`); un fallo de `notifyUsers` al intentar ingresar con jornada ya abierta no cambia la respuesta 409 (se loguea `OPEN_SHIFT_ATTEMPT_NOTIFY_FAILED`).

**Frontend** (+3 tests, total 402):
- `AttendancePage.test.tsx` (+1): una jornada con `status=FALTA_SALIDA` se muestra como "Falta registrar la salida", nunca como el enum crudo.
- `ShiftAlertsPage.test.tsx` (+2): una alerta `CRITICA` se muestra como "Crítica" en la tabla; el filtro de Severidad muestra los 3 labels legibles.

## 15. Validaciones ejecutadas

Backend: `npx prisma validate` ✅, `npx prisma generate` ✅, `npx prisma migrate status` ✅ (46 migraciones, al día — sin cambios de schema en esta etapa), `npm run typecheck` ✅, `npx vitest run` ✅ 797/797 (62 archivos), `npm run build` ✅.
Frontend: `npx tsc -b` ✅, `npx vitest run` ✅ 402/402 (55 archivos), `npm run build` ✅.
General: `git diff --check` sin errores de espacios en blanco (ver §16).

## 16. Riesgos pendientes

- `checkMissingOutRisk` resuelve el régimen de cada jornada abierta dentro de un `Promise.all`/loop sin try/catch por item — si `resolveActiveWorkRegime` o `createShiftAlert` fallan para una jornada puntual (ej. error de DB), la excepción aborta el resto del batch de ese tick del cron (60s); el cron entero ya está protegido por un try/catch externo en `clockPunchMaintenance.ts` (no crashea el proceso) y reintenta en el siguiente tick, así que el peor caso es un retraso de hasta 60s en detectar el resto de las jornadas de ese batch, no una alerta perdida. Patrón preexistente (ya aplicaba a `prisma.shiftAlert.findUnique`/`createShiftAlert` antes de esta etapa) — no se aisló por item para no exceder el alcance acotado de esta etapa.
- El default de 600 min es fijo (no configurable por régimen, a diferencia de `JORNADA_EXTENDIDA` desde 10D) — si en el futuro se necesita un umbral de "olvido de salida sin turno" distinto por régimen, sería una etapa nueva y acotada (ver §17).
- `attendanceSummary`/Asistencia sigue sin régimen-conciencia en su propio cálculo de riesgo (decisión deliberada, §12.2) — un usuario podría ver a un empleado de régimen flexible marcado con riesgo "posible olvido de salida" en Asistencia (sólo como indicador visual) aunque Alertas de Turnos correctamente no genere ninguna `ShiftAlert` para ese caso. No es un bug (Asistencia es un indicador operativo, no una decisión de alerta) pero puede generar una pregunta de un usuario que compare ambas pantallas; documentado acá para que quede explícito.

## 17. Reglas futuras / recomendaciones

- Si se necesita que el default de "olvido de salida sin turno" sea configurable por régimen (igual que `extendedShiftAlertMinutes` en 10D), agregar un campo análogo dedicado — no reutilizar `extendedShiftAlertMinutes` (semánticamente distinto: uno es sobre duración total, el otro sobre demora en marcar salida).
- Cualquier notificación nueva que se dispare desde un camino en vivo del fichador (dentro de una request HTTP) debe ser best-effort desde el día uno (try/catch con log, nunca dejar que una falla de `SystemNotification` rompa una fichada ya confirmada) — patrón ya establecido en 4 lugares distintos del código (`createShiftAlert`, `resolveOpenShiftOverflowAlert` de 10B, `notifyMissingExit`, `notifyOpenShiftAttempt`).
- Antes de agregar un nuevo tipo de `ShiftAlert` o `SystemNotification`, verificar primero si el caso ya es visible en Asistencia vía `WorkShift.status`/`AttendancePunch.status` — evita duplicar información en dos sistemas paralelos sin necesidad.
