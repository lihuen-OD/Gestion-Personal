# Etapa 13C — Auditoría de reglas funcionales detrás de las alertas de turnos

Fecha: 2026-09-01
Estado: auditoría/diagnóstico solamente — ningún código, schema, migración ni frontend modificado
Continúa: `docs/decisions/SHIFT_ENTRY_CLASSIFICATION_13A.md`, `docs/decisions/SHIFT_EXIT_CLASSIFICATION_13B.md`, `docs/decisions/WORK_REGIME_SHIFT_ALERTS_10D.md`, `docs/decisions/ATTENDANCE_SHIFT_ALERTS_NOTIFICATIONS_AUDIT_10E.md`, `docs/decisions/HOLIDAY_WORK_ASSIGNMENTS_12D.md`, `docs/decisions/HOLIDAY_INACTIVITY_NOTIFICATIONS_12E.md`, `docs/decisions/HOURS_GRID_REVIEW_SPECIAL_HOURS_AUDIT_11A.md`, `docs/decisions/HOURS_GRID_SPECIAL_HOURS_LIQUIDABLE_11A1.md`

## 1. Resumen ejecutivo

13A y 13B corrigieron **cómo** se clasifica una fichada contra un turno (entrada/salida). Esta etapa audita una pregunta distinta: **qué alertas están realmente respaldadas por una configuración funcional real**, y cuáles se disparan por un mecanismo técnico que no depende de ninguna decisión de RRHH.

Con evidencia de código (schema + lógica de evaluación + UI), el sistema tiene hoy **13 tipos de `ShiftAlert`** más **1 tipo de `SystemNotification` fuera de `ShiftAlert`** (`SIN_ACTIVIDAD_REGISTRADA`). De los 13:

- **9 están bien respaldados** por configuración real de Turno y/o Régimen, verificada en la UI (`ShiftTemplateFormFields.tsx`, `WorkRegimesPage.tsx`): `INGRESO_TARDE`, `INGRESO_ANTICIPADO`, `SALIDA_ANTICIPADA`, `SALIDA_TARDIA`, `JORNADA_EXTENDIDA`, `JORNADA_INSUFICIENTE`, `TURNO_NO_IDENTIFICADO`, `SHIFT_NOT_ENABLED_FOR_EMPLOYEE`, `POSIBLE_OLVIDO_SALIDA`.
- **1 está bien respaldada por Conceptos Horarios** de forma precisa: `CONCEPTO_NO_HABILITADO` (regla matcheó + el empleado tiene ese concepto explícitamente deshabilitado).
- **3 tienen un respaldo débil o directamente ausente**, confirmado por código, no por sospecha:
  - `POSSIBLE_SHIFT_CONFIGURATION_MISSING` — es una coincidencia horaria contra el turno de **otro** empleado, no una violación de una regla propia.
  - `SEGMENTO_SIN_CLASIFICAR` — se dispara para cualquier empleado, tenga o no tenga algún concepto horario adicional esperado, apenas exista **una sola** `HourConceptRule` activa en todo el sistema (caso concreto pedido en Parte 5, confirmado: SÍ se dispara sin conceptos adicionales).
  - `DESCANSO_INSUFICIENTE` — el umbral (480 min) está **hardcodeado** en el código, sin ningún campo de Turno ni de Régimen detrás.
- **`JORNADA_INSUFICIENTE`** (el caso concreto del pedido, Parte 5.1-5.3) **SÍ tiene un campo real y ya gatea correctamente** — `ShiftTemplate.minimumMinutesForCompliance`, nullable, expuesto en el formulario de Turnos. Nunca se dispara si el campo no está cargado. El Régimen Laboral **no** tiene ningún campo de mínimo — sólo puede configurar el máximo (`extendedShiftAlertMinutes`, jornada extendida).
- Hallazgo adicional no pedido explícitamente pero relevante: 3 columnas de `ShiftTemplate` (`warningThresholdMinutes`, `reviewThresholdMinutes`, `criticalThresholdMinutes`) tienen un comentario en el schema que dice que gradúan la severidad de `JORNADA_EXTENDIDA` — pero **no se usan en ningún lugar del código** (`grep` exhaustivo, cero resultados fuera de `schema.prisma`). La severidad de `JORNADA_EXTENDIDA` es fija (`INFO`) siempre.
- Hallazgo adicional: `WorkRegime.kind` (`TURNO_OBLIGATORIO`/`TURNO_FLEXIBLE`/`SIN_TURNO`) **no se lee en ningún punto** de la lógica de alertas — es descriptivo. El interruptor real que suprime alertas "fuera de turno" es `WorkRegime.alertOnOutOfShift`, un campo booleano independiente de `kind`.

