# Etapa 13D — Política de notificación de SEGMENTO_SIN_CLASIFICAR

Fecha: 2026-09-01
Estado: implementado, validado, pendiente de aprobación para commitear
Continúa: `docs/decisions/SHIFT_ALERT_RULES_AUDIT_13C.md` (hallazgo que motiva esta etapa), `docs/decisions/SHIFT_EXIT_CLASSIFICATION_13B.md` (cascada de prioridad que se reutiliza), `docs/decisions/SHIFT_ENTRY_CLASSIFICATION_13A.md`
Alcance: sólo la decisión de **notificar o no** `SEGMENTO_SIN_CLASIFICAR`. No se tocó entrada, Horas Especiales, liquidación, `TimeEntry`, `HourConceptBreakdown`, grilla/export/bandeja, fichador (salvo cero cambios — no hizo falta), asignaciones de feriado, ni "Sin actividad registrada".

## 1. Resumen ejecutivo

La auditoría 13C confirmó que `SEGMENTO_SIN_CLASIFICAR` se dispara para cualquier empleado apenas exista una `HourConceptRule` activa en cualquier parte del sistema, sin consultar nunca si ese empleado tiene algún concepto horario **adicional** habilitado. Esta etapa corrige exclusivamente eso: antes de generar el **aviso** (`SystemNotification`) de `SEGMENTO_SIN_CLASIFICAR`, se consulta si el empleado tiene al menos un `EmployeeHourConcept` activo distinto de la Hora Normal base (`HourConcept.systemRole = NORMAL_BASE`). Sin ninguno, no hay aviso — la ausencia de concepto adicional no es un error. La `ShiftAlert` (registro/trazabilidad interna) se sigue persistiendo siempre, sin excepción — nunca se oculta el hallazgo, sólo se deja de notificar cuando no hay nada configurado que lo justifique. La cascada de prioridad de 13B (`SALIDA_ANTICIPADA`/`JORNADA_INSUFICIENTE` explican el mismo evento) sigue gobernando exactamente igual, ahora combinada con esta nueva condición: **sólo si ninguna de las dos suprime ya el aviso**, se consulta si corresponde por concepto esperado — evitando una consulta innecesaria en el caso más común (evento ya explicado por una alerta principal).

Un único método nuevo de repositorio (`hourConceptsRepository.findHasAdditionalConceptEnabled`), una consulta condicional (nunca por segmento, nunca si la notificación ya estaba suprimida por 13B) en `applyClassificationAlerts`. Sin cambios de schema, sin migraciones, sin cambios de frontend (no hubo cambio de label/copy — ver §15). +11 tests backend (964 total, todos verdes).

## 2. Problema

Un empleado sin ningún concepto horario adicional esperado (ej. administrativo de oficina) podía recibir `SEGMENTO_SIN_CLASIFICAR` ("Tramo de jornada sin concepto horario compatible") el día que RRHH activara la primera `HourConceptRule` del sistema para una población completamente distinta (ej. "Sereno" para vigilancia nocturna) — ruido puro, sin ningún hallazgo real detrás. La auditoría 13C (§11) recomendó degradar esta alerta de notificación visible a interna quando no hay concepto esperado, sin implementarlo. Esta etapa implementa esa recomendación.

## 3. Documentos leídos

`SHIFT_ALERT_RULES_AUDIT_13C.md`, `SHIFT_EXIT_CLASSIFICATION_13B.md`, `SHIFT_ENTRY_CLASSIFICATION_13A.md`, `WORK_REGIME_SHIFT_ALERTS_10D.md`, `ATTENDANCE_SHIFT_ALERTS_NOTIFICATIONS_AUDIT_10E.md`, `HOURS_GRID_REVIEW_SPECIAL_HOURS_AUDIT_11A.md`, `HOURS_GRID_SPECIAL_HOURS_LIQUIDABLE_11A1.md`, `docs/PERFORMANCE_STANDARDS.md`, `CLAUDE.md`, `AGENTS.md`. Más lectura directa de código (heredada de 13C, releída/confirmada para esta etapa): `hourConceptClassification.ts`, `workShiftEvaluationRunner.ts`, `hourConcepts.repository.ts`, `timeEntries.service.ts` (call sites de clasificación), `schema.prisma` (`HourConcept`, `EmployeeHourConcept`, `HourConceptSystemRole`).

