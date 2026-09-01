# Etapa 13A — Clasificación de entradas según turno asignado

Fecha: 2026-09-01
Estado: implementado, validado, pendiente de aprobación para commitear
Alcance: sólo ENTRADAS. No se tocó salida, cierre de `WorkShift`, Horas Especiales, Conceptos Horarios, liquidación, grilla/export/bandeja, asignaciones de feriado, ni "Sin actividad registrada".

## 1. Resumen ejecutivo

`matchShiftForEmployee` (`backend/src/modules/shifts/workShiftEvaluation.service.ts`) resolvía el turno de una entrada priorizando el turno **asignado** del empleado sólo si la fichada caía dentro de una ventana angosta alrededor del inicio del turno (básicamente, `entryToleranceBeforeMinutes` hacia atrás). Un ingreso anticipado que excediera esa ventana no fallaba silenciosamente: caía a un segundo buscador que compara la hora de la fichada contra **todos los turnos generales del sistema no asignados a ese empleado** — pudiendo matchear el turno de otra persona (si coincidía mejor con la hora) o no encontrar nada. Resultado: un empleado con turno 08:30 que entraba a las 08:00 podía terminar clasificado contra el turno de las 08:00 de otro empleado ("Posible falta de configuración de turno") o, si no existía ningún turno ajeno cerca, como "Turno no identificado" — a pesar de tener su propio turno asignado y activo ese día.

Corrección: si el empleado tiene un turno propio aplicable ese día (`ShiftAssignment` habilitada o deshabilitada, vigente, aplicable ese día de semana), ese turno **siempre** es la referencia — nunca se compara contra turnos generales/ajenos, sin importar la magnitud de la diferencia horaria. Se agregó un tipo de alerta nuevo, `INGRESO_ANTICIPADO`, como contraparte simétrica de `INGRESO_TARDE` (mismo bloque de código, mismo criterio de tolerancia, sólo el signo cambia). El caso "sin turno asignado" (con o sin régimen) queda exactamente igual que antes — no se tocó esa rama.

+16 tests backend nuevos/actualizados (937/937 verdes), +3 tests frontend (464/464 verdes), 1 migración aditiva de un solo valor de enum.

## 2. Problema funcional (casos probados manualmente por el usuario)

1. Sin turno y sin régimen → "Turno no identificado". Correcto, sin cambios.
2. Sin turno y con régimen → sin notificación. Correcto, sin cambios.
3. Con turno, ingreso tarde → "Ingreso fuera de tolerancia". Correcto, sin cambios.
4. Con turno, ingreso antes del horario → daba "Turno no identificado". **Mal** — el sistema ya conocía el turno del empleado.
5. Con turno 08:30, ingreso 08:00, existe otro turno de 08:00 no asignado a esa persona → daba "Posible falta de configuración del turno" sobre el turno ajeno. **Mal** — nunca debió considerar un turno que no le pertenece.

## 3. Diagnóstico (Parte 1 del pedido, con evidencia)

