# Etapa 15M.5 — Formato canónico de duración humana en Gestión Horaria

Fecha: 2026-09-17
Estado: implementado y testeado, pendiente de aprobación para commitear
Continúa: `docs/decisions/ATTENDANCE_NORMAL_HOURS_RECONCILIATION_15M4.md` (15M.4/15M.4B — los mismos casos reales, legajo 29 y 30, sirven de regresión acá)

> **Extensión 15M.9 — superficies de alta densidad:** el formato largo
> (`10 h 43 min`) sigue siendo el canónico para pantallas normales y KPI. Las
> grillas mensuales usan `formatCompactDurationMinutes` (`10h 43m`) para
> mantener columnas diarias legibles. Ambos formatters reciben minutos reales;
> el compacto es sólo presentación y nunca restaura horas decimales.

## 1. Resumen ejecutivo

Toda la UI de Gestión Horaria (`HoursPage.tsx`, `EmployeeHoursPage.tsx`, `MonthlyHoursReviewGrid.tsx`, `MonthlyClosureReviewPanel.tsx`) y el KPI "Horas cargadas" del dashboard mostraban duraciones como horas decimales con 2 decimales (`2.35`, `4.12`, `1.02`). Ese formato es ambiguo y matemáticamente engañoso: `2.35` se lee naturalmente como "2 horas con 35" pero representa `2h 21min` (`0.35 × 60 = 21`, no `35`). Se creó un formatter canónico único (`formatDurationMinutes`, en minutos) y se reemplazaron todos los puntos donde una duración real se mostraba en decimal. Asistencia ya tenía su propio formatter correcto (`formatDuration` en `AttendancePage.tsx`) — se unificó para que ambas pantallas compartan exactamente la misma función. Ningún cálculo interno, `TimeEntry`, `WorkShift`, `TimeSegment`, Motor A/B, exportación de archivos ni Finnegans se tocó.

## 2. Estado Git

`main`, 0 ahead/0 behind. Etapas 15M.2 a 15M.4B ya estaban commiteadas y pusheadas por el usuario (fuera de esta sesión, confirmado con `git log`/`git rev-list` antes de empezar) — se preservó ese estado sin ningún `reset`.

## 3. Representación anterior

`frontend/src/utils/hours.ts::formatHours(value)` — únicamente `Number(value).toFixed(2)`. Usada en `HoursPage.tsx`, `EmployeeHoursPage.tsx`, `MonthlyHoursReviewGrid.tsx` y `MonthlyClosureReviewPanel.tsx` para mostrar "Horas trabajadas", "Hora normal", "Conceptos adicionales", "Valor liquidable", "Total liquidable" y KPIs del período — siempre como `"X.XX h"`, sin ninguna conversión a horas/minutos. Ejemplo real confirmado (legajo 29, 17/09/2026, 08:59→11:20): 141 minutos reales se mostraban como `"2.35 h"`.

## 4. Representación nueva

`formatDurationMinutes(totalMinutes)` — deriva SIEMPRE de minutos:
```
0    -> "0 h"
21   -> "21 min"
60   -> "1 h"
61   -> "1 h 1 min"
141  -> "2 h 21 min"
250  -> "4 h 10 min"
601  -> "10 h 1 min"
```
141 minutos ahora se muestran como `"2 h 21 min"` — igual que Asistencia ya mostraba.

## 5. Helper canónico

`frontend/src/utils/hours.ts`, tres funciones:
- `formatDurationMinutes(totalMinutes)` — el formatter canónico único. Reutilizado tal cual en `AttendancePage.tsx` (antes tenía su propia copia local `formatDuration`, con la misma lógica salvo un detalle, ver §17 — se eliminó la duplicación).
- `hoursDecimalToMinutes(hours)` — `Math.round(hours * 60)`, para los pocos DTO que sólo exponen horas decimales sin ningún campo de minutos en paralelo.
- `formatDecimalHoursDuration(hours)` — composición de las dos anteriores, para no repetir `formatDurationMinutes(hoursDecimalToMinutes(x))` manualmente en cada componente.

