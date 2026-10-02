# Modelo de contabilidad de tiempo trabajado

**Estado:** vigente desde 2026-10-02. **Reemplaza** la regla "todo `HourConceptBreakdown` es un desglose que nunca incrementa el total trabajado" (`CONCEPTOS_HORARIOS_ADITIVOS.md`, Etapa 6M) y el cálculo de "Total liquidable" de las Etapas 8F/11A.1/11B/11C (`base + conceptos + (base + conceptos) × (m − 1)`, ejemplo histórico "8 normales + 4 Sereno ×2 = 24").

La aplicación no calcula sueldos. Entrega tiempo real, su clasificación por concepto y la equivalencia en horas para liquidación. Tarifas, valores monetarios y diferenciales los resuelve el sistema de liquidación.

## 1. Las dos preguntas que el sistema responde por separado

1. **¿Cuánto trabajó realmente?** Horas base + conceptos adicionales fuera de la fichada.
2. **¿Cómo se compone ese tiempo para liquidación?** Horas normales residuales + conceptos dentro de la jornada + conceptos adicionales, cada componente × su multiplicador de Hora Especial.

## 2. Semántica explícita del concepto: `HourConcept.workTreatment`

| Valor | Significado | Efecto |
|---|---|---|
| `WITHIN_BASE` ("Dentro de la jornada") | Clasifica minutos que ya están dentro de las Horas base (ej. Sereno, Guardia). | No suma al total trabajado. Reduce las Horas normales residuales. |
| `ADDITIVE_TO_WORKED_TOTAL` ("Horas adicionales") | Tiempo trabajado que no está en la fichada (ej. Colectivo, Camioneta). | Suma al total trabajado. Nunca se resta de la base. |

- `NORMAL_BASE` no tiene tratamiento (columna `NULL`). Para todo concepto adicional es obligatorio: CHECK `HourConcept_work_treatment_check`, mismo patrón que `HourConcept_official_model_check` de `loadMode`.
- **`loadMode` no decide la semántica.** `loadMode` dice cómo se carga un concepto (MANUAL/AUTOMATIC/BOTH), y `workTreatment` dice si suma al total. Un concepto `WITHIN_BASE` con `loadMode = BOTH` sigue dentro de la jornada cuando se corrige a mano. Ninguna regla productiva usa `loadMode`, `source`, `name` ni `code` para decidir si un concepto suma.
- `countsAsWorked` sigue deprecado y no participa. `priority` no se reactivó.
- Cambiar `workTreatment` de un concepto que ya tiene horas cargadas se rechaza (`409 HOUR_CONCEPT_WORK_TREATMENT_LOCKED`) porque reinterpretaría en silencio totales, cierres y exports históricos. La alternativa es crear un concepto nuevo.

## 3. Fórmulas oficiales (por empleado + fecha)

```
baseMinutes            = minutos reales de TimeEntry NORMAL_BASE
cobertura              = unión de intervalos WITHIN_BASE + minutos WITHIN_BASE sin intervalo
normalResidualMinutes  = max(0, baseMinutes − cobertura)
additiveMinutes        = Σ minutos ADDITIVE_TO_WORKED_TOTAL
totalWorkedMinutes     = baseMinutes + additiveMinutes        (nunca + WITHIN_BASE)

settlement.normal      = normalResidual × multiplicador de la base del día
settlement.<concepto>  = minutos reales del concepto × su propio multiplicador
settlement.total       = settlement.normal + Σ WITHIN_BASE + Σ ADDITIVE
```

Una única implementación: `backend/src/modules/time-entries/workedTimeAccounting.ts` (`accountDay`, `accountEmployeePeriods`, `accountEmployeePeriod`, `withinBaseCoverageMinutes`, `totalWorkedHours`). Ningún consumidor vuelve a escribir `base − dentro + adicionales`.

`TimeEntry.hours` nunca se reescribe: la base de 8 h persiste como 8 h, y el residual se deriva al leer.

## 4. Ejemplos de referencia (cubiertos por tests)

