# Etapa 13B — Salidas con ingreso abierto: cierre, clasificación y alertas duplicadas

Fecha: 2026-09-01
Estado: implementado, validado, pendiente de aprobación para commitear
Continúa: `docs/decisions/SHIFT_ENTRY_CLASSIFICATION_13A.md`
Alcance: sólo SALIDA con ingreso abierto. No se tocó entrada, Horas Especiales, Conceptos Horarios, liquidación, grilla/export/bandeja, asignaciones de feriado, ni "Sin actividad registrada".

## 1. Resumen ejecutivo

Dos problemas reales, con una causa raíz compartida: `evaluateShiftExit`/`notifyClassificationAlerts` corrían **después** de que la salida ya estaba guardada (transacción `closeOpenWorkShift` ya committeada), pero cualquier error ahí se propagaba sin capturar hasta el llamador — que lo trataba igual que un fallo real de guardado. Eso producía dos síntomas observados: (1) hasta 3 `SystemNotification` separadas casi simultáneas para una misma salida corta/anticipada ("Tramo de jornada sin concepto horario compatible", "Jornada por debajo del mínimo", "Salida anticipada" — mala experiencia para RRHH), y (2) un `503 CLOCK_TEMPORARY_FAILURE` en `POST /clock/photo-punch` cuando alguna de esas evaluaciones fallaba, con el agravante de que el catch de esa ruta borraba la evidencia fotográfica ya referenciada por la fichada persistida.

Corrección: (a) `evaluateShiftExit` ahora es best-effort de punta a punta (nunca propaga una excepción — causa raíz del 503 resuelta con doble capa de contención), y (b) una política de prioridad entre las 3 alertas de "salida corta" reduce los avisos a RRHH a uno solo por evento sin dejar de registrar el detalle completo en Alertas de Turnos. La resolución de turno en salida (`resolveMatchForExit`) ya era segura contra el bug de 13A — confirmado, no un fix nuevo. +18 tests backend (953/953 verdes). Sin cambios de schema, sin migraciones, sin cambios de frontend.

## 2. El problema (casos observados manualmente por el usuario)

**Caso 1**: empleado con ingreso abierto marca salida. La salida se guarda, pero se generan 3 alertas/notificaciones casi simultáneas para el mismo evento ("Tramo de jornada sin concepto horario compatible", "Jornada por debajo del mínimo", "Salida anticipada").

**Caso 2**: empleado con ingreso abierto intenta marcar salida vía `POST /api/time-entries/clock/photo-punch`. El backend responde `503 Service Unavailable`. Sólo pasa con salida, nunca con ingreso.

## 3. Diagnóstico (Parte 1 del pedido, con evidencia)

