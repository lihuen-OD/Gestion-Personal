# Etapa 12A — Clasificación de Horas Especiales para calendario de feriados y asignaciones futuras

Fecha: 2026-08-31
Estado: diagnóstico + diseño — sin implementar, pendiente de aprobación para 12B+
Continúa: `docs/decisions/HORAS_ESPECIALES_AUDITORIA_8A.md`, `docs/decisions/HORAS_ESPECIALES_8B.md`, `docs/decisions/HOURS_GRID_REVIEW_SPECIAL_HOURS_AUDIT_11A.md`, `docs/decisions/HOURS_GRID_SPECIAL_HOURS_LIQUIDABLE_11A1.md`, `docs/decisions/HOURS_REVIEW_EXPORT_CLOSURE_SPECIAL_HOURS_11B.md`, `docs/decisions/HOURS_REVIEW_PERSON_SPECIAL_HOURS_11C.md`, `docs/decisions/WORK_REGIME_SHIFT_ALERTS_10D.md`, `docs/decisions/ATTENDANCE_SHIFT_ALERTS_NOTIFICATIONS_AUDIT_10E.md`

## 0. Documentos leídos

`HORAS_ESPECIALES_AUDITORIA_8A.md`, `HORAS_ESPECIALES_8B.md`, `HOURS_GRID_REVIEW_SPECIAL_HOURS_AUDIT_11A.md`, `HOURS_GRID_SPECIAL_HOURS_LIQUIDABLE_11A1.md`, `HOURS_REVIEW_EXPORT_CLOSURE_SPECIAL_HOURS_11B.md`, `HOURS_REVIEW_PERSON_SPECIAL_HOURS_11C.md`, `WORK_REGIME_SHIFT_ALERTS_10D.md`, `ATTENDANCE_SHIFT_ALERTS_NOTIFICATIONS_AUDIT_10E.md`, `docs/PERFORMANCE_STANDARDS.md`, `CLAUDE.md`, `AGENTS.md`. Más lectura directa de código: `schema.prisma` (`DoubleHourRule`, `SpecialHourRuleDate`, `SpecialHourRuleApplication`, `TimeSegment`, `HourConcept`/`HourConceptKind`, `ShiftTemplate`, `ShiftAssignment`, `WorkRegime`), `doubleHourRuleMatching.ts` completo, `workforce.service.ts` (`calendarPreview`, `createDoubleRule`, `updateDoubleRule`, `removeDoubleRule`), `workforce.schemas.ts` (`doubleRuleSchema`, `updateDoubleRuleSchema`, `calendarRangeQuerySchema`), `WorkScheduleSettingsPage.tsx`, `attendanceInactivity.service.ts` (`detectAttendanceInactivity`), y grep exhaustivo de `rule.name`/`"feriado"` en todo `backend/src` y `frontend/src` (código de producción y de tests).

## 1. Resumen ejecutivo

Hoy no existe ninguna forma de saber, de manera estructurada, qué fechas de una regla de Hora Especial (`DoubleHourRule`) son un feriado real — sólo existe el nombre libre que carga RRHH (`name: String`), que puede estar mal escrito, en otro idioma, o no describir nada en absoluto ("Pedro"). El motor de cálculo real (`doubleHourRuleMatching.ts`) confirmadamente **nunca** usa ese nombre para decidir nada — sólo lo usa para mostrarlo en pantalla — lo cual es correcto y no se debe cambiar. El problema es que, para construir a futuro una pantalla de Turnos que muestre "quién debía trabajar tal feriado", hace falta poder filtrar "cuáles de estas reglas/fechas son feriado" sin adivinar por texto. Se agrega un campo estructurado (`DoubleHourRule.kind`, enum `DoubleHourRuleKind`) que clasifica la regla completa como `FERIADO | DOMINGO | JORNADA_ESPECIAL | OTRO`, con default seguro `OTRO` para no adivinar reglas existentes por nombre. Esta etapa es sólo diagnóstico y diseño: no se tocó `schema.prisma`, no se creó ninguna migración, no se modificó código de backend/frontend/tests, no se commiteó nada.

## 2. El problema

El admin de RRHH puede nombrar una regla de Hora Especial con cualquier texto libre. Ejemplos reales posibles: "Feriados", "Feriadtos" (typo), "Pedro" (sin relación semántica), "Feriado Nacional". Cualquier lógica que intente inferir "esto es un feriado" a partir de ese texto (`rule.name.includes("feriado")`, comparación case-insensitive, etc.) se rompe silenciosamente ante un typo, un idioma distinto, un nombre libre sin relación, o un cambio futuro de convención — exactamente el tipo de bug que no aparece en ningún test porque el dato "parece" correcto hasta que alguien escribe el nombre distinto. El sistema necesita, en cambio, un campo de datos explícito que RRHH setea a propósito, independiente de cómo decida nombrar la regla.

