# Modelo de contabilidad de tiempo trabajado

**Estado:** vigente desde 2026-10-02. La corrección de tratamiento y la eliminación definitiva de conceptos (§14) se agregaron el mismo día, antes de mergear. **Reemplaza** la regla "todo `HourConceptBreakdown` es un desglose que nunca incrementa el total trabajado" (`CONCEPTOS_HORARIOS_ADITIVOS.md`, Etapa 6M) y el cálculo de "Total liquidable" de las Etapas 8F/11A.1/11B/11C (`base + conceptos + (base + conceptos) × (m − 1)`, ejemplo histórico "8 normales + 4 Sereno ×2 = 24").

La aplicación no calcula sueldos. Entrega tiempo real, su clasificación por concepto y la equivalencia en horas para liquidación. Tarifas, valores monetarios y diferenciales los resuelve el sistema de liquidación.

## 1. Las dos preguntas que el sistema responde por separado

1. **¿Cuánto trabajó realmente?** Horas base + conceptos adicionales fuera de la fichada.
2. **¿Cómo se compone ese tiempo para liquidación?** Horas normales residuales + conceptos dentro de la jornada + conceptos adicionales, cada componente × su multiplicador de Hora Especial.

## 2. Semántica explícita del concepto: `HourConcept.workTreatment`

| Valor | Significado | Efecto |
|---|---|---|
| `WITHIN_BASE` ("Dentro de la jornada") | Clasifica minutos que ya están dentro de las Horas base (ej. Sereno). | No suma al total trabajado. Reduce las Horas normales residuales. |
| `ADDITIVE_TO_WORKED_TOTAL` ("Horas adicionales") | Tiempo trabajado que no está en la fichada (ej. Colectivo, Camioneta). | Suma al total trabajado. Nunca se resta de la base. |

- `NORMAL_BASE` no tiene tratamiento (columna `NULL`). Para todo concepto adicional es obligatorio: CHECK `HourConcept_work_treatment_check`, mismo patrón que `HourConcept_official_model_check` de `loadMode`.
- **`loadMode` no decide la semántica.** `loadMode` dice cómo se carga un concepto (MANUAL/AUTOMATIC/BOTH), y `workTreatment` dice si suma al total. Un concepto `WITHIN_BASE` con `loadMode = BOTH` sigue dentro de la jornada cuando se corrige a mano. Ninguna regla productiva usa `loadMode`, `source`, `name` ni `code` para decidir si un concepto suma.
- `countsAsWorked` sigue deprecado y no participa. `priority` no se reactivó.
- **`workTreatment` es una clasificación corregible por RRHH.** Si cambia, los breakdowns existentes conservan sus minutos pero toda la proyección histórica se reinterpreta con el tratamiento actual, con auditoría e invalidación de derivados. Ver §14.
- El tratamiento no se copia a cada `HourConceptBreakdown`. Todos los consumidores lo leen del concepto al consultar: `accountingBreakdownSelect` → `toAccountingBreakdown`, `timeGridConceptSelect`, los filtros SQL `hourConcept.workTreatment` del resumen y el dashboard, y la Bandeja. Duplicarlo haría imposible una corrección retroactiva.

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
- **Estrategia:** las Horas normales residuales descuentan la **unión** de la cobertura, nunca la suma. Ejemplo: Sereno 23–02 + otro concepto dentro de la jornada 01–03 sobre base 8 da cobertura 4 h, Horas normales 4 (no 3), 3 h y 2 h por concepto (cada uno conserva su desglose), y el total real sigue en 8.
- Para que la unión sea exacta, los desgloses `AUTOMATIC` persisten su **intervalo real** (`HourConceptBreakdown.startAt/endAt`), que es la intersección fichada × regla ya partida por fecha Argentina.
- Los desgloses `MANUAL` no tienen posición dentro de la jornada. Sus minutos se toman como una distribución declarada, y la protección es la validación al guardarlos (§7).
- **Aviso:** la contabilidad expone `withinBaseOverlapMinutes` y la UI muestra una nota cuando hay superposición.
- **Limitación conocida:** un desglose manual y uno automático del mismo día no pueden detectar superposición entre sí. Se tratan como disjuntos, y la validación al cargar evita que superen la base.
- `withinBaseExcessMinutes > 0` indica cobertura mayor que la base aprobada del día. Ejemplo: Sereno en BORRADOR sin base aprobada, como el caso histórico del legajo 03 el 03/08/2026. Se marca como inconsistencia a revisar, nunca como horas adicionales.