No se modificó código, schema, migraciones ni frontend. No se commiteó nada.

## 2. Problema

Después de 13A/13B, el sistema puede generar (o generar potencialmente) alertas como "Jornada por debajo del mínimo" o "Tramo de jornada sin concepto horario compatible" sin que sea evidente si existe una regla de negocio real detrás, o si son artefactos técnicos heredados que deberían dejar de notificar a RRHH. El principio que gobierna esta auditoría: **el sistema no debe generar notificaciones visibles para RRHH si no existe una regla funcional configurable que justifique esa notificación.**

## 3. Documentos leídos

`SHIFT_ENTRY_CLASSIFICATION_13A.md`, `SHIFT_EXIT_CLASSIFICATION_13B.md`, `WORK_REGIME_SHIFT_ALERTS_10D.md`, `ATTENDANCE_SHIFT_ALERTS_NOTIFICATIONS_AUDIT_10E.md`, `HOLIDAY_WORK_ASSIGNMENTS_12D.md`, `HOLIDAY_INACTIVITY_NOTIFICATIONS_12E.md`, `HOURS_GRID_REVIEW_SPECIAL_HOURS_AUDIT_11A.md`, `HOURS_GRID_SPECIAL_HOURS_LIQUIDABLE_11A1.md`, `docs/PERFORMANCE_STANDARDS.md`, `CLAUDE.md`, `AGENTS.md`. Más lectura directa de código: `backend/prisma/schema.prisma` (`ShiftTemplate`, `ShiftAssignment`, `WorkRegime`, `ShiftAlertType`, `ShiftAlert`, `HourConcept`, `EmployeeHourConcept`, `HourConceptRule`, `SystemNotification`), `backend/src/modules/shifts/workShiftEvaluation.service.ts` (completo), `backend/src/modules/shifts/workShiftEvaluationRunner.ts` (completo), `backend/src/modules/hour-concepts/hourConceptClassification.ts` (completo), `backend/src/modules/time-entries/attendanceInactivity.service.ts` (completo), `frontend/src/components/shifts/ShiftTemplateFormFields.tsx`, `frontend/src/pages/ShiftAlertsPage.tsx`.

## 4. Configuración actual disponible (Parte 1 del pedido, con evidencia)

### 4.1 — Campos de `ShiftTemplate` (`schema.prisma:1094-1132`)

| Campo | Tipo | Default | Expuesto en UI |
|---|---|---|---|
| `startTime`/`endTime`/`crossesMidnight`/`expectedMinutes` | horario base | — | Sí |
| `entryToleranceBeforeMinutes` | Int | 10 | Sí ("Margen entrada antes") |
| `entryToleranceAfterMinutes` | Int | 10 | Sí ("Margen entrada después") |
| `exitToleranceBeforeMinutes` | Int | 20 | Sí ("Margen salida antes") |
| `exitToleranceAfterMinutes` | Int | 20 | Sí ("Margen salida después") |
| `minimumMinutesForCompliance` | Int? | null | Sí ("Mínimo informativo (min)", `ShiftTemplateFormFields.tsx:129`) |
| `maximumInformativeMinutes` | Int? | null | Sí ("Máximo informativo (min)", `ShiftTemplateFormFields.tsx:130`) |
| `missingOutAlertAfterMinutes` | Int? | null | Sí ("Alerta de olvido de salida", `ShiftTemplateFormFields.tsx:131`) |
| `absoluteOpenShiftLimitMinutes` | Int | 1200 | Sí ("Límite absoluto de jornada abierta") |
| `warningThresholdMinutes` | Int | 720 | **No** — sin uso en ningún archivo fuera de `schema.prisma` |
| `reviewThresholdMinutes` | Int | 960 | **No** — ídem |
| `criticalThresholdMinutes` | Int? | null | **No** — ídem |
| `status` | RecordStatus | ACTIVO | Sí |

