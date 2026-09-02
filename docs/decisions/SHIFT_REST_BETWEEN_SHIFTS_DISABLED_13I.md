# Etapa 13I — Desactivar DESCANSO_INSUFICIENTE entre jornadas

Fecha: 2026-09-02
Estado: implementado, validado, pendiente de aprobación para commitear
Continúa: `docs/decisions/SHIFT_ALERT_RULES_AUDIT_13C.md` (hallazgo original: umbral hardcodeado sin respaldo), `docs/decisions/SHIFT_EXIT_SINGLE_NOTIFICATION_POLICY_13G.md`, `docs/decisions/SHIFT_ALERTS_GROUPED_VIEW_13H.md`, `docs/decisions/SHIFT_ALERTS_GROUPED_VIEW_13H_1.md`, `docs/decisions/SHIFT_ENTRY_CLASSIFICATION_13A.md`, `docs/decisions/SHIFT_EXIT_CLASSIFICATION_13B.md`
Alcance: sólo la generación de `DESCANSO_INSUFICIENTE` en `evaluateShiftEntry`. No se tocó ninguna otra alerta de entrada, ninguna alerta de salida, Horas Especiales, Conceptos Horarios, liquidación, fichador, grilla/export/bandeja, asignaciones de feriado, ni "Sin actividad registrada".

## 1. Resumen ejecutivo

`DESCANSO_INSUFICIENTE` seguía notificando a RRHH con un umbral fijo de 480 minutos (8 horas) entre el fin de una jornada y el inicio de la siguiente, sin ningún respaldo de configuración por turno o régimen (hallazgo ya confirmado en la auditoría 13C). En un sistema con empleados de régimen flexible, turnos partidos y personas que pueden trabajar, cortar y volver, ese umbral fijo genera ruido y falsas alarmas. Se desactivó la generación de esta alerta: `evaluateShiftEntry` ya no consulta la jornada previa ni crea `ShiftAlert`/`SystemNotification` de este tipo. El tipo, su severidad, su label y su presencia en el schema Zod se conservan intactos — cualquier fila ya persistida sigue mostrándose correctamente en "Alertas de Turnos" y "Notificaciones", sin ningún cambio de frontend. Sin migraciones, sin borrado de datos. +3 tests backend nuevos, 997/997 verdes.

## 2. Problema funcional

Apareció en Notificaciones "Descanso insuficiente entre jornadas" para casos donde, funcionalmente, no había ningún problema real — el sistema no tiene forma hoy de distinguir un empleado con turno fijo (donde 8h de descanso es una expectativa razonable) de un empleado de régimen flexible/turno partido (donde puede no serlo en absoluto).

## 3. Por qué se desactiva por ahora

El descanso entre jornadas es difícil de evaluar correctamente sin una configuración explícita por régimen/turno/empresa — exactamente lo que hoy no existe (ver diagnóstico, §4). Implementar una regla legal o un valor fijo "razonable" sin que RRHH lo haya definido sería inventar una regla de negocio no pedida (explícitamente prohibido: "no inventar regla legal o fija hardcodeada"). La opción más segura y profesional es desactivar la generación hasta que exista una definición funcional clara, dejando el mecanismo (`evaluateRestPeriod`, pura, testeada) listo para reactivarse el día que haya una configuración real.

## 4. Diagnóstico (Parte 1 del pedido, con evidencia)