| Caso | Entrada | Real | Para liquidación |
|---|---|---|---|
| A — Sereno | Base 8, Sereno 3 | Normal 5, Sereno 3, **total 8** | 8 |
| B — Colectivo | Base 8, Colectivo 1 | Normal 8, Colectivo 1, **total 9** | 9 |
| C — Combinado | Base 8, Sereno 3, Colectivo 1 | Normal 5, Sereno 3, Colectivo 1, **total 9** | 9 |
| D — Domingo ×2 | Base 8, Sereno 3, Colectivo 1 | **total 9** | Normal 10, Sereno 6, Colectivo 2 = **18** (= 9 × 2) |
| Sólo adicional, domingo ×2 | Base 0, Colectivo 2 | **2** | **4**: usa el multiplicador propio del desglose, no depende de un TimeEntry |
| Sereno sin base | Base 0, Sereno 2 | rechazado al cargar | nunca se convierte en 2 h adicionales |
| Adicional no se resta | Base 8, Sereno 3, Colectivo 4 | Normal **5** (no 1), total 12 | — |

Tampoco se aceptan 22 h (`(8+3)×2`) ni 24 h (`(8+4)×2`).

## 5. Superposición entre conceptos dentro de la jornada

- **Datos al 2026-10-02:** ningún empleado/día tiene más de un concepto con horas (auditoría READ-ONLY), así que no había solapamientos reales.
- **Estrategia:** las Horas normales residuales descuentan la **unión** de la cobertura, nunca la suma. Ejemplo: Sereno 23–02 + Guardia 01–03 sobre base 8 da cobertura 4 h, Horas normales 4 (no 3), Sereno 3 y Guardia 2 (cada concepto conserva su desglose), y el total real sigue en 8.
- Para que la unión sea exacta, los desgloses `AUTOMATIC` persisten su **intervalo real** (`HourConceptBreakdown.startAt/endAt`), que es la intersección fichada × regla ya partida por fecha Argentina.
- Los desgloses `MANUAL` no tienen posición dentro de la jornada. Sus minutos se toman como una distribución declarada, y la protección es la validación al guardarlos (§7).
- **Aviso:** la contabilidad expone `withinBaseOverlapMinutes` y la UI muestra una nota cuando hay superposición.
- **Limitación conocida:** un desglose manual y uno automático del mismo día no pueden detectar superposición entre sí. Se tratan como disjuntos, y la validación al cargar evita que superen la base.
- `withinBaseExcessMinutes > 0` indica cobertura mayor que la base aprobada del día. Ejemplo: Sereno en BORRADOR sin base aprobada, como el caso histórico del legajo 03 el 03/08/2026. Se marca como inconsistencia a revisar, nunca como horas adicionales.

## 6. Multiplicador de Hora Especial: snapshot también en el desglose

`HourConceptBreakdown.appliedMultiplier Decimal(4,2) default 1` sigue la misma filosofía que `TimeEntry.appliedMultiplier`:

- **Carga manual:** se resuelve con el motor de Hora Especial al crear o actualizar (`resolveDoubleHourMultipliersByDate`).
- **Automáticos:** se resuelve en batch al regenerar el período, con 2 consultas por recálculo (alcance del empleado y reglas vigentes en el rango). Nunca hay una consulta por desglose.
- **Consecuencias:** un Colectivo de domingo conserva su ×2 aunque ese día no haya TimeEntry, y editar una regla después no cambia la historia. Reemplaza la limitación documentada en 11A.1, donde un desglose "huérfano" quedaba en ×1.
- **Cruce de medianoche:** TimeEntry y desgloses ya llegan partidos por fecha Argentina, y cada tramo usa el multiplicador de su fecha. Una jornada sábado 22:00 → domingo 03:00 queda con el sábado ×1 y el domingo ×2.
- **Varias bases el mismo día:** si las bases de un día tienen multiplicadores distintos (caso raro), el residual se valoriza al promedio ponderado de la base.

## 7. Carga manual (`PUT /employees/:id/hour-concept-breakdowns/manual`)

- **`WITHIN_BASE`:** requiere Horas base registradas ese día (TimeEntry NORMAL_BASE no rechazado, incluida la base de fichada en BORRADOR). Si no hay base, responde `409 WITHIN_BASE_REQUIRES_BASE_HOURS` con "No se puede cargar Sereno dentro de la jornada porque no hay horas base registradas para ese día.". La cobertura resultante, unida con los demás conceptos dentro de la jornada de ese día, no puede superar la base (`409 WITHIN_BASE_EXCEEDS_BASE_HOURS`).
- **`ADDITIVE_TO_WORKED_TOTAL`:** puede existir sin base.
- Se mantiene todo lo demás: período cerrado (`PERIOD_CLOSED`, corrección RRHH con motivo), aprobación por rol, aprobar, rechazar y devolver, auditoría.
- No se crea ningún TimeEntry para simular horas adicionales.