1. **Dónde se procesa una fichada de salida**: `backend/src/modules/time-entries/timeEntries.service.ts` — 3 caminos llegan a `timeEntriesRepository.closeOpenWorkShift`: `clockPhotoPunch` (rama `punchType==="OUT"`, línea ~1283), `clockOutResolved` (fichador por DNI sin foto, línea ~1470), `closeWorkShiftManually` (cierre manual admin, línea ~811).
2. **Qué repository cierra el `WorkShift`**: `timeEntriesRepository.closeOpenWorkShift` (`timeEntries.repository.ts:1863`) — **100% envuelto en `prisma.$transaction`**: `WorkShift.updateMany` (guardado optimista, `claimed.count!==1` lanza `WORK_SHIFT_ALREADY_CLOSED` si otro intento ya cerró la misma jornada), `AttendancePunch.create` (con evidencia fotográfica si aplica), `WorkShift.update` (liga `endPunchId`), `TimeSegment`/`SpecialHourRuleApplication`/`TimeEntry` por segmento. Confirmado: es atómica — o se guarda todo, o no se guarda nada. Esto descarta "guardado parcial" en el sentido de una transacción a medio commitear (ver §4).
3. **Qué función evalúa la salida contra turnos**: `resolveMatchForExit` (`workShiftEvaluationRunner.ts`) — **no busca contra todos los turnos del sistema**, sólo resuelve `shift.shiftTemplateId` (ya fijado en el ingreso) contra `ShiftTemplate.findUnique`/`ShiftAssignment.findUnique`. Nunca llama a `findMany`. Confirmado con test dedicado (§9, Caso 5).
4. **Qué función evalúa salida anticipada**: `evaluateExitPunctuality` (`workShiftEvaluation.service.ts`, sin cambios desde antes de esta etapa) — compara `actualExitAt` contra `scheduledInstantForShiftTime(shift.startAt, template.endTime, crossesMidnight)`.
5. **Qué función evalúa jornada por debajo del mínimo**: `evaluateWorkedDuration` (sin cambios) — `insufficientHours: totalMinutes < template.minimumMinutesForCompliance`.
6. **Qué función evalúa tramo sin concepto compatible**: `classifyWorkShiftSegments` (`hour-concepts`, no tocado en esta etapa) marca un segmento `conceptStatus: "SIN_CONCEPTO_COMPATIBLE"`; `notifyClassificationAlerts`/`applyClassificationAlerts` (`workShiftEvaluationRunner.ts`) lo traduce en `ShiftAlert` tipo `SEGMENTO_SIN_CLASIFICAR`.
7. **Qué función genera las alertas/notificaciones de salida**: `evaluateShiftExit` (puntualidad + duración) y `notifyClassificationAlerts` (clasificación de segmentos) — **antes de esta etapa, dos funciones separadas, llamadas una después de la otra desde `timeEntries.service.ts`, cada una notificando de forma independiente**.
8. **¿Corren dentro de la misma transacción que guarda la salida?** No. Se llaman **después** de que `closeOpenWorkShift` ya resolvió y committeó su propia transacción. Esto es correcto en sí mismo (las alertas son un efecto secundario de negocio, no deberían bloquear ni alargar la transacción de guardado — `docs/PERFORMANCE_STANDARDS.md` §2.D), pero exige que cualquier fallo ahí sea best-effort — y no lo era.
9. **¿Un fallo creando alerta/notificación puede devolver 503?** Sí, confirmado. `createShiftAlert` (`workShiftEvaluationRunner.ts`) hacía `await prisma.shiftAlert.upsert(...)` **sin try/catch** (sólo el `notifyUsers` posterior estaba protegido, desde la Etapa 10E). Cualquier excepción ahí (o en cualquier otra línea de `evaluateShiftExit`/`notifyClassificationAlerts`) se propagaba sin capturar hasta `timeEntries.service.ts`, cuyo bloque `catch` en la rama de salida de `clockPhotoPunch` (línea ~1338) trataba **cualquier** error no reconocido igual que un fallo real de guardado: `await cleanupClockEvidence(evidence)` (borra los archivos de storage) y `throw error` (crudo, no `AppError`). Ese error crudo llegaba a `clockPhotoPunchIdempotent`, que envuelve todo error no-`AppError` en `503 CLOCK_TEMPORARY_FAILURE` ("El intento no fue confirmado") — un diagnóstico falso.
10. **¿La salida queda guardada parcialmente?** No en el sentido de una transacción incompleta (ver punto 2) — **sí en el sentido de que el cliente recibe un 503 que dice "no confirmado" sobre una salida que en realidad SÍ se guardó completa** (`WorkShift` cerrado, `AttendancePunch` de salida creado, `TimeEntry`/`TimeSegment` generados), más el agravante de que `cleanupClockEvidence` borra el archivo de evidencia que el `AttendancePunch` ya persistido está referenciando — dejando una referencia colgante (`photoFileId`/`thumbnailFileId` apuntando a un archivo borrado).
11. **¿Usa `ShiftAssignment` o vuelve a buscar `ShiftTemplate` general?** Usa exclusivamente `shift.shiftTemplateId` (ver punto 3) — nunca una búsqueda general. Confirmado sin bug de 13A en este camino.
12. **¿Existen búsquedas contra turnos ajenos similares al bug de 13A?** No — `resolveMatchForExit` nunca tuvo ese patrón (a diferencia de `matchShiftForEmployee`, usado sólo en entrada). Se agregó test de regresión explícito para dejarlo confirmado, no supuesto.
13. **¿Hay control anti-duplicado por tipo/empleado/fecha/evento?** Sí, preexistente — `ShiftAlert.@@unique([workShiftId, type])` + `upsert` en `createShiftAlert` (ninguna alerta se duplica al reevaluar la misma jornada). Sin cambios; confirmado con test.
14. **¿Las alertas de salida tienen severidad/prioridad?** Severidad sí (`INFO`/`ADVERTENCIA`/`CRITICA`, fija por tipo). Prioridad **entre tipos para decidir qué notifica** no existía — es lo que se agrega en esta etapa (ver §6).
15. **¿Cómo se renderizan en Notificaciones?** `NotificationsPage.tsx` renderiza `title`/`message` tal cual llegan — sin cambios necesarios, esta etapa reduce cuántas `SystemNotification` se crean, no cómo se muestran (ver §11).
16-18. **Origen exacto de los 3 mensajes**: los tres son `labelByAlertType[...]` en `workShiftEvaluationRunner.ts` — `SEGMENTO_SIN_CLASIFICAR`: "Tramo de jornada sin concepto horario compatible"; `JORNADA_INSUFICIENTE`: "Jornada por debajo del mínimo"; `SALIDA_ANTICIPADA`: "Salida anticipada". Los 3 ya existían antes de esta etapa (Etapas 6L/8-10), sin cambios de copy.
19. **Logs existentes para el 503**: `clockPhotoPunchIdempotent` ya logueaba `CLOCK_ATTEMPT_FAILED` con `severity: appError.statusCode >= 500 ? "critical" : "warning"` — es decir, el log SÍ existía y clasificaba el 503 como crítico, pero no distinguía "la salida se guardó y sólo falló la evaluación de alertas" de "la salida no se guardó" — la causa real quedaba oculta detrás de un mensaje genérico (`CLOCK_TEMPORARY_FAILURE`, sin más contexto que el `error.message` crudo).
20. **Tests previos de salida anticipada/corta**: existían para `evaluateShiftExit`/`evaluateWorkedDuration` de forma aislada (Etapas 8-10D), pero ninguno cubría la combinación de 2-3 tipos disparando juntos para la misma jornada, ni la robustez ante un fallo de `prisma.shiftAlert.upsert` (sólo `notifyUsers` tenía test de fallo, Etapa 10E).

