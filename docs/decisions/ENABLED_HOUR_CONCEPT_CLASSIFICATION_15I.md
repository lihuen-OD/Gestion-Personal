# Etapa 15I — Clasificación de segmentos sólo por conceptos habilitados del empleado

Fecha: 2026-09-15
Estado: implementado, validado, pendiente de aprobación para commitear
Continúa: `docs/decisions/SHIFT_SEGMENT_UNCLASSIFIED_POLICY_13D.md` (misma familia de problema, resuelto entonces sólo para `SEGMENTO_SIN_CLASIFICAR`), auditoría 15H (read-only, sin archivo propio — quedó documentada como respuesta de esa conversación)
Alcance: sólo el filtrado de `HourConceptRule` activas por conceptos habilitados del empleado, dentro del clasificador legacy de `TimeSegment` (Motor A). No se tocó el generador aditivo de `HourConceptBreakdown` (Motor B), `TimeEntry`, Horas Especiales, Novedades, schema/migraciones, ni frontend.

## 1. Contexto (Etapa 15H)

La Etapa 15H fue una auditoría read-only que confirmó un bug funcional: un empleado con sólo Hora normal habilitada, que trabaja de noche, podía recibir un `TimeSegment` clasificado como "Sereno" con `conceptStatus = CONCEPTO_NO_HABILITADO` y una alerta "requiere revisión" — sólo porque existía una `HourConceptRule` de Sereno activa en algún lugar del sistema, sin relación con lo que ese empleado en particular tiene asignado. Trabajar de noche no debe convertir a nadie en Sereno.

## 2. Dos motores identificados

- **Motor A — clasificador legacy de `TimeSegment`** (`backend/src/modules/hour-concepts/hourConceptClassification.ts`, invocado desde `classifySegmentsForEmployee` en `backend/src/modules/time-entries/timeEntries.service.ts`). Corre en los 4 flujos que cierran una jornada (`closeWorkShiftManually`, `createWorkShift`, `clockPhotoPunch` salida, `clockOutResolved`). Alimenta el modal "Segmentos de la jornada" y las `ShiftAlert` de `backend/src/modules/shifts/workShiftEvaluationRunner.ts`.
- **Motor B — generador aditivo de `HourConceptBreakdown`** (`backend/src/modules/employees/automaticHourConceptBreakdowns.ts` + `.service.ts` + `.repository.ts`, Etapa 6I). Alimenta la Grilla mensual por concepto. Ya filtraba correctamente por conceptos elegibles del empleado (`findEligibleConcepts`) antes de intersectar con el turno — no tenía el bug.

## 3. Bug del Motor A

`classifySegmentsForEmployee` pedía `findActiveRules()` (todas las `HourConceptRule` `ACTIVO` del sistema, sin filtrar por empleado) y `findEnabledConceptIds(employeeId)` por separado, y pasaba **ambos** tal cual a `classifyWorkShiftSegments`/`classifyShiftInterval`. Esa función pura elegía un "ganador" por horario entre **todas** las reglas activas y recién **después** revisaba si el concepto ganador estaba en `enabledHourConceptIds` — si no lo estaba, marcaba `CONCEPTO_NO_HABILITADO` conservando el concepto detectado. El resultado: cualquier tramo que coincidiera con el horario de una regla de un concepto no asignado a ese empleado quedaba marcado como una supuesta inconsistencia de configuración, aunque fuera el comportamiento esperado (ese empleado simplemente no hace ese concepto).

## 4. Decisión

```
candidateRules = activeRules.filter(rule => enabledHourConceptIds.has(rule.hourConceptId))
```

Implementado en `classifySegmentsForEmployee` (`backend/src/modules/time-entries/timeEntries.service.ts`), el único caller real del clasificador. `activeRules` (global) se sigue pidiendo igual que antes; lo que cambia es que sólo `candidateRules` (la intersección con lo que el empleado tiene habilitado) se le pasa a `classifyWorkShiftSegments`. Cambio de una línea en el call site — no se tocó la firma pública ni la lógica interna de `classifyShiftInterval`/`classifyWorkShiftSegments` (`hourConceptClassification.ts`), que siguen siendo funciones puras que reciben las reglas ya resueltas por quien las llama, tal como documenta su propio módulo desde antes de esta etapa.

## 5. Hora normal como fallback universal

Sin cambios de comportamiento en este punto — ya era así, esta etapa lo hace más consistente. `HourConcept` con `systemRole = NORMAL_BASE` nunca puede tener su propia `HourConceptRule` (rechazado por el CRUD desde la Etapa 6E) y nunca aparece en `EmployeeHourConcept` (Etapa 6F: es universal, no se asigna por legajo). Por lo tanto `candidateRules` jamás puede excluir a Hora normal — sólo acota qué conceptos **adicionales** compiten por un tramo. Cuando `candidateRules` queda vacía (ningún concepto adicional habilitado, o ninguno de los habilitados tiene una regla activa), `classifyWorkShiftSegments` cae en su rama de compatibilidad preexistente y devuelve el tramo completo como `conceptStatus = "MANUAL"` con el concepto de fallback (Hora normal) — sin generar ningún estado de "requiere revisión".