## 8. Consumidores y criterio de estado (sin cambios de criterio)

Cada consumidor conserva exactamente el conjunto de estados que ya usaba y pasa sus filas a la contabilidad única:

| Consumidor | Horas base | Conceptos |
|---|---|---|
| `GET /employees/:id/time-grid` (detalle por legajo, panel de cierre) | NORMAL_BASE APROBADO/EN_REVISION | ≠ RECHAZADO |
| `GET /time-entries/period-employees` (grilla de período) | NORMAL_BASE APROBADO/EN_REVISION | ≠ RECHAZADO |
| `GET /time-entries?view=byEmployee` (Bandeja "Por persona") | NORMAL_BASE según `status` de la query | ≠ RECHAZADO |
| `GET /time-entries/export(.csv)` | NORMAL_BASE APROBADO (+EN_REVISION con `includeInReview`) | ≠ RECHAZADO |
| `GET /time-entries/summary` ("Total trabajado") | NORMAL_BASE APROBADO/EN_REVISION | sólo ADDITIVE, ≠ RECHAZADO |
| `GET /dashboard/metrics` (`loadedHours`, "Horas cargadas") | NORMAL_BASE APROBADO/EN_REVISION | sólo ADDITIVE, ≠ RECHAZADO |
| `MonthlyTimeClosure.snapshot.accounting` | NORMAL_BASE APROBADO/EN_REVISION | ≠ RECHAZADO (igual que la grilla) |
| `GET /pending` (desgloses manuales EN_REVISION) | — | sin cambios; el subtítulo indica si suma al total |

Las vistas de resumen y el dashboard sólo necesitan totales: suman base + ADDITIVE con `totalWorkedHours()`, la misma regla de `accountDay`, en una agregación SQL (sin leer día por día).

## 9. Contratos

- **time-grid:**
  - `rows[]` lleva la fila base (`role: NORMAL_BASE`) y luego una fila por concepto (`role: ADDITIONAL`): primero `WITHIN_BASE`, después `ADDITIVE_TO_WORKED_TOTAL`. Cada fila trae `enabled`, que es `false` para un concepto con horas en el período que hoy no está habilitado; se muestra en sólo lectura para que la grilla explique el total.
  - `accounting` es un `PeriodAccounting` con `days`.
  - `totalWorkedMinutes` ahora es base + adicionales.
  - `specialHoursByDay[day]` = `{ multiplier, ruleNames, conflict }`.
  - Se eliminaron `specialHourAdditionalMinutes`, `specialHourLiquidableTotalMinutes` y los `additionalMinutes`/`liquidableTotalMinutes` por día, porque eran semánticamente falsos.
- **period-employees:** `summary = { incidents, status, accounting (con days), dailyBreakdown[{ day, novelty, specialHourRuleNames, specialHourConflict }] }`. Se eliminaron `total/normal/special/specialHourAdditionalHours/specialHourLiquidableTotal`.
- **byEmployee:** `summary = { status, accounting (sin days), specialHourRuleNames, specialHourConflict }`.
- **export:** `{ total, columns[{ key, kind }], rows[Record<string,string>], definitive }`.
  - Columnas: identidad, `Horas base`, `Horas normales`, `<Concepto> (horas reales)` por concepto, `Total trabajado`, `Horas normales (para liquidación)`, `<Concepto> (para liquidación)` por concepto, `Equivalencia para liquidación`, reglas, conflicto y estado.
  - Los conceptos con el mismo nombre se distinguen por código.
  - Incluye a quienes sólo tienen horas adicionales en el período, y el gate de cierre aprobado también los alcanza.
  - El CSV usa las mismas columnas.
  - El frontend ya no genera un export local de respaldo, porque sin conceptos ni multiplicadores produciría totales incorrectos.
