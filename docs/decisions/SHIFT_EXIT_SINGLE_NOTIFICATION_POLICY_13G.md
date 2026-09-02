# Etapa 13G — Una sola notificación visible por cierre de salida

Fecha: 2026-09-02
Estado: implementado, validado, pendiente de aprobación para commitear
Continúa: `docs/decisions/SHIFT_EXIT_CLASSIFICATION_13B.md` (cascada original, ahora reemplazada), `docs/decisions/SHIFT_SEGMENT_UNCLASSIFIED_POLICY_13D.md`, `docs/decisions/SHIFT_ALERT_RULES_AUDIT_13C.md`, `docs/decisions/CLOCK_PHOTO_PUNCH_EXIT_TRANSACTION_13F.md`
Alcance: sólo la decisión de **qué notifica** entre las alertas que puede generar un cierre de salida (`evaluateShiftExit`). No se tocó entrada, el motor de matching de turnos, Horas Especiales, Conceptos Horarios (salvo lectura para diagnóstico), liquidación, grilla/export/bandeja, frontend, asignaciones de feriado, ni "Sin actividad registrada".

## 1. Resumen ejecutivo

Un mismo cierre de salida podía generar hasta 3 `SystemNotification` simultáneas porque la cascada de prioridad de la Etapa 13B sólo cubría 3 de los 6 tipos de alerta posibles en una salida (`SALIDA_ANTICIPADA`/`JORNADA_INSUFICIENTE`/`SEGMENTO_SIN_CLASIFICAR`) — `SALIDA_TARDIA`, `JORNADA_EXTENDIDA` y `CONCEPTO_NO_HABILITADO` quedaban fuera de cualquier supresión y notificaban siempre, sin importar qué más hubiera disparado para la misma jornada. Caso real reportado: legajo 09 "Granja" recibió 3 avisos casi simultáneos ("Concepto horario detectado pero no habilitado para el empleado", "Jornada extendida", "Salida fuera de tolerancia") para un único cierre.

Se reemplazó la cascada parcial de 13B por una **política unificada de un solo ganador** entre los 6 tipos posibles, con la prioridad propuesta en el pedido (evaluada contra el código real y confirmada coherente, sin necesidad de ajustarla — ver §6). Las 6 `ShiftAlert` se siguen persistiendo siempre que su condición dispare (trazabilidad completa en "Alertas de Turnos", "no ocultar problemas críticos"); sólo una — la de mayor prioridad — recibe `notify: true` y genera `SystemNotification`. Sin migraciones, sin cambios de schema, sin tocar frontend. +8 tests backend nuevos, 4 tests preexistentes actualizados (su comportamiento esperado cambió, no un bug), 993/993 verdes.

## 2. Problema observado en UI

Para el mismo empleado y el mismo cierre de salida, RRHH veía varias notificaciones casi simultáneas en "Notificaciones" (ejemplo real, legajo 09): "Concepto horario detectado pero no habilitado para el empleado", "Jornada extendida", "Salida fuera de tolerancia". En "Alertas de Turnos" aparecían filas relacionadas adicionales ("Segmento sin clasificar", "Concepto no habilitado", "Jornada extendida", "Salida tardía"). El ruido generaba confusión — RRHH esperaba una sola notificación principal por cierre.

## 3. Documentos leídos

`SHIFT_ENTRY_CLASSIFICATION_13A.md`, `SHIFT_EXIT_CLASSIFICATION_13B.md`, `SHIFT_ALERT_RULES_AUDIT_13C.md`, `SHIFT_SEGMENT_UNCLASSIFIED_POLICY_13D.md`, `SHIFT_CONFIGURATION_ALERT_POLICY_13E.md`, `CLOCK_PHOTO_PUNCH_EXIT_TRANSACTION_13F.md`, `WORK_REGIME_SHIFT_ALERTS_10D.md`, `ATTENDANCE_SHIFT_ALERTS_NOTIFICATIONS_AUDIT_10E.md`, `docs/PERFORMANCE_STANDARDS.md`, `CLAUDE.md`, `AGENTS.md`. Más lectura directa de código: `workShiftEvaluationRunner.ts` completo (`evaluateShiftExit`, `applyClassificationAlerts`, `notifyClassificationAlerts`, `createShiftAlert`), `workShiftEvaluation.service.ts` (`evaluateExitPunctuality`, `evaluateWorkedDuration`), `hourConceptClassification.ts` (para confirmar de dónde nace `CONCEPTO_NO_HABILITADO`/`SEGMENTO_SIN_CLASIFICAR`, sin tocar ese archivo).