`formatHours` (el `.toFixed(2)` original) se **eliminó por completo** — se confirmó por grep que, tras migrar los 4 archivos que la usaban, quedaba con cero importadores reales en todo `frontend/src`.

## 6. Regla de redondeo

`minutes = Math.round(decimalHours * 60)`, luego `hours = Math.floor(minutes / 60)`, `remainingMinutes = minutes % 60` — exactamente la fórmula pedida. Preferencia estricta respetada en cada call site: si ya existe un campo de minutos (`totalMinutes`, `actualMinutes`, `specialHourLiquidableTotalMinutes`, `specialHourAdditionalMinutes`, `row.totalMinutes`, `breakdownMinutes`), se usa **directamente**, sin pasar por ninguna conversión decimal — la conversión sólo se aplica donde el backend no expone minutos en absoluto (ver §14).

## 7. Grilla general (`HoursPage.tsx`)

Celda diaria, popover de detalle, KPI "Horas contables", fila de "Bandeja de revisión" y tabla de período — todos migrados a `formatDecimalHoursDuration`/`formatDurationMinutes`. El día 27 de un feriado x2 con Sereno, antes mostrando "8.00 h"/"24.00 h" en el popover, ahora muestra "8 h"/"24 h" (casos de test ya existentes, con valores redondos — ver §21).

## 8. Detalle del empleado (`EmployeeHoursPage.tsx`)

Celda de Hora normal (usa `entry.totalMinutes`, con fallback a `hoursDecimalToMinutes(entry.hours)` sólo si el mapper no trajera minutos — en la práctica siempre presente), celdas de desglose (`breakdownMinutes`, ya en minutos), fila de total (`row.totalMinutes`), KPIs "Horas trabajadas"/"Desgloses adicionales"/"Valor liquidable" y los avisos de Hora Especial en los modales — todos en minutos directos.

## 9. Hora normal

Sin cambios de cálculo — sigue siendo `TimeEntry.totalMinutes`/`actualMinutes`, el total físico completo. Sólo cambió cómo se **muestra**: `formatDurationMinutes(row.totalMinutes)` en vez de `formatHours(row.totalMinutes / 60)`.

## 10. Conceptos adicionales

Mismo criterio — `breakdownMinutes`/`additionalBreakdownMinutes(rows)` (renombrada desde `additionalBreakdownHours`, que dividía por 60 innecesariamente) se formatean directo, sin pasar por decimal en ningún punto intermedio.

## 11. KPI "Horas trabajadas"

`EmployeeHoursPage.tsx`: `totalWorkedMinutesFromRows(rows)` ya devuelve minutos — se eliminó la división por 60 que existía antes sólo para alimentar `formatHours`. `HoursPage.tsx`: `hoursSummary.countableHours` es decimal puro (no hay campo de minutos en `GET /time-entries/summary`) — se usa `formatDecimalHoursDuration`.

## 12. KPI "Desgloses adicionales"

`additionalBreakdownMinutes(rows)` directo en `EmployeeHoursPage.tsx`/`MonthlyClosureReviewPanel.tsx`. `2.50 h` (como decía el ejemplo del pedido) pasa a mostrarse `"2 h 30 min"`.

## 13. Valor liquidable

Auditado antes de tocar (pedido §10): `specialHourLiquidableTotalMinutes`/`liquidableTotalMinutes` representan minutos equivalentes liquidables (real × multiplicador de Hora Especial) — **es una duración**, no un valor monetario ni otra magnitud — confirmado releyendo `docs/decisions/HOURS_GRID_SPECIAL_HOURS_LIQUIDABLE_11A1.md` y el propio nombre del campo (`*Minutes`). Se formatea igual que cualquier otra duración. El multiplicador en sí (`formatMultiplier`, "x2") es un valor distinto, no tocado.

## 14. Totales diarios / período