1. **Dónde se generaba**: `evaluateShiftEntry` (`backend/src/modules/shifts/workShiftEvaluationRunner.ts`, antes de esta etapa líneas 289-296).
2. **Qué función lo disparaba**: `evaluateRestPeriod` (`workShiftEvaluation.service.ts`, función pura) calculaba `restMinutes`/`insufficientRest`; `evaluateShiftEntry` llamaba a `createShiftAlert` si `insufficientRest`.
3. **¿Ingreso, salida, job o evaluación posterior?**: exclusivamente en **ingreso** — dentro de `evaluateShiftEntry`, nunca en `evaluateShiftExit` ni en ningún cron/job de mantenimiento.
4. **Umbral usado**: `DEFAULT_MINIMUM_REST_MINUTES = 480` (8 horas), constante en `workShiftEvaluationRunner.ts`.
5. **¿Hardcodeado?**: sí, confirmado — sin ningún parámetro configurable, el mismo valor para cualquier empleado/turno/régimen.
6. **¿Configuración en `ShiftTemplate`?**: no — ningún campo de `ShiftTemplate` referencia descanso mínimo entre jornadas (confirmado por lectura completa del modelo, ya auditado en 13C).
7. **¿Configuración en `WorkRegime`?**: no — ídem, ningún campo (`alertOnOutOfShift`, `openShiftOverflowAction`, `extendedShiftAlertMinutes` son los únicos campos de comportamiento, ninguno sobre descanso).
8. **¿Configuración global?**: no — sólo la constante hardcodeada en el archivo.
9. **¿Generaba `SystemNotification` visible?**: sí, siempre — `createShiftAlert` se llamaba sin ningún parámetro `notify`, así que usaba el default (`true`); nunca participó de ninguna cascada de supresión (13B/13G son exclusivas de las alertas de **salida**; `DESCANSO_INSUFICIENTE` es de entrada).
10. **¿Se persistía como `ShiftAlert`?**: sí, siempre, vía el mismo `createShiftAlert` (upsert por `[workShiftId, type]`).
11. **¿Aparecía en Alertas de Turnos?**: sí, como cualquier otra `ShiftAlert`.
12. **¿Aparecía en Notificaciones?**: sí, sin ninguna supresión.
13. **Tests existentes**: `evaluateRestPeriod` (la función pura) tenía 3 tests dedicados en `workShiftEvaluation.service.test.ts` (sin cambios, ninguno modificado) — pero **ningún test en `workShiftEvaluationRunner.test.ts` cubría la generación de la `ShiftAlert`** a nivel de `evaluateShiftEntry` (confirmado por grep exhaustivo) — no había ninguna expectativa preexistente que actualizar, sólo tests nuevos que agregar.
14. **Impacto de desactivar su generación**: acotado — `DESCANSO_INSUFICIENTE` es un tipo aislado, no interactúa con ninguna otra alerta (nunca participó de ninguna cascada de prioridad, nunca fue insumo de otra evaluación). Desactivarla no cambia el comportamiento de `INGRESO_TARDE`/`INGRESO_ANTICIPADO`/`TURNO_NO_IDENTIFICADO`/`SHIFT_NOT_ENABLED_FOR_EMPLOYEE` ni de ninguna alerta de salida — confirmado con la suite completa de tests (997/997 verdes, sin ninguna regresión). Como beneficio adicional: se elimina una consulta (`prisma.workShift.findFirst`, la búsqueda de la jornada previa) de cada evaluación de entrada.
15. **Cómo conservar históricos sin romper renderizado**: no tocar el enum de Prisma (`ShiftAlertType.DESCANSO_INSUFICIENTE`), no tocar `severityByAlertType`/`labelByAlertType` (backend), no tocar `shiftAlertTypeSchema` (Zod), no tocar `TYPE_LABELS` (frontend) — los cuatro se dejaron exactamente iguales, sólo se agregó un comentario marcando el tipo como legacy. Cualquier fila ya persistida sigue teniendo un label válido y un tipo válido en cada capa.

## 5. Qué se cambió

**`backend/src/modules/shifts/workShiftEvaluationRunner.ts`** (único archivo de producción tocado):
- `evaluateShiftEntry`: se eliminó el bloque que consultaba `prisma.workShift.findFirst` (jornada previa), llamaba a `evaluateRestPeriod` y, si correspondía, a `createShiftAlert` con `type: "DESCANSO_INSUFICIENTE"`. Reemplazado por un comentario explicando la desactivación y el motivo.
- Se eliminó el import de `evaluateRestPeriod` (ya no se usa en este archivo) y la constante `DEFAULT_MINIMUM_REST_MINUTES` (quedaba sin ningún uso).
- `ShiftAlertTypeValue`, `severityByAlertType`, `labelByAlertType`: **sin cambios de contenido** — se agregó un comentario marcando `DESCANSO_INSUFICIENTE` como legacy (mismo criterio ya usado para `POSSIBLE_SHIFT_CONFIGURATION_MISSING` en la Etapa 13E.1).

**Nada más se modificó**:
- `evaluateRestPeriod` (`workShiftEvaluation.service.ts`) — función pura, se conserva **intacta y exportada**, sin ningún llamador en producción por ahora. Lista para reactivarse sin reescribir nada el día que exista una configuración real de descanso mínimo (§9).
- `schema.prisma` — sin cambios, sin migraciones. El enum `ShiftAlertType.DESCANSO_INSUFICIENTE` permanece.
- `shiftAlert.schemas.ts` (Zod) — sin cambios; `DESCANSO_INSUFICIENTE` sigue siendo un valor válido para filtrar por `?type=...`.
- Frontend (`ShiftAlertsPage.tsx`) — sin cambios; `TYPE_LABELS.DESCANSO_INSUFICIENTE` ya existía y sigue exactamente igual, sin necesitar ningún ajuste (ver §8).