1. **Dónde se procesa una fichada de entrada**: `backend/src/modules/time-entries/timeEntries.service.ts` — múltiples caminos (`clockInResolved`, `clockPhotoPunch`, ingreso manual/observado), todos llaman a `evaluateShiftEntry(employeeId, workShiftId, now)` después de crear el `WorkShift`/`AttendancePunch` (confirmado por grep: 5 call sites de `evaluateShiftEntry`, ninguno de lógica de turno duplicada fuera de `workShiftEvaluationRunner.ts`).
2. **Qué service/repository crea `AttendancePunch`**: `timeEntries.service.ts` + `timeEntries.repository.ts` (no tocados en esta etapa).
3. **Qué crea/abre `WorkShift`**: mismo `timeEntries.service.ts` — el `WorkShift` ya existe (`ABIERTO`) antes de llamar a `evaluateShiftEntry`; esta función sólo lo actualiza (`shiftTemplateId`, `maxAllowedMinutes`) si hubo match, nunca lo crea.
4. **Qué función clasifica la entrada contra turnos**: `matchShiftForEmployee` (`workShiftEvaluation.service.ts`), invocada desde `evaluateShiftEntry` (`workShiftEvaluationRunner.ts`). Es el único punto de resolución de turno para una entrada en todo el repo (confirmado por grep).
5. **Dónde se generan las alertas de entrada**: `evaluateShiftEntry`, vía `alertTypeForMatch()` (mapea el resultado de `matchShiftForEmployee` a `TURNO_NO_IDENTIFICADO` / `SHIFT_NOT_ENABLED_FOR_EMPLOYEE` / `POSSIBLE_SHIFT_CONFIGURATION_MISSING`) y `evaluateEntryPunctuality()` (mapea a `INGRESO_TARDE`, y desde esta etapa también a `INGRESO_ANTICIPADO`).
6. **Cómo se obtenía el turno esperado**: `matchShiftForEmployee` recibía **todas** las `ShiftAssignment` del empleado (`prisma.shiftAssignment.findMany({ where: { employeeId } })`) y **todos** los `ShiftTemplate` activos del sistema (`prisma.shiftTemplate.findMany({ where: { status: "ACTIVO" } })`) — no hay N+1, son 2 queries por fichada, ya acotadas por `employeeId`/`status` (sin cambios en esta etapa, ver §8 Performance).
7. **¿Busca primero `ShiftAssignment` o por hora contra `ShiftTemplate`?**: primero intentaba el turno propio (`closestOwnMatch`), pero con una ventana de tolerancia que lo **descartaba** si la diferencia excedía `-entryToleranceBeforeMinutes` (por ejemplo, 10 minutos) — un ingreso 30 minutos antes ya no calificaba como "propio" y caía al segundo paso (`closestWithinTolerance` sobre turnos generales no asignados). Esa cascada es exactamente la causa raíz del bug.
8. **Cómo se resolvía si había varios turnos posibles**: se elegía el más cercano en el tiempo por valor absoluto de diferencia (`Math.abs(differenceMinutes)`) — este criterio ya existía (test "elige el turno más cercano cuando el empleado tiene varios habilitados") y **no cambió** en esta etapa.
9. **Comportamiento si la entrada es antes del horario**: dentro de la ventana angosta, se aceptaba como turno propio (sin alerta si estaba dentro de tolerancia); fuera de esa ventana, caía al bug descripto (§7).
10. **Comportamiento si la entrada es tarde**: siempre se aceptaba como turno propio (la ventana "después" ya era generosa: `maximumInformativeMinutes + entryToleranceAfterMinutes`), sin cambios en esta etapa.
11. **Sin turno pero con régimen**: `isOutOfShiftAlertSuppressed()` consulta `resolveActiveWorkRegime()` y suprime `TURNO_NO_IDENTIFICADO`/`SHIFT_NOT_ENABLED_FOR_EMPLOYEE`/`POSSIBLE_SHIFT_CONFIGURATION_MISSING` si `alertOnOutOfShift=false` — mecanismo de la Etapa 8K, sin cambios.
12. **Sin turno ni régimen**: genera `TURNO_NO_IDENTIFICADO` sin excepciones — sin cambios.
13. **Tests previos de entradas anticipadas**: no existía ningún test de "ingreso anticipado" como concepto de negocio. Sí existían 2 tests (`workShiftEvaluation.service.test.ts`) que confirmaban el comportamiento **contrario** al que pide esta etapa: "empleado con turno habilitado no fuerza ese turno si la fichada es de un horario totalmente ajeno" (Etapa 8J) — ver §6 sobre por qué se reemplazan.
14. **Enum existente para "ingreso anticipado"**: no existía ninguno — los únicos tipos relacionados con entrada eran `INGRESO_TARDE`, `TURNO_NO_IDENTIFICADO`, `SHIFT_NOT_ENABLED_FOR_EMPLOYEE`, `POSSIBLE_SHIFT_CONFIGURATION_MISSING`.
15. **¿Falta un tipo nuevo o se puede reutilizar uno existente?**: falta un tipo nuevo — ninguno de los 4 existentes representa correctamente "hay turno asignado, la persona llegó antes de horario" (ver §7 y la pregunta de confirmación al usuario antes de implementar).

## 4. Regla funcional implementada

Prioridad para clasificar una ENTRADA:

1. Buscar `ShiftAssignment` del empleado aplicable ese día (vigencia + weekday, criterio ya establecido en la Etapa 8J — sin cambios).
2. Si existe: ese turno es la referencia **incondicional**. Se calcula la diferencia contra la ocurrencia más cercana de su horario de inicio (hoy/ayer/mañana, ya resuelto por `closestOccurrence`, sin cambios) y se clasifica:
   - dentro de tolerancia (`-entryToleranceBeforeMinutes` a `+entryToleranceAfterMinutes`) → normal, sin alerta.
   - antes de `-entryToleranceBeforeMinutes` → `INGRESO_ANTICIPADO` (nuevo).
   - después de `+entryToleranceAfterMinutes` → `INGRESO_TARDE` (sin cambios).
   - **Nunca** se compara contra un turno general/ajeno mientras exista un turno propio aplicable — sin importar qué tan grande sea la diferencia.
3. Si no existe ningún turno propio aplicable ese día: comportamiento sin cambios — se intenta un turno general dentro de tolerancia estrecha (`GENERAL_UNASSIGNED` → `POSSIBLE_SHIFT_CONFIGURATION_MISSING`, Etapa 8J/8K) y, si no hay ninguno, `NO_MATCH` → `TURNO_NO_IDENTIFICADO` (salvo régimen que lo suprima, Etapa 8K).

## 5. Matriz de casos (Parte 2 del pedido)

| Caso | Entrada | Resultado |
|---|---|---|
| A) Sin turno, sin régimen | cualquier horario | `TURNO_NO_IDENTIFICADO` (sin cambios) |
| B) Sin turno, con régimen flexible | cualquier horario | sin alerta (sin cambios) |
| C) Con turno, dentro de tolerancia | — | sin alerta (sin cambios) |
| D) Con turno, tarde fuera de tolerancia | — | `INGRESO_TARDE` (sin cambios, mensaje sigue refiriéndose al turno asignado) |
| E) Con turno, antes del horario | — | `INGRESO_ANTICIPADO` (nuevo — antes daba `TURNO_NO_IDENTIFICADO`) |
| F) Turno 08:30, entrada 08:00, turno ajeno de 08:00 existe | — | `INGRESO_ANTICIPADO` sobre el turno propio 08:30 (nuevo — antes daba `POSSIBLE_SHIFT_CONFIGURATION_MISSING` sobre el ajeno) |
| G) Varios turnos propios el mismo día | — | gana el más cercano en el tiempo (criterio preexistente, confirmado con test nuevo — ver §9) |
| H) Entrada muy anticipada (turno 08:30, entrada 04:00) | — | sigue siendo `INGRESO_ANTICIPADO` sobre el turno propio; severidad sube de `INFO` a `ADVERTENCIA` a partir de 240 minutos de diferencia (umbral propuesto, ver §6) |
| I) Sin asignación aplicable hoy, turnos existentes en el sistema | — | sin cambios: cae al camino "sin turno" preexistente (Etapa 8J/8K), nunca fuerza un turno ajeno como si fuera propio |

## 6. Umbral propuesto para "ingreso muy anticipado" (Caso H)

No hay ningún campo en `ShiftTemplate` para "tolerancia de ingreso muy anticipado", y agregar uno hoy no está justificado por ningún caso real reportado (habría requerido una migración adicional sin necesidad confirmada). En su lugar: `INGRESO_ANTICIPADO` **nunca cambia de tipo** ni se reclasifica como turno ajeno/no identificado sin importar la magnitud del adelanto — pero a partir de `EARLY_ARRIVAL_REVIEW_THRESHOLD_MINUTES = 240` (4 horas, constante en `workShiftEvaluation.service.ts`, función `isEarlyArrivalReviewRequired`), la severidad de la alerta sube de `INFO` a `ADVERTENCIA` para que RRHH pueda distinguir/filtrar (por severidad, en la pantalla de Alertas de Turnos) un adelanto normal de unos minutos de un caso que amerita revisión manual (posible doble turno, error de fichada, etc.). El umbral es fijo (no configurable por turno ni por régimen) — si en el futuro se necesita ajustarlo por turno, es un campo nuevo y una etapa aparte, con justificación propia.

## 7. Tipo de alerta: `INGRESO_ANTICIPADO` (nuevo)

Se confirmó que no existía ningún enum reutilizable (§3.14-15). Se agregó `INGRESO_ANTICIPADO` a `ShiftAlertType` (Prisma) y a los enums Zod/TS espejo — decisión confirmada explícitamente con el usuario antes de tocar el schema, dado que `ShiftAlertType` es un enum nativo de Postgres y agregar un valor requiere migración (ver §11).

