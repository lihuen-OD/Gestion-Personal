# Etapa 11A — Auditoría integral de Carga Horaria, Grilla de horas y Bandeja de revisión

Fecha: 2026-08-28
Estado: diagnóstico completo + correcciones puntuales implementadas, pendiente de aprobación para commitear
Continúa: `docs/decisions/HORAS_ESPECIALES_AUDITORIA_8A.md`, `docs/decisions/HORAS_ESPECIALES_8B.md`, `docs/decisions/HORAS_ESPECIALES_8C.md`, `docs/decisions/HORAS_ESPECIALES_8F.md`, `docs/decisions/CONCEPTOS_HORARIOS_ADITIVOS.md`, `docs/PERFORMANCE_STANDARDS.md`

## 0. Documentos leídos

`HORAS_ESPECIALES_AUDITORIA_8A.md`, `HORAS_ESPECIALES_8B.md`, `HORAS_ESPECIALES_8C.md`, `HORAS_ESPECIALES_8F.md` (bonus, directamente relevante — es la etapa que separó horas reales de liquidables), `WORK_REGIME_SHIFT_ALERTS_10D.md`, `ATTENDANCE_SHIFT_ALERTS_NOTIFICATIONS_AUDIT_10E.md`, `CONCEPTOS_HORARIOS_ADITIVOS.md` completo (incluye 6C→7A, el historial de la grilla), `docs/PERFORMANCE_STANDARDS.md`, `CLAUDE.md`, `AGENTS.md`. Más lectura directa de código: `schema.prisma` (`TimeEntry`, `DoubleHourRule`, `DoubleHourRuleEmployee`, `SpecialHourRuleDate`, `SpecialHourRuleApplication`, `TimeSegment`), `doubleHourRuleMatching.ts`, `timeEntries.repository.ts` completo, `timeEntries.service.ts` (tramos relevantes), `employees.service.ts` (`buildAdditiveTimeGrid`), `HoursPage.tsx`, `timeEntryApiService.ts`, `employeeApiService.ts`, `segmentDisplay.ts`, `WorkShiftSegmentsPanel.tsx`.

## 1. Resumen ejecutivo

El bug reportado (feriado x2 configurado para el día 27, no reflejado en la grilla) tenía **dos causas independientes**, según cómo se cargó la hora:

1. **Carga manual**: `timeEntries.repository.ts` `create()`/`update()` **nunca consultaban `DoubleHourRule`** — el motor de Horas Especiales sólo corría dentro de `createFromWorkShift`/`closeOpenWorkShift`, exclusivo del fichador automático. Una hora cargada a mano no tenía forma de recibir un multiplicador, sin importar que la regla estuviera activa, la fecha activa y el alcance correcto.
2. **Carga automática (fichador)**: el motor sí corría correctamente (alcance AND, fecha FECHA/SEMANAL/RANGO, prioridad/conflicto — toda esta lógica ya estaba bien resuelta y testeada desde 8B/8C) y persistía bien (`TimeEntry.appliedMultiplier`, `SpecialHourRuleApplication` por regla, `TimeSegment.isSpecial`). **Pero ninguna pantalla de Carga Horaria/Grilla/Bandeja leía esos campos** — sólo la pantalla de Asistencia (jornada por jornada, ruta distinta) los exponía.

Es decir: el resultado visible era idéntico en ambos casos (nada se marcaba), por dos razones distintas. No fue necesario cambiar ninguna regla de negocio, ni el schema, ni el fichador, ni Conceptos Horarios — el motor de matching/prioridad/scope ya estaba correcto; el problema era 100% de **integración de escritura** (carga manual) y **consulta/frontend** (grilla).

Se corrigieron ambas causas, más un gap de cache de frontend real y no relacionado a Horas Especiales encontrado en el camino (ver §8.3). Se agregaron 22 tests nuevos (14 backend + 8 frontend), todos verdes junto con los 811+410 preexistentes. No se tocó `schema.prisma`, no se creó ninguna migración, no se tocó el fichador, no se tocó Conceptos Horarios, no se cambió ninguna regla de negocio del motor de Horas Especiales (scope/prioridad/conflicto).