## 6. Qué pasa con históricos

No se tocó ninguna fila ya persistida. Si existen `ShiftAlert` de tipo `DESCANSO_INSUFICIENTE` (pendientes, resueltas o descartadas), siguen existiendo, siguen apareciendo en "Alertas de Turnos" y siguen siendo filtrables por tipo — el enum, la severidad y el label permanecen sin cambios en las 4 capas (Prisma, Zod, backend runner, frontend). Ninguna migración, ningún script de limpieza, ningún `UPDATE`/`DELETE` ejecutado ni propuesto.

## 7. Tests (Parte 4 del pedido)

**Backend** (+3 tests nuevos, 994 → 997 total, todos verdes), nuevo describe "`evaluateShiftEntry` — Etapa 13I (DESCANSO_INSUFICIENTE desactivado)":

1. **Tests obligatorios #1/#2**: una entrada con muy poco descanso respecto de la jornada previa (simulada explícitamente vía el mock de `workShift.findFirst`, que antes hubiera disparado la alerta) ya no genera ninguna `ShiftAlert` ni `SystemNotification` — y, más fuerte todavía, `prisma.workShift.findFirst` **ni se llama**, confirmando que la consulta se eliminó (no sólo que se ignora su resultado).
2. **Tests obligatorios #3**: entrada tarde sigue notificando `INGRESO_TARDE` normalmente, sin verse afectada.
3. **Tests obligatorios #3**: entrada anticipada sigue notificando `INGRESO_ANTICIPADO` normalmente, sin verse afectada.

**Tests obligatorios #4 (alertas de salida) y #6 (liquidación)**: no requirieron tests nuevos — `evaluateShiftExit` no fue tocado en absoluto (esta alerta nunca participó de ninguna evaluación de salida), y toda la suite existente de `SALIDA_ANTICIPADA`/`SALIDA_TARDIA`/`JORNADA_EXTENDIDA`/`JORNADA_INSUFICIENTE`/`CONCEPTO_NO_HABILITADO`/`SEGMENTO_SIN_CLASIFICAR` (Etapas 13B/13D/13G/13H.1) sigue verde sin ninguna modificación — confirma que desactivar `DESCANSO_INSUFICIENTE` no tuvo ningún efecto colateral.

**Test obligatorio #5 (históricos/labels no rompen)**: no requirió un test nuevo — `shiftAlert.schemas.test.ts` ya tiene una lista exhaustiva de los 13 tipos (incluido `DESCANSO_INSUFICIENTE`) que sigue pasando sin cambios, confirmando que el tipo sigue siendo válido en el schema Zod; `evaluateRestPeriod` conserva sus 3 tests propios en `workShiftEvaluation.service.test.ts`, también sin cambios.

**Test obligatorio #7 ("Sin actividad registrada")**: no aplica — ningún archivo de `attendanceInactivity.service.ts` fue tocado ni leído; son mecanismos completamente independientes (`DESCANSO_INSUFICIENTE` es una `ShiftAlert` del módulo de turnos, "Sin actividad registrada" es un `SystemNotification`/`AttendanceInactivityIncident` de asistencia).

## 8. Tests frontend

**No se tocó frontend, y no hicieron falta tests frontend nuevos.** `TYPE_LABELS.DESCANSO_INSUFICIENTE` (`ShiftAlertsPage.tsx`) ya existía desde antes de esta etapa y no requiere ningún cambio: el frontend nunca decide si generar o no una alerta (esa lógica es 100% backend) — sólo renderiza lo que el backend le devuelve. Al dejar de generarse alertas nuevas de este tipo, el frontend simplemente muestra menos filas de este tipo específico, sin que su propio código necesite saberlo. Las filas históricas (si existen) siguen renderizando con el mismo label ya probado (no hay ningún test frontend que dependiera de que este tipo generara alertas nuevas). La agrupación por `workShiftId` (Etapa 13H) y la política de notificación única (13G) tampoco se ven afectadas: `DESCANSO_INSUFICIENTE` nunca participó de ninguna de las dos.

## 9. Validaciones ejecutadas