## 6. Multiplicador de Hora Especial: persistido en la carga y en el desglose

`HourConceptBreakdown.appliedMultiplier Decimal(4,2) default 1` sigue la misma filosofía que `TimeEntry.appliedMultiplier`: es el multiplicador **vigente** de la fecha, persistido para que todos los consumidores lean un único dato.

- **Carga manual:** se resuelve con el motor de Hora Especial al crear o actualizar (`resolveDoubleHourMultipliersByDate`).
- **Automáticos:** se resuelve en batch al regenerar el período, con 2 consultas por recálculo (alcance del empleado y reglas vigentes en el rango). Nunca hay una consulta por desglose.
- **Consecuencias:** un Colectivo de domingo conserva su ×2 aunque ese día no haya TimeEntry. Reemplaza la limitación documentada en 11A.1, donde un desglose "huérfano" quedaba en ×1.
- **Cambio de regla:** desde 2026-10-05 crear, editar o quitar una regla **sí** reinterpreta la historia (§15). Antes, editar una regla después no cambiaba nada y el multiplicador quedaba congelado como el de la carga.
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
- **hour-concepts:** `workTreatment` es obligatorio en `POST` y opcional en `PATCH`, y se puede corregir aunque el concepto tenga horas (§14). `DELETE` es definitivo y devuelve un resumen de lo eliminado.
- **Cierre:** `snapshot.accounting = { model: "WORKED_TIME_ACCOUNTING_V1", ...PeriodAccounting, concepts[{ ..., code, name }] }`. Se conserva `snapshot.entries`. Un snapshot recalculado por una corrección de concepto agrega `snapshot.recalculation = { reason, hourConceptId, hourConceptCode, at }`.

## 10. Migración `20261002120000_add_hour_concept_work_treatment`

La migración es aditiva:

- Agrega el enum `HourConceptWorkTreatment`, la columna `HourConcept.workTreatment` (nullable) con su CHECK, y en `HourConceptBreakdown` las columnas `appliedMultiplier` (default 1) y `startAt`/`endAt` con CHECK de intervalo.
- No borra ni reescribe horas ni minutos.

**Backfill del catálogo.** Se hizo sólo sobre la instancia auditada (inspección READ-ONLY de 2026-10-02) con un mapping confirmado por el usuario:

| code | nombre | kind / loadMode | uso | tratamiento |
|---|---|---|---|---|
| HOR-001 | Sereno | SERENO / BOTH | 6 manuales | WITHIN_BASE |
| HOR-004 | Prueba | OTRO / AUTOMATIC (09–11) | 9 automáticos, siempre ≤ base | WITHIN_BASE |
| HOR-002 | Colectivo | TRANSPORTE / MANUAL | sin uso | ADDITIVE_TO_WORKED_TOTAL |
| HOR-003 | Camioneta | TRANSPORTE / MANUAL | sin uso | ADDITIVE_TO_WORKED_TOTAL |

Si queda algún concepto adicional sin tratamiento (por ejemplo, en una base no auditada), la migración **aborta** en vez de inventarlo.

**HC-GUARDIA (Guardia) se elimina físicamente.** El negocio lo descartó: es la misma idea que Sereno. No se mapea ni se convierte a Sereno.

- **Auditoría READ-ONLY de 2026-10-02:** la fila existía con baja lógica (INACTIVO, `deletedAt` 2026-08-25) y tenía 0 TimeEntry, 0 TimeSegment, 0 WorkShift, 0 Novelty y 0 HourConceptBreakdown. Las referencias por regla también daban 0 y no había habilitaciones por legajo. Sólo quedaba 1 regla inactiva propia (21:00–03:00). El "uso histórico" que registraron sus bajas lógicas era únicamente configuración (1 legajo habilitado y 1 regla). La segunda baja (25/08) ocurrió porque el seed lo reactivaba.
- **Cómo se borra:** `20261002120000` lo elimina antes del backfill y del guard, sólo si no tiene historial real; si lo tuviera, aborta. `20261002130000_remove_discarded_hc_guardia` repite el mismo bloque protegido para las bases donde `20261002120000` ya se había aplicado con la versión que lo mapeaba (staging); en una base nueva es un no-op.
- **Qué se borra:** también sus habilitaciones y reglas. Las entradas de `AuditLog` que lo mencionan se conservan, porque `entityId` es texto y no FK.
- **Seed:** se quitó del seed para que no vuelva a crearse.