### 4.2 — Campos de `ShiftAssignment` (`schema.prisma:1134-1162`)

`employeeId`, `shiftTemplateId` (único compuesto), `status` (`HABILITADO`/`DESHABILITADO`), `effectiveFrom`/`effectiveTo` (vigencia), `weekdays[]` (día de semana aplicable, vacío = todos). **Ningún campo propio de tolerancia/mínimo/máximo** — el vínculo empleado↔turno hereda el 100% de su comportamiento numérico de `ShiftTemplate`; `ShiftAssignment` sólo decide **si** ese turno aplica para ese empleado esa fecha.

### 4.3 — Campos de `WorkRegime` (`schema.prisma:1214-1240`)

| Campo | Tipo | Qué gobierna |
|---|---|---|
| `kind` (`TURNO_OBLIGATORIO`/`TURNO_FLEXIBLE`/`SIN_TURNO`) | enum | **Nada** — no se lee en ningún punto de la lógica de evaluación/alertas (`grep` de `regime.kind`/`WorkRegimeKind.` en `src/modules`: cero resultados). Es descriptivo/informativo para quien administra regímenes, no un interruptor funcional. |
| `alertOnOutOfShift` | Boolean, default `true` | Suprime `TURNO_NO_IDENTIFICADO`/`SHIFT_NOT_ENABLED_FOR_EMPLOYEE`/`POSSIBLE_SHIFT_CONFIGURATION_MISSING` (`SUPPRESSIBLE_OUT_OF_SHIFT_ALERTS`, `workShiftEvaluationRunner.ts:181-194`) y el *default* de 600 min de `POSIBLE_OLVIDO_SALIDA` cuando no hay turno/campo configurado (`workShiftEvaluation.service.ts:298-316`). Es el interruptor real de "sin turno obligatorio" — no `kind`. |
| `openShiftOverflowAction` (`ROLLOVER`/`ALERT_ONLY`) | enum | Qué pasa al llegar al límite absoluto de jornada abierta (auto-cierre vs. alerta crítica para revisión). |
| `extendedShiftAlertMinutes` | Int?, default null | Reemplaza a `ShiftTemplate.maximumInformativeMinutes` para `JORNADA_EXTENDIDA` (10D), gana incondicionalmente cuando está seteado. |
| — | — | **No existe ningún campo de mínimo de horas** a nivel de régimen. Confirmado por lectura completa del modelo: no hay `minimumMinutesForCompliance`, `minimumWorkedMinutes` ni equivalente. |

### 4.4-4.6 — Tolerancias de entrada/salida y jornada extendida

Confirmado en §4.1: tolerancias de entrada y salida existen **sólo a nivel de turno** (`entryTolerance*`/`exitTolerance*`), sin override de régimen. Jornada extendida tiene prioridad **Régimen → Turno → Default fijo (600 min)**: `evaluateWorkedDuration` (`workShiftEvaluation.service.ts:253-262`) — `maximum = regimeMaximumMinutes ?? template.maximumInformativeMinutes ?? DEFAULT_MAXIMUM_INFORMATIVE_MINUTES (600)`.

### 4.7-4.10 — Mínimo de horas trabajadas / jornada mínima diaria / por régimen / por turno

- **Por turno**: SÍ existe — `ShiftTemplate.minimumMinutesForCompliance`, nullable, expuesto en UI. Ver §10 para el análisis funcional completo.
- **Por régimen**: NO existe ningún campo (confirmado §4.3).
- No hay ningún mínimo "global" ni "por defecto" para `insufficientHours` — a diferencia de `JORNADA_EXTENDIDA`, que sí cae a un default de 600 min cuando nada está configurado, `evaluateWorkedDuration` nunca inventa un mínimo: `minimum = template?.minimumMinutesForCompliance ?? null`, y `insufficientHours: minimum !== null && totalMinutes < minimum` (`workShiftEvaluation.service.ts:254,257`) — si `minimum` es `null`, la condición es `false` siempre, sin excepción.