## 3. Por qué no usar el nombre de la regla

- **Texto libre sin validación semántica**: `name: String` en `doubleRuleBaseSchema` (`workforce.schemas.ts`) no tiene ningún enum ni whitelist — cualquier string pasa.
- **El propio motor de matching ya evita este error**: confirmado por lectura completa de [doubleHourRuleMatching.ts](../../backend/src/modules/workforce-management/doubleHourRuleMatching.ts) — `ruleMatchesDate`, `resolveWinningRules` y `scopesCouldOverlap` sólo leen `recurrenceType`/`fromDate`/`toDate`/`weekdays`/`dates`/`priority`/`multiplier`/scope. Ninguna de estas tres funciones puras recibe ni lee `name`.
- **Grep exhaustivo de todo el repo**: los únicos usos de `rule.name`/`doubleHourRule.name` en backend son de presentación — [workforce.service.ts:338](../../backend/src/modules/workforce-management/workforce.service.ts#L338) (`rules: matched.map((rule) => ({ ..., name: rule.name, ... }))`, respuesta del calendario) y [timeEntries.repository.ts:1975](../../backend/src/modules/time-entries/timeEntries.repository.ts#L1975) (texto de observación: `` `Reglas aplicadas: ${matchedRules.map(r => r.name).join(", ")}...` ``). En frontend, sólo aparece en el input del formulario y en la columna de la tabla de [WorkScheduleSettingsPage.tsx](../../frontend/src/pages/WorkScheduleSettingsPage.tsx). Cero apariciones de `.includes("feriado")`, `.toLowerCase()` sobre el nombre, ni ninguna comparación de texto usada para tomar una decisión de negocio, en ningún archivo de producción de todo el repo.
- **Nombres legacy y multi-idioma**: la única regla real en producción se llama "Domingo" (confirmado por la auditoría 8B) — un `SEMANAL`, no un feriado. Cualquier heurística de texto que buscara "feriado" no la habría tocado, pero tampoco hay garantía de que la próxima regla real se llame de forma predecible.
- **Cambios futuros de convención**: si mañana RRHH decide nombrar las reglas de otra forma (por ejemplo, por número de decreto en vez de "Feriado"), cualquier lógica basada en texto se rompe sin ningún error visible — el multiplicador seguiría aplicando bien (el motor no lo toca), pero cualquier consumidor nuevo que dependiera del nombre fallaría en silencio.

## 4. Diagnóstico actual (con evidencia de código)

### 4.1 Modelo actual de `DoubleHourRule`

[schema.prisma:1246-1287](../../backend/prisma/schema.prisma#L1246):

| Campo | Tipo | Rol |
|---|---|---|
| `name` | `String` | Texto libre visible — **no estructurado, no usado en lógica**. |
| `recurrenceType` | `FECHA \| RANGO \| SEMANAL` | Cómo se resuelve la vigencia/fechas de la regla. |
| `fromDate`/`toDate` | `DateTime` | Vigencia gruesa (SEMANAL/RANGO) o rango de filtrado previo (FECHA). |
| `weekdays` | `Int[]` | Días de semana, sólo para `SEMANAL`. |
| `dates` | `SpecialHourRuleDate[]` | Fechas explícitas togglables, sólo para `FECHA` (Etapa 8B). |
| `multiplier` | `Decimal` | Cuánto vale trabajar ese día — liquidación. |
| `priority` | `Int` | Desempate de superposición (Etapa 8B). |
| `companyId`/`sectorId`/`costCenterId`/`positionId` | `String?` | Alcance opcional, AND entre dimensiones (Etapa 8B). |
| `status` | `RecordStatus` | Activo/inactivo. |
| `reason` | `String` | Motivo obligatorio, texto libre. |

**No existe ningún campo que permita saber si una regla es feriado, domingo, día especial u otro.** No hay `Holiday`, no hay `isHoliday` en este modelo, no hay ningún enum de clasificación.

### 4.2 Recurrencia y fechas — cómo se representan hoy

- **Fecha única/múltiple (feriados)**: `recurrenceType = FECHA` + filas en `SpecialHourRuleDate` ([schema.prisma:1302-1313](../../backend/prisma/schema.prisma#L1302)) — una sola regla puede agrupar muchas fechas (ej. "Feriados 2026" con 15 fechas), cada una togglable (`isActive`) sin perder historial. Sin límite de cantidad salvo `.max(500)` en Zod.
- **Reglas semanales (Domingo)**: `recurrenceType = SEMANAL` + `weekdays: [0]` + `fromDate`/`toDate` de vigencia — sin necesidad de cargar fecha por fecha. **Estas reglas nunca tienen filas en `SpecialHourRuleDate`** — sus fechas se calculan al vuelo contra `fromDate`/`toDate`/`weekdays` en `ruleMatchesDate`.
- **Reglas por rango**: `recurrenceType = RANGO` — cualquier día dentro de `fromDate`/`toDate`, sin filtro de día de semana. Tampoco usan `SpecialHourRuleDate`.

### 4.3 Campo estructurado existente hoy: ninguno

Confirmado: no hay ningún campo en `DoubleHourRule` que distinga feriado/domingo/día especial/otro. El único campo con un nombre sugerente en todo el schema es `TimeSegment.isHoliday` ([schema.prisma:1415](../../backend/prisma/schema.prisma#L1415)) — pero es de **otro modelo** (fichadas reales, no reglas) y está **muerto**: existe en el schema con `@default(false)`, se selecciona en queries, pero ningún archivo del repo escribe `isHoliday: true` en ningún punto (confirmado por grep, deuda ya documentada desde la auditoría 8A). No tiene relación con esta etapa — es sobre `TimeSegment`, no sobre `DoubleHourRule`.

### 4.4 Frontend — ¿muestra alguna categoría hoy?

No. [WorkScheduleSettingsPage.tsx](../../frontend/src/pages/WorkScheduleSettingsPage.tsx) muestra únicamente el nombre libre (`rule.name`, input con placeholder "Ej: Domingo, Feriado") — no hay ningún selector de tipo/categoría, ni columna de clasificación en la tabla de reglas.

### 4.5 Backend — ¿usa el nombre para alguna lógica?

No, confirmado exhaustivamente (ver §3). El backend usa exclusivamente `recurrenceType`/fechas/`weekdays`/`priority`/`multiplier`/scope para decidir si una regla aplica y cuál gana.

### 4.6 Tests que dependan del nombre "Feriado"

Ninguno depende del nombre para *lógica* de assert. `"Feriado"` aparece como valor de fixture en varios tests (`workforce.controller.test.ts:202`, `workforce.service.test.ts:327,347,377,382,394,399`, `timeEntries.repository.test.ts:305,1133,1593,1606,1699,1745`, `timeEntries.service.test.ts:967`) — siempre como dato de ejemplo (`name: "Feriado"`), nunca como condición que el test verifique comparando contra ese string para decidir comportamiento. Ningún test se rompería si esas mismas reglas se llamaran "Pedro".

### 4.7 Calendario visual — endpoint y filtrado actual

`GET /workforce/double-hour-rules/calendar?from&to` → [workforce.service.ts:317-344](../../backend/src/modules/workforce-management/workforce.service.ts#L317) (`calendarPreview`). Recorre día por día el rango pedido, filtra reglas `status: ACTIVO` vigentes por `fromDate`/`toDate`, aplica `ruleMatchesDate` por día, y devuelve `{date, rules: [{id, name, priority, multiplier}], hasOverlap, hasConflict}`. Validado por `calendarRangeQuerySchema` (rango máximo 400 días). **Hoy no puede filtrar por tipo de regla porque el campo no existe.**

### 4.8 Riesgo de romper Horas Especiales existentes / reglas legacy sin clasificación

Riesgo de romper el motor: **nulo**, si el campo nuevo no se lee en `doubleHourRuleMatching.ts` (que es exactamente lo que este diseño propone — ver §7). Reglas legacy: según la auditoría 8B, sólo existe **1** `DoubleHourRule` real en la base de producción ("Domingo", `SEMANAL`). Con un `DEFAULT` seguro en la migración (ver §7.2), esa fila (y cualquier otra futura sin clasificar) queda automáticamente en un valor neutro, sin que nadie tenga que adivinar nada por nombre.

### 4.9 Impacto en el resto del flujo (grilla, detalle, bandeja, export, fichador, carga manual, motor)

Ninguno, porque el campo propuesto es puramente informativo/de filtro para el propio módulo de Horas Especiales y para un futuro consumidor de Turnos — no participa del cálculo de multiplicador, no se lee en `createFromWorkShift`/`closeOpenWorkShift`/carga manual/`findPeriodEmployees`/`buildAdditiveTimeGrid`/bandeja/export (Etapas 11A-11C), y no se toca ninguno de esos archivos en este diseño.

## 5. Opciones evaluadas

### Opción A — Enum `kind: DoubleHourRuleKind` en `DoubleHourRule` (recomendada)

**Pros**: clasificación estructurada explícita y extensible; migración aditiva de una sola sentencia (mismo molde que `priority` en 8B); filtro `WHERE kind = 'FERIADO'` alcanza para alimentar la futura pantalla de Turnos sin joins ni sincronización; sigue la convención ya usada dos veces en este mismo schema (`HourConcept.kind`/`HourConceptKind`, `WorkRegime.kind`/`WorkRegimeKind`).
**Contras**: agrega un campo más al formulario (costo de UX menor, mitigado con copy claro).
**Migración/backfill**: `NOT NULL DEFAULT 'OTRO'` en la misma sentencia — Postgres backfillea automáticamente sin script separado, sin adivinar por nombre.
**Impacto UI**: un `<select>` nuevo en el formulario existente + badge en la tabla — no reemplaza nada.
**Impacto endpoints**: `kind` viaja como campo más en create/update/calendario; `calendarPreview` gana un filtro opcional — 100% aditivo.
**Impacto tests**: sólo tests nuevos, ninguno existente se rompe (el campo tiene default, nada obliga a mandarlo).
**¿Alcanza para la futura pantalla de asignaciones?** Sí — el filtro `kind=FERIADO` es exactamente lo que esa pantalla necesitaría consultar.

### Opción B — Boolean `useForHolidayAssignments`

**Pros**: mínimo cambio de schema, gate binario simple.
**Contras**: semánticamente pobre frente al pedido explícito de "campo ESTRUCTURADO de clasificación" — sólo distingue feriado/no-feriado, no puede expresar "esto es un Domingo" (que no es ni feriado ni "otro sin clasificar", es su propia categoría con semántica clara). Acopla el modelo de Horas Especiales al nombre de un consumidor que todavía no existe (Turnos) en vez de modelar el dato en sus propios términos.
**Riesgo de ambigüedad**: alto — un futuro caso que quiera distinguir "Domingo" de "Jornada especial" en un reporte o en la propia UI de calendario no tendría dónde guardarlo, forzando una segunda migración.
**¿Conviene?** No — pierde información sin ahorrar complejidad real frente a la Opción A.

### Opción C — Entidad separada `HolidayCalendar`

**Pros**: aislaría el concepto de "feriado" de la configuración de liquidación.
**Contras**: duplicaría exactamente el calendario que `DoubleHourRule`/`SpecialHourRuleDate` ya resuelve bien (SEMANAL/RANGO/FECHA + scope + prioridad, Etapa 8B) — dos fuentes de fechas que pueden desincronizarse (¿qué pasa si una fecha está en `HolidayCalendar` pero la regla de Hora Especial correspondiente se borra o cambia de vigencia?). Exigiría su propio CRUD, sus propios permisos, su propia UI.
**Riesgo de inconsistencia**: real y alto — es exactamente el riesgo que la regla 5 del pedido prohíbe explícitamente ("no duplicar calendario de feriados en Turnos").
**¿Conviene evitarlo por ahora?** Sí, sin ninguna duda — no hay ninguna razón técnica (volumen, ciclo de vida, permisos) que justifique separar esta clasificación de su dueño natural (`DoubleHourRule`).

### Opción D — Detectar por nombre (descartada)

Confirmado por el propio código (§3): ni el motor real de matching lo hace hoy. Razones para descartar, todas confirmadas contra evidencia real de este proyecto: nombres mal escritos ("Feriadtos"), nombres libres sin relación semántica ("Pedro"), la única regla real hoy se llama "Domingo" y no "Feriado", cambios futuros de convención de nombres, datos legacy, inconsistencia entre mayúsculas/idioma, y el riesgo central del pedido: bugs silenciosos que no aparecen en ningún test hasta que alguien escribe el nombre distinto.

## 6. Recomendación final

**Opción A**, confirmada con el usuario en cuanto a naming (español, siguiendo la convención ya vigente en el schema — ver §7.1):

1. No duplicar calendario de feriados en Turnos — se descarta la Opción C.
2. Horas Especiales sigue siendo la fuente única de fechas especiales/liquidables.
3. Se agrega un campo estructurado en `DoubleHourRule`: `kind: DoubleHourRuleKind` (`FERIADO | DOMINGO | JORNADA_ESPECIAL | OTRO`).
4. Sólo las reglas con `kind = FERIADO` alimentarían la futura pantalla de asignaciones de feriado en Turnos.
5. El nombre de la regla queda sólo como texto visible — no se usa para lógica en ningún punto de este diseño.
6. Las reglas existentes (hoy, sólo "Domingo") quedan en `OTRO` automáticamente por el `DEFAULT` de la migración — nunca inferidas por nombre; requieren una acción explícita de RRHH desde la UI para reclasificarse.
7. La UI permite editar esa clasificación en el mismo formulario ya existente.

## 7. Modelo propuesto

### 7.1 Campo y enum exactos

- **Modelo**: `DoubleHourRule`, junto a `priority`/`status`.
- **Campo**: `kind` — sigue la convención ya usada por `HourConcept.kind: HourConceptKind` ([hourConcepts.schemas.ts:3](../../backend/src/modules/hour-concepts/hourConcepts.schemas.ts#L3)) y `WorkRegime.kind: WorkRegimeKind` ([schema.prisma:1151](../../backend/prisma/schema.prisma#L1151)) — mismo patrón `<Modelo>Kind`, valores de vocabulario de negocio en español, en vez de introducir un campo nuevo (`specialDayKind`) con valores en inglés.
- **Enum**: `DoubleHourRuleKind`, valores `FERIADO | DOMINGO | JORNADA_ESPECIAL | OTRO`.
  - `FERIADO` — feriado real; único valor que alimentaría la futura pantalla de Turnos.
  - `DOMINGO` — premium semanal dominical; permite reclasificar correctamente la única regla real hoy ("Domingo") sin forzarla a un cajón genérico.
  - `JORNADA_ESPECIAL` — jornada especial no feriado (equivalente a "día especial laboral"): un día puntual con premium que RRHH quiere distinguir en reportes/calendario, pero que no debe alimentar la futura asignación de feriados.
  - `OTRO` — catch-all y **default seguro**.
- **Nullable/default**: `NOT NULL DEFAULT 'OTRO'`. Se prefiere sobre nullable porque acá no hay una cadena de fallback de 3 niveles (a diferencia de `WorkRegime.extendedShiftAlertMinutes`, Etapa 10D) — un valor plano con default seguro es más simple y evita la ambigüedad "¿`null` es lo mismo que `OTRO`?".

### 7.2 Migración propuesta (diseño — no ejecutada en esta etapa)

```sql
CREATE TYPE "DoubleHourRuleKind" AS ENUM ('FERIADO', 'DOMINGO', 'JORNADA_ESPECIAL', 'OTRO');
ALTER TABLE "DoubleHourRule" ADD COLUMN "kind" "DoubleHourRuleKind" NOT NULL DEFAULT 'OTRO';
```

Mismo molde que la migración de la Etapa 8B (`priority INTEGER NOT NULL DEFAULT 0` agregada directamente sobre esta misma tabla, sin backfill separado). El `DEFAULT` en la misma sentencia deja automáticamente todas las filas existentes (incluida "Domingo") en `OTRO` — sin ningún script de adivinanza por nombre.

### 7.3 Nivel de clasificación: por regla completa, no por fecha individual

Evaluado explícitamente si convendría clasificar por `SpecialHourRuleDate` en vez de por `DoubleHourRule` completa (dado que una regla FECHA puede agrupar muchas fechas, ej. "Feriados 2026" con 15 fechas). Se descarta clasificar por fecha individual:

1. **Asimetría estructural real**: `SpecialHourRuleDate` sólo existe para `recurrenceType = FECHA` — las reglas `RANGO`/`SEMANAL` (incluida "Domingo") nunca tienen filas ahí. Clasificar sólo a nivel de fecha dejaría sin dónde clasificarse a cualquier regla `SEMANAL`/`RANGO`, obligando de todas formas a un campo de fallback a nivel de regla — terminaría en un modelo híbrido para resolver un caso sin evidencia real hoy.
2. **Sin evidencia de necesidad real**: hoy existe una sola regla real en producción ("Domingo", `SEMANAL`, cero filas en `SpecialHourRuleDate`). No hay ningún caso confirmado de una regla FECHA que mezcle fechas de distinta naturaleza (ej. feriado real + fecha especial no feriado) bajo el mismo multiplicador. La convención ya vigente en el sistema para ese caso es abrir una regla nueva (mismo criterio que ya se usaría para separar multiplicadores distintos), no partir una regla existente por fecha.
3. **Costo vs. beneficio**: clasificar por fecha exige una columna nueva en `SpecialHourRuleDate`, UI de edición por cada fila del editor de fechas, y lógica de resolución "¿gana el valor de la fecha o el de la regla?" — sin ningún caso de negocio confirmado que lo pida hoy. Iría contra "avoid overengineering" (CLAUDE.md) y contra "no optimizar/complejizar sin evidencia real" (`PERFORMANCE_STANDARDS.md` §1).

**Punto de extensión documentado para el futuro** (no se construye ahora): si aparece evidencia real de que una regla FECHA necesita mezclar fechas de distinta clasificación bajo el mismo multiplicador, el camino limpio es agregar una columna opcional `kind` en `SpecialHourRuleDate` que, cuando está seteada, gane sobre el `kind` de la regla — mismo patrón ya usado en la Etapa 10D (`WorkRegime.extendedShiftAlertMinutes` opcional ganando sobre el default del turno).

### 7.4 Cómo lo consumiría `calendarPreview` (diseño, no implementado)

- `calendarPreview(from, to, kind?)` — nuevo tercer parámetro opcional; si viene, se suma al `where` del `findMany` (`...(kind ? { kind } : {})`); sin parámetro, comportamiento idéntico al actual (100% aditivo, ningún caller existente cambia). `day.rules[]` gana `kind` en cada entrada devuelta.
- `calendarRangeQuerySchema` ganaría `kind: z.enum([...]).optional()`; el controller lo reenvía al service.
- `doubleRuleBaseSchema` (create/update) ganaría `kind: z.enum([...]).default("OTRO")` — como el `data` ya se spreadea directo a Prisma en `createDoubleRule`/`updateDoubleRule`, no requeriría cambios adicionales en el service para persistirlo.
- Cache (`workforce.cache.ts`, `doubleRulesCache`, TTL 30s): sin cambios — la invalidación ya cubre el conjunto cerrado de escrituras de `DoubleHourRule` (enumerado exhaustivamente en la Etapa 9C); un campo escalar más en esas mismas escrituras no abre ningún hueco nuevo, según el criterio de `PERFORMANCE_STANDARDS.md` §5.

## 8. UX propuesta (conceptual, no implementada)

En el formulario de alta/edición de Hora Especial ([WorkScheduleSettingsPage.tsx](../../frontend/src/pages/WorkScheduleSettingsPage.tsx)), junto a Multiplicador/Prioridad, un campo nuevo:

**"Tipo de día especial"** — `<select>` con 4 opciones: Feriado / Domingo / Día especial laboral / Otro.

Copy de ayuda recomendado: *"El tipo se usa para que otros módulos sepan cómo interpretar estas fechas. El nombre de la regla es sólo descriptivo."*

Para reglas clasificadas como **Feriado**: sus fechas podrán aparecer luego en Turnos → Asignaciones de feriados (una vez que esa pantalla exista).
Para reglas clasificadas como **Otro** (o Domingo, o Día especial laboral): se aplican para liquidación igual que siempre; no aparecen automáticamente en asignaciones de feriados.

Además: badge/columna de clasificación en la tabla de reglas existente, y precarga del valor real al editar una regla — sin rediseñar el resto de la pantalla, mismo patrón visual (`Section`, `TableShell`, `Badge`) ya usado en el módulo.

## 9. Casos funcionales validados contra el diseño

1. **Regla "Pedro" con `kind=FERIADO`** → aplica como Hora Especial normalmente (el motor no lee `kind`). Sus fechas aparecerían para asignaciones de feriados en el futuro filtro.
2. **Regla "Feriados" con `kind=OTRO`** → aplica como Hora Especial. Sus fechas NO aparecen como feriados para asignación.
3. **Regla Domingo semanal con `kind=DOMINGO`** (tras reclasificación manual) → aplica liquidación de domingo igual que hoy. No aparece en asignaciones de feriados.
4. **Regla Feriado con varias fechas y `kind=FERIADO`** → aplica liquidación; todas sus fechas (vía `SpecialHourRuleDate`) heredan la clasificación de la regla completa y aparecen para futuras asignaciones.
5. **Reglas legacy sin tipo definido** (hoy, sólo "Domingo") → no se adivina por nombre; el `DEFAULT 'OTRO'` de la migración las deja en un fallback seguro automáticamente; se resuelven desde la UI cuando RRHH decida reclasificarlas explícitamente.

## 10. Riesgos analizados

1. **Romper liquidación actual** — mitigado: `kind` no se lee en ningún punto de `doubleHourRuleMatching.ts` ni del motor real (`createFromWorkShift`/`closeOpenWorkShift`/carga manual); es un campo puramente informativo/de filtro.
2. **Duplicar calendario** — evitado por diseño: se descartó la Opción C; el futuro endpoint de Turnos reutilizaría `calendarPreview`, nunca reimplementaría el cálculo.
3. **Usar nombre visible como lógica** — explícitamente prohibido y no usado en ningún punto de este diseño (ver §3).
4. **Clasificar mal reglas existentes** — mitigado por `DEFAULT 'OTRO'` sin inferencia; la única regla real ("Domingo") requiere acción manual explícita de RRHH.
5. **Que Domingo aparezca como feriado** — evitado: `DOMINGO` es un valor propio y distinto de `FERIADO`; sólo `FERIADO` alimentaría el futuro filtro de Turnos.
6. **Que reglas especiales internas aparezcan en Turnos sin corresponder** — evitado: sólo `kind=FERIADO` alimentaría ese filtro; `JORNADA_ESPECIAL`/`OTRO`/`DOMINGO` quedan fuera a propósito.
7. **Enum demasiado limitado** — el enum es extensible (agregar un valor nuevo es una migración aditiva, mismo patrón que crearlo).
8. **Necesidad futura de más tipos** — mismo mecanismo de extensión que el punto anterior; si aparece necesidad de clasificar por fecha individual, el punto de extensión ya queda documentado en §7.3.
9. **Scope de reglas** (empresa/sector/centro de costo/puesto/empleados específicos) — sin cambios; `kind` es ortogonal al scope existente (Etapa 8B), no lo reemplaza ni lo toca.
10. **Performance del endpoint de calendario** — sin impacto: un campo escalar más en un `findMany` ya acotado por rango de fecha (máx. 400 días, `calendarRangeQuerySchema`) y `status=ACTIVO`; el filtro opcional por `kind` sólo reduce el resultado, nunca lo amplía.
11. **Permisos** — sin cambios: mismo RBAC ya vigente para `double-hour-rules` (lectura RRHH/Supervisión/Carga Horaria, escritura sólo RRHH). Quién podría ver la futura pantalla de asignaciones de feriado en Turnos queda pendiente de definir cuando esa etapa se diseñe — no se asume nada acá.

## 11. Tests futuros a proponer (no implementados en esta etapa)

**Backend**:
- Crear una regla con `kind=FERIADO` — se persiste correctamente.
- Crear una regla sin mandar `kind` — queda en `OTRO` por default.
- Editar la clasificación de una regla existente (reclasificar).
- `calendarPreview` incluye `kind` en cada entrada de `rules[]`.
- `calendarPreview(from, to, "FERIADO")` sólo devuelve reglas/días de ese tipo — una regla "Pedro" con `kind=FERIADO` aparece; una regla "Feriados" con `kind=OTRO` no aparece.
- Una regla `SEMANAL` con `kind=DOMINGO` nunca aparece en el filtro `FERIADO`.
- El motor de liquidación (`doubleHourRuleMatching.ts`, `createFromWorkShift`/`closeOpenWorkShift`/carga manual) sigue aplicando exactamente igual, sin ninguna regresión, independientemente del `kind` configurado — test de no-regresión explícito.
- Export/grilla/bandeja de revisión no cambian por la clasificación — ningún campo `specialHour*` existente se ve afectado.
- Permisos de lectura/escritura sobre `double-hour-rules` se mantienen sin cambios.
- Verificación de que una fila preexistente ("Domingo") migra a `OTRO` sin intervención manual tras aplicar la migración.
- Controller: `doubleRulesCalendar` reenvía `req.query.kind`; sin `kind`, comportamiento idéntico al actual (regresión de compatibilidad).

**Frontend**:
- El campo "Tipo de día especial" es visible en el formulario de Horas Especiales.
- El copy es claro y sin lenguaje técnico.
- Seleccionar "Feriado" y guardar manda `kind: "FERIADO"` en el payload.
- Editar una regla existente precarga su clasificación real.
- El texto no usa términos técnicos (`kind`, `enum`, `DoubleHourRuleKind`) visibles al usuario.
- (Cuando exista) el calendario de asignaciones de Turnos sólo muestra fechas de reglas `kind=FERIADO`.

## 12. Relación con Turnos

Turnos (`ShiftTemplate`/`ShiftAssignment`) define **horario habitual recurrente por día de semana** — confirmado que no existe hoy ninguna tabla de "quién debía trabajar tal fecha puntual de feriado". El diseño de esta etapa no toca ningún archivo de `backend/src/modules/shifts/` — sólo deja preparado el filtro (`kind=FERIADO`) que una futura pantalla de asignaciones de feriado en Turnos podría consumir. El contrato propuesto para ese futuro consumo (sin construirlo ahora): un endpoint fino dentro de `shifts.routes.ts` que llame a una función de `workforce-management` (ej. `workforceService.holidayDatesInRange(from, to)`, envolviendo `calendarPreview(from, to, "FERIADO")`) — mismo patrón cross-módulo que ya usa `timeEntries.repository.ts` al importar `doubleHourRuleMatching.ts` (workforce-management es dueño, otros módulos importan de acá, nunca al revés). La respuesta para Turnos debería ser deliberadamente más angosta que la de Horas Especiales (sólo `{date, rules: [{id, name}]}`, sin `multiplier`/`priority`/`hasOverlap`/`hasConflict`) — esos campos son de liquidación, no de expectativa de trabajo, y ocultarlos a nivel de contrato refuerza que "Hora Especial nunca implica obligación de trabajar" (regla 4 del pedido original).

## 13. Relación con Asignaciones de feriado (futuras, no implementadas)

No implementadas en esta etapa ni en ninguna etapa previa — no existe ninguna tabla ni pantalla hoy. Este diseño deja explícitamente definido (regla 7 del pedido original) que Turnos podrá, en una etapa futura, consultar las fechas `kind=FERIADO` para asignar empleados convocados a trabajar un feriado puntual — esa asignación futura decidirá **quién** debía trabajar; la Hora Especial seguirá decidiendo únicamente **cuánto vale** si trabaja. No se asume automáticamente que todos los empleados con turno deben trabajar feriados, ni que nadie los trabaja — ambas decisiones quedan para el diseño de esa etapa futura, sin prejuzgarlas acá.

## 14. Relación con Horas Especiales

`DoubleHourRule` sigue siendo, sin ningún cambio de comportamiento, una regla de **valor liquidable**, nunca de horas reales ni de obligación de trabajar — invariante confirmado intacto desde la Etapa 8F y reconfirmado en toda la serie 11A-11C. El campo `kind` es puramente clasificatorio: no participa del cálculo de multiplicador, no altera scope ni prioridad, no cambia ningún consumidor existente (grilla, detalle por legajo, bandeja, export, cierre, dashboard). Es estrictamente aditivo sobre un modelo que ya funciona correctamente.

## 15. Qué NO se implementa todavía

- Ninguna migración de `schema.prisma` — sólo se documenta el SQL propuesto en §7.2.
- Ningún código de backend/frontend modificado — ni `workforce.service.ts`, ni `workforce.schemas.ts`, ni `WorkScheduleSettingsPage.tsx`, ni `workforceApiService.ts`.
- Ningún test nuevo escrito — sólo se proponen en §11.
- Ninguna pantalla ni endpoint real de "asignaciones de trabajo en feriados" en Turnos — sólo se documenta el contrato futuro en §12.
- Ninguna corrección del hallazgo relacionado en `attendanceInactivity.service.ts` (§4.10 más abajo) — se documenta, no se corrige.
- Ningún cambio a `HourConceptKind.FERIADO` (Conceptos Horarios, dominio no relacionado), ni a `TimeSegment.isHoliday` (campo muerto de otro modelo).
- Ningún commit.

### 4.10 Hallazgo relacionado, no corregido en esta etapa: "Sin actividad registrada"

Confirmado por lectura completa de [attendanceInactivity.service.ts](../../backend/src/modules/time-entries/attendanceInactivity.service.ts) (`detectAttendanceInactivity`): hoy genera la notificación `SIN_ACTIVIDAD_REGISTRADA` para **todo empleado activo sin fichadas/horas/novedades ese día**, consultando únicamente `attendancePunches`/`workShifts`/`timeEntries`/`novelties` — **sin verificar `ShiftAssignment` en absoluto**, es decir, sin comprobar si ese día había alguna expectativa real de que el empleado trabajara. Esto es exactamente el gap que describe la regla conceptual 9 del pedido original ("'Sin actividad registrada' sólo debe notificarse si existía expectativa real de actividad"). Es un hallazgo real y verificado, directamente relevante para cuando exista la pantalla de asignaciones de feriado (un empleado sin convocatoria a un feriado no debería disparar esta alerta) — pero corregirlo requiere tocar código de producción, fuera del alcance de esta etapa de sólo diagnóstico. Queda documentado como candidato explícito para una etapa futura dedicada.

## 16. Plan de implementación posterior (sugerido, sujeto a aprobación)

- **12B** — Backend/schema: migración de `kind`/`DoubleHourRuleKind` (§7.2), extensión de `doubleRuleBaseSchema`/`updateDoubleRuleSchema`/`calendarRangeQuerySchema`, filtro opcional en `calendarPreview`, tests backend de §11.
- **12C** — Frontend: campo "Tipo de día especial" en `WorkScheduleSettingsPage.tsx`, badge en la tabla de reglas, tipos en `workforceApiService.ts`, tests frontend de §11.
- **12D** — Pantalla de Turnos → Asignaciones de feriados: nueva entidad de asignación (quién debía trabajar tal feriado), endpoint fino consumiendo `kind=FERIADO` (contrato de §12), UI de convocatoria — etapa completa, con su propio diagnóstico y diseño previo, no arranca directo a código.
- **12E** (candidata, evaluar prioridad con el usuario) — Corrección del hallazgo de §4.10: `detectAttendanceInactivity` consultando `ShiftAssignment` (y, cuando exista, la asignación de feriado de 12D) antes de notificar "Sin actividad registrada".

---

No se modificó `schema.prisma`, no se crearon migraciones, no se modificó código de fichador/grilla/export/Turnos/Conceptos Horarios ni ningún archivo fuente. Único cambio de esta etapa: este documento, `docs/decisions/SPECIAL_HOUR_RULE_CLASSIFICATION_12A.md` (nuevo).

No commitear sin aprobación explícita del usuario.
