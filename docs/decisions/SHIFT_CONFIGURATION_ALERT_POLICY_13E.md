# Etapa 13E — Revisión de POSSIBLE_SHIFT_CONFIGURATION_MISSING

Fecha: 2026-09-01
Estado: 13E implementada; **corregida funcionalmente por 13E.1 el mismo día — ver §18**. Ambas pendientes de aprobación para commitear.
Continúa: `docs/decisions/SHIFT_ALERT_RULES_AUDIT_13C.md` (hallazgo que motiva esta etapa), `docs/decisions/SHIFT_ENTRY_CLASSIFICATION_13A.md`, `docs/decisions/SHIFT_EXIT_CLASSIFICATION_13B.md`, `docs/decisions/SHIFT_SEGMENT_UNCLASSIFIED_POLICY_13D.md`
Alcance: sólo `POSSIBLE_SHIFT_CONFIGURATION_MISSING` — su copy y el destino del turno "ajeno" que la origina. No se tocó la cascada de matching de 13A (`matchShiftForEmployee`/`closestOwnMatch`), la política de prioridad de salida de 13B/13D, Horas Especiales, Conceptos Horarios, liquidación, grilla/export/bandeja, asignaciones de feriado, ni "Sin actividad registrada".

> **⚠️ CORRECCIÓN 13E.1 (mismo día, ver §18)**: la entrega original de 13E (secciones 1-17 de acá abajo) mantenía como válido el caso "empleado sin turno propio + fichada compatible con otro turno existente en el sistema" (`GENERAL_UNASSIGNED`/`closestWithinTolerance`) — sólo había corregido que ese turno ajeno no se **persistiera** ni gobernara duración/olvido de salida/autocierre, pero la alerta seguía **generándose** por esa comparación. 13E.1 revirtió esa parte: **se eliminó por completo la comparación contra turnos ajenos** — un empleado sin `ShiftAssignment` propia ya nunca se compara contra ningún `ShiftTemplate` del sistema, sea cual sea la coincidencia horaria. `POSSIBLE_SHIFT_CONFIGURATION_MISSING` queda **sin ningún caso funcional real que la dispare** (legacy, sólo para alertas ya persistidas). Leer §18 antes que las secciones 1-17, que describen el estado intermedio (13E) ya superado.

## 1. Resumen ejecutivo (13E — histórico, ver §18 para el estado vigente)

`POSSIBLE_SHIFT_CONFIGURATION_MISSING` ya estaba bien acotada en su condición de disparo desde 13A (nunca se genera si el empleado tiene un turno propio aplicable ese día) — el diagnóstico de esta etapa confirmó eso con evidencia y tests. El problema real tenía dos partes, ambas corregidas:

1. **Copy que afirmaba un diagnóstico que es sólo una hipótesis**: "Posible falta de configuración de turno" sonaba a un hecho de configuración incompleta cuando en realidad es una coincidencia horaria contra un turno que pertenece a otra persona. Nuevo copy: **"Revisar configuración de turno"** (título) + un mensaje de aviso específico y sin lenguaje técnico.
2. **Bug real, más grave que el copy** (Regla 5 del pedido, "no usar turnos ajenos como verdad automática"): el turno ajeno que originaba esta alerta se **persistía como si fuera el turno real de la jornada** (`WorkShift.shiftTemplateId`/`maxAllowedMinutes`), y ese dato contaminaba tres evaluaciones posteriores independientes — `evaluateWorkedDuration` en la salida (`JORNADA_INSUFICIENTE`/`JORNADA_EXTENDIDA` contra el mínimo/máximo del turno ajeno), `checkMissingOutRisk` (`POSIBLE_OLVIDO_SALIDA` contra el `missingOutAlertAfterMinutes` del turno ajeno) y `expireOpenWorkShifts` (auto-cierre contra el `absoluteOpenShiftLimitMinutes` del turno ajeno). Corregido en la fuente (ya no se adopta el turno ajeno al escribir la jornada) y con una defensa en profundidad en la evaluación de duración de salida (ignora un turno ajeno aunque ya estuviera persistido de antes).

Opción elegida: **A — mantener notificable, con copy honesto**, combinada con el fix del punto 2. Se descartaron las otras 3 opciones del pedido — ver §5. Sin cambios al enum, sin migraciones. +18 tests backend, +2 tests frontend, todos verdes (979 backend / 466 frontend).

## 2. Problema

El nombre "Posible falta de configuración del turno" sonaba más fuerte/acusatorio de lo que el mecanismo real puede sostener: sólo requiere una coincidencia horaria con un turno que no le pertenece al empleado. La auditoría 13C ya había señalado esto como uno de los 3 hallazgos con respaldo débil, sin implementarlo.

## 3. Documentos leídos

`SHIFT_ALERT_RULES_AUDIT_13C.md`, `SHIFT_ENTRY_CLASSIFICATION_13A.md`, `SHIFT_EXIT_CLASSIFICATION_13B.md`, `SHIFT_SEGMENT_UNCLASSIFIED_POLICY_13D.md`, `WORK_REGIME_SHIFT_ALERTS_10D.md`, `ATTENDANCE_SHIFT_ALERTS_NOTIFICATIONS_AUDIT_10E.md`, `docs/PERFORMANCE_STANDARDS.md`, `CLAUDE.md`, `AGENTS.md`. Más lectura directa de código: `workShiftEvaluation.service.ts` (`matchShiftForEmployee`, `evaluateWorkedDuration`, `evaluateOpenShiftRisk`), `workShiftEvaluationRunner.ts` completo, `openShiftMonitor.service.ts` (`checkMissingOutRisk`), `timeEntries.repository.ts` (uso de `maxAllowedMinutes`, `expireOpenWorkShifts`), `schema.prisma` (`WorkShift`), `shiftAlert.repository.ts` (columna "Turno"), `ShiftAlertsPage.tsx`.