## 6. Sereno (o cualquier concepto adicional) sólo se evalúa si está habilitado

- **Empleado sólo Hora normal**: `candidateRules` queda vacía apenas se filtra Sereno/Guardia/etc. → `classifyWorkShiftSegments` devuelve el/los tramo(s) como `MANUAL`, 100% Hora normal, de día o de noche, cruzando medianoche o no. Nunca se evalúa el horario de Sereno para este empleado.
- **Empleado con Hora normal + Sereno**: `candidateRules = [reglaSereno]`. Se reparte por horario real: el tramo que cae dentro de la ventana de Sereno queda `SUGERIDO` con Sereno; el resto cae al fallback Hora normal (ver §9 sobre el estado de ese resto). Ejemplo validado por test (18:00–03:00, regla Sereno 21:00–03:00): Hora normal = 3h, Sereno = 6h, total real = 9h — sin pérdida ni duplicación.

## 7. Independencia de turno/régimen

Confirmada, no modificada: `findActiveRules`/`findEnabledConceptIds`/`classifyShiftInterval` no reciben ni consultan `ShiftAssignment`, `ShiftTemplate` ni `WorkRegime` en ningún punto. El turno y el régimen siguen sirviendo exclusivamente para comparar esperado vs. real y generar alertas de cumplimiento (`workShiftEvaluationRunner.ts`, sin cambios) — nunca determinan si un tramo es Sereno. Test de regresión explícito en `timeEntries.service.test.ts` (`12/13`) confirma que `resolveActiveWorkRegime` no se invoca durante esta clasificación, con o sin régimen simulado.

## 8. Cross-midnight

Sin cambios en la lógica de partición por medianoche (`buildShiftSegments`, `ruleOccurrencesOverlapping`) — el filtrado ocurre antes, sobre la lista de reglas candidatas, no sobre la segmentación por día. Validado con test end-to-end (`timeEntries.service.test.ts`, jornada 18:00 ART a 03:00 ART del día siguiente, partida en 2 `TimeSegment` de día calendario Argentina distinto, sumando 540 minutos reales sin pérdida).

## 9. `CONCEPTO_NO_HABILITADO` queda legacy/defensivo

No se eliminó el enum de Prisma (`ShiftAlertType`), el tipo TypeScript (`SegmentConceptStatus`), ni ninguna rama de código que lo interpreta (`hourConceptClassification.ts`, `workShiftEvaluationRunner.ts`, frontend). Sigue siendo alcanzable si, por lo que sea, un caller pasara una regla no filtrada a `classifyShiftInterval` (defensa en profundidad de la función pura) o si ya existe un `TimeSegment`/`ShiftAlert` histórico con ese status — el runner (`applyClassificationAlerts`) lo sigue interpretando exactamente igual que antes, sin cambios. Lo que cambió es que, desde esta etapa, **el único caller real (`classifySegmentsForEmployee`) nunca vuelve a producir ese status por el caso normal** de "el empleado trabajó en el horario de un concepto que no tiene habilitado" — ese caso ahora cae en el fallback (Hora normal) o en `SIN_CONCEPTO_COMPATIBLE`, nunca en `CONCEPTO_NO_HABILITADO`.

No se migraron datos históricos: si ya existen filas de `TimeSegment`/`ShiftAlert` con `CONCEPTO_NO_HABILITADO` de antes de esta etapa, se conservan tal cual (siguen siendo la evidencia real de lo que el sistema clasificó en su momento) y se siguen mostrando igual en "Segmentos de la jornada"/"Alertas de Turnos".

## 10. Motor B no tocado

`backend/src/modules/employees/automaticHourConceptBreakdowns.ts`, `.service.ts` y `.repository.ts` no se modificaron. Confirmado con la suite completa de sus tests (`automaticHourConceptBreakdowns.test.ts`, `.service.test.ts`, `.repository.test.ts`) verde sin cambios de código en esos archivos.

## 11. Horas Especiales no tocadas

`DoubleHourRule`/`SpecialHourRuleApplication` (`backend/src/modules/workforce-management/doubleHourRuleMatching.ts`, persistencia en `timeEntries.repository.ts`) no se tocaron. Son reglas por fecha (feriado, etc.) aplicadas sobre `segment.date`/minutos reales, independientes de `hourConceptId`/`conceptStatus` — confirmado por lectura de código en 15H y por la suite completa de tests verde sin cambios en esos archivos.

