# Auditoría: Módulo Horas Especiales (Etapa 8A)

Fecha: 2026-08-26
Estado: diagnóstico — sin rediseño implementado, pendiente de aprobación para 8B+

> **Actualización 8F:** el hallazgo más grave de este documento (§6, punto 1 —
> el multiplicador infla `TimeEntry.hours`/`totalMinutes` reales) fue
> corregido. Ver `docs/decisions/HORAS_ESPECIALES_8F.md` para el diagnóstico
> exacto, la estrategia elegida y los consumidores corregidos. El resto de los
> hallazgos de esta auditoría (scope obligatorio por empleado, sin calendario
> de feriados, sin integración con Conceptos Horarios, sobrecarga del nombre
> "Horas especiales", sin recálculo retroactivo) sigue vigente — 8F no los
> aborda a propósito, quedan para 8B en adelante.

## 0. Resumen ejecutivo

El módulo existe y su núcleo de cálculo (motor de multiplicador, trazabilidad por
`SpecialHourRuleApplication`, política "no se acumulan, gana el mayor") está bien
resuelto y probado. El problema no es que falte lógica de cálculo: es que (a) el
alcance (scope) obliga a seleccionar empleados uno por uno, sin alternativa
general/por-sector/por-feriado; (b) el motor sólo corre en dos rutas del
fichador automático y nunca en carga manual ni en Conceptos Horarios
(`HourConceptBreakdown`), por lo que el Ejemplo 4 del pedido (Domingo + Sereno)
no es posible hoy; y (c) el nombre "Horas especiales" está sobrecargado en el
propio código/documentación con **tres significados distintos**, y el más usado
de los tres (Conceptos Horarios habilitados por legajo) no tiene nada que ver
con el motor de multiplicador que el usuario llama "Horas Especiales". El
hallazgo más grave es funcional, no de nomenclatura: el multiplicador **infla
directamente `TimeEntry.hours`/`totalMinutes`**, y ese es el campo que lee el
dashboard, el cierre mensual y el export de nómina como "horas trabajadas" —
`actualMinutes` (que sí guarda el valor real) se escribe pero no lo lee nadie
fuera de este mismo archivo. Es decir: hoy el sistema **sí** puede reportar que
Juan trabajó 16 hs reales un domingo de 8 hs, en el dashboard, en el cierre y en
el export — exactamente lo que el encargo dice que no debe pasar.

## 1. Mapa de archivos actuales

### Modelo (Prisma)