`prisma validate` ✅, `prisma generate` ✅, `prisma migrate status` ✅ (49 migraciones, sin cambios de schema, al día). Backend: `typecheck` ✅, `vitest run` ✅ 997/997 (66 archivos), `build` ✅. Frontend: no se tocó ningún archivo, sin necesidad de validaciones (confirmado con `git status`). `git diff --check` ✅ sin errores de espacios en blanco.

## 10. Qué NO se tocó

- Entrada — sólo se tocó el bloque específico de `DESCANSO_INSUFICIENTE` dentro de `evaluateShiftEntry`; `matchShiftForEmployee`, `evaluateEntryPunctuality`, `INGRESO_TARDE`/`INGRESO_ANTICIPADO`, `alertTypeForMatch`/`TURNO_NO_IDENTIFICADO`/`SHIFT_NOT_ENABLED_FOR_EMPLOYEE` — sin cambios.
- Salida (`evaluateShiftExit`, `SALIDA_ANTICIPADA`/`SALIDA_TARDIA`/`JORNADA_EXTENDIDA`/`JORNADA_INSUFICIENTE`/`CONCEPTO_NO_HABILITADO`/`SEGMENTO_SIN_CLASIFICAR`, la política de notificación única de 13G) — cero líneas tocadas.
- Horas Especiales, Conceptos Horarios — ningún archivo tocado.
- Liquidación (`TimeEntry.hours/totalMinutes/appliedMultiplier`) — sin cambios.
- Grilla/export/bandeja de revisión — ningún archivo tocado.
- Fichador (`timeEntries.service.ts`, `timeEntries.repository.ts`) — ningún archivo tocado; `evaluateShiftEntry` se sigue invocando exactamente igual desde los mismos call sites, sin cambio de firma.
- Asignaciones de feriado (`HolidayWorkAssignment`) — sin cambios.
- "Sin actividad registrada" (`attendanceInactivity.service.ts`) — sin cambios.
- `schema.prisma` — sin cambios, sin migraciones. El enum `ShiftAlertType` permanece idéntico, con los 13 valores.
- `evaluateRestPeriod` (`workShiftEvaluation.service.ts`) — función y sus 3 tests propios, intactos.
- Frontend — ningún archivo tocado.
- Permisos/RBAC — sin cambios.

## 11. Riesgos pendientes

- **Ningún reemplazo funcional todavía** — mientras no exista una configuración real de descanso mínimo, cualquier caso genuino de descanso insuficiente (ej. un empleado que realmente encadena jornadas sin descanso adecuado, en un régimen donde eso sí sería un problema) no genera ninguna alerta. Es la contrapartida aceptada explícitamente por el pedido ("por ahora esta alerta no interesa") — no es un descuido, es la decisión tomada.
- **`evaluateRestPeriod` sin llamador en producción** — al no estar referenciada desde ningún flujo real, un cambio futuro en `workShiftEvaluation.service.ts` podría modificarla sin que ningún test de integración lo note (sólo sus 3 tests unitarios directos la protegen). Riesgo bajo, mitigado por mantener sus tests propios intactos.
- **Filas históricas sin ninguna acción de limpieza** — si en algún momento se decide que las `ShiftAlert` de `DESCANSO_INSUFICIENTE` ya persistidas (pendientes) generan confusión en el uso diario de "Alertas de Turnos", resolverlas (marcarlas `DESCARTADA` en lote, por ejemplo) sería una acción puntual sobre datos reales que requeriría aprobación explícita — no se propuso ni se ejecutó acá.

## 12. Futura etapa posible

Si RRHH define una necesidad real de controlar el descanso entre jornadas, la etapa futura natural sería: agregar un campo de descanso mínimo configurable (por `WorkRegime`, análogo a `extendedShiftAlertMinutes` de la Etapa 10D, o por `ShiftTemplate`) y volver a llamar `evaluateRestPeriod` desde `evaluateShiftEntry` usando ese valor en vez de la constante hardcodeada — la función pura ya existe, testeada, sin necesidad de reescribirla. Requeriría su propia migración (columna nueva) y su propia etapa de diseño (qué prioridad tiene régimen vs. turno, si se suprime para regímenes flexibles, etc.) — no implementado ni decidido acá.

---

No se tocó entrada (salvo el bloque puntual de esta alerta), salida, Horas Especiales, Conceptos Horarios, liquidación, grilla/export/bandeja, fichador, asignaciones de feriado, "Sin actividad registrada", ni frontend. No se creó ninguna migración. No commitear sin aprobación explícita del usuario.