## 4. Diagnóstico (Parte 1 del pedido, con evidencia)

1. **Dónde se crean las notificaciones visibles a partir de `ShiftAlert`**: `createShiftAlert` (`workShiftEvaluationRunner.ts`) — único punto de creación de `SystemNotification` para las 13 alertas de turno (`notifyUsers(..., { type: "ALERTA_FICHADA", ... })`), confirmado por grep exhaustivo (ningún otro archivo crea `SystemNotification` de tipo `ALERTA_FICHADA`).
2. **Dónde se decide `notify=true/false`**: antes de esta etapa, decidido de forma **ad hoc por cada llamador** dentro de `evaluateShiftExit`/`applyClassificationAlerts` — sin ningún punto central. Después de esta etapa: en un único bloque de `evaluateShiftExit` (más el caso especial de `notifyClassificationAlerts`, standalone — ver §11).
3. **Qué función crea `SystemNotification` para cada tipo** (antes de esta etapa, todas vía `createShiftAlert`, llamada desde `evaluateShiftExit`):
   - `SALIDA_ANTICIPADA`: `evaluateShiftExit`, sin parámetro `notify` explícito → default `true` (siempre notificaba).
   - `SALIDA_TARDIA`: `evaluateShiftExit`, sin parámetro `notify` → default `true` (**siempre notificaba, fuera de cualquier cascada**).
   - `JORNADA_EXTENDIDA`: `evaluateShiftExit`, sin parámetro `notify` → default `true` (**siempre notificaba, fuera de cualquier cascada**).
   - `JORNADA_INSUFICIENTE`: `evaluateShiftExit`, `notify: !earlyLeave` (cascada 13B).
   - `CONCEPTO_NO_HABILITADO`: `applyClassificationAlerts`, sin parámetro `notify` → default `true` (**siempre notificaba, fuera de cualquier cascada**, documentado explícitamente así en 13B: "queda fuera de esta cascada a propósito").
   - `SEGMENTO_SIN_CLASIFICAR`: `applyClassificationAlerts`, `notify` calculado a partir de `options.notify` (cascada 13B, heredado de `!earlyLeave && !insufficientHours`) **y** de `hourConceptsRepository.findHasAdditionalConceptEnabled` (Etapa 13D).
4. **¿Comparten identificador del cierre?**: sí — las 6 provienen de la misma llamada a `evaluateShiftExit(employeeId, workShiftId, actualAt, classifiedSegments)`, todas persisten con el mismo `workShiftId` (`ShiftAlert.workShiftId`, `@@unique([workShiftId, type])`). No hay ambigüedad: "mismo cierre" = mismo `workShiftId`.
5. **¿La cascada de 13B/13D cubría todos los tipos?**: no — confirmado en el punto 3: `CONCEPTO_NO_HABILITADO`, `JORNADA_EXTENDIDA` y `SALIDA_TARDIA` quedaban **fuera** de cualquier supresión, exactamente como sospechaba el pedido.
6. **Por qué el caso real del legajo 09 generó 3 notificaciones**: su cierre disparó simultáneamente `CONCEPTO_NO_HABILITADO` (un tramo matcheó un concepto que el empleado no tiene habilitado), `JORNADA_EXTENDIDA` (superó el máximo informativo) y `SALIDA_TARDIA` (salió después de la tolerancia) — los 3 tipos que, antes de esta etapa, notificaban siempre sin participar en ninguna cascada.
7. **¿Las 3 nacen del mismo cierre?**: sí, confirmado (punto 4) — mismo `workShiftId`, misma llamada a `evaluateShiftExit`.
8. **¿Las alertas internas se persisten antes o después de elegir notificación?**: `createShiftAlert` siempre hace el `upsert` de `ShiftAlert` **antes** de intentar `notifyUsers` (línea ~146-151 del archivo) — la persistencia nunca dependió de la decisión de notificar, ni antes ni después de esta etapa. Sin cambios en ese orden.
9. **¿Existe control anti-duplicado por tipo pero no por evento/cierre?**: confirmado — `@@unique([workShiftId, type])` deduplica por **tipo dentro del mismo cierre** (reevaluar la misma jornada no crea una segunda fila del mismo tipo), pero no existía ningún mecanismo que relacionara **distintos tipos** del mismo cierre entre sí para decidir cuál notifica — exactamente el hueco que esta etapa cierra.
10. **¿"Alertas de Turnos" y "Notificaciones" consumen la misma fuente?**: no — confirmado desde la Etapa 10E, sin cambios: "Alertas de Turnos" (`GET /shifts/alerts`) lee 100% de `ShiftAlert`; "Notificaciones" (`GET /workforce/notifications`) lee 100% de `SystemNotification`. Son independientes; esta etapa sólo reduce **cuántas** filas de `SystemNotification` se crean, sin tocar `ShiftAlert` en absoluto (sigue creándose una fila por cada condición que dispare, exactamente igual que antes).
11. **¿Se puede resolver sin migración con los datos existentes?**: sí, confirmado — todo lo necesario para decidir el ganador (`punctuality.earlyLeave/lateLeave`, `duration.insufficientHours/extendedShift`, el conteo de segmentos por `conceptStatus`, y `hourConceptsRepository.findHasAdditionalConceptEnabled`) ya estaba disponible en memoria dentro de `evaluateShiftExit` antes de esta etapa — es pura lógica de aplicación, sin necesidad de ningún campo nuevo en `ShiftAlert` ni en `WorkShift`.
12. **¿Hace falta tocar frontend?**: no — ver §10.