### 4.11-4.13 — Concepto horario adicional / conceptos esperados / relación empleado↔concepto

- `EmployeeHourConcept` (`schema.prisma:777-790`): PK compuesta `(employeeId, hourConceptId)` — es una relación de **habilitación binaria** (existe la fila = habilitado). **No tiene ningún campo de "esperado", "obligatorio" ni de ventana horaria** — sólo dice qué conceptos puede tener ese empleado, nunca cuáles debería tener.
- `HourConceptRule` (`schema.prisma:797-813`): regla de sugerencia **del sistema**, no del empleado — un rango horario (`startTime`/`endTime`) que sugiere qué `HourConcept` aplica a un tramo real, para clasificación automática. No tiene relación con empleados ni con turnos — es global.
- **No existe ningún campo que module "este empleado, en este turno, debería generar el concepto X"** — la única relación empleado↔concepto es la habilitación binaria de `EmployeeHourConcept`, que no participa en absoluto en decidir si `SEGMENTO_SIN_CLASIFICAR` debe dispararse (ver §11).

### 4.14-4.15 — "Sin turno obligatorio" / suprimir alertas fuera de turno

Confirmado en §4.3: el campo operativo es `WorkRegime.alertOnOutOfShift` (no `kind`). Riesgo de inconsistencia de UX: un admin puede configurar `kind=SIN_TURNO` con `alertOnOutOfShift=true` (las alertas de "fuera de turno" se seguirían generando pese a que el nombre del régimen sugiere flexibilidad total) o `kind=TURNO_OBLIGATORIO` con `alertOnOutOfShift=false` (las alertas se suprimirían pese a que el régimen dice que el turno es obligatorio) — el código nunca cruza ambos campos.

## 5. Matriz de alertas (Parte 2/3 del pedido)

