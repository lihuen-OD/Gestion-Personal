# Etapa 10C — Integración de régimen con alertas: diagnóstico de JORNADA_EXTENDIDA, contrato funcional y verificación de casos nocturnos

Fecha: 2026-08-27
Estado: diagnóstico completo + correcciones acotadas (cobertura de tests) + una decisión de producto diferida por pedido explícito del usuario
Alcance: cierre del foco pendiente de 10A/10B — `JORNADA_EXTENDIDA`, contrato funcional Régimen↔Turno↔Fichador↔Alertas, notificaciones duplicadas, casos nocturnos/sereno

## 1. Resumen ejecutivo

El hallazgo central de esta etapa es que **no hay ningún bug que confunda "jornada extendida" con "olvido de salida"** — el sistema ya los separa correctamente por diseño, en dos funciones distintas que nunca se cruzan: `evaluateWorkedDuration` (JORNADA_EXTENDIDA) sólo corre cuando hay una salida **real y confirmada**; `evaluateOpenShiftRisk`/`POSIBLE_OLVIDO_SALIDA` sólo corre mientras la jornada sigue **abierta, sin salida**. Un mismo `WorkShift` nunca puede generar ambas alertas para el mismo hecho — son mutuamente excluyentes por construcción (una exige `endAt` real, la otra exige `endAt: null`).

Tampoco hay bug en el cruce de medianoche (turnos nocturnos/sereno): la conversión de horario está centralizada en un único helper (`scheduledInstantForShiftTime`) que ya recibía `crossesMidnight` correctamente en los dos únicos lugares que calculan una salida esperada (`evaluateExitPunctuality`, `evaluateOpenShiftRisk`), con tests dedicados desde antes de esta etapa (incluido un caso de vigencia por día de semana que cruza medianoche, Etapa 8J). Lo que faltaba era cobertura de este comportamiento **a nivel de integración** (con Prisma mockeado, no sólo la función pura) — se agregó en esta etapa (§15).

La única brecha real y ya conocida desde 10A/10B es que `JORNADA_EXTENDIDA` **no es configurable por régimen** — un empleado de cosecha/pañol sin turno sigue usando el umbral fijo de 600 minutos (10h), sin importar si su régimen ya suprime las alertas de "fuera de turno". **Se presentaron 3 opciones concretas al usuario antes de tocar código** (reusar `alertOnOutOfShift` sin schema; agregar un campo numérico nuevo en `WorkRegime` con migración; diferir a una etapa dedicada) — **el usuario eligió diferir**, confirmando que ninguna de las dos alternativas que requerían tocar el comportamiento (una estirando el significado de un campo existente, la otra con schema) se implementa en esta etapa. Queda documentada como el pendiente central para una etapa futura (§12).

Sobre notificaciones duplicadas: se reconfirmó con evidencia nueva (incluyendo un test que no existía) que `ALERTA_FICHADA` (aviso temprano de riesgo) y `FALTA_SALIDA` (aviso definitivo de cierre) **nunca pueden generarse en la misma corrida de mantenimiento** para la misma jornada — son secuenciales, no simultáneas, y el chequeo de riesgo temprano excluye explícitamente las jornadas ya vencidas. Se recomienda mantener ambas notificaciones (§10).

Casos nocturnos/sereno: verificados explícitamente, sin mezclar con Conceptos Horarios/Horas Especiales — confirmado que "sereno" como concepto horario (`HourConcept.kind = "SERENO"`, usado en `timeEntries.repository.ts` para liquidación) es un sistema completamente distinto y desacoplado del turno "sereno" (`ShiftTemplate` con `crossesMidnight: true`) que evalúa `ShiftAlert` — cero solapamiento de código entre ambos (§9).

## 2. Qué significa `JORNADA_EXTENDIDA`

**En el código, hoy:** `evaluateWorkedDuration` (`backend/src/modules/shifts/workShiftEvaluation.service.ts:195-204`), llamada exclusivamente desde `evaluateShiftExit` (`workShiftEvaluationRunner.ts:224-226`) — es decir, **sólo se evalúa en el momento de un cierre real de jornada** (salida del fichador, cierre manual de RRHH), nunca sobre una jornada todavía abierta.