## 4. Diagnóstico (Parte 1 del pedido, con evidencia)

1. **Dónde se genera `SEGMENTO_SIN_CLASIFICAR`**: `applyClassificationAlerts` (`backend/src/modules/shifts/workShiftEvaluationRunner.ts`, antes de esta etapa líneas 294-324), invocada desde `evaluateShiftExit` (con la cascada de prioridad 13B) y desde `notifyClassificationAlerts` (standalone, sólo usado por `createWorkShift` en `timeEntries.service.ts`, alta manual de un día completo por RRHH).
2. **Qué función lo dispara**: el tipo de alerta en sí lo decide `classifyShiftInterval` (`hourConceptClassification.ts:148-173`), que marca un intervalo como `SIN_CONCEPTO_COMPATIBLE` cuando ningún `HourConceptRule` activo cubre ese rango horario. `applyClassificationAlerts` sólo agrupa los segmentos por `conceptStatus` y crea/upsertea la `ShiftAlert` correspondiente.
3. **Qué datos tiene disponibles en ese momento**: `applyClassificationAlerts(employeeId, workShiftId, segments, options)` recibe `employeeId` (string), `workShiftId` (string) y `segments: ClassifiedSegmentAlertInput[]` (`{startAt, minutes, conceptStatus}` — sin `hourConceptId`, sin `ShiftTemplate`, sin `TimeSegment` completo). No recibía, antes de esta etapa, ninguna referencia a `EmployeeHourConcept`.
4. **¿Se consulta `EmployeeHourConcept` antes de generar la alerta?** No, antes de esta etapa — confirmado por lectura completa de `applyClassificationAlerts`. `EmployeeHourConcept` sólo se consulta **antes**, en `classifySegmentsForEmployee` (`timeEntries.service.ts:239-265`), vía `hourConceptsRepository.findEnabledConceptIds` — pero ese resultado (`enabledHourConceptIds: Set<string>`) sólo se usa dentro de `classifyShiftInterval` para decidir `SUGERIDO` vs. `CONCEPTO_NO_HABILITADO` **cuando una regla ya matcheó** (`hourConceptClassification.ts:162`) — nunca para decidir si `SIN_CONCEPTO_COMPATIBLE` debería dispararse en primer lugar. El resultado de esa consulta tampoco viajaba hasta `applyClassificationAlerts` (los `ClassifiedSegmentAlertInput` que llegan al runner no incluyen ese set).
5. **Qué significa exactamente "sin concepto horario compatible" hoy**: que, para ese tramo específico de la jornada, **ninguna** `HourConceptRule` activa en **todo el sistema** cubre ese rango horario — es una propiedad del sistema completo (¿hay alguna regla que cubra esta hora?), no del empleado evaluado.
6. **¿Se dispara para empleados sin conceptos adicionales habilitados?** Sí, confirmado — `classifyShiftInterval` no consulta `EmployeeHourConcept` para decidir `SIN_CONCEPTO_COMPATIBLE` (punto 4). Es exactamente el hallazgo de 13C.
7. **¿Se dispara para empleados con conceptos adicionales habilitados pero sin regla aplicable?** Sí, con el mismo mecanismo — si el empleado tiene, por ejemplo, "Guardia" habilitado pero trabajó un tramo que no cae dentro de ninguna regla activa (ni la de Guardia ni ninguna otra), ese tramo también cae en `SIN_CONCEPTO_COMPATIBLE`. Este caso (Parte 2.B del pedido) sí amerita seguir notificando — ver §6.
8. **¿Se dispara junto con `SALIDA_ANTICIPADA`?** Puede — no hay ninguna relación de exclusión entre la clasificación de segmentos y la puntualidad de salida; son evaluaciones independientes que corren para la misma jornada.
9. **¿Se dispara junto con `JORNADA_INSUFICIENTE`?** Igual que el punto anterior — independientes, pueden coincidir.
10. **¿Genera notificación visible hoy?** Sí, salvo que la cascada 13B ya la suprima (`notify: !earlyLeave && !duration.insufficientHours` en `evaluateShiftExit`, `workShiftEvaluationRunner.ts:403` antes de esta etapa) — es decir, ya existía una supresión parcial (13B), pero **nunca** basada en si el empleado tiene o no algún concepto adicional esperado.
11. **¿Se persiste como alerta interna?** Sí, siempre — `createShiftAlert` hace `upsert` incondicionalmente; `notify: false` sólo salta el bloque de `notifyUsers`, nunca el `upsert` (`workShiftEvaluationRunner.ts:121-126`).
12. **¿Existe metadata/evento/`WorkShift` para relacionarlo con la salida?** Sí — la `ShiftAlert` tiene `workShiftId` (FK real a `WorkShift`) y `@@unique([workShiftId, type])`, así que cada salida tiene a lo sumo una fila de cada tipo, consultable junto con el resto de las alertas de la misma jornada.
13. **¿La política de prioridad de 13B ya evita parte del ruido?** Sí — cuando `SALIDA_ANTICIPADA` o `JORNADA_INSUFICIENTE` ya explican el evento, `SEGMENTO_SIN_CLASIFICAR` ya no notificaba (13B). Pero el caso más común de ruido (empleado sin ningún concepto adicional, salida normal, sin ninguna otra alerta) **no** estaba cubierto por 13B — es exactamente el caso que 13B no podía resolver porque no depende del horario de salida, sino de la configuración de Conceptos Horarios del empleado.
14. **Qué casos reales justifican mantenerlo (notificar)**: empleado con al menos un concepto adicional habilitado, sin ninguna alerta principal de salida que ya explique el evento — ahí sí puede ser una regla automática que debía aplicar y el sistema no pudo clasificar (Parte 2.B del pedido).
15. **Qué casos reales justifican suprimirlo (no notificar)**: empleado sin ningún concepto adicional habilitado (Parte 2.A) — no hay ninguna expectativa de clasificación automática para ese empleado, así que "no se pudo clasificar" no es un hallazgo; y cualquier caso donde `SALIDA_ANTICIPADA`/`JORNADA_INSUFICIENTE` ya expliquen el evento (13B, sin cambios).
16. **¿`CONCEPTO_NO_HABILITADO` tiene una lógica distinta?** Sí, confirmado — se genera en una rama completamente separada de `applyClassificationAlerts` (`byStatus("CONCEPTO_NO_HABILITADO")`, líneas 302-311, no tocadas en esta etapa), siempre con `notify` implícito (`true`, nunca condicionado por la cascada 13B ni por esta etapa nueva). Representa un problema de configuración real e independiente (una regla matcheó, el empleado tiene explícitamente ese concepto deshabilitado) — no se mezcló con la política nueva.