- **Label frontend**: "Ingreso anticipado" (`ShiftAlertsPage.tsx`, mismo patrón que el resto de `TYPE_LABELS`).
- **Severidad**: `INFO` por defecto, `ADVERTENCIA` si supera el umbral de revisión (§6) — nunca `CRITICA` (no es un error grave, es informativo/de seguimiento, tal como pedía el encargo).
- **Mensaje**: se reutiliza el mismo mecanismo genérico ya usado por los otros 12 tipos — la notificación (`ALERTA_FICHADA`) usa `title: labelByAlertType[type]` ("Ingreso anticipado") y el mismo cuerpo fijo que ya usan `INGRESO_TARDE`/`SALIDA_ANTICIPADA`/etc. ("La fichada requiere seguimiento..."). Ninguno de los 12 tipos existentes tiene hoy un cuerpo de notificación dinámico por instancia (con hora real/hora esperada) — no se introdujo ese patrón nuevo sólo para este tipo, para no romper la consistencia entre los 13 tipos ni tocar `SystemNotification` (que no tiene campo de metadata, confirmado en la Etapa 12E). El detalle de horario (diferencia en minutos, turno, hora real) ya está disponible en la pantalla "Alertas de Turnos" vía las columnas existentes (Turno, Diferencia, Fecha) — el copy sugerido en el encargo queda cubierto por esos datos estructurados, no por texto libre.
- **Nunca suprimible por régimen**: `SUPPRESSIBLE_OUT_OF_SHIFT_ALERTS` sigue con sus 3 tipos originales (`TURNO_NO_IDENTIFICADO`/`SHIFT_NOT_ENABLED_FOR_EMPLOYEE`/`POSSIBLE_SHIFT_CONFIGURATION_MISSING`) — `INGRESO_ANTICIPADO` es una alerta de puntualidad contra un turno **ya matcheado** (como `INGRESO_TARDE`), no una alerta de "fuera de turno"; regla confirmada con test dedicado (§9).

## 8. Cambios implementados

**Backend**:
- `backend/prisma/schema.prisma`: `INGRESO_ANTICIPADO` agregado a `enum ShiftAlertType`.
- `backend/prisma/migrations/20260901120000_add_shift_alert_ingreso_anticipado/migration.sql`: `ALTER TYPE "ShiftAlertType" ADD VALUE 'INGRESO_ANTICIPADO';` (ver §11).
- `backend/src/modules/shifts/shiftAlert.schemas.ts`: `INGRESO_ANTICIPADO` agregado al enum Zod `shiftAlertTypeSchema`.
- `backend/src/modules/shifts/workShiftEvaluation.service.ts`:
  - `closestOwnMatch`: eliminada la ventana de tolerancia que excluía turnos propios — ahora siempre devuelve la ocurrencia más cercana entre los turnos propios aplicables (si hay al menos uno).
  - `EntryPunctualityResult`/`evaluateEntryPunctuality`: agregado `earlyArrival` (contraparte de `lateArrival`).
  - Nuevo: `EARLY_ARRIVAL_REVIEW_THRESHOLD_MINUTES` (240) e `isEarlyArrivalReviewRequired()`.
- `backend/src/modules/shifts/workShiftEvaluationRunner.ts`: `ShiftAlertTypeValue`/`severityByAlertType`/`labelByAlertType` incluyen `INGRESO_ANTICIPADO`; `evaluateShiftEntry` genera la alerta cuando `punctuality.earlyArrival`, con severidad `ADVERTENCIA` si supera el umbral.

**Frontend**:
- `frontend/src/services/api/shiftAlertApiService.ts`: `INGRESO_ANTICIPADO` agregado al tipo `ShiftAlertType`.
- `frontend/src/pages/ShiftAlertsPage.tsx`: `TYPE_LABELS.INGRESO_ANTICIPADO = "Ingreso anticipado"`. El resto de la pantalla (severidad, diferencia, turno, filtros) ya era genérico — no necesitó cambios adicionales.

## 9. Tests

