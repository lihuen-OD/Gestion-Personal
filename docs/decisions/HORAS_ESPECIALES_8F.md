# Etapa 8F — Separar horas reales de horas liquidables en consumidores de Horas Especiales

Fecha: 2026-08-26
Estado: implementado, pendiente de aprobación para commitear
Continúa: `docs/decisions/HORAS_ESPECIALES_AUDITORIA_8A.md` (hallazgo §6, punto 1)

## 1. Diagnóstico exacto de campos

| Campo | Antes de 8F | Después de 8F |
| --- | --- | --- |
| `TimeEntry.actualMinutes` | Minutos reales trabajados. Se escribía correctamente, pero **no lo leía nadie fuera de `timeEntries.repository.ts`**. | Igual, pero ahora es un alias exacto de `totalMinutes` (ambos son siempre el mismo valor real) — compatibilidad/deuda temporal, no se elimina. |
| `TimeEntry.totalMinutes` / `TimeEntry.hours` | `segment.minutes * appliedMultiplier` (minutos ya multiplicados) en las dos rutas automáticas del fichador. Es el campo que leían dashboard, cierre, grilla y export como "horas trabajadas". | Minutos/horas reales — igual a `actualMinutes`. Nunca se multiplican por una Hora Especial. |
| `TimeEntry.appliedMultiplier` | El multiplicador efectivo (mayor entre las reglas que matchearon), sólo usado para escribir el valor inflado. | Igual (se sigue escribiendo), pero ahora es la única fuente para derivar el valor liquidable en lectura — no se persiste ningún minuto multiplicado. |
| `SpecialHourRuleApplication` | Trazabilidad de qué `DoubleHourRule` matcheó qué `TimeSegment`, con su multiplicador — no se leía en ningún reporte. | Sin cambios en escritura; ahora también se usa en lectura (export) para nombrar la regla aplicada. |