| # | Tipo | Label (notificación / tabla) | Se dispara cuando | Archivo/función | Notifica | ShiftAlert interna |
|---|---|---|---|---|---|---|
| 1 | `INGRESO_TARDE` | "Ingreso fuera de tolerancia" / "Llegada tarde" | `differenceMinutes > entryToleranceAfterMinutes`, turno propio HABILITADO | `evaluateEntryPunctuality` (`workShiftEvaluation.service.ts:178-189`) → `evaluateShiftEntry` (`workShiftEvaluationRunner.ts:212-215`) | Sí | Sí |
| 2 | `INGRESO_ANTICIPADO` | "Ingreso anticipado" | `differenceMinutes < -entryToleranceBeforeMinutes`, turno propio HABILITADO | ídem, `:222-225` | Sí | Sí |
| 3 | `SALIDA_ANTICIPADA` | "Salida anticipada" | `differenceMinutes < -exitToleranceBeforeMinutes`, turno propio HABILITADO | `evaluateExitPunctuality` (`:217-231`) → `evaluateShiftExit` (`workShiftEvaluationRunner.ts:377-379`) | Sí (nunca suprimida, prioridad máxima 13B) | Sí |
| 4 | `SALIDA_TARDIA` | "Salida fuera de tolerancia" / "Salida tardía" | `differenceMinutes > exitToleranceAfterMinutes` | ídem, `:380-382` | Sí | Sí |
| 5 | `JORNADA_EXTENDIDA` | "Jornada extendida" | `totalMinutes > (régimen ?? turno ?? 600 default)` | `evaluateWorkedDuration` (`:253-262`) → `evaluateShiftExit` (`:396-398`) | Sí (fuera de la cascada 13B) | Sí |
| 6 | `JORNADA_INSUFICIENTE` | "Jornada por debajo del mínimo" | `totalMinutes < minimumMinutesForCompliance` (sólo si está seteado) | ídem, `:390-395` | Sí, salvo que ya haya `SALIDA_ANTICIPADA` en la misma salida (13B, `notify: !earlyLeave`) | Sí, siempre |
| 7 | `DESCANSO_INSUFICIENTE` | "Descanso insuficiente entre jornadas" / "Descanso insuficiente" | Gap entre jornadas < 480 min (**constante hardcodeada**, `DEFAULT_MINIMUM_REST_MINUTES`) | `evaluateRestPeriod` (`workShiftEvaluation.service.ts:343-347`) → `evaluateShiftEntry` (`workShiftEvaluationRunner.ts:231-234`) | Sí | Sí |
| 8 | `TURNO_NO_IDENTIFICADO` | "Turno no identificado" / "Sin turno compatible" | `NO_MATCH` — sin turno propio aplicable ni turno general dentro de tolerancia | `matchShiftForEmployee` (`:132-157`) → `alertTypeForMatch` (`workShiftEvaluationRunner.ts:153-158`) | Sí, salvo régimen `alertOnOutOfShift=false` | Sí |
| 9 | `SHIFT_NOT_ENABLED_FOR_EMPLOYEE` | "Turno no habilitado para el empleado" / "Turno no habilitado" | Turno propio matchea pero `ShiftAssignment.status=DESHABILITADO` | ídem | Sí, salvo régimen `alertOnOutOfShift=false` | Sí |
| 10 | `POSSIBLE_SHIFT_CONFIGURATION_MISSING` | "Posible falta de configuración de turno" / "Posible falta de configuración" | Sin turno propio aplicable, pero la fichada coincide en horario con un turno **de otro empleado/general** | ídem (`GENERAL_UNASSIGNED`) | Sí, salvo régimen `alertOnOutOfShift=false` | Sí |
| 11 | `POSIBLE_OLVIDO_SALIDA` | "Posible olvido de salida" | Jornada abierta supera `missingOutAlertAfterMinutes` (o default 600 min) | `evaluateOpenShiftRisk` (`:298-316`), cron `checkMissingOutRisk` | Sí, salvo régimen `alertOnOutOfShift=false` (sólo apaga el default, nunca un umbral explícito) | Sí |
| 12 | `CONCEPTO_NO_HABILITADO` | "Concepto horario detectado pero no habilitado para el empleado" / "Concepto no habilitado" | Un tramo matchea una `HourConceptRule` activa, pero ese `HourConcept` no está en `EmployeeHourConcept` del empleado | `classifyShiftInterval` (`hourConceptClassification.ts:162-170`) → `applyClassificationAlerts` (`workShiftEvaluationRunner.ts:302-311`) | Sí, siempre (fuera de la cascada 13B a propósito) | Sí |
| 13 | `SEGMENTO_SIN_CLASIFICAR` | "Tramo de jornada sin concepto horario compatible" | Un tramo no cae dentro del rango horario de **ninguna** `HourConceptRule` activa del sistema | ídem (`:151-160`) → `applyClassificationAlerts` (`:313-323`) | Sí, salvo que ya haya `SALIDA_ANTICIPADA`/`JORNADA_INSUFICIENTE` en la misma salida | Sí, siempre |
| — | `SIN_ACTIVIDAD_REGISTRADA` (no es `ShiftAlertType`, es `SystemNotification.type`) | "Sin actividad registrada" | Empleado activo sin fichadas/horas/novedades ese día; en feriado, sólo si hay `HolidayWorkAssignment` ACTIVA | `detectAttendanceInactivity` (`attendanceInactivity.service.ts:35-104`) | Sí | No (usa `AttendanceInactivityIncident`, no `ShiftAlert`) |

## 6. Qué alertas están respaldadas por Turno

`INGRESO_TARDE`, `INGRESO_ANTICIPADO`, `SALIDA_ANTICIPADA`, `SALIDA_TARDIA` (tolerancias), `JORNADA_EXTENDIDA` y `JORNADA_INSUFICIENTE` (máximo/mínimo informativo), `POSIBLE_OLVIDO_SALIDA` (`missingOutAlertAfterMinutes`), `TURNO_NO_IDENTIFICADO`/`SHIFT_NOT_ENABLED_FOR_EMPLOYEE` (existencia/estado de `ShiftAssignment`). Los 4 campos de tolerancia y los 3 de umbral/mínimo/olvido están **todos expuestos en el formulario de Turnos** (`ShiftTemplateFormFields.tsx`) — la configuración es real y accionable por RRHH hoy.

## 7. Qué alertas están respaldadas por Régimen