## 5. Qué significa `SEGMENTO_SIN_CLASIFICAR`

**Antes de esta etapa**: "ningún `HourConceptRule` activo en el sistema cubre este tramo horario" — una propiedad global del catálogo de reglas, sin relación con la configuración del empleado evaluado. Notificaba siempre, salvo que 13B ya lo subordinara a `SALIDA_ANTICIPADA`/`JORNADA_INSUFICIENTE`.

**Ahora**: sigue significando exactamente lo mismo a nivel de clasificación (`classifyShiftInterval` no se tocó, ver §15) — pero el **aviso** a RRHH sólo se genera cuando, además, el empleado tiene al menos un concepto horario adicional habilitado. La `ShiftAlert` (registro técnico) se sigue creando siempre, para no perder trazabilidad ni ocultar el dato crudo a quien audite Conceptos Horarios.

## 6. Criterio de "concepto esperado" (Parte 4 del pedido)

**Criterio implementado**: el empleado tiene al menos una fila de `EmployeeHourConcept` cuyo `HourConcept` está `status: "ACTIVO"` y **no** es la Hora Normal base.

`HourConceptSystemRole` (`schema.prisma:172-174`) tiene un único valor posible, `NORMAL_BASE`, y `HourConcept.systemRole` es `@unique` — sólo puede existir un concepto con ese rol en todo el catálogo. Por lo tanto, `systemRole: null` identifica sin ambigüedad "es un concepto adicional" (nunca la Hora Normal), sin depender de conocer de antemano cuál es el id de la Hora Normal de cada empleado. Implementado en `hourConceptsRepository.findHasAdditionalConceptEnabled` (`backend/src/modules/hour-concepts/hourConcepts.repository.ts`):