```ts
export function evaluateWorkedDuration(input: { totalMinutes: number; template: ShiftTemplateRef | null }): DurationEvaluationResult {
  const minimum = input.template?.minimumMinutesForCompliance ?? null;
  const maximum = input.template ? input.template.maximumInformativeMinutes : DEFAULT_MAXIMUM_INFORMATIVE_MINUTES;
  return {
    insufficientHours: minimum !== null && input.totalMinutes < minimum,
    extendedShift: maximum !== null && input.totalMinutes > maximum,
    ...
  };
}
```

Significa: **"esta jornada, ya cerrada con una salida real, duró más minutos de los que el turno (o el default de 600 min si no hay turno) considera razonable informar."** Severidad `INFO` (`severityByAlertType.JORNADA_EXTENDIDA`, `workShiftEvaluationRunner.ts:41`) — es decir, el propio sistema ya la trata como un dato informativo, no como una alerta crítica que requiera acción.

**Qué debería significar funcionalmente** (según el objetivo original de 9A/10A): exactamente lo mismo que significa hoy — una extensión real de jornada, nunca una sospecha de olvido de salida. La única brecha es que el umbral que decide "más de lo razonable" no distingue régimen (ver §2.3/§12).

**Campos que usa:** `shift.totalMinutes` (horas reales ya computadas, nunca recalculadas acá) y `template.maximumInformativeMinutes` (o `DEFAULT_MAXIMUM_INFORMATIVE_MINUTES = 600` si el empleado no tiene turno matcheado).

**Campos que ignora:** `WorkRegime.alertOnOutOfShift`, `WorkRegime.openShiftOverflowAction`, `WorkRegime.kind` (ninguno de los tres se consulta en esta función ni en su llamador) y los 3 campos de `ShiftTemplate` sin consumidor real ya señalados en 10A (`warningThresholdMinutes`/`reviewThresholdMinutes`/`criticalThresholdMinutes` — declarados para graduar `JORNADA_EXTENDIDA` en distintos niveles de severidad, nunca implementado).

**Alertas que genera:** únicamente `JORNADA_EXTENDIDA` (severidad `INFO`). No genera ni afecta ninguna otra.

**Alertas que debería generar:** las mismas — no se encontró evidencia de que deba generar algo adicional. Lo que falta no es un tipo de alerta nuevo, es que el umbral existente sea sensible al régimen (ver §12).

### 2.1 — Si la persona sigue trabajando después del horario esperado (jornada todavía abierta)

No pasa por `evaluateWorkedDuration` en absoluto — pasa por `evaluateOpenShiftRisk` (§5), que evalúa niveles de riesgo (`NORMAL`/`MISSING_OUT`/`EXPIRED`) mientras la jornada sigue `ABIERTO`. `JORNADA_EXTENDIDA` recién puede generarse **después**, cuando esa persona finalmente marca la salida real — en ese momento, si `totalMinutes` superó el umbral, se marca como informativa.

### 2.2 — Si se olvida de marcar salida

Nunca genera `JORNADA_EXTENDIDA` — al no haber salida real, `evaluateShiftExit`/`evaluateWorkedDuration` no se ejecutan nunca para esa jornada. El camino es exclusivamente `POSIBLE_OLVIDO_SALIDA` (§5) y, eventualmente, el cierre automático en 0h (§6) o la marca `ALERT_ONLY` para revisión (§6).

### 2.3 — Cruce de medianoche / turnos nocturnos

`totalMinutes` es una diferencia de tiempo real (minutos transcurridos entre `startAt` y `endAt`), agnóstica de si el turno cruza medianoche o no — no hay ningún cálculo especial ni riesgo de doble conteo. Verificado con 2 tests nuevos de integración (§15): una jornada nocturna que cierra en horario no genera nada, y una que se extiende de verdad (con salida real tardía) genera `JORNADA_EXTENDIDA` — nunca `POSIBLE_OLVIDO_SALIDA`, porque hubo salida confirmada.