## 5. Diferencia entre Alertas de Turnos y Notificaciones (Parte 3 del pedido)

Sin cambios de arquitectura, reafirmado por esta etapa:

- **`ShiftAlert` / Alertas de Turnos**: puede seguir mostrando **varias filas** por el mismo cierre — es la vista técnica/de auditoría, pensada para que RRHH/Turnos vea el detalle completo de qué se detectó (severidad, diferencia en minutos, tipo). Nunca se oculta un hallazgo acá.
- **`SystemNotification` / Notificaciones**: a partir de esta etapa, **como máximo una** por cierre de salida — es el canal de aviso, pensado para que RRHH sepa "hay algo que revisar" sin recibir ruido repetido por el mismo evento.

## 6. Política final de notificación única (Parte 2 del pedido)

**Prioridad aplicada — la propuesta en el pedido, evaluada y confirmada coherente con el código real, sin necesidad de ajustarla:**

1. `CONCEPTO_NO_HABILITADO` — contradicción real de configuración (un concepto matcheó pero no está habilitado para el empleado); requiere revisión de configuración, no sólo de horario.
2. `JORNADA_EXTENDIDA` — superó el máximo configurado/informativo de horas.
3. `SALIDA_TARDIA` — salió después del horario/tolerancia, sin llegar a "extendida".
4. `SALIDA_ANTICIPADA` — salió antes del horario/tolerancia.
5. `JORNADA_INSUFICIENTE` — por debajo del mínimo configurado, normalmente ya explicada por una salida anticipada, pero puede darse sola.
6. `SEGMENTO_SIN_CLASIFICAR` — la señal más débil (13C/13D); sólo es candidata si, además, el empleado tiene algún concepto adicional esperado.

**Por qué no se propuso un orden distinto**: se evaluó explícitamente si `SALIDA_ANTICIPADA` debía ir primero (como en la cascada parcial de 13B, donde era "la que nunca se suprime") — se descartó reordenar porque (a) `SALIDA_ANTICIPADA` y `SALIDA_TARDIA` son **mutuamente excluyentes por construcción** (`evaluateExitPunctuality` las computa sobre el mismo `differenceMinutes`, nunca pueden ser ambas `true` para el mismo cierre), así que este reordenamiento nunca hace perder a `SALIDA_ANTICIPADA` frente a `SALIDA_TARDIA` en ningún caso real; y (b) el resto del orden propuesto ya coincide exactamente con los 5 casos funcionales del pedido (Parte 5), confirmando que es la interpretación esperada.

**Implementación**: `EXIT_ALERT_NOTIFICATION_PRIORITY` (`workShiftEvaluationRunner.ts`), un array constante con el orden de arriba. `evaluateShiftExit` calcula qué tipos "dispararon" (`fired`) y recorre la prioridad en orden — el primero que disparó gana `notify: true`; todos los demás que dispararon reciben `notify: false` (se persisten igual). `SEGMENTO_SIN_CLASIFICAR` se resuelve en una segunda fase, sólo si ningún tipo de mayor prioridad ya ganó — mismo criterio de "no consultar si ya no hace falta" que la Etapa 13D había establecido para su propio chequeo de `EmployeeHourConcept` (ver §9, performance).