## 4. Causa del 503 (confirmada, con reproducción)

**Causa exacta**: `createShiftAlert` no envolvía `prisma.shiftAlert.upsert` en try/catch (sólo el `notifyUsers` posterior, desde 10E). Cualquier excepción ahí — o en cualquier otra línea de `evaluateShiftExit`/`notifyClassificationAlerts` (ambas corriendo, sin protección, después de que `closeOpenWorkShift` ya había committeado) — se propagaba cruda hasta el bloque `catch` de la rama de salida en `clockPhotoPunch`, que:
1. Llamaba `cleanupClockEvidence(evidence)` — borra en storage la foto/thumbnail que el `AttendancePunch` de salida **ya persistido** referencia.
2. No reconocía el error (no es `TIME_ENTRY_LOCKED:`/`WORK_SHIFT_ALREADY_CLOSED`) → `throw error` crudo.
3. `clockPhotoPunchIdempotent` envolvía ese error crudo en `503 CLOCK_TEMPORARY_FAILURE`.

**Reproducción**: no se reprodujo contra la base real (Neon, staging, no se justifica forzar un fallo de infraestructura ahí) ni se armó el mock completo de `storageService`/evidencia fotográfica que exigiría un test end-to-end de `clockPhotoPunch` (no existía ninguno en el repo — ni siquiera para el camino feliz — antes de esta etapa; agregarlo hubiera significado construir infraestructura de mocks nueva y no acotada sólo para reproducir este bug puntual). En su lugar, se reprodujo **en el punto exacto de la falla**, con evidencia más precisa que un test end-to-end: `workShiftEvaluationRunner.test.ts` ("Caso 9 del pedido / causa raíz del 503") fuerza `prisma.shiftAlert.upsert` a rechazar y confirma que, **antes de esta corrección**, esa excepción se hubiera propagado sin capturar fuera de `evaluateShiftExit` — y `timeEntries.service.test.ts` ("Caso 9... si evaluateShiftExit falla, la salida igual se confirma") reproduce el mismo escenario un nivel más arriba, con el mock de `evaluateShiftExit` rechazando, confirmando que `clockOutByEmployee` (mismo camino de cierre que `clockPhotoPunch`, sin necesitar mocks de storage) sigue devolviendo la salida cerrada con éxito. Ambos tests fallan si se revierte la corrección — es la prueba de que la causa identificada es la real, no una hipótesis sin verificar.