**Snapshot de multiplicador en desgloses existentes.** Se copia el mayor `appliedMultiplier` de la base APROBADO/EN_REVISION del mismo empleado y fecha, que es exactamente lo que leían las grillas antes. Los que no tienen base quedan en 1, igual que antes. Ningún número histórico cambia por la migración.

**Desgloses automáticos previos.** Quedan sin intervalo hasta el próximo recálculo, que ocurre automáticamente al cerrar una jornada o con el endpoint de recálculo. Mientras tanto se tratan como distribución declarada, lo cual es exacto porque no hay superposiciones en los datos.

**Orden de deploy.** Primero `prisma migrate deploy` (incluye `20260918100000_add_job_checkpoint`, que estaba pendiente, y `20261002130000_remove_discarded_hc_guardia`) y después el backend y el frontend nuevos. El frontend nuevo requiere el contrato nuevo.

**Nota para staging.** Se editó `20261002120000` después de aplicarla, antes de mergear y sin tocar producción, para sacar a HC-GUARDIA del backfill. `migrate status` y `migrate deploy` no comparan checksums de migraciones ya aplicadas; sólo `migrate dev` lo señalaría, y este proyecto no lo usa contra Neon por la limitación de shadow DB documentada desde 10D.

**Aplicación.** Se aplicó en Neon staging el 2026-10-02 con autorización explícita. `migrate status` quedó al día y `migrate diff` (base → schema) dio vacío. Producción no se tocó.

## 11. Finnegans

`finnegans-export` lee exclusivamente `Novelty`, el cierre mensual (gate) y su historial de lotes. No consume `TimeEntry` ni `HourConceptBreakdown`, así que **no fue modificado**. La palabra "liquidación" no implica que consuma horas.

## 12. Cachés

- **Backend:** toda mutación de desgloses (manual, aprobar, rechazar, devolver, recálculo) ya limpiaba las cachés de grilla y de time-entries en el controller, y la auditoría limpia la caché del dashboard.
- **Backend, conceptos:** editar (nombre, estado, tratamiento) o eliminar un concepto llama a `clearHourConceptDependentReadCaches()` (`hourConcepts.controller.ts`). Limpia en el momento, sin depender del TTL:
  - el catálogo (controller y repository);
  - Legajo y `time-grid` (detalle por legajo y panel de cierre), y el catálogo embebido de la grilla (`invalidateTimeGridCatalogCache`, que antes sólo vencía por TTL de 120 s);
  - `period-employees`, Bandeja "Por persona", resumen y asistencia (`clearTimeEntriesReadCaches`);
  - el dashboard;
  - los cierres (el payload incluye el snapshot recalculado);
  - las novedades (al eliminar se desvincula su concepto destino).
  - El export no tiene caché.
- **Backend, reglas de Hora Especial:** crear, editar o quitar una regla llama a `clearWorkedTimeDerivedReadCaches()` (`time-entries/workedTimeReadCaches.ts`, compartido con los conceptos): `time-grid`, `period-employees`/Por persona/resumen/asistencia, dashboard y cierres (§15).
- **Frontend:** las mutaciones de desgloses ahora también invalidan la familia `dashboard`, porque las horas adicionales cambian "Horas cargadas". Las mutaciones de concepto (`update`, `updateStatus`, `remove`) invalidan `HOUR_CONCEPT_DEPENDENT_CACHE_FAMILIES`: `hour-concepts`, `employees`, `time-entries`, `pending`, `dashboard`, `monthly-closures` y `novelties`. La grilla por legajo no tiene caché de frontend. Las mutaciones de reglas de Hora Especial invalidan `workforce-config` más `WORKED_TIME_DERIVED_CACHE_FAMILIES` (`employees`, `time-entries`, `pending`, `dashboard`, `monthly-closures`), la misma lista que reutilizan los conceptos.
- La edición optimista de una celda atenúa los valores calculados (Horas normales, total y equivalencia) hasta que llega la contabilidad recalculada. El frontend nunca los recalcula.

## 13. UI (lenguaje de negocio)