## 7. Caso real 09 Granja (Parte 4 del pedido)

Test dedicado (`workShiftEvaluationRunner.test.ts`, describe "Etapa 13G"): un cierre con `SALIDA_TARDIA` (3h tarde) + `JORNADA_EXTENDIDA` (11h trabajadas, máximo 9h) + `CONCEPTO_NO_HABILITADO` (un segmento) reproduce exactamente el caso real. Resultado verificado:
- Las 3 `ShiftAlert` se persisten (`upsertedAlertTypes()` contiene los 3 tipos).
- Una sola `SystemNotification`, con el título de `CONCEPTO_NO_HABILITADO` ("Concepto horario detectado pero no habilitado para el empleado") — la de mayor prioridad.

## 8. Cambios implementados

**`backend/src/modules/shifts/workShiftEvaluationRunner.ts`**:
- Nueva constante `EXIT_ALERT_NOTIFICATION_PRIORITY` (array ordenado, ver §6).
- Nueva función `isSegmentoSinClasificarNotifiable` (extraída de la lógica que antes vivía inline en `applyClassificationAlerts` — mismo comportamiento exacto de la Etapa 13D, ahora reutilizable desde `evaluateShiftExit` y desde `notifyClassificationAlerts`).
- `applyClassificationAlerts`: su parámetro `options` pasa de `{ notify: boolean }` (una sola bandera para ambos tipos) a `{ notifyConceptoNoHabilitado: boolean; notifySegmentoSinClasificar: boolean }` — cada tipo recibe su propia decisión explícita, ya resuelta por el llamador; la función ya no calcula ninguna cascada internamente.
- `notifyClassificationAlerts` (standalone, usado por `createWorkShift`): resuelve `notifySegmentoSinClasificar` con `isSegmentoSinClasificarNotifiable` (mismo comportamiento que tenía antes) y pasa `notifyConceptoNoHabilitado: true` siempre (sin cambios de comportamiento — ver §11 sobre por qué este camino no participa en la política de un solo ganador).
- `evaluateShiftExit`: reemplaza los `notify` ad hoc de `SALIDA_ANTICIPADA`/`SALIDA_TARDIA`/`JORNADA_INSUFICIENTE`/`JORNADA_EXTENDIDA` (antes: 2 con default `true`, 1 con `!earlyLeave`, 1 con default `true`) por un cálculo único (`fired` + recorrido de `EXIT_ALERT_NOTIFICATION_PRIORITY`) que decide, para los 6 tipos, cuál es el único que notifica.

**Nada más se modificó** — ni `hourConceptClassification.ts` (el motor de clasificación en sí), ni `workShiftEvaluation.service.ts` (funciones puras de matching/puntualidad/duración, reutilizadas tal cual), ni `schema.prisma`, ni ningún archivo de frontend.

## 9. Tests (Parte 7 del pedido)

**Backend** (+8 tests nuevos, 4 tests preexistentes con expectativa actualizada — su comportamiento esperado cambió por diseño, no por regresión —, 985 → 993 total, todos verdes):