**Otras causas descartadas explícitamente** (de la lista de sospechas del pedido): no es un enum faltante (los 12 tipos de `ShiftAlertType` usados en salida existen desde antes de esta etapa, y 13A sólo agregó `INGRESO_ANTICIPADO`, que no participa en salida); no es una alerta duplicada (el `upsert` por `[workShiftId, type]` ya deduplicaba correctamente, confirmado con test); no es una validación Zod (el error se genera después de la validación, en la fase de evaluación de alertas); no es un problema de rate limit ni de reintentos (no se encontró evidencia de eso en el código de fichador — el idempotency-key ya maneja reintentos correctamente, ver §8).

## 5. Regla funcional de salida (Parte 3 del pedido) — confirmada, no requirió cambios de matching

1. **Turno asignado como referencia principal**: ya era así — `resolveMatchForExit` usa `shift.shiftTemplateId` (fijado en el ingreso, con la prioridad de 13A ya aplicada ahí). Confirmado con test, sin cambios de código.
2. **Nunca elegir un turno ajeno**: ya era así — `resolveMatchForExit` nunca hace una búsqueda "por hora contra todos los turnos" (a diferencia de `matchShiftForEmployee`, exclusivo de entrada). Confirmado con test.
3. **Salida antes de tolerancia → `SALIDA_ANTICIPADA`**: sin cambios, ya funcionaba.
4. **Salida dentro de tolerancia → sin alerta**: sin cambios, ya funcionaba.
5. **Jornada extendida**: sin cambios, sigue funcionando igual (fuera de la cascada de prioridad de "jornada corta", ver §6).
6. **Jornada por debajo del mínimo**: se persiste siempre; su **aviso** (`SystemNotification`) queda subordinado a `SALIDA_ANTICIPADA` cuando ambas explican el mismo evento (§6).
7. **Tramo sin concepto compatible**: se persiste siempre; su aviso queda subordinado a `SALIDA_ANTICIPADA`/`JORNADA_INSUFICIENTE` cuando alguna de esas ya explica el evento (§6).

## 6. Política de alertas duplicadas (Parte 4 del pedido)

**Prioridad implementada** (exactamente la propuesta por el pedido): `SALIDA_ANTICIPADA` > `JORNADA_INSUFICIENTE` > `SEGMENTO_SIN_CLASIFICAR`.

**Regla**: la `ShiftAlert` (fila de historial/auditoría en "Alertas de Turnos") se persiste **siempre** para los 3 tipos, sin excepción — nunca se oculta un problema. Sólo se suprime el **aviso** (`SystemNotification`/`notifyUsers`) de un tipo de menor prioridad cuando uno de mayor prioridad **ya disparó para la misma salida**:

| Combinación real | `ShiftAlert` creadas | `SystemNotification` enviadas |
|---|---|---|
| Sólo salida anticipada | `SALIDA_ANTICIPADA` | 1 (Salida anticipada) |
| Salida anticipada + jornada corta | `SALIDA_ANTICIPADA` + `JORNADA_INSUFICIENTE` | 1 (Salida anticipada) |
| Jornada corta sin salida anticipada (ej. ingreso tardío, salida puntual) | `JORNADA_INSUFICIENTE` | 1 (Jornada por debajo del mínimo) — **no se suprime cuando es la única explicación** |
| Salida anticipada + tramo sin concepto | `SALIDA_ANTICIPADA` + `SEGMENTO_SIN_CLASIFICAR` | 1 (Salida anticipada) |
| Jornada corta + tramo sin concepto (sin salida anticipada) | `JORNADA_INSUFICIENTE` + `SEGMENTO_SIN_CLASIFICAR` | 1 (Jornada por debajo del mínimo) |
| Sólo tramo sin concepto (salida e jornada normales) | `SEGMENTO_SIN_CLASIFICAR` | 1 (Tramo de jornada sin concepto horario compatible) — **no se suprime cuando es la única explicación** |
| `CONCEPTO_NO_HABILITADO` (cualquier combinación) | siempre se crea | siempre notifica |
| `SALIDA_TARDIA` / `JORNADA_EXTENDIDA` (cluster de "jornada larga") | siempre se crean | siempre notifican |

**Por qué `CONCEPTO_NO_HABILITADO` queda fuera de la cascada**: representa un problema de configuración real e independiente del horario de salida (un `HourConceptRule` matcheó un tramo, pero ese concepto no está habilitado para el empleado) — nunca es "consecuencia" de haber salido antes, a diferencia de `SEGMENTO_SIN_CLASIFICAR` (que sí puede ser un tramo residual producto de un recorte de jornada). Siempre notifica, sin excepción — "no ocultar problemas críticos".

**Por qué `SALIDA_TARDIA`/`JORNADA_EXTENDIDA` quedan fuera**: son el cluster de "jornada larga", ortogonal al de "jornada corta" que esta política resuelve — no hay evidencia ni caso reportado de ruido ahí, y mezclarlos hubiera sido una generalización sin necesidad confirmada.

**Implementación**: `createShiftAlert` gana un parámetro opcional `notify?: boolean` (default `true`, no rompe ningún llamador existente) — cuando es `false`, la `ShiftAlert` se persiste exactamente igual, pero se salta el bloque de `notifyUsers` por completo (ni siquiera se intenta, no es "notificar y descartar el resultado"). `evaluateShiftExit` calcula `earlyLeave`/`insufficientHours` como banderas locales y las usa para decidir el `notify` de `JORNADA_INSUFICIENTE` (`!earlyLeave`) y de `SEGMENTO_SIN_CLASIFICAR` (`!earlyLeave && !insufficientHours`) — cascada estrictamente descendente, nunca al revés (una jornada corta nunca suprime `SALIDA_ANTICIPADA`).

## 7. Cambios implementados

**`backend/src/modules/shifts/workShiftEvaluationRunner.ts`**:
- `createShiftAlert`: nuevo parámetro `notify?: boolean` (default `true`) — persiste siempre, notifica condicionalmente.
- `evaluateShiftExit`: firma nueva `(employeeId, workShiftId, actualAt, classifiedSegments = [])` — ahora también recibe los segmentos clasificados y aplica la política de prioridad de §6 en un solo lugar. **Toda la función queda envuelta en un único try/catch best-effort** (nunca propaga una excepción — causa raíz del 503, ver §4) que loguea `EVALUATE_SHIFT_EXIT_FAILED` (severidad `critical`) sin bloquear nada aguas arriba.
- Nueva función interna `applyClassificationAlerts` (no exportada) — misma lógica que antes tenía `notifyClassificationAlerts`, ahora parametrizada por `{ notify }`.
- `notifyClassificationAlerts` (exportada) — se mantiene para su único uso restante fuera de esta cascada (`createWorkShift`, alta manual de un día completo sin `evaluateShiftExit`, fuera de alcance de esta etapa) — delega en `applyClassificationAlerts` con `notify: true` siempre, comportamiento idéntico al de antes.