Regla aditiva preservada sin cambios: Hora normal sigue siendo el total físico completo del día/período (`Σ TimeSegment.minutes` vía `TimeEntry.totalMinutes`), los conceptos adicionales se muestran aparte y nunca se suman al total trabajado. `totalWorkedMinutes` del período sigue siendo exclusivamente `Σ` de Hora normal, sin incluir `HourConceptBreakdown` — sólo cambió el formato con el que se **muestra** ese número (`formatDurationMinutes`), nunca el número en sí.

## 15. Sumas

No se introdujo ninguna suma nueva en este cambio — donde ya existían sumas (`totalWorkedMinutesFromRows`, `additionalBreakdownMinutes`, agregación backend), siguen operando exclusivamente sobre minutos/enteros, nunca sobre strings ya formateados ni sobre decimales parcialmente redondeados. Test explícito agregado (`hours.test.ts`): `141 + 247 + 62 = 450` → `"7 h 30 min"`, nunca `2.21 + 4.07 + 1.02` ni una suma de strings.

## 16. Reglas horarias / Horas Especiales

Sin cambios de lógica — `doubleHourRuleMatching.ts`, `appliedMultiplier`, `SpecialHourRuleApplication` no se tocaron. Sólo se formatea distinto el resultado ya calculado.

## 17. Caso legajo 29 (17/09/2026, 08:59→11:20 = 141 min)

`hours.test.ts` incluye el caso exacto: `formatDurationMinutes(141) === "2 h 21 min"`. Asistencia (que siempre usó minutos correctamente) y Carga Horaria ahora usan literalmente la misma función (`formatDurationMinutes`), garantizando que ambas pantallas coincidan — no sólo "por casualidad" sino porque comparten el código.

## 18. Caso legajo 30 (16/09, reconciliado en 15M.4 a 250 min)

`hours.test.ts`: `formatDurationMinutes(250) === "4 h 10 min"` — nunca `"4.17"`. Sirve como test de regresión cruzada entre 15M.4 (dato correcto en base) y 15M.5 (dato mostrado correctamente).

## 19. Tests del formatter

`frontend/src/utils/hours.test.ts` (nuevo, 25 tests): los 13 valores pedidos (`0,1,21,59,60,61,119,120,121,141,247,250,601`) con resultados exactos, `null`/`undefined`/negativos/`NaN` → `"0 h"`, redondeo de fraccionarios, `hoursDecimalToMinutes` (incluidos los 3 ejemplos del pedido: 2.35→141, 4.12→247, 4.17→250), la composición `formatDecimalHoursDuration`, y el pipeline completo decimal→minutos→humano.

## 20. Tests de sumas

Incluidos en `hours.test.ts`: `141+247+62=450 → "7 h 30 min"` (ejemplo obligatorio del pedido) y una suma de 5 días reales (incluido un día en 0).

## 21. Tests de grilla/detalle/KPI

Se actualizaron las aserciones ya existentes que esperaban el formato viejo (`"8.00 h"` → `"8 h"`, `"6.00"` → `"6 h"`, etc.) en `HoursPage.test.tsx`, `EmployeeHoursPage.test.tsx` y `MonthlyHoursReviewGrid.test.tsx` — todos los valores de esos tests son horas redondas, así que el cambio de formato es mecánico y no requirió nuevos casos con minutos sueltos (esos ya quedan cubiertos por `hours.test.ts`). Se agregó un test nuevo en `DashboardPage.test.tsx` para el KPI "Horas cargadas" con un valor no-redondo (2.35h → "2 h 21 min"), el único KPI de esa pantalla que mostraba una duración real.

## 22. Pantallas auditadas

`HoursPage.tsx`, `EmployeeHoursPage.tsx`, `MonthlyHoursReviewGrid.tsx`, `MonthlyClosureReviewPanel.tsx`, `AttendancePage.tsx` (unificado, no reescrito), `DashboardPage.tsx` (KPI "Horas cargadas", encontrado en la auditoría global — ver §29 del pedido). Grep exhaustivo confirmó cero patrones de decimal-hours restantes (`toFixed`, `formatHours`, `Number(...).hours`) en ningún archivo de Gestión Horaria/Asistencia/Dashboard tras el cambio.