```ts
async findHasAdditionalConceptEnabled(employeeId: string): Promise<boolean> {
  const additional = await prisma.employeeHourConcept.findFirst({
    where: { employeeId, hourConcept: { status: "ACTIVO", systemRole: null } },
    select: { employeeId: true },
  });
  return additional !== null;
},
```

**Por qué no se usó `loadMode` (`AUTOMATIC`/`BOTH`/`MANUAL`)**: se auditó como posible criterio adicional (sugerido en el pedido), pero `loadMode` gobierna cómo se generan los `HourConceptBreakdown` de ese concepto (Etapa 6C/6I) — no participa en ningún punto de `classifyShiftInterval`/`classifyWorkShiftSegments` (confirmado por lectura completa de `hourConceptClassification.ts`: ninguna función ahí lee `loadMode`). Incluirlo habría sido inventar una condición sin relación real con el mecanismo que genera `SIN_CONCEPTO_COMPATIBLE`. Documentado acá para que la decisión quede explícita, no por omisión.

**Por qué no se intentó matchear el concepto adicional específico contra la ventana horaria del segmento sin clasificar**: sería una regla mucho más precisa (ej. "el empleado tiene Guardia habilitado, pero el tramo sin clasificar no está ni cerca del horario de ninguna regla de Guardia") — pero exigiría cruzar cada segmento sin clasificar contra las reglas propias de cada concepto habilitado, lógica nueva y no acotada, fuera del alcance "chico y quirúrgico" pedido. El criterio implementado es deliberadamente a nivel de empleado (tiene o no tiene algún concepto adicional), exactamente como lo planteó el pedido en la Parte 2.B/4 — no una coincidencia de ventana horaria por concepto.

## 7. Política final (Parte 3 del pedido)

Implementada en `applyClassificationAlerts` (`workShiftEvaluationRunner.ts`):

```
sinClasificar = segmentos con conceptStatus = SIN_CONCEPTO_COMPATIBLE

si sinClasificar está vacío:
    no hace nada (sin cambios respecto de antes)

si no:
    notify = options.notify
             ? hourConceptsRepository.findHasAdditionalConceptEnabled(employeeId)
             : false   // ya suprimido por 13B -- ni se consulta

    createShiftAlert({ type: SEGMENTO_SIN_CLASIFICAR, ..., notify })
    // el upsert (persistencia) ocurre siempre, notify sólo gobierna el aviso
```

`options.notify` es el mismo booleano que ya calculaba la cascada 13B (`!earlyLeave && !duration.insufficientHours` en `evaluateShiftExit`, o `true` fijo en el camino standalone de `notifyClassificationAlerts`/`createWorkShift`). El operador ternario evita la consulta a `EmployeeHourConcept` por completo cuando 13B ya decidió que no corresponde notificar — no hace falta saber si hay concepto esperado si el evento ya está subordinado a una alerta principal más clara.

Este orden implementa exactamente los 3 puntos de la Parte 3: (1) nunca es la primera notificación visible si no hay concepto esperado o si hay una alerta principal; (2) sólo notifica si hay concepto esperado **y** ninguna alerta principal ya lo explica; (3) no fue necesario degradar toda la alerta a "siempre interna" porque el modelo actual (`EmployeeHourConcept` + `systemRole`) sí permite determinar "concepto esperado" con seguridad — no se necesitó el camino de contingencia de la Parte 3.3.

## 8. Cambios implementados

**`backend/src/modules/hour-concepts/hourConcepts.repository.ts`**: nuevo método `findHasAdditionalConceptEnabled(employeeId)` (ver §6), agregado junto a `findEnabledConceptIds` (mismo patrón, misma tabla).