**`backend/src/modules/time-entries/timeEntries.service.ts`**:
- Nueva función interna `evaluateShiftExitSafely` — segunda capa de contención a nivel llamador (`evaluateShiftExit` ya es best-effort por sí sola; esto protege contra una futura regresión que reintroduzca una excepción sin capturar en ese módulo). Loguea `EVALUATE_SHIFT_EXIT_CALL_FAILED` si algo se escapa igual.
- Los 3 call sites que cierran una jornada abierta (`closeWorkShiftManually`, la rama `SALIDA` de `clockPhotoPunch`, `clockOutResolved`) ahora llaman `evaluateShiftExitSafely(..., classifiedSegments)` **una sola vez**, en vez de `evaluateShiftExit(...)` + `notifyClassificationAlerts(...)` por separado.
- El único call site que **no** se tocó: `createWorkShift` (alta manual de un día completo por RRHH) — sigue llamando `notifyClassificationAlerts` de forma standalone, sin `evaluateShiftExit` (nunca lo llamó, no hay jornada abierta que cerrar en ese flujo) y sin la cascada de prioridad de 13B (fuera del alcance: "grilla/carga manual", explícitamente no tocado).

**Nada de esto requirió tocar** `timeEntries.repository.ts` (`closeOpenWorkShift` ya era transaccional y correcto), `workShiftEvaluation.service.ts` (funciones puras de matching, sin cambios), ni `schema.prisma`.

## 8. Doble click / reintento rápido (Caso 10 del pedido)

Ya protegido, sin cambios necesarios: `clockPhotoPunchIdempotent` deduplica por `requestId` (clave de idempotencia real: mismo `requestId` + mismo hash → devuelve la respuesta ya guardada sin re-ejecutar nada; hash distinto con el mismo `requestId` → `409 CLOCK_IDEMPOTENCY_KEY_REUSED`). Para un reintento con un `requestId` **distinto** sobre la misma jornada (ej. el cliente reintenta tras un timeout de red), `closeOpenWorkShift`'s guardado optimista (`WorkShift.updateMany` con `status: "ABIERTO"`, `claimed.count!==1` lanza `WORK_SHIFT_ALREADY_CLOSED`) ya devuelve un `409 CLOCK_ALREADY_CLOSED` prolijo — confirmado con test preexistente, sin modificar. Ninguna de las dos protecciones se tocó en esta etapa.

## 9. Tests (Parte 7 del pedido)

**Backend** (+18 tests, 953 total, todos verdes):

`workShiftEvaluationRunner.test.ts`, nuevo describe "Etapa 13B" (16 tests):
1. Salida normal → sin alertas.
2. Salida anticipada sola → sólo `SALIDA_ANTICIPADA`, sólo esa notifica.
3. Salida anticipada + jornada corta → ambas se persisten, sólo notifica `SALIDA_ANTICIPADA`.
4. Jornada corta SIN salida anticipada (ingreso tardío, salida puntual) → notifica igual (no queda permanentemente silenciada).
5. Salida anticipada + tramo sin concepto → ambas se persisten, sólo notifica `SALIDA_ANTICIPADA`.
6. Tramo sin concepto solo (sin las otras dos) → notifica (sigue siendo un problema real cuando es la única explicación).
7. Tramo sin concepto subordinado a `JORNADA_INSUFICIENTE` sin salida anticipada (prioridad 2 > 3).
8. `CONCEPTO_NO_HABILITADO` nunca se suprime, aunque coincida con salida anticipada.
9. La salida usa exclusivamente `shift.shiftTemplateId` — nunca `findMany` sobre turnos/asignaciones (regresión del bug de 13A, confirmada para salida).
10. Sin turno + con régimen → sin cambios.
11. Sin turno + sin régimen → sin cambios.
12. Jornada extendida sigue funcionando, notifica siempre (fuera de la cascada).
13. **Causa raíz del 503**: un fallo en `prisma.shiftAlert.upsert` no propaga la excepción fuera de `evaluateShiftExit`.
14. Reintentar la misma salida no duplica alertas (upsert por `[workShiftId, type]`).