### 2.4 — Empleados sereno/nocturno

Mismo comportamiento que cualquier otro turno — el sistema no tiene (ni necesita) ninguna rama especial para "sereno" a nivel de evaluación de jornada. La única razón por la que "sereno" existe como concepto en el código es como `HourConceptKind` para liquidación (Conceptos Horarios, ver §9) — un sistema completamente distinto.

### 2.5 — ¿Diferencia entre "trabajó más tiempo permitido" y "olvidó salida"? ¿El sistema los confunde?

**Sí hay diferencia, y el sistema NO los confunde.** Es la conclusión central de esta etapa, con evidencia directa de código: son dos funciones puras distintas (`evaluateWorkedDuration` vs. `evaluateOpenShiftRisk`), invocadas desde puntos distintos del flujo (cierre real vs. jornada todavía abierta), sobre datos mutuamente excluyentes (`totalMinutes` de una jornada ya cerrada vs. minutos transcurridos de una jornada sin `endAt`). No existe ningún camino de código donde ambas se evalúen para el mismo `WorkShift` en el mismo momento.

## 3. Contrato funcional entre Régimen, Turno, Fichador y Alertas

Este contrato ya estaba correctamente implementado antes de esta etapa (confirmado en 10A) — se documenta acá de forma explícita y centralizada, como pedía el objetivo 4 de 10C.

| Responsable | Qué decide | Qué NO decide |
|---|---|---|
| **`WorkRegime`** (Régimen laboral) | Si se debe alertar cuando un empleado ficha sin turno compatible (`alertOnOutOfShift`); qué hacer cuando una jornada abierta excede el límite absoluto — cerrar en 0h o dejar para revisión (`openShiftOverflowAction`) | No decide horarios concretos, no decide tolerancias, no calcula horas, no decide `JORNADA_EXTENDIDA` (brecha conocida, §12) |
| **`ShiftTemplate`/`ShiftAssignment`** (Turno) | Horario concreto esperado (`startTime`/`endTime`/`crossesMidnight`), tolerancias de entrada/salida, umbral informativo de duración (`maximumInformativeMinutes`), umbral de aviso de olvido (`missingOutAlertAfterMinutes`), límite absoluto de jornada abierta (`absoluteOpenShiftLimitMinutes`) | No decide si alertar o no — sólo provee los umbrales; la decisión de "alertar sí/no" para el caso "sin turno" vive en régimen |
| **Fichador** (`TimeClockPage`/`timeEntries.service.ts`) | Registra el hecho real (`startAt`/`endAt`), nunca inventa ni estima horas | No decide alertas — sólo dispara la evaluación (`evaluateShiftEntry`/`evaluateShiftExit`) después de persistir el hecho real |
| **Motor de evaluación** (`workShiftEvaluationRunner.ts`) | Decide qué `ShiftAlert` corresponde, consultando régimen sólo para las 3 alertas "fuera de turno" (`isOutOfShiftAlertSuppressed`); resuelve el ciclo de vida de `POSIBLE_OLVIDO_SALIDA` al cerrar una jornada (10B) | No inventa horas, no cierra jornadas, no decide `openShiftOverflowAction` (eso lo hace `timeEntries.repository.ts`/`timeEntries.service.ts`, consultando régimen directamente) |
| **`SystemNotification`** | Sólo entrega — nunca decide nada de negocio; su contenido deriva de lo que `ShiftAlert`/`WorkShift` ya decidieron | No tiene lógica propia, no debe tenerla nunca (confirmado en 10A/10B, reconfirmado acá) |

**Regla de precedencia cuando régimen y turno "compiten"**: no compiten — gobiernan dimensiones distintas. El turno decide horario/tolerancias; el régimen decide si esas 3 alertas puntuales de "fuera de turno" se notifican o no. Ningún camino de código permite que el turno anule una decisión de régimen ni viceversa (confirmado en 10A §8, sin cambios en 10C).