## 12. Tests

**`hourConceptClassification.test.ts`** (+9 tests, 8 → 17): el Caso D preexistente se reencuadró explícitamente como salvaguarda defensiva de la función pura (mismo código, mismo resultado, comentario actualizado) — no se borró, porque Parte 6 pide conservar esa rama. Nuevo describe "Etapa 15I — sólo conceptos habilitados llegan como reglas candidatas" con los 9 casos pedidos (diurno/nocturno/cross-midnight sólo Normal; tramo mixto/todo nocturno/cross-midnight con Sereno habilitado; invariante de minutos sin pérdida/duplicación), todos verificando explícitamente la ausencia de `CONCEPTO_NO_HABILITADO`.

**`timeEntries.service.test.ts`** (+4 tests, 93 → 97): nuevo describe "createWorkShift — Etapa 15I" que ejercita `classifySegmentsForEmployee` end-to-end vía `createWorkShift` (mockeando `hourConceptsRepository.findActiveRules`/`findEnabledConceptIds`): Sereno global no habilitado se filtra (100% Hora normal, sin `CONCEPTO_NO_HABILITADO`); Sereno habilitado reparte 3h/6h/9h; el filtro no depende de régimen (`resolveActiveWorkRegime` no se invoca, con o sin régimen simulado); cross-midnight preserva los 540 minutos reales en 2 `TimeSegment` de día distinto.

**`workShiftEvaluationRunner.test.ts`** (+1 test, sin tocar código de este archivo): test explícito que traza la conexión entre el fix upstream y la ausencia de alerta `CONCEPTO_NO_HABILITADO` cuando los segmentos llegan ya filtrados (`MANUAL`/`SUGERIDO`). Los ~10 tests preexistentes que alimentan `conceptStatus: "CONCEPTO_NO_HABILITADO"` directamente como fixture (Casos E, 13G, 13D) se dejaron intactos a propósito — siguen probando que el runner, dado ese status, lo sigue interpretando igual (salvaguarda legacy, §9).

**Motor B y Horas Especiales**: cero tests nuevos (no era necesario, código no tocado); se confirmó con la suite completa verde.

**Backend completo**: 1568/1568 tests verdes (105 archivos), `prisma validate` OK, `typecheck` limpio, `build` limpio.

## 13. Riesgo residual

- **`SIN_CONCEPTO_COMPATIBLE` para el "resto" de un tramo con concepto adicional habilitado**: cuando un empleado tiene Sereno habilitado y parte de su jornada no cae dentro de la ventana de ninguna regla candidata (ej. el tramo 18:00–21:00 del ejemplo de Hora normal), ese resto sigue cayendo en `conceptStatus = SIN_CONCEPTO_COMPATIBLE` (no en un "SUGERIDO Hora normal" limpio) — comportamiento preexistente, sin cambios en esta etapa, ya gobernado por la política de notificación de la Etapa 13D (`docs/decisions/SHIFT_SEGMENT_UNCLASSIFIED_POLICY_13D.md`: sólo notifica si el empleado tiene algún concepto adicional habilitado). No es una regresión de 15I ni estaba dentro de su alcance — se documenta acá para que quede explícito, no oculto.
- **Criterio a nivel de concepto, no de ventana horaria específica**: si un empleado tiene Sereno habilitado pero además existe otra regla global de un concepto que tampoco tiene habilitado (ej. "Colectivo"), ese tramo ahora cae en `SIN_CONCEPTO_COMPATIBLE` en vez de `CONCEPTO_NO_HABILITADO` — una mejora respecto de antes (mensaje más preciso), no un caso nuevo sin cubrir.
- **`CONCEPTO_NO_HABILITADO` sin ningún camino de código real que lo genere hoy**: mismo patrón ya usado por el repo para otros tipos legacy (`POSSIBLE_SHIFT_CONFIGURATION_MISSING`, Etapa 13E.1; `DESCANSO_INSUFICIENTE`, Etapa 13I) — se conserva documentado como inalcanzable por el camino normal, no se retira del enum ni de los mapas de label/severidad.
- **Sin verificación contra datos reales de producción**: no hay acceso a esa base desde esta sesión; validado con tests unitarios/integración y validaciones estáticas únicamente.

## 14. Datos históricos no migrados

No se tocó `schema.prisma`, no hubo migraciones, y no se modificó ningún `TimeSegment`/`ShiftAlert` ya persistido. Cualquier fila histórica con `CONCEPTO_NO_HABILITADO` sigue existiendo y se sigue mostrando igual.

---

No se tocó Motor B, `TimeEntry`, `HourConceptBreakdown`, Horas Especiales, Novedades, storage/documentos/Cloudinary/login/seed, schema/migraciones, ni frontend. No commitear sin aprobación explícita del usuario.