`timeEntries.service.test.ts`, extendido dentro de `clockOutByEmployee` (2 tests):
15. `evaluateShiftExit` se llama una sola vez con los segmentos clasificados como 4º argumento; `notifyClassificationAlerts` **no** se llama por separado.
16. **Causa raíz del 503, un nivel más arriba**: si `evaluateShiftExit` (mockeada) rechaza, `clockOutByEmployee` igual devuelve la salida cerrada con éxito — sin necesitar mocks de storage/evidencia fotográfica para probar el mismo punto de falla que `clockPhotoPunch`.

**No se agregaron tests frontend** — ver §11.

## 10. Validación manual recomendada (no ejecutada por el agente — requiere UI en vivo)

1. Ingreso + salida normal → sin alerta.
2. Ingreso + salida anticipada → una sola notificación ("Salida anticipada").
3. Ingreso + salida muy anticipada (jornada corta) → una sola notificación, "Jornada por debajo del mínimo" visible en Alertas de Turnos como detalle, sin notificación duplicada.
4. Ingreso + salida corta que antes generaba 3 alertas → confirmar una sola notificación, 2-3 filas en Alertas de Turnos (detalle completo preservado).
5. Persona con turno propio y otro turno cercano no asignado → la salida sigue clasificada contra el turno propio.
6. Persona sin turno/con régimen → sin cambios.
7. Persona sin turno/sin régimen → sin cambios.
8. Doble click/reintento rápido en salida → sin duplicar, 409 prolijo si corresponde.
9. Ver Notificaciones y Alertas de Turnos → confirmar que Alertas de Turnos sigue mostrando el detalle completo (nada se oculta) mientras Notificaciones ya no muestra avisos redundantes.

## 11. Frontend — no se tocó

No hubo cambios de tipo, label ni copy: los 3 tipos de alerta (`SALIDA_ANTICIPADA`, `JORNADA_INSUFICIENTE`, `SEGMENTO_SIN_CLASIFICAR`) ya existían en `ShiftAlertsPage.tsx`/`shiftAlertApiService.ts` desde antes de esta etapa, sin ningún enum nuevo (a diferencia de 13A, que sí agregó `INGRESO_ANTICIPADO`). El fix de esta etapa reduce **cuántas** `SystemNotification` se crean en el backend — la pantalla de Notificaciones ya renderiza genéricamente lo que reciba, sin ningún mapeo por tipo que debiera actualizarse. Alertas de Turnos también sigue mostrando exactamente las mismas columnas/labels para los 3 tipos — la única diferencia observable es que, para una salida corta/anticipada, ahora aparecen 2-3 filas en esa tabla (como antes) pero **1 sola** notificación en la campanita/pantalla de Notificaciones (antes 2-3). Ningún archivo de `frontend/` fue tocado ni necesitaba tests nuevos.

## 12. Performance (Parte 10 del pedido)

- **Sin N+1 nuevo**: `evaluateShiftExit` hace exactamente las mismas consultas que antes (`workShift.findUnique`, `resolveOpenShiftOverflowAlert`'s `updateMany`, `resolveMatchForExit`'s 2 `findUnique` vía `Promise.all`, `resolveActiveWorkRegime`, hasta 5 `createShiftAlert`/`upsert`) — el parámetro `notify` no agrega ninguna consulta, sólo condiciona un `if` en memoria antes de llamar (o no) a `notifyUsers`.
- **Nunca carga todos los turnos del sistema en salida**: confirmado con test (`shiftTemplate.findMany`/`shiftAssignment.findMany` nunca se llaman desde `evaluateShiftExit`).
- **Menos escrituras de notificación por evento, no más**: el objetivo explícito de esta etapa — de hasta 3 `SystemNotification` por salida corta a 1.
- **Ningún cache tocado**: `frontend/src/services/cache/`, `backend/src/shared/cache/` sin cambios — este flujo (fichador) nunca tuvo cache, categoría D de `docs/PERFORMANCE_STANDARDS.md`.

## 13. Qué NO se tocó