| Modelo | Archivo:línea | Rol |
| --- | --- | --- |
| `DoubleHourRule` | [schema.prisma:1236](../../backend/prisma/schema.prisma#L1236) | La "regla de hora especial" (motor real). Nombre en código, no en UI. |
| `DoubleHourRuleEmployee` | [schema.prisma:1256](../../backend/prisma/schema.prisma#L1256) | Join obligatorio regla↔empleado (única forma de scope hoy). |
| `SpecialHourRuleApplication` | [schema.prisma:1272](../../backend/prisma/schema.prisma#L1272) | Traza qué regla matcheó qué `TimeSegment` y con qué multiplicador. |
| `TimeSegment.isHoliday/isNight/isSpecial` | [schema.prisma:1362-1364](../../backend/prisma/schema.prisma#L1362) | Flags por tramo. `isHoliday` existe en el schema pero no se escribe en ningún lado (ver §8). |
| `TimeEntry.appliedMultiplier/actualMinutes` | [schema.prisma:920-921](../../backend/prisma/schema.prisma#L920) | Multiplicador efectivo y minutos reales del `TimeEntry` resultante. |
| `HourConceptKind.FERIADO` | [schema.prisma:156-163](../../backend/prisma/schema.prisma#L156) | Enum de **Concepto Horario** que incluye `FERIADO` como un kind más, junto a `SERENO`/`GUARDIA`/`TRANSPORTE`. Ver §6. |

### Backend

| Capa | Archivo | Qué hace |
| --- | --- | --- |
| Rutas | [workforce.routes.ts:29-32](../../backend/src/modules/workforce-management/workforce.routes.ts#L29) | `GET/POST/PATCH/DELETE /workforce/double-hour-rules` |
| Controller | `workforce.controller.ts` | Delega a `workforceService` |
| Service (CRUD) | [workforce.service.ts:223-258](../../backend/src/modules/workforce-management/workforce.service.ts#L223) | `doubleRules`, `createDoubleRule`, `updateDoubleRule`, `removeDoubleRule` |
| Schemas (validación) | [workforce.schemas.ts:27](../../backend/src/modules/workforce-management/workforce.schemas.ts#L27) | `doubleRuleSchema` — `employeeIds` **obligatorio**, `.min(1)` |
| Motor de aplicación | [timeEntries.repository.ts:152-177](../../backend/src/modules/time-entries/timeEntries.repository.ts#L152) | `matchingDoubleHourRules`, `effectiveMultiplier` |
| Aplicación real (2 rutas) | [timeEntries.repository.ts:1460-1500](../../backend/src/modules/time-entries/timeEntries.repository.ts#L1460) y [1624-1716](../../backend/src/modules/time-entries/timeEntries.repository.ts#L1624) | `createFromWorkShift` / `closeOpenWorkShift` — únicos dos lugares donde `DoubleHourRule` toca datos reales |
| Consumo en resúmenes | [timeEntries.repository.ts:400-411](../../backend/src/modules/time-entries/timeEntries.repository.ts#L400) | `summary()` — suma `TimeEntry.hours` (ya multiplicado) |
| Consumo en cierres | [workforce.service.ts:82-88](../../backend/src/modules/workforce-management/workforce.service.ts#L82) | `submitClosures()` — mismo problema |
| Consumo en export | [timeEntries.service.ts:1619-1667](../../backend/src/modules/time-entries/timeEntries.service.ts#L1619) | `exportByPerson()` — columna "Horas trabajadas totales" = `hours` multiplicado |

### Frontend

| Archivo | Rol |
| --- | --- |
| [WorkScheduleSettingsPage.tsx](../../frontend/src/pages/WorkScheduleSettingsPage.tsx) | Única pantalla de configuración. Título de la sección: "Horas especiales". |
| [workforceApiService.ts:78-119](../../frontend/src/services/api/workforceApiService.ts#L78) | Cliente API (`DoubleHourRule`, CRUD) |
| [utils/doubleHourRule.ts](../../frontend/src/utils/doubleHourRule.ts) | Validación de multiplicador (min/max) |
| [components/attendance/segmentDisplay.ts:91-96](../../frontend/src/components/attendance/segmentDisplay.ts#L91) | `describeSpecialRuleApplication` — única vista de detalle (panel de asistencia por jornada, no en el módulo de Horas Especiales) |
| [components/attendance/WorkShiftSegmentsPanel.tsx](../../frontend/src/components/attendance/WorkShiftSegmentsPanel.tsx) | Consume lo anterior |
| [utils/hoursExport.ts:11-20](../../frontend/src/utils/hoursExport.ts#L11) | Columna CSV "Horas especiales" = Conceptos Horarios, no `DoubleHourRule` |
| [pages/HoursPage.tsx:123,466,941](../../frontend/src/pages/HoursPage.tsx#L123) | Columna "Especiales" de la grilla = Conceptos Horarios, no `DoubleHourRule` |

### Docs

| Doc | Qué dice |
| --- | --- |
| [BACKEND_API_CONTRACTS.md:416](../BACKEND_API_CONTRACTS.md#L416) | "Horas especiales habilitadas" = `PUT /employees/:id/hour-concepts` (Conceptos Horarios) |
| [BACKEND_API_CONTRACTS.md:654](../BACKEND_API_CONTRACTS.md#L654) | Sección "Horas especiales" = CRUD de `/api/hour-concepts` (Conceptos Horarios) |
| [BACKEND_API_CONTRACTS.md:1209-1214](../BACKEND_API_CONTRACTS.md#L1209) | Export: aclara que "Horas especiales" ahí es `HourConceptBreakdown`, no `DoubleHourRule` |
| [BACKEND_API_CONTRACTS.md:1298](../BACKEND_API_CONTRACTS.md#L1298) | Única mención real del motor: `/double-hour-rules*` = "Reglas de horas dobles" |
| [decisions/CONCEPTOS_HORARIOS_ADITIVOS.md:181](CONCEPTOS_HORARIOS_ADITIVOS.md#L181) | Deja documentado que cierre/dashboard/export no fueron auditados respecto de este acoplamiento |

### Tests

- [workforce.service.test.ts:138-230](../../backend/src/modules/workforce-management/workforce.service.test.ts#L138) — CRUD, FKs, huso horario de "regla futura".
- [timeEntries.repository.test.ts:510-721](../../backend/src/modules/time-entries/timeEntries.repository.test.ts#L510) — motor de multiplicador: sin regla, una regla, dos reglas (gana la mayor), no duplica en un solo cierre, invariante de `actualMinutes`.
- No hay tests de: scope no-employeeIds (no existe), interacción con `HourConceptBreakdown` (no existe integración), carga manual (no aplica el motor), consumo de `hours` inflado en dashboard/cierre/export (nadie testea que el dashboard use el valor correcto).

### Seeds / mock data

No hay seed ni script de feriados nacionales, ni de reglas de domingo, ni fixtures de `DoubleHourRule` fuera de los tests unitarios (`rule()` helper de test). Confirma que no existe calendario de feriados en ninguna capa (ver §8).

## 2. Diagnóstico del modelo actual

`DoubleHourRule` tiene: `name`, `recurrenceType` (`FECHA`/`RANGO`/`SEMANAL`), `fromDate`/`toDate`, `weekdays: Int[]`, `multiplier: Decimal`, `status`, `reason`, `createdByUserId`. Tiene multiplicador ✅, tiene fechas/rango/semanal ✅, **no** tiene:
- referencia a un calendario de feriados (no hay entidad `Holiday`/`Feriado`);
- alcance (scope) más allá de la lista de empleados — no hay `sectorId`/`costCenterId`/`positionId`/`companyId`/"todos";
- forma de decir sobre qué aplica (Hora normal / Conceptos Horarios específicos / ambos) — hoy aplica siempre y sólo sobre la Hora normal generada por fichador (ver §3);
- prioridad configurable de superposición — la política existe pero está fija en código (`effectiveMultiplier`, "gana el mayor"), no es un dato de la regla;
- resultado auditable propio expuesto — existe `SpecialHourRuleApplication` (sí guarda regla aplicada, tramo, multiplicador, timestamp) pero **nunca se lee desde ningún endpoint de reporte**, sólo desde el detalle de asistencia de una jornada puntual.

`DoubleHourRuleEmployee` obliga `employeeIds.min(1)` tanto en el schema Zod ([workforce.schemas.ts:27](../../backend/src/modules/workforce-management/workforce.schemas.ts#L27)) como en el frontend ([WorkScheduleSettingsPage.tsx:27](../../frontend/src/pages/WorkScheduleSettingsPage.tsx#L27), mensaje "Seleccioná al menos una persona para guardar la regla."). No existe ningún modo de "aplica a quien trabaje ese día sin seleccionar a nadie".

## 3. Diagnóstico backend

**¿Aplica de verdad o sólo configura?** Aplica de verdad, pero sólo en dos lugares: `createFromWorkShift` y `closeOpenWorkShift` en `timeEntries.repository.ts`, ambos disparados exclusivamente por el ciclo entrada/salida del fichador. La lógica está duplicada casi línea por línea entre ambas funciones (mismo patrón `matchingDoubleHourRules` → `effectiveMultiplier` → crear `SpecialHourRuleApplication` → escribir `appliedMultiplier`/`isSpecial` en dos sitios).

**¿En qué momento se aplica?** Al cerrar el `WorkShift` (con salida ya fichada), por tramo (`TimeSegment`), nunca "al fichar" en el sentido de bloquear/preguntar nada al kiosco — coincide con el requisito de que el fichador no pregunte nada.

**¿Se aplica al recalcular?** No existe recálculo. El test "Caso H" lo documenta explícitamente: *"no hay recálculo implementado todavía"* ([timeEntries.repository.test.ts:688](../../backend/src/modules/time-entries/timeEntries.repository.test.ts#L688)). Si una regla se crea/edita después de que ya existan `TimeEntry` para esas fechas, esos registros no se actualizan.

**¿Se aplica manualmente (grilla)?** No. La función `create()` de carga manual ([timeEntries.repository.ts:1382](../../backend/src/modules/time-entries/timeEntries.repository.ts#L1382)) no consulta `doubleHourRule` en ningún momento.

**¿Se aplica sobre Conceptos Horarios (`HourConceptBreakdown`)?** No, en absoluto. `DoubleHourRule` no aparece en ningún archivo del módulo `hour-concepts`. El Ejemplo 4 del encargo (Domingo + Sereno) no tiene ningún camino de cálculo hoy: si Juan hace Sereno un domingo, el Sereno se calcula normal (por `HourConceptRule`, horario) y el domingo sólo multiplica la Hora normal, sin que exista forma de decir "Domingo también aplica sobre Sereno".

**¿Soporta cruce de medianoche?** Sí, estructuralmente: el matching corre por `TimeSegment`, y cada `TimeSegment` ya tiene su propia `date` (los tramos se parten por día calendario aguas arriba, en `classifySegmentsForEmployee`). Un turno sábado 22:00→domingo 02:00 genera dos `TimeSegment` con `date` distinta, y `matchingDoubleHourRules` evalúa cada uno por separado — el Ejemplo 3 del encargo está resuelto en el motor, aunque no hay un test explícito de este caso con `DoubleHourRule` (los tests de multiplicador existentes usan turnos de un solo día).

**¿Soporta reglas generales sin empleados seleccionados?** No (ver §2).

**¿Soporta feriados?** Sólo como `recurrenceType: "FECHA"` con multiplicador — es decir, "feriado" no es un concepto propio, es una regla de fecha única indistinguible de cualquier otra fecha especial ad hoc. No hay calendario de feriados nacional/importable (ver §8).

**¿Soporta superposiciones?** Sí: `matchingDoubleHourRules` devuelve *todas* las reglas que matchean un tramo, se registran todas en `SpecialHourRuleApplication`, y `effectiveMultiplier` aplica **el mayor multiplicador, sin acumular ni multiplicar entre reglas**. Política ya decidida y testeada (Caso C). Es una decisión de código, no configurable por regla.

## 4. Diagnóstico frontend

La pantalla `WorkScheduleSettingsPage.tsx` (ruta bajo Configuración, sólo visible a `roleLevel === 1`) tiene un formulario único:

- Nombre, Repetición (Una fecha / Rango / Días semanales), Multiplicador, Desde, Hasta, checkboxes de día de semana (si `SEMANAL`), Motivo (texto libre obligatorio), y un selector remoto de personas **obligatorio** (`EmployeeRemoteSelector`, "Seleccioná al menos una persona").
- No hay opción de alcance por sector/centro de costo/puesto/empresa/"todos".
- No hay vista de calendario ni forma de cargar feriados en bloque; `SEMANAL` con checkbox "Dom" cubre "todos los domingos del año" sin fechas individuales, pero sigue exigiendo elegir personas una por una.
- La tabla de reglas sólo muestra metadata de configuración (nombre, tipo, período, multiplicador, cantidad de personas, motivo, estado) — cero visibilidad de **resultado aplicado** (a quién le tocó, cuántos minutos, cuánto se liquidó). Esa información sólo aparece, parcialmente, en el panel de detalle de una jornada individual (`segmentDisplay.ts`), no en este módulo.
- Sin estados vacíos más allá de `EmptyState`/`LoadingState` genéricos (correcto, pero mínimo).
- Título de la sección ("Horas especiales") coincide con el motor real — es la única pantalla donde el nombre no está sobrecargado —, pero convive en el mismo dominio de nombres que Conceptos Horarios en otras pantallas (ver §6), lo que puede confundir a RRHH al buscar "dónde cargo el feriado".

## 5. ¿Qué funciona hoy?

- El motor de matching y multiplicador (`matchingDoubleHourRules`/`effectiveMultiplier`) está bien escrito, con comentarios que documentan la decisión de negocio, y bien testeado (Casos A–I).
- Cruce de medianoche resuelto correctamente a nivel de `TimeSegment`.
- Superposición entre reglas resuelta con una política explícita y testeada (mayor multiplicador, nunca se acumula).
- Trazabilidad de auditoría (`SpecialHourRuleApplication`) existe y no se pierde información aunque no se lea en reportes: registra *todas* las reglas que matchearon, no sólo la ganadora.
- CRUD de reglas con mapeo de errores FK prolijo, soft-delete correcto (inactiva si ya empezó, borra si es futura, igual que `ShiftTemplate`) — reutiliza un patrón ya validado en el proyecto.
- RBAC correcto: lectura para `rrhh`/`supervision`/`cargaHoraria`, escritura sólo `rrhh`.
- El fichador (`TimeClockPage.tsx`/`timeClockApiService.ts`) no pregunta nada sobre horas especiales — cumple el requisito central sin que haya que tocar nada ahí.

## 6. ¿Qué está mal?

Ordenado por severidad:

1. **El multiplicador infla el campo que el resto del sistema lee como "horas trabajadas".** En `createFromWorkShift`/`closeOpenWorkShift`, `TimeEntry.hours` y `TimeEntry.totalMinutes` se calculan como `segment.minutes * multiplier` ([timeEntries.repository.ts:1476](../../backend/src/modules/time-entries/timeEntries.repository.ts#L1476)), y `actualMinutes` guarda el valor real aparte. Pero **`actualMinutes` no se lee en ningún otro archivo del backend** (confirmado por grep completo). En cambio, `hours` es exactamente lo que suma:
   - el dashboard/`summary()` como `countableHours` ([timeEntries.repository.ts:400-411](../../backend/src/modules/time-entries/timeEntries.repository.ts#L400));
   - el snapshot de cierre mensual ([workforce.service.ts:82-88](../../backend/src/modules/workforce-management/workforce.service.ts#L82));
   - el export de nómina, en una columna literalmente llamada **"Horas trabajadas totales"** ([timeEntries.service.ts:1651-1653](../../backend/src/modules/time-entries/timeEntries.service.ts#L1651)).
   Un test lo documenta como intencional para "pago de horas extra" ([timeEntries.repository.test.ts:715-717](../../backend/src/modules/time-entries/timeEntries.repository.test.ts#L715)), es decir: el campo se diseñó a propósito para ser el valor **liquidable**, pero luego se reutilizó, sin revisión, como si fuera el valor **trabajado** en dashboard/cierre/export/grilla. Es exactamente el escenario que el Ejemplo 1 del encargo prohíbe: hoy el sistema puede reportar 16 hs "trabajadas totales" para una jornada real de 8. El propio doc de decisión de Conceptos Horarios ya deja constancia de que esto "no se auditó" ([CONCEPTOS_HORARIOS_ADITIVOS.md:181](CONCEPTOS_HORARIOS_ADITIVOS.md#L181)).
2. **El nombre "Horas especiales" está sobrecargado con tres significados distintos** en el propio código y documentación:
   - Conceptos Horarios habilitados por legajo (`PUT /employees/:id/hour-concepts`, doc "Horas especiales habilitadas").
   - El endpoint/CRUD de `HourConcept` en general (sección "Horas especiales" de `BACKEND_API_CONTRACTS.md` documentando `/api/hour-concepts`).
   - El motor real de multiplicador (`DoubleHourRule`, la única pantalla del frontend con ese título).
   Esto confirma la sospecha del encargo: el sistema efectivamente mezcla los dos dominios, no en el modelo de datos (`DoubleHourRule` y `HourConcept` son tablas separadas y no se pisan), sino en el **vocabulario**, lo cual es igual de peligroso para RRHH al operar el sistema.
3. **`FERIADO` es un `HourConceptKind` seleccionable al crear un Concepto Horario** ([hourConcepts.schemas.ts:3-4](../../backend/src/modules/hour-concepts/hourConcepts.schemas.ts#L3), [HourConceptsPage.tsx:22](../../frontend/src/pages/HourConceptsPage.tsx#L22)), con un mock literal `"Feriado trabajado"` en los datos de ejemplo del frontend. Esto habilita a RRHH a crear un Concepto Horario aditivo llamado "Feriado" en paralelo al motor real de `DoubleHourRule`, sin que ninguno de los dos sepa del otro — riesgo real de doble carga o de que alguien use el camino equivocado.
4. **Scope obligatorio por empleado**, ya detallado en §2/§4 — es el problema funcional más explícito del encargo.
5. **Sin calendario de feriados** — cada feriado es una regla `FECHA` cargada a mano, para cada empleado, cada año.
6. **Sin recálculo** — cambiar o borrar una regla no toca los `TimeEntry` ya generados (documentado como deuda conocida, Caso H).
7. **Cero integración con `HourConceptBreakdown`** — Ejemplo 4 del encargo no es posible hoy.
8. **Cero visibilidad de resultado aplicado a nivel de módulo** — sólo existe al nivel de detalle de una jornada individual, no hay un reporte "cuánto se liquidó por esta regla este mes".
9. **`TimeSegment.isHoliday` nunca se escribe** — existe en el schema con default `false`, se selecciona en `attendanceTimeSegmentSelect`, pero ningún código hace `isHoliday: true` en ninguna parte del repo. Es un campo muerto que sugiere una intención de distinguir "feriado" de "otra regla especial" que nunca se completó.
10. **Lógica duplicada** entre `createFromWorkShift` y `closeOpenWorkShift` (~90 líneas de matching/creación repetidas) — no es exclusivo de este módulo, pero afecta directamente la mantenibilidad de cualquier corrección futura acá.

## 7. ¿Qué sobra?

- El campo `TimeSegment.isHoliday` tal como está: sin escritor, es ruido — o se completa como parte del rediseño (ligado a un futuro calendario de feriados) o se documenta como deuda explícita.
- La duplicación entre `createFromWorkShift`/`closeOpenWorkShift` (candidato a unificar, sin cambiar comportamiento, en una etapa de refactor acotada — no en 8A).
- Nada del motor en sí sobra; no hay endpoints sin UI ni UI sin backend en este módulo puntual (a diferencia de otras partes del sistema por la auditoría de 2026-08, acá front y back están acoplados 1 a 1).

## 8. ¿Qué falta?

- Alcance (scope) más allá de lista de empleados: todos-los-que-trabajen-ese-día, sector, centro de costo, puesto, empresa.
- Calendario de feriados (carga anual, activar/desactivar fechas, un feriado nacional no debería requerir tocar cada regla a mano).
- Forma de decir sobre qué aplica la regla: Hora normal / Conceptos Horarios específicos / ambos (Ejemplo 4).
- Separación real entre "valor liquidable" y "horas trabajadas" en todos los consumidores (dashboard, cierre, export, grilla) — no sólo en el modelo de datos (que ya tiene `actualMinutes`, subutilizado).
- Reporte/auditoría a nivel de módulo (qué reglas se aplicaron, a quién, cuánto).
- Recálculo cuando una regla se crea/edita retroactivamente sobre `TimeEntry` ya generados (o, al menos, una decisión explícita de que no se recalcula y por qué).
- Terminología separada en UI/docs entre "Conceptos Horarios" y "Horas Especiales" para que RRHH no confunda los flujos.

## 9. ¿Está mezclado con Conceptos Horarios?

En el modelo de datos, no — son tablas independientes (`DoubleHourRule` vs `HourConcept`/`HourConceptBreakdown`), no se pisan. En el **vocabulario y en la superficie que ve RRHH**, sí, de tres maneras concretas (detalladas en §6.2 y §6.3): la documentación oficial llama "Horas especiales" al endpoint de Conceptos Horarios, el export/la grilla llaman "Horas especiales" al desglose de Conceptos Horarios, y el enum de Concepto Horario incluye `FERIADO` como si fuera un concepto aditivo más. La única superficie que usa "Horas especiales" para el motor real es el título de una sola pantalla de configuración.

## 10. ¿El fichador aplica algo automáticamente hoy?

No pide nada al empleado (correcto, cumple el requisito). El backend sí resuelve automáticamente qué `DoubleHourRule` corresponde, por día de semana o fecha, al cerrar el turno — pero sólo para la Hora normal generada por ese ciclo de fichada, nunca para carga manual ni para Conceptos Horarios.

## 11. ¿Hay calendario/feriados/domingos hoy?

Domingos: sí, vía `recurrenceType: "SEMANAL"` con `weekdays: [0]` — sin necesidad de cargar fecha por fecha, pero sí exige seleccionar personas. Feriados: no hay una entidad de calendario; cada feriado es una regla `FECHA` suelta, cargada a mano, sin importación ni vista de calendario, y sin relación con el `HourConceptKind.FERIADO` que existe en paralelo en Conceptos Horarios.

## 12. Propuesta funcional corregida

- **Horas Especiales sigue siendo una regla de *valor*, nunca de horas reales.** El motor calcula un multiplicador/valor equivalente sobre minutos ya trabajados o cargados (Hora normal o un Concepto Horario específico), y ese resultado vive separado del dato real, con trazabilidad propia — nunca sobrescribe `TimeEntry.hours`/`totalMinutes` reales ni `HourConceptBreakdown.minutes`.
- **El scope se resuelve automáticamente**, sin exigir selección manual para reglas generales (Domingo, Feriado): el sistema evalúa "¿esta persona trabajó/cargó algo ese día?" y aplica la regla si corresponde, según el alcance configurado (todos / sector / centro de costo / puesto / empresa / empleados específicos).
- **El fichador sigue sin preguntar nada.** Ningún cambio ahí.
- **Domingo/Feriado pueden aplicar sobre Hora normal, sobre uno o varios Conceptos Horarios, o sobre ambos**, según lo que configure RRHH por regla — nunca de forma implícita.

## 13. Propuesta técnica corregida

1. Separar de forma explícita, en todos los consumidores (`summary`, `submitClosures`, `exportByPerson`, grilla), "minutos reales" de "valor equivalente/liquidable" — usando `actualMinutes` (ya existe) como fuente de "trabajado" y un campo/relación nueva y explícita como fuente de "liquidable", en vez de sobrecargar `hours`/`totalMinutes`.
2. Mover el motor de aplicación de "sólo dos funciones de `timeEntries.repository.ts`" a un servicio propio, reutilizable desde: fichador automático (ya existe), carga manual de Hora normal, y aplicación de Conceptos Horarios (`HourConceptBreakdown`) — sin duplicar el matching entre `createFromWorkShift`/`closeOpenWorkShift`.
3. Agregar resolución de scope (nueva, no hay patrón previo en el repo para reutilizar — ver §14) evaluada al momento de aplicar la regla, no al crearla, para que "todos los que trabajen" no dependa de una lista congelada al momento de guardar la regla.
4. Mantener la política de superposición actual (mayor multiplicador gana, se registran todas) como default, evaluando si conviene hacerla configurable por regla en una etapa posterior (ver §17).
5. No tocar `HourConceptRule`, `HourConceptBreakdown` ni el clasificador de conceptos salvo para leer/escribir la aplicación de Horas Especiales sobre ellos — se integra, no se reemplaza.

## 14. Propuesta de entidades (boceto para 8B, no implementado)

No se modifica `schema.prisma` en esta etapa. Boceto de lo que se evaluaría en 8B:

- `DoubleHourRule` (o su sucesor): agregar `appliesTo` (`NORMAL` / `HOUR_CONCEPTS` / `BOTH`), relación opcional a `HourConcept[]` cuando aplica a conceptos específicos, y `scopeType` (`ALL_WORKING` / `EMPLOYEES` / `SECTOR` / `COST_CENTER` / `POSITION` / `COMPANY`) + tablas de join sólo para los scopes que las necesiten (sector/centro de costo/puesto/empresa ya existen como entidades — se referencian, no se duplican).
- Entidad de calendario de feriados, separada de `DoubleHourRule`: fecha, nombre, activo/inactivo, año — una `DoubleHourRule` de tipo "feriado" podría referenciar el calendario en vez de una fecha suelta.
- Resultado aplicado: evaluar si `SpecialHourRuleApplication` alcanza extendiéndola con minutos equivalentes/liquidables explícitos, o si conviene una entidad de "aplicación" separada que además cubra `HourConceptBreakdown` (hoy sólo referencia `TimeSegment`). Esto se decide en 8B con el detalle de solapamientos ya resuelto en el motor actual como punto de partida.

## 15. Propuesta de endpoints (boceto)

- Mantener `/workforce/double-hour-rules*` como base, extendiendo el body con `scopeType`/`scopeRefs`/`appliesTo`.
- Agregar un endpoint de sólo lectura para el resultado aplicado (por regla, por período) — hoy no existe ninguno, toda la trazabilidad vive enterrada en el detalle de asistencia por jornada.
- Evaluar un endpoint de calendario de feriados independiente si se adopta esa entidad.

## 16. Propuesta de frontend (boceto)

- Separar visualmente "Conceptos Horarios" de "Horas Especiales" en la navegación y en cualquier texto/columna que hoy comparta el nombre (grilla, export), para cortar la confusión de §6.2.
- En el formulario de regla: reemplazar el selector de personas obligatorio por un selector de alcance (todos los que trabajen / sector / centro de costo / puesto / empresa / personas específicas), mostrando el picker de personas sólo cuando el alcance sea "personas específicas".
- Agregar una vista de resultado aplicado dentro del propio módulo (no sólo en el detalle de jornada individual).
- Mantener el patrón visual y de componentes ya usado (`Section`, `TableShell`, `EmptyState`, `LoadingState`, `EmployeeRemoteSelector`) — no introducir un sistema visual nuevo.

## 17. Política de superposiciones (propuesta)

Punto de partida: mantener la decisión ya tomada y testeada en el motor actual (no se acumulan, gana la de mayor multiplicador, se registran todas para trazabilidad) como default para Domingo+Feriado, Domingo+Sereno, Feriado+Sereno y regla global+específica. Evaluar en 8B si conviene una prioridad configurable por regla para casos donde el negocio quiera forzar acumulación explícita — sin implementarlo en esta etapa. Ventana horaria + fecha especial no aplica hoy (no existe "ventana horaria" como tipo de regla de Horas Especiales); si se agrega, debería resolverse con el mismo criterio de "todas matchean, gana la de mayor valor" salvo decisión explícita en contrario.

## 18. Integraciones esperadas (flujo propuesto, sin implementar)

Fichador → `WorkShift`/`TimeSegment` (sin cambios) → motor de Horas Especiales evalúa scope+fecha+regla sobre el tramo → si corresponde, genera valor equivalente separado (nunca pisa `TimeEntry`/`HourConceptBreakdown` reales) → grilla y bandeja de revisión muestran el real sin contaminar, con indicador de que hay una Hora Especial aplicada → export/dashboard exponen "trabajado" y "liquidable" como columnas/series distintas → liquidación futura consume el valor liquidable.

## 19. Etapas recomendadas

- **8B** — Modelo/contrato de backend: schema (scope, `appliesTo`, calendario de feriados) + servicio único de aplicación, sin tocar aún UI ni recálculo retroactivo.
- **8C** — Frontend de configuración: selector de alcance, separación de nomenclatura de Conceptos Horarios.
- **8D** — Calendario de feriados (carga anual, activar/desactivar).
- **8E** — Motor de aplicación automática extendido a carga manual y a Conceptos Horarios (Ejemplo 4).
- **8F** — Separación real de "trabajado" vs "liquidable" en dashboard/cierre/export/grilla (corrige el hallazgo más grave de §6.1) — candidata a adelantarse antes que 8C/8D si se prioriza corregir el riesgo de datos antes que la UX de carga.
- **8G** — Reporte/auditoría de resultado aplicado a nivel de módulo.
- **8H** — Recálculo retroactivo al editar/crear una regla (o decisión explícita de no soportarlo).

## 20. Cambios realizados en esta etapa

Sólo este documento: `docs/decisions/HORAS_ESPECIALES_AUDITORIA_8A.md` (nuevo). No se tocó `schema.prisma`, no se crearon migraciones, no se modificó código de fichador/grilla/export/Conceptos Horarios ni ningún archivo fuente.

## 21. Validaciones ejecutadas

Sólo documentación → `git diff --check` (ver resultado abajo, sin errores de espacios en blanco).

## 22. git status

Ver salida de `git status --short` en la respuesta al usuario.

## 23. git diff --stat

Ver salida de `git diff --stat` en la respuesta al usuario (archivo nuevo, sin diff de contenido existente).

---

No commitear sin aprobación explícita del usuario.