**Backend** (+16 tests, 921→937, todos verdes):
- `workShiftEvaluation.service.test.ts`:
  - 2 tests de la Etapa 8J reemplazados (mismo escenario, expectativa invertida según la nueva regla — ver §6 del pedido y comentario en el código citando esta etapa).
  - Nuevo describe "Etapa 13A": Caso 4/E (sin otro turno), Caso 5/F (turno ajeno de 08:00 no gana), Caso H (muy anticipado, sigue sobre el propio), Caso G (varios turnos propios, gana el más cercano incluso adelantado), 2 regresiones del Caso I (sin asignación / asignación no aplicable hoy por weekday — el turno general ajeno se sigue matcheando exactamente igual que antes, Etapa 8J sin tocar).
  - `evaluateEntryPunctuality`: `earlyArrival` agregado a los asserts existentes + 3 tests nuevos (dentro de tolerancia, antes de tolerancia, turno deshabilitado no evalúa).
  - `isEarlyArrivalReviewRequired`: 3 tests (umbral exacto, por debajo, por encima, ambos signos).
- `workShiftEvaluationRunner.test.ts`, nuevo describe "Etapa 13A — evaluateShiftEntry": Caso 5/F end-to-end (con mocks de Prisma), Caso 4/E, dentro de tolerancia sin alerta, tarde sigue en `INGRESO_TARDE`, Caso H con severidad `ADVERTENCIA`, notificación best-effort no bloquea (mismo patrón 10E), no duplica alertas (upsert por `[workShiftId, type]`), régimen `alertOnOutOfShift=false` no suprime `INGRESO_ANTICIPADO`.
- `shiftAlert.schemas.test.ts`: `INGRESO_ANTICIPADO` agregado a la lista exhaustiva de 13 tipos + test de filtro `?type=INGRESO_ANTICIPADO`.

**Frontend** (+3 tests, 461→464, todos verdes), `ShiftAlertsPage.test.tsx`, nuevo describe "Etapa 13A": label correcto en la tabla (no enum crudo), el filtro de Tipo incluye "Ingreso anticipado", la columna Diferencia muestra el signo negativo correctamente para un ingreso anticipado.

## 10. Validación manual recomendada (no ejecutada por el agente — requiere UI en vivo)

1. Persona sin turno y sin régimen marca entrada → "Turno no identificado".
2. Persona sin turno y con régimen marca entrada → sin notificación.
3. Persona con turno marca dentro de tolerancia → sin alerta.
4. Persona con turno marca tarde → "Ingreso fuera de tolerancia".
5. Persona con turno marca antes → "Ingreso anticipado" (nuevo).
6. Persona con turno 08:30 marca 08:00 existiendo otro turno 08:00 no asignado → "Ingreso anticipado" sobre el turno propio, nunca "Posible falta de configuración".
7. Persona sin turno marca a una hora que coincide con un turno existente de otro grupo → sigue comportándose igual que antes de esta etapa (Caso C/D, sin cambios).

## 11. Migración (justificación y aplicación)

`ShiftAlertType` es un enum nativo de Postgres (no un `String` validado sólo en la app) — agregar `INGRESO_ANTICIPADO` requiere `ALTER TYPE ... ADD VALUE`. Se confirmó con el usuario antes de crear la migración (instrucción explícita de esta etapa: no migrar sin justificar y aprobar antes). Mismo patrón ya usado en `20260723165615_shift_alert_duration_and_missing_out_types` (que agregó `JORNADA_INSUFICIENTE`/`JORNADA_EXTENDIDA`/`DESCANSO_INSUFICIENTE`/`POSIBLE_OLVIDO_SALIDA` de la misma forma). 100% aditiva — un solo valor de enum nuevo, ninguna fila ni tipo existente se toca. Aplicada con `npx prisma migrate deploy` (no `migrate dev`, por la limitación preexistente y ya documentada desde la Etapa 10D de que la shadow database no puede reproducir `20260824170000_normalize_hour_concepts` desde cero). Confirmado con `prisma migrate status`: 49 migraciones, esquema al día.

## 12. Performance

- Sin cambios en el volumen de queries: `matchShiftForEmployee` sigue recibiendo exactamente las mismas 2 consultas por fichada (`shiftAssignment.findMany({ employeeId })` + `shiftTemplate.findMany({ status: ACTIVO })`), ya acotadas antes de esta etapa — no se agregó ninguna consulta nueva a la base de datos.
- `closestOwnMatch` sigue operando en memoria sobre listas ya cargadas (sin nuevo `map`/`filter` costoso; se eliminó un `.filter()`, si acaso más liviano que antes).
- No se tocó ningún cache (`frontend/src/services/cache/`, `backend/src/shared/cache/`) — este flujo nunca tuvo cache (es fichador, categoría D de `docs/PERFORMANCE_STANDARDS.md`, dato crítico sin cache por diseño).

