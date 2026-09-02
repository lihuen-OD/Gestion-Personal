# Corrección 13H.1 — Dejar de crear SEGMENTO_SIN_CLASIFICAR sin concepto adicional esperado

Fecha: 2026-09-02
Estado: implementado, validado, pendiente de aprobación para commitear
Continúa: `docs/decisions/SHIFT_ALERTS_GROUPED_VIEW_13H.md` (agrupación por jornada, donde se detectó el problema), `docs/decisions/SHIFT_SEGMENT_UNCLASSIFIED_POLICY_13D.md` (política original de concepto esperado)
Alcance: sólo la persistencia de `SEGMENTO_SIN_CLASIFICAR` cuando el empleado no tiene ningún concepto horario adicional habilitado. No se tocó liquidación, Horas Especiales, el motor de clasificación de Conceptos Horarios, fichador, entrada/salida (salvo la única línea que decide si esta alerta puntual se persiste), ni la generación de ninguna otra alerta.

## 1. Resumen ejecutivo

13D (Etapa previa) ya había resuelto que `SEGMENTO_SIN_CLASIFICAR` no debía **notificar** cuando el empleado no tiene ningún concepto horario adicional habilitado — pero seguía **persistiéndose** como `ShiftAlert` "interna". Al agrupar Alertas de Turnos por jornada (Etapa 13H), esa fila interna volvió a ser visible para RRHH como "hallazgo asociado" dentro del grupo, reintroduciendo la misma confusión que 13D había resuelto para Notificaciones. Esta corrección cierra el hueco en el origen: sin concepto adicional esperado, la `ShiftAlert` de tipo `SEGMENTO_SIN_CLASIFICAR` **ya no se crea en absoluto** (ni interna, ni notificable) — no sólo no notifica. Resuelto 100% en backend, en el punto exacto donde ya se decidía si notificar; cero cambios de frontend, cero cambios de schema. Datos históricos ya persistidos antes de esta corrección no se tocan. +6 tests backend actualizados/nuevos, 994/994 verdes.

## 2. Diagnóstico

1. **¿El endpoint de Alertas de Turnos (`GET /shifts/alerts`) devuelve si el empleado tiene conceptos adicionales?** No — `shiftAlert.repository.ts` (`employeeSelect`/`workShiftSelect`) no incluye ningún dato de `EmployeeHourConcept`. El frontend no tiene, ni tuvo nunca, forma de resolver esto por sí solo.
2. **¿`SEGMENTO_SIN_CLASIFICAR` tenía algún flag `notify`/metadata visible por API que permitiera distinguir "interna" de "notificable"?** No — `ShiftAlert` (schema.prisma) no tiene ningún campo `notify` persistido; el parámetro `notify` de `createShiftAlert` es transitorio (sólo decide, en el momento de creación, si se dispara `SystemNotification`) y nunca se guarda en la fila. Una vez creada, una `ShiftAlert` no lleva ninguna marca de "esta no debía notificar".
3. **¿13D dejó alguna forma de distinguir "persistida interna sin notificación"?** No — 13D sólo resolvía el parámetro `notify` en el momento de la llamada a `createShiftAlert`; la fila resultante en la base es indistinguible de cualquier otra `ShiftAlert` `PENDIENTE`.
4. **¿13H muestra todas las `ShiftAlert` del grupo sin filtrar?** Sí — `groupAlerts` (`ShiftAlertsPage.tsx`) agrupa y muestra **todo** lo que el endpoint devuelve, sin ningún filtro adicional por "relevancia".
5. **Dónde conviene resolverlo**:
   - **A) Frontend, ocultando hallazgos internos/no notificables** — descartado: el punto 1 confirma que el frontend no tiene el dato necesario (¿tiene el empleado algún concepto adicional?); hacerlo posible exigiría enriquecer el endpoint con esa información, duplicando en el cliente una regla que ya vive en el backend.
   - **B) Backend, no devolviendo esas alertas a la vista principal** — descartado: exigiría un filtro nuevo en `shiftAlertRepository.findMany` que reevalúe en cada lectura si el empleado *hoy* tiene conceptos adicionales — una alerta ya creada podría "aparecer y desaparecer" según el estado actual del empleado, inconsistente con lo que se decidió en el momento del cierre, y más costoso (una subconsulta extra por fila).
   - **C) Backend, no persistir `SEGMENTO_SIN_CLASIFICAR` cuando no hay concepto adicional esperado** — **elegida**: usa exactamente el mismo dato que 13D ya consultaba en ese momento (`hourConceptsRepository.findHasAdditionalConceptEnabled`), en el mismo punto del código, sin ninguna consulta nueva ni ningún endpoint nuevo. Es la solución más limpia: arregla el problema en el origen, y todas las vistas presentes y futuras (Notificaciones, Alertas de Turnos, cualquier otra) quedan correctas automáticamente sin duplicar la regla en ningún otro lugar.