## 4. Diagnóstico (Parte 1 del pedido, con evidencia)

1. **Dónde se genera**: `alertTypeForMatch()` (`workShiftEvaluationRunner.ts`), invocada desde `evaluateShiftEntry`.
2. **Qué función lo dispara**: `alertTypeForMatch(match)` mapea `match.case === "GENERAL_UNASSIGNED"` → `"POSSIBLE_SHIFT_CONFIGURATION_MISSING"`.
3. **Condición exacta**: en `matchShiftForEmployee` (`workShiftEvaluation.service.ts`) — (a) el empleado **no** tiene ningún `ShiftAssignment` (habilitado o deshabilitado) aplicable ese día (vigencia + weekday), **y** (b) existe otro `ShiftTemplate` activo del sistema, **no asignado a este empleado**, cuyo horario cae dentro de **su propia** tolerancia general respecto de la fichada.
4. **¿Entrada, salida o ambos?** Sólo **entrada** — confirmado por lectura completa de `evaluateShiftExit`: nunca llama a `alertTypeForMatch`. `resolveMatchForExit` puede devolver el mismo `case: "GENERAL_UNASSIGNED"`, pero ese resultado sólo alimenta `evaluateWorkedDuration` (nunca genera esta alerta).
5. **¿Se dispara con turno propio del empleado?** No, desde 13A — `closestOwnMatch` siempre gana cuando existe una asignación propia aplicable ese día, sin ventana de tolerancia que la excluya; `GENERAL_UNASSIGNED` estructuralmente no puede ocurrir en ese caso.
6. **¿Se dispara sólo con un turno ajeno compatible por hora?** Sí, es exactamente esa condición (punto 3).
7. **¿Se dispara sin turno propio?** Sí, siempre que además exista ese ajeno compatible — si no existe ninguno, cae a `NO_MATCH`/`TURNO_NO_IDENTIFICADO` en cambio.
8. **¿Se dispara con régimen flexible/sin turno obligatorio?** Depende exclusivamente de `WorkRegime.alertOnOutOfShift` (no de `kind`) — se suprime sólo si `alertOnOutOfShift=false` explícito (`SUPPRESSIBLE_OUT_OF_SHIFT_ALERTS`). Un régimen `kind=TURNO_FLEXIBLE`/`SIN_TURNO` con `alertOnOutOfShift=true` (el default) sigue generándola — inconsistencia ya documentada en 13C, no tocada en esta etapa (fuera de alcance, ver §11).
9. **¿Genera notificación visible?** Sí, salvo supresión por régimen.
10. **¿Se persiste como alerta interna?** Sí, siempre (`upsert`).
11. **Label/copy que veía RRHH (antes de esta etapa)**: título "Posible falta de configuración de turno" (backend, usado como título de `SystemNotification`) / "Posible falta de configuración" (frontend, tabla y filtro de "Alertas de Turnos"); cuerpo del aviso genérico compartido por los 13 tipos ("La fichada requiere seguimiento...").
12. **¿Después de 13A puede aparecer en casos de entrada anticipada?** No — mutuamente excluyentes por construcción: `INGRESO_ANTICIPADO` sólo se evalúa cuando `match.case === "ENABLED"`, y `alertTypeForMatch` sólo devuelve un tipo para `DISABLED_FOR_EMPLOYEE`/`GENERAL_UNASSIGNED`/`NO_MATCH` — nunca para `ENABLED`. Confirmado con test preexistente (13A) y con 2 tests nuevos dedicados (entrada anticipada y entrada tarde, ver §9).
13. **¿Después de 13B puede aparecer en salida?** Nunca pudo, ni antes ni después de 13B — es un mecanismo exclusivo de `evaluateShiftEntry` (punto 4). Confirmado con test nuevo.
14/15. **¿Se superpone con `TURNO_NO_IDENTIFICADO`/`SHIFT_NOT_ENABLED_FOR_EMPLOYEE`?** No — `alertTypeForMatch` es un `if/else if` sobre `match.case`, que sólo puede tomar un valor por evaluación; los 3 tipos son mutuamente excluyentes por diseño.
16. **Casos reales que justifican mantenerla**: existe evidencia real y verificable (un `ShiftTemplate` activo cuyo horario coincide) de que podría faltar una asignación — información legítimamente distinta de "no hay nada que coincida" (`TURNO_NO_IDENTIFICADO`).
17. **Casos reales que justifican ajustarla**: el copy afirmaba certeza que no tiene; y — hallazgo nuevo de esta etapa — el turno ajeno se propagaba como si fuera el turno real de la jornada, contaminando 3 evaluaciones posteriores (ver §6).
18. **Tests existentes**: cobertura de supresión por régimen (8K), no-duplicación, no-solapamiento con `INGRESO_ANTICIPADO` (13A) — pero **ningún test** cubría el efecto del turno ajeno sobre `evaluateWorkedDuration`/`checkMissingOutRisk`/`expireOpenWorkShifts` en la salida. Gap de cobertura real, coherente con que nadie lo había detectado.