## 4. Flujo de entrada/salida

**Entrada (clock-in)**: se crea el `WorkShift` (`status: ABIERTO`) inmediatamente, sin esperar a saber si hay turno compatible. Recién después de persistir la jornada corre `evaluateShiftEntry` — matchea contra `ShiftAssignment`/`ShiftTemplate`, decide si corresponde alguna de `TURNO_NO_IDENTIFICADO`/`SHIFT_NOT_ENABLED_FOR_EMPLOYEE`/`POSSIBLE_SHIFT_CONFIGURATION_MISSING`/`INGRESO_TARDE`/`DESCANSO_INSUFICIENTE` (con la supresión por régimen aplicando sólo a las 3 primeras).

**Salida (clock-out)**: se calculan minutos/segmentos reales entre `startAt` y `endAt` real. Después de persistir el cierre corre `evaluateShiftExit` — que **ahora, desde 10B, primero resuelve cualquier `POSIBLE_OLVIDO_SALIDA` pendiente de esa jornada** (§6), y después evalúa `SALIDA_ANTICIPADA`/`SALIDA_TARDIA`/`JORNADA_INSUFICIENTE`/`JORNADA_EXTENDIDA`. El turno nunca se usa para calcular las horas en sí, sólo para comparar contra lo esperado.

## 5. Flujo de jornada abierta

Dos umbrales, evaluados por caminos separados:
- **`missingOutAlertAfterMinutes`** (aviso temprano) — evaluado por `checkMissingOutRisk` (`openShiftMonitor.service.ts`), corrida periódica que sólo mira jornadas `ABIERTO` y **excluye explícitamente** las que ya están en nivel `EXPIRED` (`if (risk.level !== "MISSING_OUT") continue`) — confirmado con test nuevo (§15). Si corresponde, crea `POSIBLE_OLVIDO_SALIDA` (severidad `ADVERTENCIA` por defecto) + notificación `ALERTA_FICHADA`.
- **`absoluteOpenShiftLimitMinutes`** (límite duro) — evaluado en `expireOpenWorkShifts`/al intentar un nuevo ingreso; ver §6.

## 6. Flujo de auto-expiración

`expireOpenWorkShifts` (`timeEntries.repository.ts`), corrida periódica. Para cada jornada que supera el límite absoluto: resuelve el régimen vigente del empleado — `ALERT_ONLY` → no cierra, marca con `flagOpenShiftOverflowForReview` (alerta crítica, jornada sigue abierta); si no (default `ROLLOVER`/sin régimen) → cierra con `hours: 0` explícito, `status: FALTA_SALIDA`, y **desde 10B, resuelve automáticamente cualquier `POSIBLE_OLVIDO_SALIDA` pendiente de esa jornada** (`resolveOpenShiftOverflowAlert`, best-effort, nunca bloquea el cierre). Nunca inventa una hora de salida.

## 7. Flujo de rollover

`rolloverExpiredOpenWorkShift` (`timeEntries.repository.ts`) — se dispara cuando llega un nuevo ingreso mientras la jornada previa sigue abierta y excedida, y el régimen permite rollover (no `ALERT_ONLY`). Cierra la jornada vieja en `FALTA_SALIDA`/0h, crea la nueva jornada, y **desde 10B, resuelve cualquier `POSIBLE_OLVIDO_SALIDA` pendiente de la jornada vieja** — mismo criterio que §6, sin dejarla huérfana.

## 8. Reglas para turnos nocturnos