- **hour-concepts:** `workTreatment` es obligatorio en `POST` y opcional en `PATCH`.
- **Cierre:** `snapshot.accounting = { model: "WORKED_TIME_ACCOUNTING_V1", ...PeriodAccounting, concepts[{ ..., code, name }] }`. Se conserva `snapshot.entries`.

## 10. Migración `20261002120000_add_hour_concept_work_treatment`

La migración es aditiva:

- Agrega el enum `HourConceptWorkTreatment`, la columna `HourConcept.workTreatment` (nullable) con su CHECK, y en `HourConceptBreakdown` las columnas `appliedMultiplier` (default 1) y `startAt`/`endAt` con CHECK de intervalo.
- No borra ni reescribe horas ni minutos.

**Backfill del catálogo.** Se hizo sólo sobre la instancia auditada (inspección READ-ONLY de 2026-10-02) con un mapping confirmado por el usuario:

| code | nombre | kind / loadMode | uso | tratamiento |
|---|---|---|---|---|
| HOR-001 | Sereno | SERENO / BOTH | 6 manuales | WITHIN_BASE |
| HOR-004 | Prueba | OTRO / AUTOMATIC (09–11) | 9 automáticos, siempre ≤ base | WITHIN_BASE |
| HC-GUARDIA | Guardia | GUARDIA / AUTOMATIC (eliminado) | sin uso | WITHIN_BASE |
| HOR-002 | Colectivo | TRANSPORTE / MANUAL | sin uso | ADDITIVE_TO_WORKED_TOTAL |
| HOR-003 | Camioneta | TRANSPORTE / MANUAL | sin uso | ADDITIVE_TO_WORKED_TOTAL |

Si queda algún concepto adicional sin tratamiento (por ejemplo, en una base no auditada), la migración **aborta** en vez de inventarlo.

**Snapshot de multiplicador en desgloses existentes.** Se copia el mayor `appliedMultiplier` de la base APROBADO/EN_REVISION del mismo empleado y fecha, que es exactamente lo que leían las grillas antes. Los que no tienen base quedan en 1, igual que antes. Ningún número histórico cambia por la migración.

**Desgloses automáticos previos.** Quedan sin intervalo hasta el próximo recálculo, que ocurre automáticamente al cerrar una jornada o con el endpoint de recálculo. Mientras tanto se tratan como distribución declarada, lo cual es exacto porque no hay superposiciones en los datos.

**Orden de deploy.** Primero `prisma migrate deploy` (incluye `20260918100000_add_job_checkpoint`, que estaba pendiente) y después el backend y el frontend nuevos. El frontend nuevo requiere el contrato nuevo.

**Aplicación.** Se aplicó en Neon staging el 2026-10-02 con autorización explícita. `migrate status` quedó al día y `migrate diff` (base → schema) dio vacío. Producción no se tocó.

## 11. Finnegans

`finnegans-export` lee exclusivamente `Novelty`, el cierre mensual (gate) y su historial de lotes. No consume `TimeEntry` ni `HourConceptBreakdown`, así que **no fue modificado**. La palabra "liquidación" no implica que consuma horas.

## 12. Cachés

- **Backend:** toda mutación de desgloses (manual, aprobar, rechazar, devolver, recálculo) ya limpiaba las cachés de grilla y de time-entries en el controller, y la auditoría limpia la caché del dashboard. No hizo falta agregar invalidaciones.
- **Frontend:** las mutaciones de desgloses ahora también invalidan la familia `dashboard`, porque las horas adicionales cambian "Horas cargadas".
- La edición optimista de una celda atenúa los valores calculados (Horas normales, total y equivalencia) hasta que llega la contabilidad recalculada. El frontend nunca los recalcula.

## 13. UI (lenguaje de negocio)

- **Etiquetas:** "Horas base" (registradas), "Horas normales" (residual), "Distribución de la jornada", "Horas adicionales", "Total trabajado", "Para liquidación" y "Equivalencia para liquidación". Los enums técnicos no se muestran.
- **Componentes compartidos:**
  - `MonthlyHoursTableSections`: secciones de la grilla mensual, usadas por el detalle por legajo y el panel de cierre.
  - `HoursAccountingSummary`: composición real vs. para liquidación.
  - `AccountingStatCards`: tarjetas de Total trabajado y Para liquidación.
- **Pantalla de conceptos horarios:** el campo "Tratamiento en el total" es obligatorio y no tiene default.