- **Etiquetas:** "Horas base" (registradas), "Horas normales" (residual), "Distribución de la jornada", "Horas adicionales", "Total trabajado", "Para liquidación" y "Equivalencia para liquidación". Los enums técnicos no se muestran.
- **Componentes compartidos:**
  - `MonthlyHoursTableSections`: secciones de la grilla mensual, usadas por el detalle por legajo y el panel de cierre.
  - `HoursAccountingSummary`: composición real vs. para liquidación.
  - `AccountingStatCards`: tarjetas de Total trabajado y Para liquidación.
- **Pantalla de conceptos horarios:**
  - El campo "Tratamiento en el total" es obligatorio y no tiene default.
  - Cambiarlo en un concepto existente pide confirmación ("Cambiar tratamiento del concepto"): las horas ya cargadas conservan sus minutos y pasan a leerse con el tratamiento nuevo.
  - "Deshabilitar" y "Eliminar" son acciones distintas (§14). Eliminar usa una única confirmación fuerte: "Eliminar concepto definitivamente", con los botones Cancelar / Eliminar definitivamente.

## 14. Corrección de tratamiento, cierres y eliminación definitiva

**Estado:** vigente desde 2026-10-02 (antes de mergear `feat/worked-time-accounting`). Reemplaza el bloqueo `HOUR_CONCEPT_WORK_TREATMENT_LOCKED` y la eliminación de las Etapas 8O/8P (409 `HOUR_CONCEPT_IN_USE`, segundo `DELETE ?force=true` y baja lógica con `deletedAt`).

**Caso real que lo motivó:** "Prueba 02" (HOR-005) se creó por error como `ADDITIVE_TO_WORKED_TOTAL` y se cargaron horas. Después no se pudo corregir porque tenía horas. Al eliminarlo quedó con baja lógica: conservó la fila y las horas, que seguían contando. Tampoco se pudo recrear HOR-005, porque la fila con baja lógica seguía ocupando `UNIQUE(code)`.

### 14.1 Corregir `workTreatment`

`hourConceptsRepository.updateReinterpretingHistory` corre en una transacción:

1. Actualiza el concepto. No escribe ningún `HourConceptBreakdown`: mismos ids, minutos y multiplicadores.
2. Calcula el alcance en 1 consulta (`groupBy` empleado + período de desgloses que cuentan).
3. Recalcula los snapshots de los cierres afectados (§14.2).

Después de la transacción, la auditoría registra:

- `HourConcept` `UPDATE`, con el concepto, el tratamiento anterior (`before`) y el nuevo (`after`), el usuario, la fecha, la cantidad de desgloses, legajos y períodos reinterpretados y los ids de cierres recalculados;
- un `MonthlyTimeClosure` `UPDATE` por cierre recalculado, con el snapshot anterior y el nuevo.

Ejemplo (tests en `hourConcepts.workTreatmentCorrection.test.ts`):

| Prueba | Base | Prueba | Horas normales | Total trabajado | Equivalencia (domingo ×2) |
|---|---|---|---|---|---|
| `ADDITIVE_TO_WORKED_TOTAL` (error) | 8 | 2 | 8 | 10 | 20 |
| `WITHIN_BASE` (corregido, mismo desglose) | 8 | 2 | 6 | 8 | 16 |

Si al pasar a `WITHIN_BASE` hay días cuya cobertura supera la base, la contabilidad los marca como `withinBaseExcessMinutes` (§5). Nunca se convierten en horas adicionales. Las validaciones de carga manual (§7) aplican a las cargas nuevas con el tratamiento vigente.

### 14.2 Cierres mensuales

Qué hacía el sistema antes de este cambio (auditado en código):

- `MonthlyTimeClosure.snapshot` se escribe sólo en `submitClosures` (ENVIADO). Aprobar y devolver no lo tocan.
- Aprobar una corrección (`approveCorrection`) cambia el `TimeEntry` y deja el cierre en APROBADO, sin rehacer el snapshot. Una corrección directa de RRHH en un período cerrado tampoco lo rehace.
- Ninguna pantalla lee el snapshot. El panel de cierre (`MonthlyClosureReviewPanel`) usa el `time-grid` en vivo; el gate del export y Finnegans leen sólo `status`. El snapshot llega en el payload de `GET /workforce/closures`, pero el frontend no lo usa.
- Por lo tanto, "grilla 8 h / cierre 10 h" sólo podía quedar en el JSON persistido, que es el registro de auditoría del cierre.