- Todo cálculo de horario esperado (salida, riesgo de olvido) pasa por `scheduledInstantForShiftTime(reference, time, crossesMidnight)` — único punto del código que suma un día calendario cuando corresponde. No hay una segunda implementación de este cálculo en ningún otro archivo (verificado por grep).
- El matching de turno (¿a qué plantilla pertenece esta fichada?) busca la ocurrencia más cercana entre ayer/hoy/mañana (`closestOccurrence`), por lo que una entrada a las 23:05 no depende de si el turno cruza medianoche — sólo importa para calcular la **salida** esperada.
- `totalMinutes` (para `JORNADA_INSUFICIENTE`/`JORNADA_EXTENDIDA`) es tiempo real transcurrido, sin ninguna lógica especial de medianoche — no hay riesgo de doble conteo ni de horas "perdidas" en el cruce de día.
- Verificado explícitamente con tests nuevos de integración (§15): entrada nocturna matchea sin alertas falsas, salida real en horario no genera nada, jornada nocturna extendida de verdad genera `JORNADA_EXTENDIDA` (nunca `POSIBLE_OLVIDO_SALIDA`), y una salida real siempre resuelve cualquier aviso de olvido previo de esa misma jornada.
- **No se encontró ningún caso especial hardcodeado para "sereno"** a nivel de evaluación de turno — es un turno más, con `crossesMidnight: true` como cualquier otro. Esto es correcto: no hace falta una regla especial, el mecanismo genérico ya lo cubre.

## 9. Reglas para empleados sin turno (y separación con Conceptos Horarios/Horas Especiales)

- Un empleado sin ningún `ShiftAssignment` matcheado usa el fallback `DEFAULT_MAXIMUM_INFORMATIVE_MINUTES = 600` para `JORNADA_EXTENDIDA`, y genera `TURNO_NO_IDENTIFICADO` en cada ingreso — salvo que su régimen vigente tenga `alertOnOutOfShift=false` (10A/10B). Confirmado sin cambios en 10C.
- La función `hasNoShiftAssignments()` (`workShiftEvaluation.service.ts:109-111`) sigue existiendo pero **sigue sin usarse en ningún flujo de producción** (código muerto, ya señalado en 10A) — no se activó ni se eliminó en esta etapa (no estaba en el alcance permitido).
- **Verificación explícita pedida por esta etapa — separación con Conceptos Horarios/Horas Especiales**: `"SERENO"`/`"NOCTURNA"`/`"GUARDIA"` también existen como valores de `HourConceptKind` (`hourConcepts.schemas.ts:3-4`), usados en `timeEntries.repository.ts:150` (`NIGHT_HOUR_CONCEPT_KINDS`) para derivar un flag `isNight` en la clasificación de segmentos para exportación/liquidación (líneas 1538-1556, 1719-1737 de ese archivo). **Es un sistema completamente distinto y desacoplado**: no hay ninguna función compartida, ninguna importación cruzada, ni ningún dato compartido entre este clasificador de conceptos horarios y el motor de evaluación de `ShiftAlert` (`workShiftEvaluationRunner.ts`/`workShiftEvaluation.service.ts`). El primero decide cómo se liquida un segmento ya trabajado; el segundo decide si hay que avisar algo sobre el turno/jornada. El sistema **no interpreta automáticamente "sereno" como hora especial ni como alerta** — cada uno vive en su propio módulo, sin mezcla. No se tocó ningún archivo de `hour-concepts`/Horas Especiales en esta etapa; se corrió su suite de tests como parte de la corrida completa del backend (§16) para confirmar que nada se rompió.

## 10. Decisión sobre notificaciones duplicadas

Re-analizado con evidencia nueva (10B ya había llegado a la misma conclusión; acá se agrega un test de integración que no existía, ver §15):