## 2. Mapa de flujo — Carga manual (antes de esta etapa)

- **Endpoint**: `POST /time-entries` (crear) / `PATCH /time-entries/:id` (editar) → `timeEntries.controller.ts` → `timeEntries.service.ts` (`create`/`update`) → `timeEntries.repository.ts` (`create`/`update`).
- **Qué escribía**: únicamente `TimeEntry` (`employeeId`, `hourConceptId`, `date`, `hours`, `totalMinutes`, `status`, `observation`). No creaba `TimeSegment`, no creaba `WorkShift`, no creaba `HourConceptBreakdown`.
- **¿Consultaba `DoubleHourRule`?** No, en ningún punto — confirmado por lectura completa de ambas funciones y grep de `DoubleHourRule`/`doubleHourRule` en todo el archivo (sólo aparecía dentro de `createFromWorkShift`/`closeOpenWorkShift`).
- **¿Escribía `appliedMultiplier`?** No — quedaba en el default de Prisma (`1`, `@default(1)`), nunca por cálculo.
- **¿Aplicaba reglas de feriado/domingo por otra vía?** No — Conceptos Horarios (`HourConceptRule`/clasificador) tampoco interviene en `create()`/`update()` de `TimeEntry`; ese clasificador sólo corre en las 4 rutas de cierre de jornada (ver `CONCEPTOS_HORARIOS_ADITIVOS.md` Etapa 6L), no en carga manual de Hora normal.
- **Frontend**: `EmployeeHoursPage.tsx` (grilla mensual por legajo, ruta `/horas/:employeeId`) llama `timeEntryApiService.save()` → `create()`/`update()`. Actualización local optimista de la celda (Etapa 6L.4), sin ningún campo de Horas Especiales en el payload ni en la respuesta mapeada.
- **Permisos**: `[rrhh, supervision, cargaHoraria]` pueden cargar; scope de empleados vía `employeeAccessWhere` (RRHH ve todos, Nivel 2/3 sólo empleados con `EmployeeAssignment.type=TIME_RESPONSIBLE` asignado a su usuario).

## 3. Mapa de flujo — Carga automática / fichador

- **Flujo fichada → jornada → `TimeEntry`**: `AttendancePunch` (entrada/salida) → `WorkShift` → al cerrar (`clockOutResolved`/`clockPhotoPunch`/`closeWorkShiftManually`/`createWorkShift`) se llama `createFromWorkShift` o `closeOpenWorkShift` en `timeEntries.repository.ts`.
- **Motor de Horas Especiales** (dentro de ambas funciones, idéntico patrón):
  1. Resuelve el scope del empleado (`sectorId`/`costCenterId`/`positionId`/`companies` vía `tx.employee.findUnique`).
  2. Trae las `DoubleHourRule` candidatas (`status: ACTIVO`, vigencia gruesa por `fromDate`/`toDate`, `AND` de `doubleHourRuleScopeWhere` — empresa/sector/centro de costo/puesto/empleados específicos, todo opcional, todo AND).
  3. `matchingDoubleHourRules` filtra por fecha exacta del `TimeSegment` (`ruleMatchesDate`: SEMANAL por `weekdays`+vigencia, RANGO por vigencia, FECHA por `SpecialHourRuleDate.isActive`).
  4. `resolveWinningRules` resuelve prioridad (gana la de mayor `priority`; empate se resuelve por mayor `multiplier` y se marca `wasConflicting`).
  5. Se crea un `SpecialHourRuleApplication` por **cada** regla que matcheó (no sólo la ganadora), con `isWinner`/`wasConflicting` congelados.
  6. `TimeEntry.appliedMultiplier` recibe el multiplicador de la regla ganadora. `hours`/`totalMinutes`/`actualMinutes` **siempre** quedan en minutos reales (desde la Etapa 8F) — nunca se multiplican.