**Solución.** Corregir el tratamiento o eliminar un concepto recalcula, dentro de la misma transacción, el snapshot de cada cierre afectado. Usa el mismo builder que el envío (`buildClosureSnapshots`, `workforce-management/closureSnapshot.ts`), así que el snapshot queda igual a lo que hoy congelaría un reenvío.

- **Cierres afectados** (`findClosuresForHourConcept`, 1 consulta): los de cada empleado + período con desgloses que cuentan del concepto, más los cuyo snapshot ya menciona el concepto (`snapshot.accounting.concepts @> [{ hourConceptId }]`; cubre, por ejemplo, un desglose rechazado después del envío).
- **Qué no cambia:** estado, autoría y fechas del cierre. Un APROBADO sigue APROBADO, igual que en una corrección directa de RRHH en un período cerrado (el flujo de correcciones existente no reabre cierres aprobados). No se inventó una política nueva para APROBADO.
- **Trazabilidad:** el snapshot nuevo lleva `recalculation = { reason, hourConceptId, hourConceptCode, at }` y la auditoría conserva before/after.
- **Alcance de los datos:** el recálculo usa los datos vigentes, igual que un reenvío. Si después del envío hubo otras correcciones de RRHH que ya se ven en la grilla, el snapshot recalculado también las incluye. El snapshot anterior queda en la auditoría.
- **Costo:** 3 consultas por período afectado más 1 `update` por cierre, dentro de la transacción (timeout 30 s).
- **Deuda conocida, sin cambios:** aprobar una corrección horaria o corregir directamente en un período cerrado sigue sin rehacer el snapshot.

### 14.3 Deshabilitar vs. eliminar

- **Deshabilitar** (`status: INACTIVO`) es para un concepto válido históricamente que ya no se va a usar.
  - Conserva el concepto, sus desgloses, reglas, habilitaciones por legajo y auditoría.
  - Impide nuevas cargas manuales (`HOUR_CONCEPT_INACTIVE`), asignaciones (`HOUR_CONCEPT_NOT_ASSIGNABLE`), reglas (`HOUR_CONCEPT_RULE_INACTIVE_CONCEPT`) y la clasificación automática.
  - Sus horas siguen contando en grillas y cierres. La grilla las muestra en sólo lectura.
  - Corrección de un hueco encontrado al auditar: el recálculo automático (`replaceAutomatic`, que corre en cada jornada cerrada del período) borraba todos los desgloses AUTOMATIC del período, incluidos los de conceptos deshabilitados, y no los volvía a crear. Ahora sólo reemplaza los de conceptos activos.
- **Eliminar definitivamente** es para una configuración creada por error. Borra el concepto y su historial específico y deja el código libre para reutilizarse.
- **Código automático:** `GET /hour-concepts/next-code` consulta la base (no el catálogo cacheado del navegador) y devuelve el primer `HOR-NNN` libre. Por eso un código liberado puede reutilizarse. La restricción `UNIQUE(code)` permanece como defensa ante dos altas concurrentes; ante `P2002`, la UI conserva el formulario y solicita una nueva sugerencia.
- **Deuda de bajas lógicas:** la migración `20261003100000_drop_hour_concept_deleted_at` elimina físicamente todas las filas antiguas con `deletedAt`, junto con su configuración/desgloses y preservando jornadas mediante reclasificación. Nunca está hardcodeada a `HOR-005`. Si alguna tiene `TimeEntry` legacy, la migración aborta antes de escribir y enumera el caso para revisión manual.

### 14.4 Relaciones de `HourConcept` y qué hace la eliminación

FK reales (auditadas en staging, 2026-10-02, sin triggers):