**`backend/src/modules/shifts/workShiftEvaluationRunner.ts`**:
- Import nuevo: `hourConceptsRepository` desde `../hour-concepts/hourConcepts.repository` (sin dependencia circular — `hour-concepts` no importa nada de `shifts`, confirmado por grep).
- `applyClassificationAlerts`: el bloque de `SIN_CONCEPTO_COMPATIBLE` ahora calcula `notify` con la consulta condicional de §7 antes de llamar a `createShiftAlert`. El bloque de `CONCEPTO_NO_HABILITADO` (líneas previas, sin cambios) no se tocó.

**Nada más se modificó** — ni `hourConceptClassification.ts` (el motor de clasificación en sí), ni `classifySegmentsForEmployee`/`timeEntries.service.ts`, ni `schema.prisma`, ni ningún archivo de frontend.

## 9. Qué pasa con empleados sin conceptos adicionales

La `ShiftAlert` `SEGMENTO_SIN_CLASIFICAR` se sigue creando/actualizando (trazabilidad completa, visible en "Alertas de Turnos" para quien la busque), pero **no** dispara `SystemNotification` — RRHH no recibe ningún aviso. No es un error del empleado ni de configuración: es la situación esperada de cualquier persona que nunca tuvo Sereno/Guardia/Colectivo/etc. habilitado.

## 10. Qué pasa con empleados con conceptos adicionales

Sin cambios de comportamiento respecto de antes de esta etapa, salvo la nueva condición: si el empleado tiene al menos un concepto adicional activo **y** ninguna alerta principal (13B) ya explica el evento, `SEGMENTO_SIN_CLASIFICAR` notifica exactamente igual que siempre — sigue siendo, para esa población, un hallazgo real que amerita revisión de configuración.

## 11. Qué pasa con Salida anticipada

Sin cambios — `SALIDA_ANTICIPADA` sigue notificando siempre (nunca suprimida, prioridad máxima de 13B), y cuando coincide con un tramo sin clasificar, `SEGMENTO_SIN_CLASIFICAR` sigue subordinada a ella (`options.notify` ya llega en `false`) — ahora, además, ni siquiera se consulta `EmployeeHourConcept` en ese caso (optimización: la respuesta ya estaba decidida por 13B, sin importar si el empleado tiene o no conceptos adicionales).

## 12. Qué pasa con Jornada insuficiente

Igual que el punto anterior — `JORNADA_INSUFICIENTE` sigue notificando según `ShiftTemplate.minimumMinutesForCompliance` (13C confirmó que este campo está bien respaldado, sin cambios en esta etapa), y sigue subordinando el aviso de `SEGMENTO_SIN_CLASIFICAR` cuando corresponde, sin consultar `EmployeeHourConcept` en ese caso.

## 13. Qué pasa con `CONCEPTO_NO_HABILITADO`

Sin ningún cambio — código no tocado, comportamiento idéntico. Sigue notificando siempre que una regla matcheó pero el concepto resultante no está habilitado para el empleado, sin verse afectado por si el empleado tiene o no **otros** conceptos adicionales habilitados (son evaluaciones independientes por diseño, confirmado con test — ver §14, "camino independiente, aunque no haya ningún concepto adicional habilitado").

## 14. Tests (Parte 6 del pedido)

**Backend** (+11 tests, 953 → 964 total, todos verdes):

`hourConcepts.repository.test.ts` (+3, nuevo describe "findHasAdditionalConceptEnabled"): arma el `where` exacto (`status: ACTIVO`, `systemRole: null`); devuelve `true` si existe al menos uno; devuelve `false` si no existe ninguno.