- Entrada (`evaluateShiftEntry`, `matchShiftForEmployee`, `closestOwnMatch`, `evaluateEntryPunctuality`, `INGRESO_ANTICIPADO`/`INGRESO_TARDE`) — cero líneas tocadas. Toda la suite de tests de entrada de 13A sigue verde sin modificación.
- Horas Especiales / Conceptos Horarios (`doubleHourRuleMatching.ts`, `hour-concepts/*`, `classifyWorkShiftSegments`) — ningún archivo tocado; sólo se leyó para diagnóstico.
- Liquidación (`TimeEntry.hours/totalMinutes/appliedMultiplier`, `HourConceptBreakdown`) — sin cambios. `closeOpenWorkShift` (donde vive ese cálculo) no fue tocado.
- Grilla/export/bandeja de revisión (`HoursPage.tsx`, `EmployeeHoursPage.tsx`, exportaciones) — ningún archivo tocado. `createWorkShift` (alta manual de un día completo) tampoco, ver §7.
- Asignaciones de feriado (`HolidayWorkAssignment`) — sin cambios.
- "Sin actividad registrada" (`attendanceInactivity.service.ts`) — sin cambios.
- `schema.prisma` — sin cambios, sin migraciones (el parámetro `notify` es un flag transitorio de función, no un campo persistido).
- Permisos/RBAC — sin cambios.
- Frontend — sin cambios (ver §11).
- La protección "salida sin ingreso abierto" (`CLOCK_NO_OPEN_SHIFT`) — sin rediseñar, confirmada intacta (regresión mínima, tal como pedía el encargo).
- El control de doble-click/reintento (idempotencia por `requestId`, guardado optimista en `closeOpenWorkShift`) — sin cambios, sólo confirmado que sigue funcionando (§8).

## 14. Riesgos pendientes

- **Datos históricos potencialmente afectados por el bug ya corregido**: si el 503 reportado por el usuario ya ocurrió en producción/staging antes de esta corrección, podría existir algún `AttendancePunch` de salida con `photoFileId`/`thumbnailFileId` apuntando a un archivo de storage ya borrado por `cleanupClockEvidence` (ver §4, punto 10). Esta etapa **no** incluyó ninguna auditoría ni reparación de datos existentes — es una acción sobre datos reales que requiere autorización explícita antes de tocar la base compartida (mismo criterio que 8B/8F). Recomendado como verificación puntual antes de dar por cerrado el incidente, no bloqueante para esta entrega de código.
- **`evaluateShiftExitSafely` es una segunda capa de contención sobre una `evaluateShiftExit` que ya no debería poder fallar** — deliberado (defensa en profundidad ante una futura regresión), documentado como tal en el propio código para que no se lea como redundancia accidental.
- **La cascada de prioridad es fija (no configurable)** — si en el futuro RRHH quisiera ver SIEMPRE las 3 notificaciones, o cambiar el orden, hoy requiere un cambio de código, no una opción de configuración. No se pidió que fuera configurable; documentado como límite conocido del alcance V1.
- **`CONCEPTO_NO_HABILITADO` puede seguir notificando junto a `SALIDA_ANTICIPADA`** (a propósito, ver §6) — si en el futuro se reporta que esta combinación también es percibida como ruido, es una decisión de producto nueva, no un bug de esta etapa.

## 15. Próxima etapa sugerida

No hay una "13C" obligatoria — 13A (entrada) y 13B (salida) cierran el ciclo completo de clasificación de fichadas contra el turno asignado. Si en el futuro aparece un caso real de ruido de notificaciones en el cluster de "jornada larga" (`SALIDA_TARDIA`/`JORNADA_EXTENDIDA`) análogo al de esta etapa, sería una extensión acotada de la misma política de prioridad — no implementada ahora por falta de un caso reportado que la justifique.

---

No se tocó entrada, Horas Especiales, Conceptos Horarios, liquidación, grilla/export/bandeja, asignaciones de feriado, ni "Sin actividad registrada". No commitear sin aprobación explícita del usuario.