| Relación | FK en la base | Qué es | Al eliminar |
|---|---|---|---|
| `HourConceptBreakdown.hourConceptId` | RESTRICT | Horas específicas del concepto | **Se borran todas** (cualquier estado) |
| `HourConceptRule.hourConceptId` | CASCADE | Configuración | **Se borran** explícitamente |
| `EmployeeHourConcept.hourConceptId` | CASCADE | Configuración (habilitación por legajo) | **Se borran** explícitamente |
| `TimeSegment.hourConceptId` (obligatoria) / `hourConceptRuleId` | RESTRICT / SET NULL | Tramo de una jornada física (evidencia del clasificador) | **Se reclasifica** a Hora normal, `hourConceptRuleId = null`, `conceptStatus = SIN_CONCEPTO_COMPATIBLE`: lo mismo que deja el clasificador en un tramo sin regla. Minutos e intervalos intactos. |
| `WorkShift.hourConceptId` / `hourConceptName` | SET NULL | Jornada física | **Se reclasifica** a Hora normal (como toda jornada desde 6L). La jornada y sus fichadas se conservan. |
| `Novelty.targetHourConceptId` | SET NULL | Novedad del legajo (puede ir a Finnegans) | **Se desvincula** (`null`). La novedad se conserva. |
| `TimeEntry.hourConceptId` | RESTRICT | Horas base (siempre `NORMAL_BASE` desde 6L) | Nunca se toca. Si existe un `TimeEntry` con el concepto adicional (modelo previo a 6L, cuando la jornada se guardaba con el concepto elegido), esos minutos pueden ser trabajo real: **409 `HOUR_CONCEPT_HAS_LEGACY_TIME_ENTRIES`** y no se borra nada. En staging hay 0. |
| `AttendancePunch`, `TimeEntry` NORMAL_BASE, `WorkShift` | — | Evidencia física | Nunca se borran |
| `AuditLog` (`entityId` texto) | — | Trazabilidad | Se conserva. Se agrega la auditoría de la eliminación. |
| `MonthlyTimeClosure.snapshot` | — | Auditoría del cierre | Se recalcula (§14.2) |

`hourConceptsRepository.deletePermanently` es una sola transacción, con las dependencias en orden explícito y sin depender de ningún `ON DELETE`:

1. Busca los cierres afectados.
2. Borra los desgloses.
3. Reclasifica tramos y jornadas.
4. Desvincula las novedades.
5. Borra reglas y habilitaciones.
6. Borra el concepto.
7. Recalcula los snapshots.

Si mientras tanto se carga una hora con el concepto, la FK RESTRICT aborta la transacción completa (`409 HOUR_CONCEPT_CHANGED_DURING_DELETE`).

La respuesta resume lo eliminado: `deletedBreakdowns`, `deletedRules`, `deletedEmployeeAssignments`, `reclassifiedSegments`, `reclassifiedWorkShifts`, `unlinkedNovelties` y `recalculatedClosures`. La UI sólo muestra "Se eliminó definitivamente el concepto …".

### 14.5 Migración `20261003100000_drop_hour_concept_deleted_at`

- Normaliza a INACTIVO las filas con baja lógica. Es lo que la política vigente llama Deshabilitado, y la baja lógica ya lo hacía. Esas filas vuelven a verse en el catálogo, donde RRHH puede habilitarlas o eliminarlas definitivamente. No borra ni reinterpreta horas.
- Recrea el CHECK `HourConcept_official_model_check` sin `deletedAt` y borra la columna.
- **Orden de deploy:** el backend nuevo ya no lee ni escribe `deletedAt`, así que funciona antes y después de la migración. Antes de aplicarla, una fila con baja lógica se ve como Deshabilitada.
- Staging al 2026-10-02: HOR-005 "Prueba 02" tenía baja lógica (1 desglose MANUAL APROBADO de 180 min en 2026-10 y 1 regla).

## 15. Reglas de Hora Especial: reinterpretación de la historia

**Estado:** vigente desde 2026-10-05. Reemplaza "editar una regla después no cambia la historia" (§6, 8F, 11B).

**Regla de negocio.** Un feriado (o cualquier `DoubleHourRule`: domingo, jornada especial) es una regla vigente sobre la fecha, no una propiedad irreversible de la carga. Las horas y la regla pueden cargarse en cualquier orden: el resultado depende sólo del estado vigente de la regla y de los minutos reales. Ejemplo: 8 h reales el 03/10 → día normal equivalencia 8; se marca feriado ×2 → 16; se cambia a ×1,5 → 12; se quita → 8. Con base 8 + Sereno 3 (dentro de la jornada) + Colectivo 1 (adicional): 9 → 18 → 9. Nunca se borra ni recarga una hora.

**Causa raíz del bug anterior.** El multiplicador se resolvía una sola vez, al escribir cada fila (`TimeEntry.appliedMultiplier`, `HourConceptBreakdown.appliedMultiplier`, la traza `SpecialHourRuleApplication` y `TimeSegment.isSpecial`), y `createDoubleRule`/`updateDoubleRule`/`removeDoubleRule` no recalculaban nada. Todos los consumidores leen el valor persistido.