## 5. Decisión funcional (Parte 2 del pedido) — ⚠️ superada por 13E.1, ver §18

**Opción elegida: A — mantener notificable, con copy más honesto**, combinada con el fix de §6.

**Por qué no Opción B (degradar 100% a interna)**: contradice la Regla 4 del propio pedido ("puede generar 'Revisar configuración de turno'... el mensaje debe ser claro"), que asume que sigue siendo visible. El mecanismo, una vez corregido el copy y el bug de propagación, ya representa evidencia real (un turno activo que coincide por horario) — sigue siendo información útil para RRHH.

**Por qué no Opción C (reemplazar por `TURNO_NO_IDENTIFICADO`)**: perdería una distinción real y ya existente — "no hay absolutamente ningún turno que coincida" (`TURNO_NO_IDENTIFICADO`) es una situación distinta de "hay un turno activo del sistema que coincide por horario, pero no está asignado a esta persona" (esta alerta). Fusionarlas sería un downgrade de información sin necesidad, además de requerir decidir qué hacer con el historial de ambos tipos.

**Por qué no Opción D (exigir evidencia de sector/equipo)**: no es viable hoy sin un cambio de modelo más grande — `ShiftTemplate` no tiene ningún campo estructurado de sector/equipo (`categoryName` es texto libre, "Ej: Administrativo, Cosecha, Sereno", sin relación a `Sector`). Implementarla exigiría agregar una relación nueva a `ShiftTemplate` (campo + migración), desproporcionado para una etapa "chica y quirúrgica". Documentado como candidato futuro (§13), no implementado.

## 6. Bug real corregido (Regla 5 del pedido): el turno ajeno dejó de "adoptarse" como verdad de la jornada

**Evidencia del problema** (antes de esta etapa): `evaluateShiftEntry` escribía incondicionalmente `WorkShift.shiftTemplateId`/`maxAllowedMinutes` con los datos de `match.template` cada vez que `match.template` existía — **sin excluir el caso `GENERAL_UNASSIGNED`** (turno ajeno). Ese dato después se leía como si fuera el turno real de la jornada en:

- `evaluateWorkedDuration` (`evaluateShiftExit`, salida): el `minimumMinutesForCompliance`/`maximumInformativeMinutes` del turno **ajeno** podían disparar `JORNADA_INSUFICIENTE`/`JORNADA_EXTENDIDA` para un empleado que nunca tuvo ese turno asignado.
- `checkMissingOutRisk` (`openShiftMonitor.service.ts`, cron cada 60s): consulta `shift.shiftTemplate` (la relación de `shiftTemplateId`) para calcular `missingOutAlertAfterMinutes` — el turno ajeno podía disparar `POSIBLE_OLVIDO_SALIDA` con un horario esperado que no es el del empleado.
- `expireOpenWorkShifts` (`timeEntries.repository.ts:1355`): usa `shift.maxAllowedMinutes` (el valor ya persistido) para decidir el auto-cierre — el límite del turno ajeno gobernaba cuándo se cerraba/marcaba en revisión la jornada.

**Corrección** (2 puntos, ambos en `workShiftEvaluationRunner.ts`):

1. **En la fuente** (`evaluateShiftEntry`): `if (match.template && match.case !== "GENERAL_UNASSIGNED")` — un turno ajeno ya no se escribe en `WorkShift` para ninguna jornada nueva. `ENABLED`/`DISABLED_FOR_EMPLOYEE` (evidencia real de una `ShiftAssignment`, esté habilitada o no) siguen adoptándose exactamente igual que antes — sin cambios ahí.
2. **Defensa en profundidad** (`evaluateShiftExit`): `const durationTemplate = match.case === "GENERAL_UNASSIGNED" ? null : match.template;` antes de llamar a `evaluateWorkedDuration`. Cubre dos escenarios que el punto 1 solo no alcanza: (a) jornadas ya persistidas **antes** de esta etapa que ya tengan un `shiftTemplateId` ajeno (no se hizo backfill de datos existentes — fuera de alcance de una etapa de código, requeriría autorización explícita sobre datos reales), y (b) cualquier camino futuro que vuelva a resolver `GENERAL_UNASSIGNED` en la salida.

**Qué NO se tocó de este mecanismo**: `checkMissingOutRisk`/`expireOpenWorkShifts` no fueron modificados — no hizo falta, porque ambos dependen de que `WorkShift.shiftTemplateId`/`maxAllowedMinutes` tengan un valor ajeno, y el punto 1 corta esa escritura en el origen para toda jornada nueva. Se evaluó explícitamente tocar esos dos archivos también (defensa en profundidad ahí también) y se descartó por desproporción: hubiera exigido re-resolver el `case` de matching dentro de un cron que hoy no lo necesita, ampliando el alcance de una etapa "chica y quirúrgica" a 3 archivos más. Ver §13 como candidato futuro si aparece evidencia de que jornadas viejas contaminadas siguen generando ruido ahí.

## 7. Copy final (Parte 4 del pedido)