1. **Aviso temprano** (`ALERTA_FICHADA`, desde `checkMissingOutRisk`): se dispara cuando la jornada supera `missingOutAlertAfterMinutes` — todavía `ABIERTO`. Título: el label del tipo de alerta (ej. "Posible olvido de salida"). Mensaje: *"La fichada requiere seguimiento. Las horas no fueron modificadas automáticamente."*
2. **Aviso definitivo** (`FALTA_SALIDA`, desde `notifyMissingExit`): se dispara cuando la jornada supera el límite absoluto y se cierra. Título: *"Falta registrar la salida"*. Mensaje: *"La jornada venció sin salida registrada y requiere revisión."*
3. **¿Ocurren en momentos distintos?** Sí, siempre — confirmado ahora con test explícito (`openShiftMonitor.service.test.ts`, "nunca evalúa una jornada EXPIRED"): `checkMissingOutRisk` excluye por código cualquier jornada en nivel `EXPIRED`, así que nunca se solapa con el cierre de `expireOpenWorkShifts` en la misma corrida.
4. **¿Llegan al mismo destinatario?** Sí — ambas usan `attendanceRecipients()` (RRHH + responsable de asistencia del empleado).
5. **¿El copy permite entender la diferencia?** Parcialmente — el contenido es preciso y no contradictorio ("posible olvido" vs. "venció y requiere revisión"), pero ninguna de las dos referencia a la otra explícitamente como parte del mismo incidente evolutivo.
6. **¿La segunda debería reemplazar/resolver la primera?** Es exactamente lo que ya hace el fix de 10B a nivel de `ShiftAlert` (la alerta subyacente pasa a `RESUELTA`) — pero a nivel de `SystemNotification` no hay ningún vínculo entre ambas hoy (son filas independientes, `entityType` distinto: `ShiftAlert` vs. `WorkShift`).
7. **¿La primera debería ser sólo alerta interna, no notificación externa?** Es una opción real y válida (dejar `POSIBLE_OLVIDO_SALIDA` visible sólo en `/turnos/alertas`, sin push a la campanita) — pero cambia lo que hoy ve el usuario final, es una decisión de producto.
8. **¿Se debe mantener ambas por trazabilidad?** Sí — son dos hechos de negocio genuinamente distintos en el tiempo (riesgo detectado vs. jornada efectivamente vencida): mantener ambas conserva la traza completa del incidente.

**Recomendación (no implementada, no requiere aprobación por ser "no tocar"): mantener el comportamiento actual.** No es una duplicación por error — es una secuencia de dos avisos legítimos sobre la evolución de un mismo problema, con copy ya distinguible y sin superposición temporal posible. Si en el futuro se quiere reducir el ruido percibido, las dos alternativas concretas (silenciar el aviso temprano fuera de `/turnos/alertas`, o vincular ambas notificaciones para que la definitiva se muestre como "actualización" de la temprana) quedan documentadas para una decisión de producto explícita, no se implementan acá.

## 11. Qué se corrigió en esta etapa

- **Nada de comportamiento en producción** — 10C fue diagnóstica + de cobertura de tests, por decisión explícita del usuario (diferir la única corrección de comportamiento posible, la configurabilidad de `JORNADA_EXTENDIDA` por régimen).
- Se agregaron 10 tests nuevos que cierran huecos de cobertura reales (no bugs, huecos de verificación) identificados por esta etapa: comportamiento de `checkMissingOutRisk` a nivel de integración (nunca tenía tests propios — 6 tests nuevos, archivo nuevo `openShiftMonitor.service.test.ts`) y comportamiento nocturno/sereno de `JORNADA_EXTENDIDA`/ciclo de vida de alertas a nivel de integración (4 tests nuevos en `workShiftEvaluationRunner.test.ts`).

## 12. Qué quedó pendiente

- **`JORNADA_EXTENDIDA` configurable por régimen** — el usuario, consultado explícitamente, decidió diferir esta decisión a una etapa futura dedicada, en vez de elegir entre reusar `alertOnOutOfShift` (sin schema, pero estira su significado) o agregar un campo numérico nuevo en `WorkRegime` (mejor semántica, requiere migración). Sigue siendo el pendiente central para que el caso de negocio de cosecha/pañol quede 100% resuelto.
- Notificaciones duplicadas — confirmado que no es un bug, recomendado mantener tal cual (§10); las 2 alternativas de reducir ruido quedan documentadas, no implementadas.
- Los 3 campos muertos de `ShiftTemplate` (`warningThresholdMinutes`/`reviewThresholdMinutes`/`criticalThresholdMinutes`) — sin cambios, siguen siendo deuda ya conocida desde 10A.
- `hasNoShiftAssignments()` — sigue siendo código muerto, no se activó ni se eliminó (fuera del alcance explícito de esta etapa).