- **Cruce de medianoche**: correcto — cada `TimeSegment` tiene su propia `date`, el matching corre por tramo, así que sólo el tramo del día feriado/domingo recibe la regla (test dedicado desde 8F, Caso K).
- **Trazabilidad**: `SpecialHourRuleApplication` queda persistida completa, pero antes de esta etapa **no se leía desde ningún endpoint de Carga Horaria** — sólo desde `attendanceTimeSegmentSelect` (usado por `GET /time-entries/attendance` y `/attendance/observations`, ambos consumidos por `AttendancePage.tsx` → `WorkShiftSegmentsPanel.tsx`, pantalla de Asistencia, ruta `/asistencia`).
- **El fichador no pregunta nada** sobre Horas Especiales — confirmado sin cambios, cumple el requisito.

## 4. Cómo se aplican las Horas Especiales (antes/después de 11A)

| | Antes de 11A | Después de 11A |
|---|---|---|
| Fichador (`createFromWorkShift`/`closeOpenWorkShift`) | Aplica correctamente | Sin cambios — no se tocó |
| Carga manual (`create()`/`update()`) | Nunca aplica | Aplica (mismo motor puro, reutilizado) |
| Grilla de período (`findPeriodEmployees` → `HoursPage.tsx`) | No expone nada | Expone multiplicador/equivalente/regla/conflicto por día y por período |
| Export (`exportByPerson`) | Ya correcto desde 8F | Sin cambios — ya funcionaba |
| Cierre (`submitClosures`) | Ya correcto (pass-through de `hours`, reales) | Sin cambios |

## 5. Horas reales vs. liquidables

Invariante confirmado intacto en toda la auditoría: `TimeEntry.hours`/`totalMinutes` son **siempre** minutos reales, tanto en carga manual como automática, antes y después de esta etapa. El valor liquidable/equivalente se deriva en lectura, nunca se persiste inflado:

```
equivalente liquidable = horas reales × appliedMultiplier
adicional liquidable    = horas reales × (appliedMultiplier − 1)
```

Esto ya lo hacía el export desde 8F (`exportByPerson`, `real × appliedMultiplier`) — el fix de carga manual (§8.1) hace que ese mismo cálculo, para una carga manual, deje de dar siempre "= real" (porque `appliedMultiplier` siempre era 1) y empiece a reflejar la regla real cuando corresponde. El fix de grilla (§8.2) expone el mismo cálculo en `findPeriodEmployees`, en un campo nuevo y separado (`specialHourAdditionalHours`), que nunca se suma a `total`/`normal`.

## 6. Conceptos Horarios vs. Horas Especiales — confirmado sin mezcla

Sin cambios respecto a lo ya documentado en 8A/6M: son dos tablas y dos motores completamente independientes (`HourConcept`/`HourConceptBreakdown` vs. `DoubleHourRule`/`SpecialHourRuleApplication`). La columna "Especiales" que ya existía en la grilla (`findPeriodEmployees`, campo `special`) sale exclusivamente de `HourConceptBreakdown` (Sereno/Colectivo/etc.) — **no se tocó, no se renombró, no se mezcló** con el indicador nuevo de Horas Especiales, que usa nombres de campo (`specialHourMultiplier`, `specialHourAdditionalHours`, `specialHourRuleNames`, `specialHourConflict`) y copy ("Hora Especial x2 — Adicional liquidable") deliberadamente distintos para no repetir la ambigüedad de nombres que 8A ya había señalado como riesgo. Un feriado cargado como `HourConceptKind.FERIADO` (Concepto Horario) y una regla de Hora Especial "Feriado" (`DoubleHourRule`) siguen siendo caminos distintos, sin integración entre sí — Ejemplo 4 del pedido original (Domingo aplicando también sobre Sereno) sigue sin implementarse, documentado como pendiente desde 8A/8B.

## 7. Bug del día 27 feriado x2 — respuestas punto por punto