| | Antes | Ahora |
|---|---|---|
| Título (backend, `SystemNotification`) | "Posible falta de configuración de turno" | **"Revisar configuración de turno"** |
| Label (frontend, tabla/filtro "Alertas de Turnos") | "Posible falta de configuración" | **"Revisar configuración de turno"** |
| Mensaje del aviso | Genérico compartido: "La fichada requiere seguimiento. Las horas no fueron modificadas automáticamente." | **"La persona registró una fichada, pero no tiene un turno asignado compatible para ese horario. Revisá si corresponde asignarle un turno."** |

Implementado con un `messageByAlertType: Partial<Record<ShiftAlertTypeValue, string>>` nuevo en `workShiftEvaluationRunner.ts` — sólo este tipo tiene entrada propia; los otros 12 siguen usando el mensaje genérico (`DEFAULT_ALERT_NOTIFICATION_MESSAGE`, mismo texto de siempre) vía fallback (`messageByAlertType[input.type] ?? DEFAULT_ALERT_NOTIFICATION_MESSAGE`). Mismo criterio ya establecido en 13A: el mensaje es fijo por **tipo**, nunca dinámico por instancia (no se agregó hora real/turno al texto) — no se rompe la consistencia entre los 13 tipos, sólo se amplía de "1 mensaje para todos" a "mensaje por tipo, con fallback".

Sin lenguaje técnico verificado: ni "ShiftAssignment", ni "ShiftTemplate", ni "enum", ni "backend", ni "schema" aparecen en ningún texto (verificado por lectura y por test).

Sin cambio de enum: `ShiftAlertType.POSSIBLE_SHIFT_CONFIGURATION_MISSING` (Postgres) permanece exactamente igual — sólo cambió el texto que lo traduce para humanos. Sin migración.

## 8. Qué casos siguen generando alerta — ⚠️ superado por 13E.1, ver §18 (la respuesta vigente es "ninguno")

- Empleado sin turno propio aplicable, existe un turno ajeno compatible por horario, régimen ausente o con `alertOnOutOfShift=true` (default) — sigue notificando, ahora con el copy nuevo.

## 9. Qué casos ya no notifican / nunca notificaron

- Empleado con turno propio (aplicable ese día, habilitado o deshabilitado) — nunca la genera (ya así desde 13A, confirmado con test nuevo).
- Entrada anticipada o tarde contra el turno propio — nunca coexiste con esta alerta (mutuamente excluyentes por diseño, confirmado con 2 tests nuevos).
- Cualquier evento de salida (`SALIDA_ANTICIPADA`, `JORNADA_INSUFICIENTE`, etc.) — esta alerta nunca se genera en salida (confirmado con test nuevo, incluso simulando un `WorkShift` con un `shiftTemplateId` ajeno ya persistido).
- Régimen con `alertOnOutOfShift=false` — se suprime (sin cambios, ya funcionaba).
- **Nuevo**: el turno ajeno ya no gobierna `JORNADA_INSUFICIENTE`/`JORNADA_EXTENDIDA` en la salida de esa misma jornada, aunque la alerta de entrada sí se haya generado (confirmado con test dedicado, §10).

## 10. Tests (Parte 5 del pedido)

**Backend** (+18 tests sobre `workShiftEvaluationRunner.test.ts`, nuevo describe "POSSIBLE_SHIFT_CONFIGURATION_MISSING — Etapa 13E", 964 → 979 total, todos verdes):

1. Empleado con turno propio nunca genera la alerta (Parte 5.1).
2. Entrada anticipada no la genera (Parte 5.2).
3. Entrada tarde no la genera (Parte 5.3).
4. Salida anticipada no la genera — la alerta nunca se evalúa en salida (Parte 5.4).
5. Aunque el `WorkShift` referencie un turno ajeno (simulando contaminación previa a esta etapa), la salida nunca la genera.
6. Régimen flexible (`alertOnOutOfShift=false`) sin turno propio: no la genera (Parte 5.5).
7. Sin turno propio y sin régimen: sigue generándola — caso real que justifica revisar la asignación (Parte 5.6/5.7).
8. El aviso usa el copy nuevo — título y mensaje exactos, sin lenguaje técnico (Parte 4).
9. Otros tipos de alerta (`INGRESO_TARDE`) siguen usando el mensaje genérico — el copy nuevo es exclusivo de este tipo.
10. El turno ajeno nunca se adopta como turno de la jornada — `workShift.update` no se llama para `GENERAL_UNASSIGNED` (Regla 5).
11. Aunque el `WorkShift` ya tenga un turno ajeno referenciado, su máximo informativo ya no gobierna `JORNADA_EXTENDIDA` en la salida (defensa en profundidad, §6).
12. Regresión: un turno propio habilitado (`ENABLED`) se sigue adoptando sin cambios.
13. Regresión: un turno propio deshabilitado (`DISABLED_FOR_EMPLOYEE`) también se sigue adoptando — es evidencia real de una asignación, no una coincidencia ajena.
14. Regresión: `TURNO_NO_IDENTIFICADO` sigue funcionando sin cambios (Parte 5.8).
15. Regresión: `SHIFT_NOT_ENABLED_FOR_EMPLOYEE` sigue funcionando sin cambios (Parte 5.9).

**Parte 5.10 (no se toca liquidación) / 5.11 (no se toca "Sin actividad registrada")**: no requirió tests nuevos — ningún archivo de `TimeEntry`/liquidación/`attendanceInactivity.service.ts` fue tocado; la suite completa (979 tests) corrió sin regresiones en esas áreas.