`JORNADA_EXTENDIDA` (override de umbral vía `extendedShiftAlertMinutes`), `POSIBLE_OLVIDO_SALIDA` (supresión del default vía `alertOnOutOfShift`), `TURNO_NO_IDENTIFICADO`/`SHIFT_NOT_ENABLED_FOR_EMPLOYEE`/`POSSIBLE_SHIFT_CONFIGURATION_MISSING` (supresión total vía `alertOnOutOfShift`). El Régimen **nunca** respalda `JORNADA_INSUFICIENTE` (no tiene campo de mínimo) ni las alertas de puntualidad de entrada/salida (tolerancias son 100% de turno).

## 8. Qué alertas están respaldadas por Conceptos Horarios

`CONCEPTO_NO_HABILITADO` — respaldo preciso y correcto: una `HourConceptRule` activa matcheó el tramo, y el empleado tiene explícitamente ese `HourConcept` fuera de su `EmployeeHourConcept`. Es una violación real de una configuración explícita del empleado.

`SEGMENTO_SIN_CLASIFICAR` técnicamente también "usa" Conceptos Horarios (las `HourConceptRule` activas), pero **no usa `EmployeeHourConcept` en absoluto** para decidir si corresponde alertar — ver §11.

## 9. Qué alertas no tienen respaldo funcional suficiente

1. **`POSSIBLE_SHIFT_CONFIGURATION_MISSING`**: el "respaldo" es que existe un `ShiftTemplate` activo en el sistema cuyo horario coincide con la fichada — de **cualquier** empleado, no del evaluado. No es una regla violada por el empleado en cuestión, es una coincidencia horaria contra la configuración de un tercero. El label ("Posible falta de configuración de turno") lo presenta como un hecho de configuración cuando en realidad es una hipótesis estadística.
2. **`SEGMENTO_SIN_CLASIFICAR`**: se dispara para cualquier empleado sin importar si tiene o no algún concepto adicional esperado — el único requisito es que exista alguna `HourConceptRule` activa en cualquier parte del sistema. Ver análisis dedicado, §11.
3. **`DESCANSO_INSUFICIENTE`**: el umbral de 480 minutos está hardcodeado (`DEFAULT_MINIMUM_REST_MINUTES`, `workShiftEvaluationRunner.ts:33`) — no hay ningún campo de Turno ni de Régimen detrás. No fue pedido explícitamente en la lista mínima del encargo, pero aparece en el enum y en la matriz (Parte 2 pide "listar todos los tipos"). No tengo evidencia de código de que 480 min corresponda a un piso legal fijo (LCT) documentado en el repo — sólo el nombre de la constante lo sugiere. Si es un piso legal universal, no necesita ser configurable y su falta de campo no es un defecto; si no lo es, hoy no tiene ninguna configuración real detrás. Recomendado confirmar con RRHH/Legal antes de decidir (ver §13).

## 10. Decisión sobre "Jornada por debajo del mínimo" (Parte 5.1-5.3, caso concreto pedido)

**Respuesta directa**: **sí existe con configuración real hoy**, y el gate ya es correcto en código — no es una alerta técnica heredada ni necesita suprimirse.

- **Campo**: `ShiftTemplate.minimumMinutesForCompliance` (`schema.prisma:1108`), `Int?`, sin default (`null` = sin mínimo).
- **Expuesto en UI**: sí, `ShiftTemplateFormFields.tsx:129` ("Mínimo informativo (min)", placeholder "Sin definir").
- **Gate en código**: `evaluateWorkedDuration` (`workShiftEvaluation.service.ts:253-262`) — `insufficientHours: minimum !== null && totalMinutes < minimum`. Si el campo no está cargado en ese turno específico, la condición es `false` siempre, sin excepción ni fallback. Si el empleado no tiene ningún turno matcheado (`template === null`), el mínimo también es `null` — tampoco se dispara.
- **Régimen Laboral**: no permite configurar ningún mínimo — sólo permite configurar el máximo (`extendedShiftAlertMinutes`, jornada extendida). Confirmado por lectura completa del modelo `WorkRegime` (§4.3): no existe ningún campo análogo a `minimumMinutesForCompliance` a nivel de régimen.