## 3. Frontend o backend

**100% backend.** No se tocó ningún archivo de `frontend/` — la corrección está en el punto exacto donde nace el dato (`workShiftEvaluationRunner.ts`), así que la vista agrupada de la Etapa 13H queda correcta sin ningún cambio propio: simplemente deja de recibir filas que antes existían y ahora no se crean.

## 4. Qué pasa con SEGMENTO_SIN_CLASIFICAR sin concepto adicional

**Ya no se crea ninguna `ShiftAlert` de ese tipo para ese cierre.** Antes: se persistía siempre (con `notify: false`) y aparecía como hallazgo interno en Alertas de Turnos (Etapa 13H) aunque nunca hubiera generado notificación. Ahora: la llamada a `createShiftAlert` para `SEGMENTO_SIN_CLASIFICAR` directamente no ocurre — no hay fila que mostrar en ningún lado, ni en Notificaciones (sin cambios, ya estaba bien desde 13D) ni en Alertas de Turnos (corregido acá). Coincide exactamente con la Regla 1/2 del pedido: "la ausencia de concepto horario adicional no es un problema", así que no amerita ningún registro.

## 5. Qué pasa con SEGMENTO_SIN_CLASIFICAR con concepto adicional

**Sin cambios respecto de 13D/13G.** Se sigue persistiendo siempre que haya un tramo sin clasificar, y notifica sólo si ninguna alerta de mayor prioridad ya explica el mismo cierre (política unificada de la Etapa 13G). En Alertas de Turnos (13H) sigue apareciendo como hallazgo asociado del grupo, exactamente como antes de esta corrección — acá sí hay un hallazgo real que podría ameritar revisión de configuración.

## 6. Cambios implementados

**`backend/src/modules/shifts/workShiftEvaluationRunner.ts`**:
- `applyClassificationAlerts`: el parámetro `options.notify` (booleano único) para `SEGMENTO_SIN_CLASIFICAR` se reemplaza por dos banderas explícitas — `persistSegmentoSinClasificar` (si corresponde crear la `ShiftAlert` en absoluto) y `notifySegmentoSinClasificar` (si además corresponde avisar). El `createShiftAlert` para este tipo ahora está condicionado a `sinClasificar.length > 0 && options.persistSegmentoSinClasificar`, no sólo a `sinClasificar.length > 0`.
- `notifyClassificationAlerts` (standalone, alta manual RRHH): resuelve `segmentoSinClasificarEligible` una sola vez y la usa para **ambas** banderas (`persist`/`notify`) — en ese camino, al no competir contra otras alertas, "elegible para persistir" y "elegible para notificar" son la misma condición.
- `evaluateShiftExit`: la consulta `isSegmentoSinClasificarNotifiable` (Etapa 13D — ¿tiene el empleado algún concepto adicional habilitado?) ya no puede diferirse a "sólo si ningún tipo de mayor prioridad ya ganó" (la optimización que había agregado la Etapa 13G) — ahora también decide si la `ShiftAlert` se persiste, no sólo si notifica, así que se resuelve siempre que haya al menos un segmento sin clasificar (una sola vez, nunca por segmento). El resultado (`segmentoSinClasificarEligible`) alimenta tanto la selección del ganador de notificación (13G, sin cambios de comportamiento ahí) como la nueva bandera de persistencia.

**Nada más se modificó** — el resto de `evaluateShiftExit` (puntualidad, duración, `CONCEPTO_NO_HABILITADO`, la prioridad de 13G) es exactamente igual; `hourConceptClassification.ts` (el motor que produce `SIN_CONCEPTO_COMPATIBLE` en primer lugar) no se tocó.

## 7. Tests

**Backend** (+1 test nuevo, 5 tests preexistentes actualizados a la expectativa correcta, 993 → 994 total, todos verdes):