**Estrategia.** Se mantiene el valor persistido como fuente única de lectura (nada que recalcular en cada pantalla ni en las agregaciones SQL) y se reinterpreta al cambiar la regla: `reinterpretSpecialHours` (`workforce-management/specialHourReinterpretation.ts`) corre en la **misma transacción** que crear, editar, inactivar o eliminar la regla (timeout 30 s). Si el recálculo falla, la regla no cambia.

1. **Alcance:** las fechas que matchean el calendario de la regla **antes o después** del cambio (`ruleMatchesDate` sobre ambas formas), dentro de la ventana de vigencia de ambas. Una regla sin fin deja la ventana abierta, y sólo existen cargas hasta hoy.
2. **Motor único:** para cada empleado con cargas, desgloses o tramos en esas fechas, `resolveSpecialHourRulesByDate` (el mismo motor que usa una carga nueva: reglas ACTIVAS vigentes, alcance empresa/sector/centro de costo/puesto/empleados, ganadoras por prioridad). Son 2 consultas por empleado alcanzado, nunca una por fila. Un empleado fuera del alcance resuelve sin la regla y no cambia.
3. **Escrituras:** `TimeEntry.appliedMultiplier` y `HourConceptBreakdown.appliedMultiplier` donde cambió, con un `updateMany` por valor. La traza por tramo (`SpecialHourRuleApplication` + `TimeSegment.isSpecial`) se reconstruye con `specialHourApplicationRows`, el mismo helper que usa el fichador. **Nunca** cambian minutos reales (TimeEntry, TimeSegment, desgloses), estado de aprobación, fecha, empleado ni concepto.
4. **Cierres:** los cierres de cada empleado + período cuyo multiplicador cambió se recalculan con `rebuildClosureSnapshots` (§14.2), con `recalculation = { reason: "SPECIAL_HOUR_RULE_CHANGED", doubleHourRuleId, doubleHourRuleName, at }`. Es la misma política: el estado no cambia (un APROBADO sigue APROBADO), no hay estado terminal que bloquee, y el snapshot anterior queda en la auditoría.
5. **Auditoría:** el `DoubleHourRule` lleva una descripción en lenguaje de negocio, por ejemplo "Se actualizó el feriado Día de la Raza (03/10/2026) de x1 a x2. Se recalcularon 23 carga(s) de 18 legajo(s) y 4 cierre(s) mensual(es).". El detalle técnico va en `after.reinterpretation` (cantidades, períodos, ids de cierres). Se registra además un `MonthlyTimeClosure` `UPDATE` por cierre recalculado.
6. **Cachés:** backend `clearWorkedTimeDerivedReadCaches()` y frontend `WORKED_TIME_DERIVED_CACHE_FAMILIES` (§12).

**Eliminar vs. inactivar.** Una regla ya vigente se inactiva (conserva la regla) y las horas vuelven a su valor sin ella. Una regla futura se elimina: primero se retira su traza (`SpecialHourRuleApplication.doubleHourRuleId` es `RESTRICT`) y la reinterpretación la reconstruye sin ella.

**Alcance por empleado.** El multiplicador lo decide el alcance de la regla y, para reglas FERIADO, también la convocatoria (§16).

**Fuera de alcance.**
- Finnegans no consume horas (§11).
- La observación de texto libre escrita al fichar ("Reglas aplicadas: Feriados. Multiplicador x2 · 3 h trabajadas.") es una nota histórica del momento de la fichada y no se reescribe. El multiplicador, la traza y la equivalencia sí se reinterpretan.
- Si una fichada se cierra en el mismo instante en que se guarda una regla, podría escribir con el estado anterior de la regla. Volver a guardar la regla lo corrige, porque la reinterpretación es idempotente.

**Tests:** `specialHourReinterpretation.test.ts` (casos A–H, orden indistinto A ≡ B, cruce de medianoche, alcance, cambio de fecha, idempotencia, traza, minutos y estados intactos), `workforce.service.test.ts` (transacción, auditoría, inactivar/eliminar), `workforce.controller.test.ts` y `workforceApiService.test.ts` (cachés).

## 16. FERIADO + convocatoria (HolidayWorkAssignment)

**Estado:** vigente desde 2026-10-05. Reemplaza "HolidayWorkAssignment no interviene en la liquidación" (12A §12, 12D §5/§7/§9 y la primera versión de §15).