**Recomendación**: **mantener notificable tal como está** — no requiere suprimirse, dejarse interna ni eliminarse, porque ya está correctamente gateado por una configuración real y explícita por turno. El único límite real es que hoy sólo puede configurarse **por turno**, nunca por régimen — si en el futuro se necesita un piso de horas mínimas independiente del turno (ej. "todo el régimen Cosecha debe cumplir 6h/día sin importar el turno puntual"), eso requeriría un campo nuevo en `WorkRegime` (análogo a `extendedShiftAlertMinutes` pero para el mínimo), etapa separada — no implementado, no pedido con un caso real que lo justifique hoy. No se auditó si algún `ShiftTemplate` real en la base de datos tiene hoy el campo cargado (fuera de alcance de una auditoría de código; si se necesita confirmar cobertura real, es una consulta puntual a la base, no un cambio de código).

## 11. Decisión sobre "Tramo sin concepto horario compatible" (Parte 5.4-5.5, caso concreto pedido)

**Respuesta directa**: **sí, se dispara aunque el empleado no tenga ningún concepto horario adicional esperado o habilitado.**

Evidencia (`hourConceptClassification.ts`):
- `classifyWorkShiftSegments` (`:199-227`) sólo tiene **una** condición de corte: si no existe **ninguna** `HourConceptRule` activa en **todo el sistema**, no clasifica nada (`MANUAL`, sin alerta). Esta condición es global, no depende del empleado evaluado.
- Si existe al menos una regla activa en cualquier parte del sistema (por ejemplo, una regla "Sereno" 21:00-04:00 pensada para vigilancia nocturna), **todo tramo de trabajo de cualquier empleado que no caiga dentro de esa ventana horaria** cae en `SIN_CONCEPTO_COMPATIBLE` (`:151-160`) → `SEGMENTO_SIN_CLASIFICAR`.
- La función **nunca consulta `EmployeeHourConcept`** para decidir si corresponde marcar `SIN_CONCEPTO_COMPATIBLE` — esa tabla sólo se usa para distinguir, cuando **sí** hubo match de regla, si el concepto resultante está habilitado (`CONCEPTO_NO_HABILITADO`) o no (`SUGERIDO`) — nunca para decidir si el tramo *debería* tener algún concepto en primer lugar.
- Conclusión: un empleado administrativo de oficina, sin ningún concepto horario adicional esperado, puede empezar a recibir `SEGMENTO_SIN_CLASIFICAR` en cada jornada el día que RRHH active la primera `HourConceptRule` del sistema para un área completamente distinta (ej. vigilancia). No es un bug de cálculo — es un diseño que no distingue "tramo que debería tener concepto y no lo tiene" de "empleado sin ninguna expectativa de concepto adicional".

**Recomendación**: dado que hoy **no existe ningún campo** que module "este empleado/turno espera un concepto horario adicional" (confirmado en §4.11-4.13 — `EmployeeHourConcept` es sólo habilitación binaria, sin relación con expectativa), esta alerta no cumple el principio rector de la auditoría. **Degradar de notificación visible a alerta interna**: seguir persistiendo el `ShiftAlert` (auditoría/trazabilidad para quien revise Conceptos Horarios), pero dejar de generar `SystemNotification` a RRHH por defecto (`notify: false` en `applyClassificationAlerts`, o condicionar por si el empleado tiene al menos un `EmployeeHourConcept` habilitado) hasta que exista una noción real de "concepto esperado". **No implementado en esta etapa** — es una recomendación de diseño para una etapa futura, aprobada explícitamente antes de tocar código.

## 12. Riesgos