## 13. Qué NO se tocó

- Ninguna regla de cálculo de horas reales del fichador.
- Ningún archivo de `hour-concepts`/Conceptos Horarios ni de Horas Especiales (`workforce-management`'s `DoubleHourRule`) — sólo se verificó, vía grep y corriendo su suite de tests, que la separación con Turnos/Alertas se mantiene intacta.
- Ningún campo de `WorkRegime`/`ShiftTemplate` — sin agregar, sin quitar, sin cambiar significado.
- `alertOnOutOfShift`/`openShiftOverflowAction` — sin cambios de significado ni de consumidores.
- Ningún schema, ninguna migración.
- Ninguna UI — no se tocó ningún archivo de frontend en esta etapa.
- Permisos — sin cambios.

## 14. Riesgos

- La brecha de `JORNADA_EXTENDIDA` (§12) sigue sin resolver — mientras no se implemente, un empleado de cosecha/pañol bien configurado en régimen sigue recibiendo un aviso informativo (`INFO`, no crítico) en jornadas largas legítimas. Es una molestia de UX documentada, no un error de datos ni de liquidación.
- El diagnóstico de esta etapa es de lectura de código + tests nuevos — no se midió comportamiento en producción ni volumen real de alertas nocturnas/sereno.
- `hasNoShiftAssignments()` sigue siendo código muerto — riesgo ya señalado en 10A de que alguien lo active más adelante sin saber que el mecanismo real es el régimen.

## 15. Tests agregados

Backend (+10 tests, total 755):
- `openShiftMonitor.service.test.ts` (+6, **archivo nuevo** — `checkMissingOutRisk` no tenía cobertura propia): genera `POSIBLE_OLVIDO_SALIDA` sólo en nivel `MISSING_OUT` (no en `NORMAL`); lo genera correctamente al cruzar el umbral; **nunca evalúa una jornada `EXPIRED`** (evidencia central de que no hay duplicación posible con `expireOpenWorkShifts`); no duplica si ya existe la alerta; turno nocturno sin llegar a la salida esperada no genera falsa alerta; turno nocturno que sí se pasó de la salida esperada genera la alerta correctamente.
- `workShiftEvaluationRunner.test.ts` (+4, nuevo describe "Etapa 10C — turno nocturno/sereno"): entrada nocturna matchea sin alertas falsas; salida real en horario nocturno no genera ninguna alerta de puntualidad ni `JORNADA_EXTENDIDA`; jornada nocturna extendida de verdad genera `JORNADA_EXTENDIDA` y nunca `POSIBLE_OLVIDO_SALIDA`; una salida real resuelve cualquier `POSIBLE_OLVIDO_SALIDA` previa de esa jornada, incluso en turno nocturno.

No se tocó frontend — sin tests de frontend en esta etapa.

## 16. Validaciones ejecutadas

Backend: `npx prisma validate` ✅, `npx prisma generate` ✅, `npx prisma migrate status` ✅ (45 migraciones, sin cambios — ninguna migración nueva), `npm run typecheck` ✅, `npx vitest run` ✅ 755/755 (incluye toda la suite de `hour-concepts`/Horas Especiales, sin regresiones), `npm run build` ✅.
Frontend: no se tocó ningún archivo — validaciones de frontend no aplicables a esta etapa (regla "si se toca frontend").
General: `git diff --check` sin errores de espacios en blanco.

## 17. Confirmaciones explícitas

- **Sin schema ni migraciones**: confirmado — la decisión de producto que hubiera requerido schema (campo nuevo en `WorkRegime`) fue explícitamente diferida por el usuario.
- **Sin librerías nuevas**: confirmado.
- **Sin cambios de reglas de carga horaria**: confirmado — `totalMinutes`/cálculo de horas no se tocó en ningún punto.

## 18. Aprobación pendiente

No commitear sin aprobación explícita del usuario.