## 23. Exportaciones no afectadas

`frontend/src/utils/hoursExport.ts` (Excel de liquidación) y `timeEntryApiService.ts::toExportRow`/`getPeriodExportRowsFromEntries` — auditados, confirmado que escriben campos numéricos decimales crudos a la planilla (nunca strings formateados con `formatHours`/`formatDurationMinutes`) — **no se tocaron**, siguen exactamente igual. Finnegans (`finnegans-export/*`, `FinnegansExportPage.tsx`) no fue tocado en absoluto — nunca exportó horas, sólo novedades, sin relación con este cambio.

## 24. Backend modificado

**No.** Se auditaron los endpoints que alimentan estas pantallas (`GET /time-entries/period-employees`, `GET /employees/:id/time-grid`, `GET /time-entries/summary`, `GET /dashboard`) — ninguno calcula un total de forma incorrecta; todos agregan minutos/horas reales correctamente en el backend. El único "defecto" era de **presentación** en el frontend. Por eso este cambio es 100% frontend, sin ninguna migración ni cambio de contrato de API.

## 25. Validaciones frontend

`npx tsc -b` limpio, `npx tsc -p tsconfig.e2e.json --noEmit` limpio, `npm test` → **983/983** (93 archivos; 953 previos + 30 nuevos/actualizados), `npm run build` limpio.

## 26. Validaciones backend

Sin cambios de código backend. Ejecutado igual como práctica estándar: `prisma validate`/`generate` OK, `typecheck` limpio, `npm test` → **1775/1775** (114 archivos, sin cambios), `build` limpio.

## 27. Documentación

Este archivo. Actualizado `docs/PROJECT_CONTEXT.md`.

## 28. Archivos modificados

- `frontend/src/utils/hours.ts` — reescrito (formatter canónico, `hoursDecimalToMinutes`, `formatDecimalHoursDuration`; se eliminó `formatHours`).
- `frontend/src/utils/hours.test.ts` — nuevo.
- `frontend/src/utils/employeeHoursGrid.ts` / `.test.ts` — `additionalBreakdownHours` renombrada a `additionalBreakdownMinutes` (minutos, no horas).
- `frontend/src/components/hours/MonthlyHoursReviewGrid.tsx` / `.test.ts` (implícito, sólo una aserción).
- `frontend/src/components/hours/MonthlyClosureReviewPanel.tsx`.
- `frontend/src/pages/HoursPage.tsx` / `HoursPage.test.tsx`.
- `frontend/src/pages/EmployeeHoursPage.tsx` / `EmployeeHoursPage.test.tsx`.
- `frontend/src/pages/AttendancePage.tsx` (unificación, sin cambio de comportamiento salvo el detalle de §17 de la comparación con el formato viejo, ya documentado como mejora, no regresión).
- `frontend/src/pages/DashboardPage.tsx` / `DashboardPage.test.tsx` (KPI "Horas cargadas", hallazgo de la auditoría global).
- `docs/decisions/HUMAN_DURATION_FORMAT_15M5.md` (nuevo), `docs/PROJECT_CONTEXT.md`.

## 29. Riesgos

- Las celdas de la grilla mensual (hasta 31 columnas) ahora pueden mostrar textos más largos ("2 h 21 min" en vez de "2.35") — se decidió priorizar la consistencia/legibilidad pedida explícitamente por el encargo (mismo formato en toda la superficie) por sobre la compacidad; el formato compacto alternativo ya documentado (`formatMinutesDuration`, "2h 21m", usado en `WorkShiftSegmentsPanel.tsx`) queda disponible como opción futura si el ajuste visual real (no evaluado en esta etapa, sin levantar el servidor) lo requiriera.
- `AttendancePage.tsx` cambia de comportamiento para duraciones menores a 60 minutos: antes mostraba `"0 h 21 min"`, ahora `"21 min"` — es la corrección explícita que pedía el encargo (formato canónico uniforme), no un efecto colateral no buscado.