## 13. Qué NO se tocó

- Salida (`evaluateShiftExit`, `evaluateExitPunctuality`, `resolveMatchForExit`) — ningún archivo ni línea tocada.
- Cierre de `WorkShift` (`expireOpenWorkShifts`, `rolloverExpiredOpenWorkShift`, `evaluateOpenShiftRisk`) — sin cambios.
- Horas Especiales / Conceptos Horarios (`hour-concepts`, `workforce-management/doubleHourRuleMatching.ts`) — ningún archivo tocado.
- Liquidación (`TimeEntry.hours/totalMinutes/appliedMultiplier`, `HourConceptBreakdown`) — sin cambios.
- Grilla/export/bandeja de revisión (`HoursPage.tsx`, `EmployeeHoursPage.tsx`, `timeEntries.repository.ts` export) — ningún archivo tocado.
- Asignaciones de feriado (`HolidayWorkAssignment` y su módulo completo) — sin cambios.
- "Sin actividad registrada" (`attendanceInactivity.service.ts`) — sin cambios.
- El mecanismo `GENERAL_UNASSIGNED`/`POSSIBLE_SHIFT_CONFIGURATION_MISSING` para empleados **sin ningún turno propio aplicable** ese día — deliberadamente sin tocar (Etapa 8J/8K, con su propia suite de tests e historia); esta etapa sólo cambia la prioridad cuando **sí** existe un turno propio aplicable. Se agregaron 2 tests de regresión explícitos confirmando que este camino sigue intacto (§9, Caso I).
- Permisos/RBAC — sin cambios.
- Ningún endpoint nuevo ni cambio de contrato de `GET /shifts/alerts` más allá de aceptar el nuevo valor de `type` en el filtro (ya cubierto por el enum Zod actualizado).

## 14. Riesgos pendientes

- **Umbral de 240 min para escalar severidad es una propuesta de esta etapa, no un valor pedido explícitamente por el usuario** — documentado y testeado, pero ajustable si RRHH lo considera muy alto/bajo en el uso real; cambiarlo es una edición de una constante, sin migración.
- **Un turno propio ahora siempre "gana" sin importar la distancia horaria** (revierte una salvaguarda de la Etapa 8J que evitaba forzar el turno propio ante una fichada "totalmente ajena"): si un empleado tiene un único turno asignado (ej. 06:30-15:00) y ficha a una hora completamente disociada de su rutina (ej. 20:00, por error o por estar cubriendo otra tarea), la fichada ahora se clasifica igual como `INGRESO_ANTICIPADO`/`INGRESO_TARDE` contra su propio turno (con `differenceMinutes` grande, y severidad `ADVERTENCIA` si supera 240 min) en lugar de intentar matchear un turno general ajeno. Es exactamente el comportamiento pedido por la regla funcional aprobada ("nunca usar un turno no asignado para hacer match"), pero es un cambio de comportamiento real para ese escenario límite — documentado acá para que quede explícito si en el futuro se reporta como sorpresivo.
- **Mensaje de notificación sin detalle dinámico de horario** (§7) — si en el futuro se decide mostrar "entrada a las 08:00, antes del inicio previsto 08:30" en el cuerpo de la notificación (no sólo en la tabla de Alertas), requiere agregar ese patrón a los 13 tipos por consistencia, o justificar por qué sólo este tipo lo tendría — fuera del alcance acotado de esta etapa.

## 15. Próxima etapa sugerida

**13B — Salidas según turno asignado**: aplicar el mismo criterio de prioridad (turno asignado siempre gana, nunca un turno ajeno "hace match") al camino de salida, si existiera un problema análogo en `resolveMatchForExit`/`evaluateExitPunctuality`. No evaluado en esta etapa (fuera de alcance explícito — "NO modificar lógica de salida").

---

No se tocó salida, cierre de `WorkShift` salvo lo estrictamente necesario para entrada (ninguno fue necesario), Horas Especiales, Conceptos Horarios, liquidación, grilla/export/bandeja, asignaciones de feriado, ni "Sin actividad registrada". No commitear sin aprobación explícita del usuario.