- **Nuevo, caso 3 del pedido**: `SALIDA_TARDIA` + `JORNADA_INSUFICIENTE` + segmento sin clasificar **sin** concepto adicional → sólo 2 `ShiftAlert` (`SALIDA_TARDIA`, `JORNADA_INSUFICIENTE`), `SEGMENTO_SIN_CLASIFICAR` no aparece en absoluto; una sola notificación ("Salida fuera de tolerancia"), sin cambios en las otras dos.
- **Actualizados** (comportamiento esperado cambiado a propósito, no una regresión): "Caso A del pedido" (13D) — antes esperaba `upsertedAlertTypes()` con la fila; ahora espera lista vacía. "Caso D"/"Caso E" (13D) — con concepto adicional, la consulta a `EmployeeHourConcept` ahora SÍ corre siempre que hay un segmento sin clasificar (antes se saltaba si otra alerta ya había ganado el aviso); sin concepto adicional, el segmento directamente no aparece en `upsertedAlertTypes()`. `notifyClassificationAlerts` standalone (13D) y "Parte 5.8" (13G) — misma actualización, lista vacía en vez de `["SEGMENTO_SIN_CLASIFICAR"]`.
- **Caso con concepto adicional (Parte 8 del pedido)**: cubierto sin cambios por "Caso B del pedido" (13D, preexistente) — sigue persistiendo y notificando cuando es la única explicación.
- **Notificaciones no se tocan**: confirmado — ningún test de `CONCEPTO_NO_HABILITADO`/`JORNADA_EXTENDIDA`/`SALIDA_TARDIA`/`SALIDA_ANTICIPADA`/`JORNADA_INSUFICIENTE` cambió su expectativa de notificación; toda la suite de la Etapa 13G sigue verde sin modificación (salvo el único test que involucraba `SEGMENTO_SIN_CLASIFICAR` sin concepto, ya listado arriba).
- **Agrupación por `workShiftId` (13H) no se rompe**: no requirió test nuevo — no se tocó ningún archivo de frontend; los 20 tests de `ShiftAlertsPage.test.tsx` siguen intactos y no se ejecutaron de nuevo porque no hubo ningún cambio en esa capa.
- **Liquidación**: sin test nuevo — ningún archivo de `TimeEntry`/`HourConceptBreakdown`/liquidación tocado.

## 8. Validaciones ejecutadas

`prisma validate` ✅, `prisma generate` ✅, `prisma migrate status` ✅ (49 migraciones, sin cambios de schema, al día). Backend: `typecheck` ✅, `vitest run` ✅ 994/994 (66 archivos), `build` ✅. Frontend: no se tocó ningún archivo, no requirió validaciones (confirmado con `git status`). `git diff --check` ✅ sin errores de espacios en blanco.

## 9. Qué NO se tocó

- Frontend — ningún archivo (`ShiftAlertsPage.tsx` y su test quedan exactamente como los dejó la Etapa 13H).
- Liquidación (`TimeEntry.hours/totalMinutes/appliedMultiplier`) — sin cambios.
- Horas Especiales (`doubleHourRuleMatching.ts`) — sin cambios.
- El motor de clasificación de Conceptos Horarios (`hourConceptClassification.ts`, `classifySegmentsForEmployee`) — sin cambios; sigue marcando `SIN_CONCEPTO_COMPATIBLE` exactamente igual, esta corrección sólo cambia si ese resultado se persiste como alerta.
- Fichador (`timeEntries.service.ts`, `timeEntries.repository.ts`) — ningún archivo tocado.
- Entrada (`evaluateShiftEntry`) — cero líneas tocadas.
- El resto de la política de notificación única de 13G (`CONCEPTO_NO_HABILITADO`, `JORNADA_EXTENDIDA`, `SALIDA_TARDIA`, `SALIDA_ANTICIPADA`, `JORNADA_INSUFICIENTE`, la prioridad combinada de 13H) — sin cambios de comportamiento.
- `schema.prisma` — sin cambios, sin migraciones.
- Datos históricos — ninguna fila `SEGMENTO_SIN_CLASIFICAR` ya persistida antes de esta corrección se modificó ni se borró; siguen existiendo tal cual, visibles en Alertas de Turnos si un empleado sin conceptos adicionales tiene alguna de antes de esta corrección (riesgo residual, ver más abajo).

## 10. Riesgos pendientes

- **Filas históricas de `SEGMENTO_SIN_CLASIFICAR` creadas antes de esta corrección para empleados sin concepto adicional siguen visibles** — no se filtran retroactivamente (ni se borran ni se ocultan), por decisión explícita ("no borrar históricos") y porque hacerlo requeriría exactamente la Opción B descartada (recalcular en cada lectura). Si esto sigue generando confusión real en el uso diario, es una acción puntual sobre datos ya existentes (ej. un script de limpieza único) que requeriría autorización explícita — no una migración de schema, no un cambio de código recurrente.
- **La consulta a `EmployeeHourConcept` ya no puede saltearse cuando otra alerta de mayor prioridad ya ganó** (regresión parcial de la optimización agregada en 13G) — ahora corre siempre que hay al menos un segmento sin clasificar, para decidir persistencia, no sólo notificación. Costo acotado: una consulta más por cierre, sólo cuando aplica, nunca por segmento — mismo orden de magnitud que antes de la optimización de 13G.

---

No se tocó frontend, liquidación, Horas Especiales, el motor de clasificación de Conceptos Horarios, fichador, ni entrada. No se creó ninguna migración. No commitear sin aprobación explícita del usuario.