1. **¿La regla matchea correctamente la fecha 27?** Sí, si la carga pasa por el motor — `ruleMatchesDate` con `recurrenceType=FECHA` consulta `SpecialHourRuleDate.isActive`, testeado exhaustivamente desde 8B/8C (Casos S/T, 7 fechas en una sola regla, fecha inactiva no matchea).
2/3. **¿Regla y fecha activas?** El motor las respeta correctamente cuando corre — depende de la configuración real cargada por RRHH, no de un bug de código.
4/5. **¿Alcance correcto?** El AND de scope (`doubleHourRuleScopeWhere`) está bien resuelto y testeado (Casos L–Y de 8B/8C) — funciona igual para todas las dimensiones.
6. **¿Manual o automática?** Ambas rutas existen en el sistema; el bug reproducía en ambas, por causas distintas (§1).
7. **¿La grilla lee las reglas aplicadas?** No, antes de esta etapa — cero referencias a `DoubleHourRule`/`SpecialHourRuleApplication`/`appliedMultiplier` en `HoursPage.tsx` ni en `findPeriodEmployees` (confirmado por grep exhaustivo).
8. **¿El backend calcula las horas especiales para la grilla?** El backend calculaba correctamente para el fichador, pero el endpoint de la grilla no las consultaba.
9. **¿La carga manual dispara el cálculo?** No — causa raíz #1, corregida.
10. **¿La carga automática dispara el cálculo?** Sí, siempre lo hizo correctamente.
11. **¿Cálculo, persistencia, consulta, frontend o cache?** Consulta + frontend (grilla nunca pedía el dato) para el camino automático; falta de disparo del cálculo (no se invocaba el motor) para el camino manual. No fue un bug de cálculo del motor en sí, ni de persistencia.
12/13. **¿Debería la grilla mostrar badge y equivalente liquidable, conservando horas reales?** Sí — implementado (§8.2): badge/indicador visual + horas reales sin inflar en la celda base.
14. **¿Diferencia domingo semanal vs. feriado fecha específica?** No, en cuanto al bug — ambos pasan por el mismo motor y sufrían el mismo gap de visibilidad.
15. **¿Diferencia regla general vs. por alcance?** No — mismo motor, mismo gap.

## 8. Bugs encontrados y corregidos

### 8.1 — Carga manual no aplicaba Horas Especiales (backend)

**Causa exacta**: `timeEntries.repository.ts` `create()`/`update()` nunca consultaban `DoubleHourRule`. **Corrección**: nueva función `resolveDoubleHourMultiplierForManualEntry(employeeId, date)` (reutiliza `doubleHourRuleScopeWhere`/`matchingDoubleHourRules`/`resolveWinningRules`, las mismas funciones puras que usa el fichador — no se duplicó ni se reescribió lógica de matching/prioridad/scope), invocada desde `create()` y `update()` antes de escribir. Escribe únicamente `TimeEntry.appliedMultiplier` — `hours`/`totalMinutes` nunca cambian de fórmula.

**Limitación conocida y aceptada explícitamente por decisión de producto** (ver §10): una carga manual **no genera `TimeSegment`** (no hay jornada real que partir en tramos), y `SpecialHourRuleApplication.timeSegmentId` es una FK obligatoria (no nullable) — por eso una carga manual queda con `appliedMultiplier` correcto (equivalente liquidable/adicional se ven bien en grilla y export) pero **sin** un registro de trazabilidad nombrando la regla exacta que aplicó. Volver `timeSegmentId` opcional es un cambio de schema, fuera de alcance de esta etapa sin aprobación explícita — documentado como candidato a una etapa futura (§12).

`update()` re-resuelve el multiplicador contra la fecha efectiva en cada edición (mismo criterio "se corrige al tocar la fila" que ya usa el fichador desde 8F para autocorregir filas legadas — no es un recálculo retroactivo masivo).

### 8.2 — La grilla de período no exponía ningún dato de Horas Especiales

**Causa exacta**: `findPeriodEmployees` (`GET /time-entries/period-employees`, el endpoint que alimenta la tabla "Cargas del período" de `HoursPage.tsx`) sólo seleccionaba `hours`/`status`/`hourConcept.systemRole`/`workShift.status` de cada `TimeEntry` — nunca `appliedMultiplier` ni la relación a `SpecialHourRuleApplication`. **Corrección**:

- Backend: el `select` de `TimeEntry` ahora incluye `appliedMultiplier` y `timeSegment.specialHourRuleApplications` (filtrado a `isWinner: true`, mismo patrón ya usado por `findForExport` desde 8F — no se inventó un patrón nuevo). La agregación por día/período calcula `specialHourMultiplier`, `specialHourAdditionalHours`, `specialHourRuleNames`, `specialHourConflict`, siempre derivados en lectura, nunca sumados a `total`/`normal`.
- Frontend: `HoursPage.tsx` — un punto ámbar (`alert-dot orange`, reutilizando un tono ya existente en el sistema, distinto del punto morado de novedades) en la celda de cada día con multiplicador aplicado; el popover de detalle muestra "Hora Especial x{N} — {regla(s)} (adicional liquidable +X h)" y, si corresponde, un aviso de conflicto ("Hay más de una Hora Especial en conflicto ese día. Se aplicó la de mayor prioridad."); la columna Total del período muestra un `Badge` "Hora Especial +X h" cuando hay adicional liquidable en el mes. Ningún texto técnico (`TimeEntry`, `DoubleHourRule`, `schema`, `payload`) — verificado con el test existente que ya blinda esto.
- Alcance de UI decidido explícitamente con el usuario antes de implementar: sólo la grilla de período (`HoursPage.tsx`). La grilla mensual por legajo (`EmployeeHoursPage.tsx`) sigue sin este indicador — documentado como pendiente (§12).

### 8.3 — Cache de frontend stale tras mutar un desglose manual (encontrado en el camino, no relacionado a Horas Especiales)

**Causa exacta**: los 5 métodos de `HourConceptBreakdown` manual/automático en `employeeApiService.ts` (`saveManualHourConceptBreakdown`, `approve/reject/returnManualHourConceptBreakdown`, `recalculateAutomaticHourConceptBreakdowns`) no invalidaban ningún cache de frontend. El backend ya invalidaba su propio cache desde la Etapa 7A (`clearTimeEntriesReadCaches` en `employees.controller.ts`), pero es una capa independiente del cache de frontend (`frontend/src/services/cache/`, familia `"time-entries"`, TTL 30s). Resultado: la columna "Especiales" (Conceptos Horarios) de la grilla de período, y la Bandeja de revisión, podían quedar hasta 30s desactualizadas tras guardar/aprobar/rechazar/devolver un desglose manual. **Corrección**: los 4 mutadores que cambian estado de revisión invalidan `"time-entries"` y `"pending"`; el recálculo automático invalida sólo `"time-entries"` (no cambia estado de revisión).

## 9. Bandeja de revisión — mapeado, sin bugs encontrados

- **Datos que muestra**: `HoursPage.tsx` en modo `pendingOnly` (`/pendientes`) — "Horas enviadas a revisión" (`TimeEntry[]` vía `GET /time-entries` o `?view=byEmployee`), "Novedades pendientes", "Desgloses manuales pendientes" (`kind: "hourConceptBreakdown"`, Etapa 6L.5).
- **¿Muestra horas reales?** Sí — `hours` nunca estuvo inflado en esta vista (correcto desde 8F). Se decidió explícitamente **no** agregar el indicador de Horas Especiales a esta tabla en esta etapa (alcance acordado: sólo grilla de período, §8.2).
- **¿Aprobar/rechazar/devolver funciona correctamente?** Sí — `approve`/`reject`/`returnForCorrection` sólo cambian campos de estado del `TimeEntry` (`status`/`approvedByUserId`/`approvedAt`/`rejectedAt`). Ninguno borra ni toca `TimeSegment`/`SpecialHourRuleApplication` — la trazabilidad de una entrada de fichador se preserva intacta al aprobar/devolver/rechazar (simplemente no se mostraba en esta pantalla, ahora tampoco cambia eso).
- **¿Diferencia manual vs. automática dentro de la bandeja?** Ninguna a nivel de query/permisos — el campo `TimeEntry.source` existe (`null` para manual, seteado para fichador) pero no se usa para filtrar ni para mostrar ninguna distinción visual. No es un bug (no lo pide el negocio hoy), documentado como posible mejora futura (§13).

## 10. Export / Cierre — confirmado correcto, sin cambios necesarios