- **Confusión de severidad para RRHH**: 3 campos de `ShiftTemplate` (`warningThresholdMinutes`/`reviewThresholdMinutes`/`criticalThresholdMinutes`) sugieren, por su comentario en el schema, que `JORNADA_EXTENDIDA` tiene severidad graduada — no es así, es fija (`INFO`). Si alguien lee el schema sin cruzar contra el código de evaluación, puede asumir un comportamiento que no existe.
- **Label engañoso en `POSSIBLE_SHIFT_CONFIGURATION_MISSING`**: el texto afirma "falta de configuración" como un hecho, cuando en realidad es una coincidencia horaria contra el turno de un tercero — puede generar tickets/reclamos de RRHH pidiendo "arreglar la configuración" de un turno que en realidad nunca estuvo mal configurado.
- **Ruido sistémico latente en `SEGMENTO_SIN_CLASIFICAR`**: el riesgo no se manifestó todavía en producción porque (según 11A/11A1) el motor de Conceptos Horarios recién se está adoptando activamente — pero crece con cada `HourConceptRule` nueva que RRHH active, alcanzando a empleados sin ninguna relación con esa regla.
- **`kind` de `WorkRegime` no gobierna nada**: alguien que configure un régimen esperando que `SIN_TURNO` suprima alertas de turno se sorprenderá si no tocó también `alertOnOutOfShift`.
- **`DESCANSO_INSUFICIENTE` sin configuración**: si 480 min no es un piso legal fijo confirmado, es la única alerta de puntualidad/duración sin ningún respaldo de Turno ni Régimen — inconsistente con el resto del cluster.
- Ninguno de estos riesgos es nuevo (no introducido por 13A/13B) — son brechas preexistentes que esta auditoría deja documentadas por primera vez con evidencia de código.

## 13. Próximas etapas sugeridas (no implementadas)

1. **`SEGMENTO_SIN_CLASIFICAR` → interna, no notificable** (ver §11) — cambio acotado a `applyClassificationAlerts`/`notifyClassificationAlerts`, sin schema.
2. **Copy de `POSSIBLE_SHIFT_CONFIGURATION_MISSING`** — reformular el label/mensaje para reflejar que es una hipótesis de coincidencia horaria, no un hecho confirmado; posible candidato a degradar a interna también, si RRHH confirma que genera más ruido que valor.
3. **Confirmar con RRHH/Legal el criterio de `DESCANSO_INSUFICIENTE`** (480 min) — si es un piso legal fijo, documentarlo explícitamente en el código (comentario + referencia a la norma); si no, evaluar si necesita un campo configurable (turno o régimen).
4. **Limpieza de columnas muertas** (`warningThresholdMinutes`/`reviewThresholdMinutes`/`criticalThresholdMinutes`) — o bien implementar la severidad graduada que el comentario promete, o bien eliminar las columnas (requiere migración, fuera de alcance de una auditoría).
5. **Campo de mínimo por Régimen** (análogo a `extendedShiftAlertMinutes`) — sólo si aparece un caso real que lo requiera (ej. un régimen con mínimo diario independiente del turno puntual); no hay evidencia de esa necesidad hoy.
6. **Cruzar `WorkRegime.kind` con `alertOnOutOfShift`** en la UI de `WorkRegimesPage.tsx` — al menos una advertencia visual si se configuran de forma contradictoria (ej. `SIN_TURNO` + `alertOnOutOfShift=true`).

Ninguno de estos puntos fue implementado — quedan como recomendaciones para etapas futuras, cada una con su propia aprobación explícita antes de tocar código.

## 14. Qué NO se implementó

- Ningún cambio a `schema.prisma`, ninguna migración.
- Ningún cambio a `workShiftEvaluation.service.ts`, `workShiftEvaluationRunner.ts`, `hourConceptClassification.ts`, `attendanceInactivity.service.ts` ni a ningún otro archivo de producción.
- Ningún cambio de frontend (`ShiftTemplateFormFields.tsx`, `ShiftAlertsPage.tsx`, `WorkRegimesPage.tsx` ni ninguna otra pantalla).
- Ningún test nuevo ni modificado.
- La supresión de notificación para `SEGMENTO_SIN_CLASIFICAR` recomendada en §11 — es una recomendación, no un cambio aplicado.
- Ninguna verificación contra datos reales de producción (ej. si algún `ShiftTemplate` tiene hoy `minimumMinutesForCompliance` cargado, o cuántas `HourConceptRule` están activas) — esta auditoría es 100% de código/configuración disponible, no de datos runtime.
- No se commiteó nada.

---

Auditoría solamente. No se modificó código, schema, migraciones ni frontend. No se commiteó nada.