Dónde se calcula `appliedMultiplier`: `matchingDoubleHourRules`/`effectiveMultiplier` en [timeEntries.repository.ts:152-177](../../backend/src/modules/time-entries/timeEntries.repository.ts#L152) — sin cambios, esa lógica ya estaba bien y no se tocó.

Dónde se escriben `hours`/`totalMinutes`/`actualMinutes`/`appliedMultiplier`: únicamente en `createFromWorkShift` y `closeOpenWorkShift` ([timeEntries.repository.ts](../../backend/src/modules/time-entries/timeEntries.repository.ts)), los dos únicos lugares donde `DoubleHourRule` toca datos reales (confirmado en 8A). Ninguna otra ruta (carga manual, `update()`, Conceptos Horarios) escribe estos campos con lógica de multiplicador.

## 2. Consumidores auditados y clasificación

| Consumidor | Archivo | Lee | Clasificación | Acción |
| --- | --- | --- | --- | --- |
| Dashboard — KPI "horas cargadas" | `dashboard.repository.ts:sumLoadedHours` / `dashboard.service.ts` | `_sum: { hours }` filtrado `NORMAL_BASE` | Debe mostrar horas reales | Ninguna — pass-through puro, se corrige solo al arreglar la escritura |
| Resumen de horas | `timeEntries.repository.ts:summary()` (`countableHours`) | `_sum: { hours }` filtrado `NORMAL_BASE` | Debe mostrar horas reales | Ninguna — pass-through |
| Grilla — vista por empleado | `timeEntries.repository.ts:findManyByEmployeeGrouped` | suma `entry.hours` filtrado `NORMAL_BASE` | Debe mostrar horas reales | Ninguna — pass-through |
| Grilla — vista por período (`findPeriodEmployees`) | `timeEntries.repository.ts` | suma `entry.hours` filtrado `NORMAL_BASE`, por día (`dailyBreakdown`) | Debe mostrar horas reales | Ninguna — pass-through |
| Legajo — grilla aditiva (`buildAdditiveTimeGrid`, `totalWorkedMinutes`) | `employees.service.ts` | suma `entry.hours` filtrado `NORMAL_BASE` | Debe mostrar horas reales | Ninguna — pass-through |
| Cierre mensual — snapshot | `workforce.service.ts:submitClosures` | `_sum: { hours }` filtrado `NORMAL_BASE` | Debe mostrar horas reales | Ninguna — pass-through |
| Corrección posterior al cierre | `workforce.service.ts:createCorrection/approveCorrection` | `entry.hours` individual | Debe mostrar/operar sobre horas reales | Ninguna — opera sobre el valor vigente, que ahora es real |
| Bandeja "pendientes" | `pending.service.ts` | `entry.hours` individual | Debe mostrar horas reales | Ninguna — pass-through |
| Export de nómina | `timeEntries.service.ts:exportByPerson` | `entry.hours`, ahora también `appliedMultiplier` y `timeSegment.specialHourRuleApplications` | Debe mostrar **ambas** (real y liquidable, en columnas separadas) | **Modificado** — 3 columnas nuevas |
| Conceptos Horarios (`HourConceptBreakdown`) — grilla/export | varios | `minutes` de `HourConceptBreakdown` | No aplica (dominio distinto, ya excluido del total desde la Etapa 6M) | Ninguna |

Conclusión: de once consumidores identificados, **diez ya quedan correctos con solo arreglar la escritura** — nunca tuvieron lógica propia de multiplicación, sólo sumaban lo que la base tenía. El único que necesitaba código nuevo es el export, porque ahí es donde el negocio necesita ver el valor liquidable — si no se agrega en columna aparte, esa información desaparece del reporte en vez de mostrarse mal.

## 3. Estrategia elegida

Se aplicó la estrategia preferida indicada en el encargo, viable sin migración: **corregir la escritura, no los 10 consumidores**.

- `TimeEntry.totalMinutes`/`hours` vuelven a representar minutos/horas reales.
- `TimeEntry.actualMinutes` queda como alias redundante (mismo valor) — deuda documentada, no se elimina el campo (evita tocar `schema.prisma`).
- `TimeEntry.appliedMultiplier` sigue igual, es la fuente de verdad del multiplicador.
- El valor liquidable/equivalente se deriva en lectura (`real × appliedMultiplier`), sólo donde hace falta (export) — nunca se vuelve a persistir inflado.

Por qué no la alternativa ("corregir consumidores para leer `actualMinutes`"): hubiera significado tocar 6-7 archivos de lectura distintos para lograr exactamente el mismo resultado que corregir 2 funciones de escritura, y habría dejado `hours`/`totalMinutes` mintiendo en la base para cualquier consumidor futuro que no se acuerde de usar `actualMinutes`. Corregir la escritura es la opción de menor superficie y la que hace que el dato sea correcto por default, no por convención.

## 4. Qué cambió

**Backend:**
- [timeEntries.repository.ts](../../backend/src/modules/time-entries/timeEntries.repository.ts) — `createFromWorkShift` y `closeOpenWorkShift`: `hours`/`totalMinutes`/`actualMinutes` pasan a calcularse siempre desde minutos reales (`segment.minutes`, o `existing.actualMinutes ?? existing.totalMinutes` + `segment.minutes` al fusionar con un `TimeEntry` existente). Se eliminó la variable `creditedMinutes` (quedaba sin uso). `appliedMultiplier` se sigue escribiendo igual.
  - Efecto colateral buscado: la fórmula de fusión (`existing.actualMinutes ?? existing.totalMinutes`, no `existing.totalMinutes`) hace que un `TimeEntry` legado que haya quedado inflado antes de esta etapa **se autocorrija solo** la próxima vez que reciba un tramo nuevo, sin necesitar un script de backfill (ver §8).
- `findForExport` — se agregó `timeSegment.specialHourRuleApplications.doubleHourRule.name` al include (el multiplicador ya venía por default).
- `exportByPerson` — 3 columnas nuevas: `Horas especiales (equivalente liquidable)`, `Adicional por horas especiales`, `Reglas de horas especiales aplicadas`. `Horas normales`/`Horas trabajadas totales` quedan con la misma fórmula de antes (ahora automáticamente correctas).

**Frontend:**
- `timeEntryApiService.ts` — tipo `ApiExportResponse` y `toExportRow` extendidos con las 3 columnas nuevas.
- `hoursExport.ts` — `HoursExportRow` y `buildHoursExportWorkbook` agregan las mismas 3 columnas al Excel que descarga RRHH.
- `getPeriodExportRowsFromEntries` (fallback local sin backend, modo mock/error de red) — se completan las 3 columnas nuevas con `0`/cadena vacía, documentado en comentario: ese camino no tiene acceso a `appliedMultiplier`/`SpecialHourRuleApplication`, así que no inventa un valor liquidable.
- No se tocó ninguna pantalla (grilla, dashboard, cierre) — quedan correctas sin cambios de UI porque el dato de base ya es real.

**Docs:**
- Este documento.
- `docs/decisions/HORAS_ESPECIALES_AUDITORIA_8A.md` — nota de actualización al inicio.
- `docs/BACKEND_API_CONTRACTS.md` — columnas nuevas del export documentadas.

## 5. Qué no cambió y por qué

- `schema.prisma`: sin cambios. No hacía falta ningún campo nuevo — `actualMinutes` y `appliedMultiplier` ya alcanzaban.
- No se creó ninguna migración.
- No se tocó el fichador (`TimeClockPage.tsx`, `timeClockApiService.ts`) — nunca preguntó nada sobre Horas Especiales y sigue sin hacerlo.
- No se tocó la grilla de carga (`HoursPage.tsx` más allá del export), ni Conceptos Horarios/`HourConceptBreakdown` — quedan igual porque `DoubleHourRule` nunca los tocó (ver 8A) y esta etapa no integra esos caminos, sólo corrige el dato que sí se genera hoy.
- No se agregó recálculo retroactivo masivo (barrer todos los `TimeEntry` ya cerrados) — no hizo falta: no hay ninguna fila afectada hoy (ver §8) y el mecanismo de autocorrección al tocar un `TimeEntry` existente cubre el caso real que puede volver a pasar.
- Alcance/scope, calendario de feriados, integración con Conceptos Horarios, terminología sobrecargada: deliberadamente fuera de esta etapa (son 8B en adelante).

## 6. Tests agregados/modificados

Backend:
- `timeEntries.repository.test.ts` — Caso I reescrito (antes esperaba `totalMinutes: 480` para un real de 240 con x2; ahora exige `totalMinutes === actualMinutes === 240`, `appliedMultiplier === 2`). Caso J nuevo: un `TimeEntry` existente ya inflado antes de 8F se autocorrige al recibir un nuevo tramo. Caso K nuevo: cruce de medianoche sábado 22:00→domingo 02:00, sólo el tramo domingo recibe la regla, los dos `TimeEntry` (uno por fecha) quedan en minutos reales.
- `timeEntries.service.test.ts` — `exportEntry()` extendido con `appliedMultiplier`/`timeSegment.specialHourRuleApplications`. Dos tests nuevos: Domingo x2 (real 8 / liquidable 16 / adicional 8 / regla nombrada) y sin regla (liquidable = real, adicional 0, regla vacía).
- `dashboard.repository.test.ts` — test nuevo confirmando que `sumLoadedHours` es un pass-through puro (no multiplica nada por su cuenta).
- `workforce.service.test.ts` — test nuevo confirmando que el snapshot del cierre guarda exactamente el `_sum.hours` devuelto por Prisma, sin volver a multiplicarlo.
- Sin cambios (siguen verdes, cubren requisitos ya satisfechos): tests de Conceptos Horarios aditivos sin sumarse al total (Etapa 6M), tests de `SpecialHourRuleApplication`/multiplicador efectivo Casos A-H, tests de `summary()`/`findPeriodEmployees`/`findManyByEmployeeGrouped` (ya eran pass-through puro, documentados como tal en 6M).

Frontend: no se agregaron tests nuevos — no había tests existentes sobre `hoursExport.ts`/`toExportRow`/`getPeriodExportRowsFromEntries` que hiciera falta actualizar, y el cambio es aditivo (columnas nuevas, tipos extendidos).

## 7. Validación manual

**No se ejecutó contra la base.** `backend/.env` apunta a una base Postgres real y compartida (Neon, `neondb`, `APP_ENV=staging`), no a una base local descartable. Simular el flujo completo (crear una regla Domingo x2, generar una jornada real vía fichador, revisar dashboard/export, revertir) implica crear y después borrar `AttendancePunch`/`WorkShift`/`TimeSegment`/`TimeEntry`/`DoubleHourRule` reales — y en el camino, entradas de auditoría (`AuditLog`) que no deberían borrarse para "revertir" limpio. Eso es una acción con impacto sobre una base compartida, no reversible del todo (el rastro de auditoría queda), y no estaba autorizada explícitamente para esta etapa.

En su lugar, la corrección se verificó de punta a punta con tests automatizados que ejercitan exactamente la misma función que usaría el fichador real (`createFromWorkShift`) con el escenario pedido (Domingo x2, real 8h/240min si se toma el caso de 4h de los tests existentes, liquidable 16h/equivalente, `totalMinutes`/`hours` sin inflar) — Caso I, Caso K y los dos tests nuevos de export cubren exactamente los 4 puntos que pedía la validación manual (real=8, regla registrada x2, total mostrado=real, columna liquidable=equivalente). Si preferís que se ejecute igual contra la base compartida, decime con qué legajo de prueba puedo trabajar y confirmo antes de crear/borrar nada ahí.

## 8. Impacto sobre datos existentes

Se corrió una consulta de sólo lectura contra la base conectada (`backend/.env`, Neon `neondb`) antes de cualquier cambio:

```
TimeEntry.count({ where: { appliedMultiplier: { not: 1 } } }) = 0
```

**Cero filas afectadas hoy.** No hace falta backfill ni script de corrección de datos — no hay ningún `TimeEntry` ya inflado por una `DoubleHourRule` en la base actual. No se modificó ni se borró ningún dato existente en esta etapa.

## 9. Datos demo revertidos

No aplica — no se creó ni modificó ningún dato demo (ver §7 y §8).

## 10. Riesgos pendientes

- El mecanismo de autocorrección (recalcular desde `actualMinutes ?? totalMinutes` al fusionar con un `TimeEntry` existente) sólo corrige una fila cuando esa fila recibe un tramo nuevo. Si en el futuro apareciera una fila inflada que nunca vuelve a tocarse (ej. un período ya cerrado), quedaría inflada hasta que se decida un backfill explícito — hoy no aplica (§8), pero es una condición a vigilar si se detecta una fila con `appliedMultiplier != 1` y `totalMinutes != actualMinutes` en el futuro.
- El resto de los hallazgos de la auditoría 8A (scope obligatorio, sin calendario de feriados, sin integración con Conceptos Horarios, terminología sobrecargada, sin recálculo retroactivo masivo) siguen sin resolver — quedan para 8B en adelante, tal como estaba previsto.
- No se validó manualmente contra la base real (ver §7) — la cobertura de tests automatizados es sólida, pero no reemplaza una corrida end-to-end contra Postgres real si se quiere el nivel de confianza más alto antes de aprobar.