**Frontend** (+2 tests sobre `ShiftAlertsPage.test.tsx`, nuevo describe "Etapa 13E", 464 → 466 total, todos verdes): la tabla muestra "Revisar configuración de turno" (ni el enum crudo ni el copy anterior); el filtro de Tipo muestra el label nuevo, no el anterior.

## 11. Qué NO se tocó

- La cascada de matching de entrada (`matchShiftForEmployee`, `closestOwnMatch`, `closestWithinTolerance`) — sin cambios, ya estaba correctamente acotada desde 13A.
- La política de prioridad de salida de 13B (`SALIDA_ANTICIPADA` > `JORNADA_INSUFICIENTE` > `SEGMENTO_SIN_CLASIFICAR`) ni la política de 13D (`SEGMENTO_SIN_CLASIFICAR` vs. concepto esperado) — ningún archivo de esa lógica modificado más allá de la línea puntual de §6.2.
- `checkMissingOutRisk` (`openShiftMonitor.service.ts`) y `expireOpenWorkShifts` (`timeEntries.repository.ts`) — no requirieron cambios (§6), quedan protegidos indirectamente por el fix en el punto de escritura.
- Horas Especiales, Conceptos Horarios — ningún archivo tocado.
- Liquidación (`TimeEntry.hours/totalMinutes/appliedMultiplier`) — sin cambios.
- Grilla/export/bandeja de revisión — ningún archivo tocado.
- Fichador — ningún archivo de `timeEntries.service.ts`/rutas de clock tocado; no hizo falta ninguna integración nueva.
- Asignaciones de feriado (`HolidayWorkAssignment`) — sin cambios.
- "Sin actividad registrada" (`attendanceInactivity.service.ts`) — sin cambios.
- `schema.prisma` — sin cambios, sin migraciones. El enum `ShiftAlertType` permanece idéntico.
- La inconsistencia `WorkRegime.kind` vs. `alertOnOutOfShift` (documentada en 13C §9/§12) — sigue sin resolverse, fuera del alcance explícito de esta etapa.
- Permisos/RBAC — sin cambios.

## 12. Riesgos pendientes

- **Datos históricos ya contaminados**: jornadas cerradas antes de esta etapa que ya tengan un `WorkShift.shiftTemplateId` apuntando a un turno ajeno no se corrigieron retroactivamente (sin backfill, sin tocar datos reales sin autorización explícita) — la defensa en profundidad de §6.2 neutraliza el efecto hacia adelante (una reevaluación de esa jornada ya no usaría el turno ajeno para duración), pero no borra el dato ya persistido en `shiftTemplateId`. Si en algún momento se decide limpiar esos datos, es una acción sobre la base real que requiere aprobación explícita (mismo criterio que 8B/8F/13B).
- **`checkMissingOutRisk`/`expireOpenWorkShifts` sin la misma defensa en profundidad** (§6, decisión de alcance explícita) — si aparece evidencia real de que una jornada abierta con un turno ajeno ya persistido sigue generando `POSIBLE_OLVIDO_SALIDA`/auto-cierre incorrecto mientras esté abierta (antes de llegar a `evaluateShiftExit`), sería una extensión acotada de este mismo fix, no implementada por falta de un caso reportado.
- **`WorkRegime.kind` sigue sin gobernar la supresión** (heredado de 13C, no tocado) — un régimen `SIN_TURNO`/`TURNO_FLEXIBLE` con `alertOnOutOfShift=true` (default) sigue generando esta alerta pese al nombre del régimen.
- **Opción D (evidencia de sector/equipo) sigue sin ser posible** — requiere un campo estructurado nuevo en `ShiftTemplate`, no evaluado como necesario hoy sin un caso real que lo justifique.

## 13. Próxima etapa sugerida

Dos candidatas, ambas mencionadas explícitamente en el pedido:

1. **`DESCANSO_INSUFICIENTE`** — el otro hallazgo de 13C con respaldo débil (umbral de 480 min hardcodeado, sin ningún campo de turno/régimen detrás). Requiere primero confirmar con RRHH/Legal si es un piso legal fijo (en cuyo caso no necesita configuración) o si debería ser configurable.
2. **Validación integral de alertas** — una pasada de extremo a extremo (entrada + salida + jornada abierta) confirmando que ningún otro tipo de alerta tiene un mecanismo de "adopción de configuración ajena" análogo al corregido en esta etapa — el hallazgo de §6 no se buscó deliberadamente, apareció al auditar esta alerta puntual; vale la pena confirmar que no hay un patrón similar en otro lugar del módulo de Turnos.

---

## 18. Corrección 13E.1 — eliminación del matching contra turnos ajenos

Fecha: 2026-09-01 (mismo día, corrección inmediata sobre la entrega de 13E de arriba).

### 18.1 Qué quedó mal en 13E

13E (secciones 1-17) resolvió el **efecto** del turno ajeno (que se persistiera y gobernara duración/olvido de salida/autocierre) pero mantuvo como válida la **causa**: sin turno propio aplicable, el sistema seguía comparando la fichada contra `ShiftTemplate` activos **de otras personas**, y si coincidía por horario, generaba `POSSIBLE_SHIFT_CONFIGURATION_MISSING`. Decisión aprobada ahora: esa comparación en sí misma está mal — que una fichada coincida con el horario de un turno ajeno **nunca fue evidencia real** de nada para el empleado evaluado. "Los turnos sólo aplican a empleados con `ShiftAssignment` propia" (Regla 1 del pedido 13E.1).