`workShiftEvaluationRunner.test.ts` (+8, nuevo describe "SEGMENTO_SIN_CLASIFICAR — Etapa 13D"):
1. Empleado SIN conceptos adicionales: se persiste la `ShiftAlert` pero no notifica (Parte 6.1/6.2).
2. El criterio consulta `EmployeeHourConcept` con `systemRole: null` exacto (verifica la forma de la query, no sólo el resultado).
3. Empleado CON al menos un concepto adicional: notifica cuando es la única explicación (Parte 6.3).
4. `SALIDA_ANTICIPADA` + segmento sin clasificar, empleado CON conceptos adicionales: igual no notifica el segmento, y **ni siquiera consulta** `EmployeeHourConcept` (Parte 6.4 + verificación de la optimización de performance).
5. `JORNADA_INSUFICIENTE` + segmento sin clasificar: mismo patrón (Parte 6.5).
6. `CONCEPTO_NO_HABILITADO` sigue notificando sin verse afectado, incluso sin ningún concepto adicional habilitado (Parte 6.6, camino independiente).
7. Varios segmentos `SIN_CONCEPTO_COMPATIBLE` en la misma salida consultan `EmployeeHourConcept` una sola vez, no por segmento (Parte 6.12, sin N+1).
8. `notifyClassificationAlerts` (alta manual standalone, fuera de la cascada 13B) también respeta la política nueva.

**Tests preexistentes no modificados en su intención, sólo en su fixture**: se agregó `employeeHourConcept: { findFirst: vi.fn() }` al mock de Prisma y un default (`mockResolvedValue({ employeeId: "employee-1" })`, "tiene concepto adicional") en el `beforeEach` global, para que los ~15 tests preexistentes que ya cubrían `SALIDA_ANTICIPADA`/`JORNADA_INSUFICIENTE`/`JORNADA_EXTENDIDA`/entrada sigan pasando exactamente con la misma aserción que antes, sin tener que tocar cada uno individualmente — ninguno de ellos es sobre la dimensión nueva, así que el default preserva su intención original. Confirmado corriendo la suite completa: 964/964 verdes, incluida toda la suite de entrada (Etapa 13A, sin tocar) y el resto de 13B.

**Parte 6.10 (no se toca entrada) / 6.11 (no se toca liquidación)**: no requirió tests nuevos — `evaluateShiftEntry`/`evaluateEntryPunctuality` no fueron tocados (cero líneas), y ningún archivo de `TimeEntry`/`HourConceptBreakdown`/liquidación fue modificado; la suite completa de la Etapa 13A y de Horas Especiales/Conceptos Horarios corrió sin regresiones como parte de los 964 tests verdes.

## 15. Performance

- **Nunca una consulta por segmento**: `sinClasificar` agrupa todos los segmentos `SIN_CONCEPTO_COMPATIBLE` de la jornada antes de decidir `notify` — una sola llamada a `findHasAdditionalConceptEnabled` por salida, sin importar cuántos segmentos sin clasificar tenga (confirmado con test, §14.7).
- **Cero consultas cuando no aplica**: si no hay ningún segmento `SIN_CONCEPTO_COMPATIBLE`, o si la cascada 13B ya decidió `notify: false` por `SALIDA_ANTICIPADA`/`JORNADA_INSUFICIENTE`, la consulta ni se ejecuta (confirmado con test, §14.4/14.5) — es estrictamente una consulta *menos* que antes en el caso más común (evento ya explicado por otra alerta), nunca una consulta de más.
- **Una consulta por employeeId por cierre de jornada** en el peor caso (hay segmento sin clasificar y ninguna alerta principal lo explica) — exactamente el patrón "una consulta por employeeId está bien" que autorizaba el pedido para una evaluación de un solo cierre, sin ningún loop.
- **Categoría de dato**: `EmployeeHourConcept` es configuración administrada a mano por empleado (categoría B/A de `docs/PERFORMANCE_STANDARDS.md`), la misma tabla que ya consulta `findEnabledConceptIds` en el mismo flujo de cierre — no se introdujo ninguna tabla ni patrón de acceso nuevo.
- **Ningún cache tocado** — `frontend/src/services/cache/`, `backend/src/shared/cache/` sin cambios; este flujo (evaluación de salida, best-effort, 13B) nunca tuvo cache y sigue sin tenerlo (categoría D/fichador, dato crítico sin cache por diseño).

## 16. Qué NO se tocó