- `exportByPerson` (`timeEntries.service.ts`) ya deriva "Horas especiales (equivalente liquidable)"/"Adicional por horas especiales"/"Reglas de horas especiales aplicadas" desde `real × appliedMultiplier` y `timeSegment.specialHourRuleApplications`, sin ningún cambio de código en esta etapa — el fix de §8.1 alcanza para que, una vez que `appliedMultiplier` sea correcto también en carga manual, el export automáticamente muestre bien el equivalente/adicional. La columna "Reglas aplicadas" queda vacía para filas manuales (consistente con la limitación documentada en §8.1 — no hay `SpecialHourRuleApplication` sin `TimeSegment`).
- `submitClosures` (`workforce.service.ts`) sigue siendo pass-through puro de `_sum.hours` (reales, `systemRole=NORMAL_BASE`) — nunca multiplica, sin cambios.

## 11. Permisos — confirmado correcto, sin bugs

- RRHH ve/carga/aprueba todo. Nivel 2/3 (Supervisión/Carga Horaria) cargan/editan dentro de su scope, pero **sólo RRHH** aprueba/rechaza/devuelve (`assertCanApprove`, Etapa 6L.3).
- Scope de empleados: `employeeAccessWhere` — RRHH sin restricción, Nivel 2/3 vía `EmployeeAssignment.type=TIME_RESPONSIBLE` (asignación explícita persona↔empleado, con vigencia), cualquier otro rol sin acceso. Mismo mecanismo para carga manual y para bandeja — no hay una función de scope distinta entre ambas.
- Horas Especiales no filtran ni exponen datos fuera de ese scope — el motor evalúa por `employeeId` recibido, que ya pasó por `ensureEmployeeScope` antes de llegar al repositorio.

## 12. Qué NO se tocó

- `schema.prisma` — ninguna columna, ningún modelo, ninguna migración.
- El motor puro de matching/prioridad/scope (`doubleHourRuleMatching.ts`, `doubleHourRuleScopeWhere`) — se **reutilizó**, no se modificó.
- El fichador (`TimeClockPage.tsx`, `timeClockApiService.ts`, `clockPhotoPunch`/`clockOutResolved`) — sigue sin preguntar nada sobre Horas Especiales.
- Conceptos Horarios — ningún archivo de `hour-concepts` tocado, ninguna regla de negocio de ese módulo modificada.
- `createFromWorkShift`/`closeOpenWorkShift` — sin cambios (ya estaban correctos desde 8F/8B).
- `HourConceptBreakdown`, la columna "Especiales" existente (Conceptos Horarios) — sin renombrar, sin mezclar con el indicador nuevo.
- La grilla mensual por legajo (`EmployeeHoursPage.tsx`) — decisión explícita de alcance, sin indicador de Horas Especiales en esta etapa.
- La bandeja de revisión — sin indicador de Horas Especiales en la tabla de `TimeEntry` en revisión (decisión explícita de alcance).
- Cálculo de horas reales — `hours`/`totalMinutes` siguen calculándose exactamente igual que antes en todos los caminos.
- Cierre mensual, dashboard — confirmados correctos, sin cambios.

## 13. Reglas futuras / recomendaciones para la grilla

- Si en el futuro se autoriza volver `SpecialHourRuleApplication.timeSegmentId` opcional (cambio de schema + migración), la carga manual podría ganar trazabilidad completa por regla — hoy sólo tiene el multiplicador efectivo.
- Extender el indicador de Horas Especiales a `EmployeeHoursPage.tsx` (grilla mensual por legajo) y/o a la tabla de la Bandeja de revisión, si el negocio lo prioriza — la agregación backend ya expone los campos necesarios (`appliedMultiplier` vía `include` en `findMany`/`findManyByEmployeeGrouped` requeriría el mismo tratamiento que se le dio a `findPeriodEmployees`).
- Evaluar mostrar `TimeEntry.source` (manual vs. fichador) como distinción visual en la Bandeja, si RRHH lo pide.
- El heurístico de superposición del calendario de configuración (`scopesCouldOverlap`, Etapa 8B) sigue siendo advisorio — no cambió en esta etapa.