### 18.2 Diagnóstico (con evidencia, releído sobre el código dejado por 13E)

1. **Ramas `GENERAL_UNASSIGNED` o equivalentes**: dos. (a) `matchShiftForEmployee` (`workShiftEvaluation.service.ts`, entrada) — la rama que comparaba contra "turnos generales" (`generalTemplates`/`closestWithinTolerance`) cuando no había turno propio. (b) `resolveMatchForExit` (`workShiftEvaluationRunner.ts`, salida) — un escenario **distinto y no relacionado**: `shift.shiftTemplateId` ya resuelto (de un turno propio real) pero cuya `ShiftAssignment` dejó de existir entre el ingreso y la salida. Sólo (a) hace matching horario contra turnos ajenos — (b) nunca compara nada por hora, sólo relee un id ya fijado.
2. **Dónde se buscan turnos generales por horario**: exclusivamente en (a) — `closestWithinTolerance(actualAt, generalTemplates)`, `workShiftEvaluation.service.ts:112-118` (antes de esta corrección).
3. **¿Genera `POSSIBLE_SHIFT_CONFIGURATION_MISSING`?**: sólo (a), vía `alertTypeForMatch` (`workShiftEvaluationRunner.ts`, único llamador: `evaluateShiftEntry`). (b) nunca llega a `alertTypeForMatch` — `evaluateShiftExit` no lo llama (confirmado en 13E §4.4).
4. **¿Puede persistir `shiftTemplateId` ajeno?**: no, desde 13E (§6.1 de arriba) — ya corregido, sin cambios en esta corrección.
5. **¿Afecta entrada, salida, jornada extendida, insuficiente, olvido de salida, autocierre?**: la comparación en sí (a) sólo afecta **entrada** (genera la alerta). Los 4 efectos downstream (jornada extendida/insuficiente, olvido de salida, autocierre) ya estaban cortados por 13E (adopción bloqueada en la escritura + defensa en profundidad en `evaluateWorkedDuration`) — no requirieron cambios nuevos en 13E.1, sólo se volvieron **inalcanzables por completo** al eliminar (a): sin la comparación, nunca hay ningún turno ajeno candidato del que "defenderse".
6. **¿`TURNO_NO_IDENTIFICADO` sigue funcionando para sin turno/sin régimen?**: sí, sin cambios — es el resultado directo de `NO_MATCH`, que ahora es el único desenlace posible sin turno propio (antes competía con `GENERAL_UNASSIGNED`, que se eliminó).
7. **¿Régimen flexible sigue suprimiendo la alerta?**: sí — `TURNO_NO_IDENTIFICADO` sigue en `SUPPRESSIBLE_OUT_OF_SHIFT_ALERTS`, sin cambios. Antes suprimía (entre otras) `POSSIBLE_SHIFT_CONFIGURATION_MISSING`; ahora, como ese tipo nunca se genera, en la práctica sólo queda suprimiendo `TURNO_NO_IDENTIFICADO`/`SHIFT_NOT_ENABLED_FOR_EMPLOYEE` — mismo campo (`WorkRegime.alertOnOutOfShift`), mismo mecanismo, sin cambios de código en la supresión en sí.
8. **¿Empleados con turno propio siguen funcionando igual?**: sí — `closestOwnMatch` (la función que resuelve turno propio) no se tocó en absoluto; sólo se eliminó lo que pasaba **después** de que `closestOwnMatch` devolviera `null`. Confirmado con la suite completa de tests de entrada/salida con turno propio (13A/13B/13D), todos verdes sin modificación.

### 18.3 Cambio implementado

**`backend/src/modules/shifts/workShiftEvaluation.service.ts`** (`matchShiftForEmployee`):
- Eliminada la función `closestWithinTolerance` (sin otro llamador).
- Eliminadas las variables `assignedIds`/`generalTemplates`/`generalMatch` y la rama `if (generalMatch) return { case: "GENERAL_UNASSIGNED", ... }`.
- Sin turno propio aplicable (`ownMatch === null`), el resultado es directamente `return { case: "NO_MATCH", template: null, differenceMinutes: null }` — sin ningún paso intermedio.
- `ShiftMatchCase`/`ShiftMatchResult` no cambiaron de forma (siguen incluyendo `GENERAL_UNASSIGNED` como valor posible del tipo) porque `resolveMatchForExit` (salida) todavía lo puede producir en su escenario residual (18.2, punto 1b) — no relacionado con esta corrección, no tocado.