**Regla conceptual (no volver a separarlas):**
- La regla de Hora Especial **FERIADO** define **cuánto vale** trabajar ese día: fecha, multiplicador y demás configuración. El multiplicador vive sólo en `DoubleHourRule` y nunca se copia a la convocatoria.
- La **Asignación de feriado** (`HolidayWorkAssignment` ACTIVA) define **quién fue convocado**.
- En un FERIADO con convocatoria, ambas se combinan para decidir el tratamiento de cada empleado.

**Política (decidida por negocio el 2026-10-05):**
- **La fecha tiene al menos un convocado ACTIVO:** las reglas FERIADO aplican **sólo a los convocados**, aunque la regla tenga otro alcance. Quien trabajó sin convocatoria cobra esas horas sin el multiplicador del feriado.
- **La fecha no tiene ninguna convocatoria ACTIVA:** cada regla usa su alcance, como antes. Los feriados globales sin convocatoria siguen funcionando igual.
- **Quitar un convocado:** queda sin el feriado mientras la fecha tenga otros convocados. Si se quitan todos, la fecha vuelve al alcance de la regla.
- **Otras clasificaciones** (DOMINGO, JORNADA_ESPECIAL, OTRO): nunca dependen de la convocatoria.

**Implementación (motor único, sin segundo motor):**
- `specialHourRulesForEmployeeOnDate` (`doubleHourRuleMatching.ts`, puro) aplica la política. `resolveSpecialHourRulesByDate` la usa con 4 consultas fijas: alcance del empleado, reglas en alcance, reglas FERIADO y convocatorias del rango.
- El fichador (`createFromWorkShift`, `closeOpenWorkShift`), la carga manual, los desgloses y la reinterpretación usan **todos** ese resolver. Antes el fichador tenía sus propias consultas de reglas.
- **Guardar convocatorias** (`holidayWorkAssignment.service.ts::save`) escribe las convocatorias y llama a `reinterpretSpecialHoursOnDates` sobre la fecha completa en la **misma transacción** (timeout 30 s). La fecha completa, porque el primer convocado restringe el FERIADO para todos. Si el recálculo falla, la convocatoria no queda guardada.
- **Auditoría:** las altas, cancelaciones y reactivaciones de siempre, más "Convocatoria del feriado del 05/10/2026: Se recalcularon N carga(s) de M legajo(s) y K cierre(s) mensual(es)." y un `MonthlyTimeClosure` `UPDATE` por cierre (`recalculation.reason = "HOLIDAY_WORK_ASSIGNMENT_CHANGED"`).
- **Cachés:** el backend llama a `clearWorkedTimeDerivedReadCaches()` al guardar. El frontend invalida `WORKED_TIME_DERIVED_CACHE_FAMILIES` en `saveAssignments`. Las fechas de feriado (`workforce-config`) no cambian por convocar.

**Caso que lo motivó (staging, legajo 31, 05/10/2026):** la carga se escribió ×1 a las 10:23 ART. RRHH agregó el 05/10 a la regla global "Feriados" a las 10:30 ART, antes de que existiera la reinterpretación de §15 (pusheada a las 11:36), y ninguna reinterpretación corrigió la fila. No era un problema de alcance: la regla es global. La convocatoria de L31 se creó a las 10:32.

**Reconciliación (backfill):** `npm run staging:special-hours:reconcile` (dry-run, `--report`) y `:apply -- --backup=<archivo>`. Sólo staging. Recorre todas las fechas con cargas con el mismo motor. El dry-run corre en una transacción que se revierte, y `--apply` aborta si los cambios ya no coinciden con el dry-run. En staging se aplicó el 2026-10-05: 15 cargas de 13 legajos y 1 cierre.
- L31 05/10: 2 h 26 min reales → 4 h 52 min para liquidación.
- Un domingo de agosto que había quedado desfasado.
- Por la política: legajo 01 (02/09) y legajo 02 (27/08), que trabajaron sin convocatoria en feriados con convocatoria, pasaron a ×1.

**Tests:** `doubleHourRuleMatching` vía `timeEntries.repository.test.ts` (convocado fuera de alcance, no convocado con convocatoria, sin convocatoria, DOMINGO), `specialHourReinterpretation.test.ts` (casos 1–8, orden indistinto), `holidayWorkAssignment.service.test.ts` (transacción, auditoría, fallo sin auditar), controller y `holidayWorkAssignmentApiService.test.ts` (cachés).