Nuevo describe "`evaluateShiftExit` — Etapa 13G":
1. **Caso real (legajo 09 Granja)**: `CONCEPTO_NO_HABILITADO` + `JORNADA_EXTENDIDA` + `SALIDA_TARDIA` → las 3 `ShiftAlert` se persisten, una sola notificación (Parte 4).
2. Salida normal → sin alertas, sin notificación (Parte 5.1).
3. Salida tardía sola → una `ShiftAlert`, una notificación "Salida fuera de tolerancia" (Parte 5.2).
4. `CONCEPTO_NO_HABILITADO` + `SALIDA_TARDIA` (sin jornada extendida) → notifica sólo Concepto no habilitado (Parte 5.5, variante reducida del caso 09).
5. Segmento sin clasificar + salida tardía → no notifica el segmento (Parte 5.6).
6. Segmento sin clasificar solo, con concepto adicional esperado → notifica (Parte 5.7, confirma que 13D sigue intacto).
7. Segmento sin clasificar solo, sin concepto adicional esperado → no notifica (Parte 5.8, confirma que 13D sigue intacto).
8. Reevaluar el mismo cierre dos veces no duplica: misma fila de `ShiftAlert` upserteada (mismo `where`), un aviso por evaluación, nunca dos tipos distintos en la misma corrida (Parte 5.9 / Tests obligatorios #7).

**Tests preexistentes actualizados** (comportamiento esperado cambiado deliberadamente, no una regresión):
- "`CONCEPTO_NO_HABILITADO` nunca se suprime" (13B): redefinido — sigue sin suprimirse como `ShiftAlert`, pero ahora gana el único aviso sobre `SALIDA_ANTICIPADA` en vez de notificar ambas (Parte 5.5, caso general).
- "Caso 8 del pedido: jornada extendida... siempre notifica" (13B): redefinido — `JORNADA_EXTENDIDA` sigue disparando siempre, pero ahora gana el único aviso sobre `SALIDA_TARDIA` (Parte 5.3 del pedido original de 13G).

**Tests obligatorios ya cubiertos por la suite existente, sin necesitar cambios** (Parte 7 del pedido):
- #2 (jornada extendida + salida tardía notifica sólo jornada extendida) y #3 (salida anticipada + jornada insuficiente notifica sólo salida anticipada) — confirmados por los tests preexistentes "Caso 8" (actualizado) y "Caso 3 del pedido" (13B, sin cambios — `SALIDA_ANTICIPADA` seguía ganando, y sigue ganando con la nueva prioridad).
- #8 (las `ShiftAlert` internas se siguen persistiendo según corresponda) — verificado en cada test nuevo (`upsertedAlertTypes()` siempre incluye todos los tipos que dispararon, notifiquen o no).
- #9 (entrada sigue sin cambios) — cero líneas de `evaluateShiftEntry` tocadas; toda la suite de entrada (13A/13E/13E.1) sigue verde sin modificación.
- #10 (liquidación sigue sin cambios) — ningún archivo de `TimeEntry`/`HourConceptBreakdown`/liquidación tocado; la suite completa de Horas Especiales/exportación sigue verde.

## 10. Qué pasa con Alertas de Turnos (Parte 6 del pedido)

**No se tocó frontend** — decisión explícita, justificada:

- "Alertas de Turnos" (`ShiftAlertsPage.tsx`) sigue mostrando exactamente las mismas filas que antes de esta etapa — esta etapa no persiste menos `ShiftAlert`, sólo notifica menos. RRHH que entre a esa pantalla sigue viendo el detalle técnico completo (`SALIDA_TARDIA`, `JORNADA_EXTENDIDA`, `CONCEPTO_NO_HABILITADO`, las 3 filas del caso 09), tal como el pedido esperaba ("puede conservar más detalle").
- "Notificaciones" (`NotificationsPage.tsx`) no necesitó ningún cambio porque ya renderiza genéricamente lo que `SystemNotification` le devuelve, sin ningún mapeo por tipo — confirmado por lectura del componente (mismo hallazgo ya documentado en 13B §11). Al crear menos filas de `SystemNotification`, la pantalla automáticamente muestra menos avisos, sin tocar ni una línea de ese archivo.
- **Diagnóstico explícito pedido**: si la vista de "Alertas de Turnos" sigue resultando confusa para RRHH al mostrar varias filas relacionadas al mismo cierre sin ninguna agrupación visual, es candidata a una etapa futura de UI (agrupar por `WorkShift`/persona/evento) — no implementada acá por ser un rediseño de UI fuera del alcance explícito de esta etapa ("no hacer rediseño grande ahora salvo que sea mínimo"; agrupar una tabla no es mínimo). Ver §13.

## 11. Qué NO se tocó

- Entrada (`evaluateShiftEntry`, `matchShiftForEmployee`, `evaluateEntryPunctuality`, `INGRESO_TARDE`/`INGRESO_ANTICIPADO`/`DESCANSO_INSUFICIENTE`) — cero líneas tocadas.
- El motor de matching de turnos (`resolveMatchForExit`, `evaluateExitPunctuality`, `evaluateWorkedDuration`) — funciones puras, reutilizadas tal cual; sólo se leyeron sus resultados (`punctuality.earlyLeave/lateLeave`, `duration.insufficientHours/extendedShift`) para alimentar la nueva política.
- Horas Especiales (`doubleHourRuleMatching.ts`, `DoubleHourRule`) — ningún archivo tocado.
- Conceptos Horarios (`hourConceptClassification.ts`, `classifySegmentsForEmployee`) — sólo se leyó para el diagnóstico (confirmar de dónde nace `CONCEPTO_NO_HABILITADO`/`SEGMENTO_SIN_CLASIFICAR`), ningún archivo modificado. `hourConceptsRepository.findHasAdditionalConceptEnabled` (13D) se reutiliza tal cual, sin cambios en su implementación.
- Liquidación (`TimeEntry.hours/totalMinutes/appliedMultiplier`) — sin cambios.
- Grilla/export/bandeja de revisión — ningún archivo tocado.
- Fichador (`timeEntries.service.ts`, `timeEntries.repository.ts`) — ningún archivo tocado; `evaluateShiftExit` sigue invocándose exactamente igual desde los 3 call sites existentes (`closeWorkShiftManually`, `clockPhotoPunch`, `clockOutResolved`), sin cambio de firma.
- **`createWorkShift`/`notifyClassificationAlerts` (alta manual RRHH de un día completo)**: sigue notificando `CONCEPTO_NO_HABILITADO` y `SEGMENTO_SIN_CLASIFICAR` de forma independiente (sin competir entre sí por un único ganador) — ese camino nunca llama a `evaluateShiftExit` (no evalúa puntualidad/duración, no hay "cierre de salida" en el sentido de esta etapa), así que la política de un solo ganador de 13G no aplica ahí. Es un comportamiento preexistente (ya así desde antes de 13G), no tocado ni empeorado por esta etapa — documentado como límite de alcance explícito, no un descuido.
- Asignaciones de feriado (`HolidayWorkAssignment`) — sin cambios.
- "Sin actividad registrada" (`attendanceInactivity.service.ts`) — sin cambios.
- `schema.prisma` — sin cambios, sin migraciones.
- Frontend — ningún archivo tocado (ver §10).
- Permisos/RBAC — sin cambios.

## 12. Riesgos pendientes

- **`createWorkShift` (alta manual) puede seguir generando 2 avisos si RRHH carga un día completo con ambos problemas a la vez** (`CONCEPTO_NO_HABILITADO` + `SEGMENTO_SIN_CLASIFICAR` simultáneos) — ver §11. Es un camino de uso mucho menos frecuente que el fichador (carga manual puntual de RRHH, no el flujo diario de salida), y no fue el origen del caso real reportado. Si en el futuro se reporta ruido ahí también, extender la misma política de un solo ganador a `notifyClassificationAlerts` es un cambio acotado (mismo patrón, sin necesidad de tocar `applyClassificationAlerts` de nuevo).
- **La prioridad es fija, no configurable** — si en el futuro RRHH quisiera un orden distinto (por ejemplo, priorizar `SALIDA_ANTICIPADA` sobre `SALIDA_TARDIA`/`JORNADA_EXTENDIDA` en algún régimen especial), hoy requiere un cambio de código (editar `EXIT_ALERT_NOTIFICATION_PRIORITY`), no una opción de configuración. No se pidió que fuera configurable; documentado como límite conocido del alcance V1 (mismo criterio ya aceptado en 13B para su cascada parcial).
- **"Alertas de Turnos" puede seguir resultando ruidosa como vista técnica** (varias filas por el mismo cierre, sin agrupación visual) — ver §13, próxima etapa sugerida.

## 13. Próxima etapa sugerida

**Agrupar "Alertas de Turnos" por evento/cierre**, si la vista técnica sigue generando confusión pese a que "Notificaciones" ya quedó limpia: agrupar visualmente las filas que comparten `workShiftId` (mismo cierre) bajo un único bloque expandible, en vez de N filas sueltas sin relación visual explícita entre sí. No implementado en esta etapa — es un cambio de UI no mínimo, explícitamente fuera del alcance acordado ("no hacer rediseño grande ahora salvo que sea mínimo").

---

No se tocó entrada, el motor de matching de turnos, Horas Especiales, Conceptos Horarios (salvo lectura para diagnóstico), liquidación, grilla/export/bandeja, frontend, asignaciones de feriado, ni "Sin actividad registrada". No se creó ninguna migración. No commitear sin aprobación explícita del usuario.