**`backend/src/modules/shifts/workShiftEvaluationRunner.ts`**:
- `alertTypeForMatch`: eliminada la rama `if (match.case === "GENERAL_UNASSIGNED") return "POSSIBLE_SHIFT_CONFIGURATION_MISSING"`. Como `matchShiftForEmployee` (su único llamador, vía `evaluateShiftEntry`) ya nunca produce ese `case`, la rama era código muerto — se retiró en vez de dejarla, con un comentario explicando por qué. `GENERAL_UNASSIGNED` cae ahora al `return null` final (ninguna alerta), documentado explícitamente por si `resolveMatchForExit` alguna vez lo produjera en un contexto que llame a esta función (no ocurre hoy).
- `SUPPRESSIBLE_OUT_OF_SHIFT_ALERTS`: sin cambios (se deja `POSSIBLE_SHIFT_CONFIGURATION_MISSING` en el `Set`, ahora sin efecto práctico — documentado con comentario, no se achicó el `Set` para minimizar el diff).
- `ShiftAlertTypeValue`/`severityByAlertType`/`labelByAlertType`/`messageByAlertType`: **sin cambios de contenido** — se agregó un comentario marcando el tipo como legacy (ningún camino de código lo genera desde 13E.1; se conserva sólo para que las `ShiftAlert` ya persistidas se sigan mostrando correctamente).
- El bloque de adopción en `evaluateShiftEntry` (`if (match.template && match.case !== "GENERAL_UNASSIGNED")`, de 13E) y la defensa en profundidad en `evaluateShiftExit` (`durationTemplate = match.case === "GENERAL_UNASSIGNED" ? null : match.template`, también de 13E) **se dejaron intactos** — ya no tienen ningún caso real que neutralizar desde el lado de entrada, pero siguen siendo correctos y documentan la invariante; tocarlos no aportaba nada y aumentaba el diff sin necesidad.

**Enum de Prisma**: sin cambios, sin migración. `ShiftAlertType.POSSIBLE_SHIFT_CONFIGURATION_MISSING` permanece — las alertas históricas ya persistidas (si las hay) siguen siendo datos válidos y consultables.

### 18.4 Empleado sin turno + régimen

Sin turno propio aplicable, con un `EmployeeWorkRegime` vigente: el resultado de matching es `NO_MATCH` → `alertTypeForMatch` mapea a `TURNO_NO_IDENTIFICADO` → `isOutOfShiftAlertSuppressed` consulta `regime.alertOnOutOfShift`. Si es `false` (régimen flexible/sin turno obligatorio, el caso típico), la alerta se suprime — **no se genera ninguna alerta de turno**, coincidencia horaria con un turno ajeno o no. Si es `true` (el default, incluso para regímenes nominalmente flexibles si RRHH no configuró lo contrario — inconsistencia heredada de 13C, no tocada acá), sí se genera `TURNO_NO_IDENTIFICADO`.

### 18.5 Empleado sin turno, sin régimen

`NO_MATCH` → `TURNO_NO_IDENTIFICADO`, sin ninguna supresión (no hay régimen que la aplique) — comportamiento histórico, sin cambios.

### 18.6 Empleado que ficha a la misma hora que un turno ajeno

Ya no se compara. El resultado es `NO_MATCH` (o su supresión por régimen) exactamente igual que si no existiera ningún turno en el sistema con esa hora — la presencia de un turno de otra persona que coincide por horario es, a partir de esta corrección, información completamente irrelevante para la evaluación de este empleado.

### 18.7 Qué pasa con `POSSIBLE_SHIFT_CONFIGURATION_MISSING`

Queda **sin ningún caso funcional real que la dispare** — no removida del enum (evitando una migración y preservando el historial), pero sin ningún camino de código que vuelva a crear una fila nueva. Es, a todo efecto práctico, un tipo **legacy**: sigue siendo consultable/filtrable (`GET /shifts/alerts?type=...`) y sigue renderizando correctamente en "Alertas de Turnos" con el copy honesto de 13E ("Revisar configuración de turno") si existieran filas antiguas, pero no se genera ninguna nueva.

### 18.8 Confirmación: nunca se persiste turno ajeno

Cierto en dos niveles independientes, ambos verificados con test: (1) ya no existe ningún turno "ajeno" candidato — sin la comparación horaria, no hay nada que adoptar; (2) aunque lo hubiera (defensa en profundidad de 13E, sin tocar), `evaluateShiftEntry` seguiría sin escribirlo en `WorkShift`. Test dedicado: *"sin ningún turno propio aplicable, `workShift.update` nunca se llama"* (`workShiftEvaluationRunner.test.ts`).

### 18.9 Confirmación: empleados con turno propio siguen igual

`closestOwnMatch` — la función que resuelve el turno propio — no fue tocada por 13E ni por 13E.1. Toda la suite de tests de entrada (ingreso normal/tarde/anticipado) y salida (normal/anticipada/tardía/jornada extendida/insuficiente) con turno propio sigue verde sin modificación de expectativas.

### 18.10 Tests

**Backend** (+13 tests netos sobre `workShiftEvaluationRunner.test.ts`, -2 tests obsoletos removidos, +3 tests redefinidos sobre `workShiftEvaluation.service.test.ts`; 980 tests totales, todos verdes):

En `workShiftEvaluation.service.test.ts`: los 3 tests que documentaban `GENERAL_UNASSIGNED` contra un turno ajeno (Caso C, y los dos "Caso I" de regresión de 13A) se redefinieron para esperar `NO_MATCH` — mismos escenarios de entrada, expectativa invertida según la regla nueva, con comentario explicando el cambio.