- Entrada (`evaluateShiftEntry`, `matchShiftForEmployee`, `evaluateEntryPunctuality`, `INGRESO_ANTICIPADO`/`INGRESO_TARDE`) — cero líneas tocadas.
- Horas Especiales (`doubleHourRuleMatching.ts`, `DoubleHourRule`, `SpecialHourRuleApplication`) — ningún archivo tocado.
- Liquidación (`TimeEntry.hours/totalMinutes/appliedMultiplier`, `HourConceptBreakdown`) — sin cambios; el motor de clasificación en sí (`hourConceptClassification.ts`, `classifyShiftInterval`/`classifyWorkShiftSegments`) tampoco se tocó — sigue marcando `SIN_CONCEPTO_COMPATIBLE` exactamente igual que antes, esta etapa sólo cambia si ese resultado dispara un aviso.
- Grilla/export/bandeja de revisión (`HoursPage.tsx`, `EmployeeHoursPage.tsx`, `timeEntries.repository.ts` export) — ningún archivo tocado.
- Fichador — no requirió ningún cambio de integración; los 3 call sites que ya invocaban `evaluateShiftExitSafely`/`notifyClassificationAlerts` (`closeWorkShiftManually`, `clockPhotoPunch`, `clockOutResolved`, `createWorkShift`) siguen llamando exactamente igual, sin ninguna firma nueva que propagar — el cambio quedó 100% contenido dentro de `applyClassificationAlerts`.
- Asignaciones de feriado (`HolidayWorkAssignment`) — sin cambios.
- "Sin actividad registrada" (`attendanceInactivity.service.ts`) — sin cambios.
- Frontend — ningún archivo tocado. No hubo cambio de label/copy: el título de la notificación (`labelByAlertType.SEGMENTO_SIN_CLASIFICAR`, "Tramo de jornada sin concepto horario compatible") y el label de "Alertas de Turnos" (`ShiftAlertsPage.tsx`) siguen exactamente iguales — esta etapa reduce **cuándo** se genera el aviso, no cómo se muestra el que sí se genera. "Alertas de Turnos" sigue mostrando la fila (la `ShiftAlert` se sigue persistiendo siempre) exactamente con el mismo label — no requiere test frontend nuevo (Parte 7 del pedido: "si no se toca frontend, documentar por qué" — documentado acá).
- `schema.prisma` — sin cambios, sin migraciones. `EmployeeHourConcept`/`HourConceptSystemRole` ya existían tal como se usaron.
- Permisos/RBAC — sin cambios.
- `CONCEPTO_NO_HABILITADO` — código no tocado (ver §13).

## 17. Riesgos pendientes

- **Criterio a nivel de empleado, no de ventana horaria por concepto** (§6): un empleado con "Guardia" habilitado pero cuyo tramo sin clasificar no tiene ninguna relación temporal con el horario real de Guardia igual notifica (falso positivo residual, mucho más acotado que antes — de "cualquier empleado del sistema" a "sólo empleados con algún concepto adicional real"). Si en el futuro se reporta como ruido persistente, requeriría cruzar el segmento contra las reglas propias del concepto habilitado — etapa nueva, no implementada acá por estar fuera del alcance "chico y quirúrgico" pedido.
- **`POSSIBLE_SHIFT_CONFIGURATION_MISSING` y `DESCANSO_INSUFICIENTE`** (otros 2 hallazgos de 13C con respaldo débil) — no tocados en esta etapa, siguen exactamente como los dejó 13C (recomendaciones documentadas, no implementadas; ver `SHIFT_ALERT_RULES_AUDIT_13C.md` §13).
- **Sin verificación contra datos reales de producción** (ej. cuántos empleados tienen hoy algún concepto adicional habilitado, o si ya existe alguna `HourConceptRule` activa real) — esta etapa se validó con tests unitarios y validaciones estáticas (`typecheck`/`build`/`vitest`), no con una corrida manual contra la base real (fuera de lo posible en este entorno de sesión). Recomendado como validación manual antes de aprobar el commit (ver Parte 8 del pedido).

---

No se tocó entrada, Horas Especiales, liquidación, `TimeEntry`, `HourConceptBreakdown` salvo lo auditado (sin cambios), grilla/export/bandeja, asignaciones de feriado, ni "Sin actividad registrada". No commitear sin aprobación explícita del usuario.