## 14. Tests agregados/modificados

**Backend** (+14 tests sobre `timeEntries.repository.test.ts`, total 811, todos verdes):
- Carga manual (9 tests, describe "carga manual aplica Horas Especiales — Etapa 11A"): sin regla → multiplicador 1 sin inflar horas; regla FECHA activa (feriado, día 27) → multiplicador correcto; regla SEMANAL domingo → multiplicador correcto; fecha inactiva dentro de una regla FECHA → no aplica; dos reglas que matchean → gana la de mayor multiplicador; scope del empleado se pasa correctamente al `AND` de la query (mismo criterio que el fichador); regla excluida por scope (simulado por el mock, igual criterio que los Casos M-P de 8B) → multiplicador 1; no crea `TimeSegment` ni `SpecialHourRuleApplication`; `update()` re-resuelve el multiplicador contra la fecha nueva.
- Grilla (5 tests sobre `findPeriodEmployees`): expone `specialHourMultiplier`/`specialHourAdditionalHours`/`specialHourRuleNames` sin sumarse a total/normal; sin regla queda en 1/0; una carga manual sin `TimeSegment` igual expone el multiplicador (sin nombre de regla); marca `specialHourConflict` en empate de prioridad; el `select` filtra `specialHourRuleApplications` a `isWinner=true`.

**Frontend** (+8 tests: 5 en `HoursPage.test.tsx` total 35, 3 en `employeeApiService.test.ts` total 16, ambos verdes):
- Grilla: popover muestra "Hora Especial x2"/regla/adicional sin inflar el valor de la celda; sin regla no muestra ningún indicador; conflicto de reglas se indica claramente; badge de período "Hora Especial +Xh" cuando hay adicional en el mes; sin adicional, sin badge.
- Cache: los 5 mutadores de `HourConceptBreakdown` invalidan `"time-entries"`/`"pending"` correctamente.

## 15. Validaciones ejecutadas

| Validación | Resultado |
| --- | --- |
| `npx prisma validate` (backend) | ✅ schema válido |
| `npx prisma generate` (backend) | ✅ |
| `npx prisma migrate status` (backend) | ✅ "Database schema is up to date!" (46 migraciones, sin cambios) |
| `npm run typecheck` (backend) | ✅ sin errores |
| `npx vitest run` (backend) | ✅ 811/811 tests, 62 archivos |
| `npm run build` (backend) | ✅ |
| `npx tsc -b` (frontend) | ✅ sin errores |
| `npx vitest run` (frontend) | ✅ 410/410 tests, 55 archivos |
| `npm run build` (frontend) | ✅ |
| `git diff --check` | ✅ sin errores de espacios en blanco |

## 16. Riesgos pendientes

- **Trazabilidad incompleta para carga manual** (§8.1): una carga manual con Hora Especial aplicada no tiene `SpecialHourRuleApplication` — el export no puede nombrar la regla exacta para esas filas (sólo para las de fichador). Aceptado explícitamente como parte del alcance de esta etapa; requiere cambio de schema para resolverse.
- **Indicador visual no extendido a `EmployeeHoursPage.tsx` ni a la Bandeja** (§8.2, decisión explícita de alcance) — un usuario que sólo mire esas pantallas sigue sin ver el indicador, aunque el dato ya esté disponible/correcto en base.
- **`update()` recalcula el multiplicador en cada edición** (incluso ediciones que no tocan la fecha) — comportamiento intencional (mismo criterio "se corrige al tocar la fila" de 8F), pero puede sorprender si RRHH edita sólo una observación de una fila vieja y el multiplicador cambia silenciosamente porque las reglas activas cambiaron desde que se cargó. No es un bug — es la misma política ya aceptada para el fichador, documentada acá para que quede explícita también para carga manual.
- Los riesgos ya documentados en 8B/8C/8F siguen vigentes sin cambios (sin bandeja de resolución de conflictos, sin política `ACUMULAR` configurable, sin integración con Conceptos Horarios, heurístico de superposición del calendario advisorio).

---

No commitear sin aprobación explícita del usuario.