En `workShiftEvaluationRunner.test.ts`:
- Describe "Etapa 8K" (histórico, 10A/10D): 3 tests reescritos (ya no verifican `POSSIBLE_SHIFT_CONFIGURATION_MISSING`, verifican `TURNO_NO_IDENTIFICADO` en su lugar, con la misma cobertura de régimen/vigencia). 1 test de dedup específico de este tipo se eliminó (probaba el mecanismo genérico de `upsert` por `[workShiftId, type]` contra un escenario que ya no ocurre; ese mecanismo sigue cubierto por otros tipos, ej. `INGRESO_ANTICIPADO`).
- Describe "B. POSSIBLE_SHIFT_CONFIGURATION_MISSING" reescrito íntegramente para documentar/probar que el tipo ya no tiene caso funcional.
- Describe "POSSIBLE_SHIFT_CONFIGURATION_MISSING — Etapa 13E/13E.1": todos los tests obligatorios del pedido 13E.1, explícitamente nombrados:
  1. Empleado sin turno + régimen flexible → **ninguna alerta** (fortalecido: antes sólo chequeaba ausencia de `POSSIBLE_SHIFT_CONFIGURATION_MISSING`, ahora chequea `upsertedAlertTypes()` vacío).
  2. Empleado sin turno + sin régimen → `TURNO_NO_IDENTIFICADO`, nunca `POSSIBLE_SHIFT_CONFIGURATION_MISSING`.
  3. Empleado sin turno ficha a las 08:00 existiendo un turno 08:00 de otra persona → no lo usa, `TURNO_NO_IDENTIFICADO`, `workShift.update` no se llama.
  4. Empleado sin turno ficha salida con ingreso abierto (flujo limpio, `shiftTemplateId` nace `null`) → `resolveMatchForExit` corta en `NO_MATCH` sin consultar `ShiftTemplate`/`ShiftAssignment`; ninguna alerta de duración.
  5. Empleado con turno propio: ingreso normal/tarde/anticipado — cubiertos (Parte 5.1/5.2/5.3, preexistentes de 13E, sin cambios).
  6. Empleado con turno propio: salida normal (nueva) + anticipada (preexistente) — ambas verdes.
  7. `workShift.update` nunca se llama sin turno propio aplicable — 2 tests (con y sin turno ajeno coincidente por hora).
  - Se mantuvieron sin cambios los tests de 13E que siguen siendo válidos: adopción de turno propio (`ENABLED`/`DISABLED_FOR_EMPLOYEE`), la defensa en profundidad de `evaluateWorkedDuration` contra un `WorkShift` con datos legacy contaminados, y el mensaje genérico de otros tipos de alerta.

**Frontend**: sin cambios de comportamiento — sólo un comentario agregado en `ShiftAlertsPage.tsx` marcando el label como legacy. El test frontend existente (`ShiftAlertsPage.test.tsx`, describe "Etapa 13E") sigue verde sin modificación: sigue siendo válido porque mockea la respuesta de la API directamente (no depende de que el backend genere el tipo), y el copy/label no cambiaron.

### 18.11 Validaciones ejecutadas

`prisma validate`/`generate`/`migrate status` ✅ (sin cambios de schema, 49 migraciones, al día). Backend: `typecheck` ✅, `vitest run` ✅ 980/980 (66 archivos), `build` ✅. Frontend: `tsc -b` ✅, `vitest run` ✅ 466/466 (57 archivos), `build` ✅. `git diff --check` ✅ sin errores de espacios en blanco.

### 18.12 Qué NO se tocó (13E.1)

- `closestOwnMatch` (resolución de turno propio) — sin cambios.
- `resolveMatchForExit` (salida) — sin cambios; su rama residual `GENERAL_UNASSIGNED` (18.2, punto 1b) es un escenario distinto, no relacionado con la comparación contra turnos ajenos que se eliminó.
- La defensa en profundidad de `evaluateWorkedDuration` en `evaluateShiftExit` (13E) — se deja intacta, sigue siendo correcta y ahora doblemente innecesaria en la práctica (ya no hay comparación que la alimente), pero removerla no aportaba nada.
- El bloque de adopción condicional en `evaluateShiftEntry` (13E) — mismo criterio, se deja intacto.
- `ShiftAlertType` (enum de Prisma) — sin cambios, sin migración.
- Horas Especiales, Conceptos Horarios, liquidación, grilla/export/bandeja, asignaciones de feriado, "Sin actividad registrada" — ningún archivo tocado.
- Fichador — ningún archivo de `timeEntries.service.ts`/rutas de clock tocado.
- Permisos/RBAC — sin cambios.

### 18.13 Riesgos pendientes (13E.1)

- **`POSSIBLE_SHIFT_CONFIGURATION_MISSING` queda como deuda de limpieza futura**: si en algún momento se decide retirarlo del todo del enum (no sólo dejarlo inerte), es una migración de Postgres (`ALTER TYPE`, no soporta `DROP VALUE` directo — requeriría reescritura de tabla) y debería evaluarse sólo si hay confirmación de que no quedan filas históricas relevantes. No evaluado ni necesario hoy.
- Los riesgos ya documentados en §12 (arriba) para `checkMissingOutRisk`/`expireOpenWorkShifts` sin defensa en profundidad directa, `WorkRegime.kind` sin gobernar supresión, y la Opción D (sector/equipo) siguen vigentes sin cambios — 13E.1 no los agrava ni los resuelve.

---

No se tocó `closestOwnMatch`, `resolveMatchForExit` (más allá de lo ya descripto), Horas Especiales, Conceptos Horarios, liquidación, grilla/export/bandeja, fichador (salvo cero cambios de integración, no hizo falta), asignaciones de feriado, ni "Sin actividad registrada". No se creó ninguna migración. No commitear sin aprobación explícita del usuario.
