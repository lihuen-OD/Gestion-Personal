# Motor de cobertura horaria de Novedades

**Estado:** decisión aprobada el 2026-11-13; implementación por etapas en `feat/novelties-coverage-engine`. **Implementado hasta la Etapa 1** (modelo y configuración, ver §9). Mientras no se completen las etapas 3 y 4, **ninguna novedad aporta minutos a ningún total**: el comportamiento productivo sigue siendo el de 15G.1 (justificación administrativa + bloqueo de nueva carga).

**Reemplaza parcialmente** la decisión "una novedad es sólo una justificación administrativa y nunca genera ni modifica horas" ([`NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md`](NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md)). Ver §11.

## 1. Problema

El negocio necesita que cada Tipo de Novedad defina su comportamiento horario: Trámite bancario cubre 4 h, Vacaciones cubre la jornada que el empleado tenía que cumplir (con multiplicador de domingo/feriado), Llegada tarde informa 1 h que no suma, Falta sin aviso no cubre nada. Hasta 15G.1 ninguna novedad podía aportar tiempo, y la grilla mostraba el chip de la novedad con el total trabajado del día, no con la cantidad de la novedad.

## 2. Principios

1. **Una novedad nunca escribe horas reales.** No crea ni modifica `TimeEntry`, `WorkShift`, `TimeSegment`, `HourConceptBreakdown` ni fichadas (15G.1 §2.1–§2.4 siguen vigentes). La cobertura vive en una tabla propia (`NoveltyDayCoverage`) y la contabilidad la suma como un componente separado.
2. **Trabajo real y cobertura nunca se confunden.** `totalWorkedMinutes` sigue siendo trabajo real; la cobertura se expone aparte y el total computable es real + cobertura que cuenta.
3. **Sin reglas por nombre.** Ningún comportamiento se infiere de `name`, `code` ni `kind`. Todo sale de la configuración del tipo.
4. **Un solo motor de multiplicadores.** La cobertura usa el motor de Horas Especiales existente (`resolveSpecialHourRulesByDate` y la política FERIADO + convocatoria de `WORKED_TIME_ACCOUNTING_MODEL.md` §16). Nunca "domingo = 16 h".
5. **Nunca inventar jornada.** Si no se puede resolver la obligación de un empleado (por ejemplo, un legajo mínimo sin turno), el día queda en 0 h **provisional** para revisión, distinto de 0 h confirmado.
6. **Sin dependencia nueva de estructura organizacional.** Un empleado con sólo legajo, DNI, nombre y apellido funciona.

## 3. Decisiones de negocio (fuente: usuario, 2026-11-13)

- **D1 — Vacaciones cubre la obligación real.** Día normal o domingo: según el turno vigente. Feriado: sólo si la persona fue **convocada** (`HolidayWorkAssignment` ACTIVA); si no, 0 h. Franco: 0 h. Con obligación: horas base × multiplicador vigente del día.
- **D2 — Trabajo real + cobertura el mismo día** no se suma automáticamente ni se corrige en silencio. Se distingue combinación válida, incompatible y excepcional a revisar.
- **D3 — Jornada no resoluble:** se guarda la novedad, el día queda en 0 h provisional "Revisar por encargado de carga", no suma hasta revisarse y bloquea cierre/exportación consolidada. El encargado confirma 0 h o indica las horas base (luego aplica el multiplicador general). La resolución queda trazada.
- **D4 — Sólo una novedad APROBADA suma.** Una PENDIENTE se ve con su cantidad, sin sumar.
- **C1 — Trámite bancario es incompatible con trabajo real.** Si aparece trabajo real ese día queda para revisión. **No existe una resolución que sume trabajo real y cobertura incompatibles**: hay que decidir qué evidencia vale (corregir el trabajo, o que la novedad no cubra ese día).
- **C2 — Régimen y jornada para Novedades:** `TURNO_FLEXIBLE` sin asignación aplicable → revisión; `TURNO_OBLIGATORIO` sin planificación vigente → revisión (requiere configuración); `SIN_TURNO` **nunca** es 0 h confirmado por el nombre del régimen → revisión. Las alertas conservan su comportamiento actual.
- **C3 — Feriado en reglas por calendario** (por ejemplo, Maternidad un feriado lunes a viernes): sin default funcional. Políticas genéricas: no cuenta (0 h), cuenta igual, o cuenta sólo si la persona estaba convocada. Pendiente P1 para el tipo Maternidad definitivo.

## 4. Configuración del Tipo de Novedad

| Pregunta | Campo | Valores |
|---|---|---|
| ¿Registra tiempo y cómo? | `coverageMode` | `NONE` · `FIXED_MINUTES` · `MANUAL_MINUTES` · `EXPECTED_SCHEDULE` |
| Cantidad fija | `coverageFixedMinutes` | 1..1440, sólo `FIXED_MINUTES` |
| ¿Qué días cuenta? | `coverageDayRule` | `EVERY_DAY` · `SELECTED_WEEKDAYS` (+ `coverageWeekdays`, 0 = domingo) · `WORK_OBLIGATION` |
| Franco (reglas por calendario) | `coverageOnDayOff` | `NO_COVERAGE` · `COVER` |
| Feriado (reglas por calendario) | `coverageOnHoliday` | `NO_COVERAGE` · `COVER` · `ONLY_IF_CONVOKED` |
| Multiplicadores | `coverageAppliesSpecialHours` | bool |
| ¿Suma al total? | `coverageCountsTowardTotal` | bool |
| ¿Puede haber trabajo real ese día? | `realWorkCompatibility` | `COMPATIBLE` · `INCOMPATIBLE` (aplica a todos los tipos) |
| Observación obligatoria | `requiresObservation` | bool |
| Bloqueo de nueva carga | `timeEntryBehavior` (existente) | `NO_BLOQUEA` · `BLOQUEA_NUEVA_CARGA` |

Reglas de coherencia (backend `noveltyTypes.service.ts::assertCoverageConfigCoherent` y CHECK `NoveltyType_coverage_config_check`):

- `NONE`: sin cantidad, `EVERY_DAY` sin días elegidos, sin políticas, sin multiplicadores, no suma.
- `MANUAL_MINUTES`: la cantidad la indica quien carga, para **un único día** (`allowsDateRange = false`, y `allowsHours = true` mientras exista ese campo); sin regla de días ni políticas.
- `EXPECTED_SCHEDULE`: sólo con `WORK_OBLIGATION`.
- `FIXED_MINUTES`: 1..1440 minutos. Con `WORK_OBLIGATION` las políticas de franco y feriado son `NULL` (deciden el franco y la convocatoria). Con `EVERY_DAY` o `SELECTED_WEEKDAYS` las dos políticas son **obligatorias**, sin default.
- `SELECTED_WEEKDAYS` exige al menos un día; el backend normaliza los días sin repetidos y ordenados.
- Se valida el estado resultante (en PATCH, fila actual + patch). Un campo incoherente se rechaza (`400 NOVELTY_TYPE_COVERAGE_CONFIG_INVALID`); nunca se corrige en silencio.

Los cinco tipos de validación del motor:

| Tipo | Configuración |
|---|---|
| Trámite bancario | `FIXED_MINUTES` 240 · `EVERY_DAY` · franco y feriado a definir al configurarlo · suma · `INCOMPATIBLE` |
| Maternidad | `FIXED_MINUTES` 480 · `SELECTED_WEEKDAYS` [1..5] · sin multiplicadores · suma · `INCOMPATIBLE` · feriado: P1 |
| Vacaciones | `FIXED_MINUTES` 480 · `WORK_OBLIGATION` · multiplicadores · suma · `INCOMPATIBLE` |
| Llegada tarde | `MANUAL_MINUTES` · no suma · `COMPATIBLE` |
| Falta sin aviso | `NONE` · `INCOMPATIBLE` · bloqueo a decidir al configurarlo |

## 5. Resultado diario (`NoveltyDayCoverage`)

Una fila por novedad no rechazada y fecha de su rango, de cualquier modo (también `NONE`, con 0 min), para que grilla y contabilidad tengan una única fuente de "qué novedad cae en qué día".

- `outcome`: `COVERED` · `NO_COVERAGE` · `WEEKDAY_NOT_INCLUDED` · `NO_WORK_OBLIGATION` · `HOLIDAY_NOT_CONVOKED` · `HOLIDAY_EXCLUDED` · `DAY_OFF` · `SCHEDULE_UNRESOLVED`.
- `scheduleReviewReason` (sólo `SCHEDULE_UNRESOLVED`): `SCHEDULE_MISSING` · `FLEXIBLE_REGIME_NO_ASSIGNMENT` · `REGIME_WITHOUT_SCHEDULE` · `EXPECTED_MINUTES_UNKNOWN`.
- `baseMinutes`, `appliedMultiplier`, `expectedMinutes` (jornada resuelta o `null`), snapshot de `countsTowardTotal` y `realWorkCompatibility`, `shiftTemplateId` de origen.
- Revisión: `reviewStatus` (`NOT_REQUIRED` · `PENDING` · `RESOLVED`) y resolución (`CONFIRMED_ZERO` · `SET_BASE_MINUTES`) con autor, fecha, nota y los minutos reales contra los que se resolvió. Si esos minutos reales cambian después, el día vuelve a revisión.
- Los minutos computados no se persisten: `(resolvedBaseMinutes ?? baseMinutes) × appliedMultiplier`, igual que `TimeEntry`.
- `Novelty` → `NoveltyDayCoverage` es `Cascade` (dato derivado). La historia queda en la auditoría y en los snapshots de cierre.

CHECKs de integridad: período y día coherentes con la fecha; minutos entre 0 y 1440 y 0 fuera de `COVERED`; multiplicador > 0; `SCHEDULE_UNRESOLVED` siempre con motivo y nunca `NOT_REQUIRED` (0 h provisional ≠ confirmado); `PENDING` sólo en `SCHEDULE_UNRESOLVED`; una resolución completa o ninguna. Los CHECKs con columnas anulables van envueltos en `COALESCE(…, false)`.

## 6. Algoritmo (etapa 3)

Por empleado y fecha: tipo `NONE` → `NO_COVERAGE`; elegibilidad por regla de días (calendario o `expectedWorkday`, §7); franco y feriado en reglas por calendario según su política; minutos base (fijos, manuales o jornada esperada); resolución manual previa conservada (el recálculo nunca pisa una decisión humana); multiplicador del motor único si el tipo lo aplica; persistencia. Al leer: estado de aprobación (D4), informativa si no suma, y reglas de trabajo real (D2/C1).

## 7. Jornada esperada para Novedades (etapa 2)

"Planificación vigente" = al menos una `ShiftAssignment` HABILITADA con template ACTIVO cuya vigencia incluye la fecha. Precedencia:

| Situación | Resultado |
|---|---|
| Franco ACTIVO | 0 confirmado (`DAY_OFF`) |
| Feriado sin convocatoria ACTIVA de la persona | 0 confirmado (`HOLIDAY_NOT_CONVOKED`) |
| Feriado con convocatoria | obligación; minutos de la convocatoria o del turno, si no hay → revisión (`EXPECTED_MINUTES_UNKNOWN`) |
| Régimen `SIN_TURNO` | revisión (`REGIME_WITHOUT_SCHEDULE`) |
| Asignación aplicable ese día | obligación con minutos esperados |
| `TURNO_FLEXIBLE` sin asignación aplicable | revisión (`FLEXIBLE_REGIME_NO_ASSIGNMENT`) |
| Sin planificación vigente | revisión (`SCHEDULE_MISSING`) |
| `TURNO_OBLIGATORIO` o sin régimen, planificación que excluye ese día | 0 confirmado (`NO_WORK_OBLIGATION`) |

Sólo para cobertura de Novedades: `resolveWorkObligationCandidates` y las alertas no cambian.

## 8. Revisión de días (D2, C1, D3)

- **Trabajo real en un tipo incompatible:** "No trabajó" → se corrige el trabajo real por el flujo existente y la cobertura cuenta sola; "Trabajó" → se rechaza/elimina la novedad o, en un rango, ese día pasa a `CONFIRMED_ZERO`. Mientras tanto cuenta sólo el trabajo real.
- **Tipo compatible que suma con exceso o sin jornada conocida:** `CONFIRMED_ZERO`, o `SET_BASE_MINUTES` con nota, validando trabajo + cobertura ≤ jornada esperada cuando se conoce.
- **Jornada no resuelta:** `CONFIRMED_ZERO` o `SET_BASE_MINUTES`.

## 9. Etapas

| Etapa | Contenido | Estado |
|---|---|---|
| 1 | Modelo, migración, configuración y validación del tipo, `Novelty.quantityMinutes` | **Implementada y aprobada** (2026-11-13) |
| 2 | `expectedWorkday` (núcleo puro + cargador batch) | Pendiente |
| 3 | Motor, persistencia de días, preview, resolución, guard de cierres | Pendiente |
| 4 | Contabilidad (`accountDay`), consumidores, snapshot de cierre, bloqueo de envío con revisión pendiente | Pendiente |
| 5 | Recálculo por reglas, convocatorias, francos, turnos, regímenes y configuración del tipo | Pendiente |
| 6–8 | Grilla frontend, Tipos de Novedad, carga reactiva con vista previa | Pendiente |
| 9 | Finnegans (`value1` derivado de la cobertura) | Pendiente |
| 10 | QA y cierre | Pendiente |

### Etapa 1 — qué quedó implementado

- `schema.prisma`: enums `NoveltyCoverage*` y `NoveltyRealWorkCompatibility`, campos de cobertura en `NoveltyType`, `Novelty.quantityMinutes`, tabla `NoveltyDayCoverage` (vacía, sin escritor todavía).
- Migración `20261113180000_add_novelty_coverage_engine` (aditiva). Precondición antes de cualquier cambio: aborta si una novedad de un tipo con horas y sin rango tiene más de 24 h. Backfill sólo con evidencia: `allowsHours = true` y sin rango → `MANUAL_MINUTES` que no suma (el comportamiento vigente); con rango → `NONE` (sin evidencia para repartir); resto → `NONE`; `quantityMinutes = round(quantityHours × 60)` en tipos manuales. Ningún tipo existente suma.
- Rollback `backend/prisma/rollbacks/20261113180000_add_novelty_coverage_engine.down.sql`: aborta si hay resoluciones manuales, tipos con configuración propia o cantidades que sólo existen en minutos.
- `novelty-types`: Zod con los campos nuevos (defaults neutros; políticas de franco y feriado sin default) y `assertCoverageConfigCoherent` en alta y PATCH.
- `novelties`: en tipos `MANUAL_MINUTES` el backend deriva `quantityMinutes` de `quantityHours` y rechaza más de 24 h (`400 NOVELTY_MANUAL_QUANTITY_EXCEEDS_DAY`). No cambia ningún total ni escribe horas.
- Seed local: "Llegada tarde" como `MANUAL_MINUTES` con su novedad en 60 min (mismo criterio que el backfill).
- Frontend sin cambios: los campos nuevos son aditivos en la API y un PATCH sin ellos conserva la configuración actual.

## 10. Pendientes

- **P1 (abierta):** Maternidad en un feriado lunes a viernes: no cuenta / cuenta igual / sólo si estaba convocada. No bloquea el motor; impide configurar el tipo definitivo.
- **P2:** Finnegans para tipos con cobertura: `HOURS` sin multiplicador (propuesto); Vacaciones en `DAYS`: días corridos (actual) o días cubiertos. Antes de la etapa 9.
- **P3 (corregida por el usuario, 2026-11-13; se resuelve al empezar la etapa 2):** varias `ShiftAssignment` aplicables el mismo día **no se suman a ciegas**. `expectedWorkday` debe soportar turnos partidos reales sin contar dos veces los intervalos superpuestos: 08:00–12:00 + 14:00–18:00 → 8 h; 08:00–16:00 + 12:00–20:00 **nunca** 16 h. La etapa 2 empieza auditando cómo el sistema permite hoy varias asignaciones para un mismo empleado y fecha, y propone la regla canónica de minutos esperados. Se prefiere calcular sobre los intervalos efectivos del día (unión) o detectar configuraciones incompatibles (revisión) antes que sumar `expectedMinutes`.
- **P4 (deuda documentada):** las alertas consideran feriado una regla FERIADO aunque tenga alcance acotado (`holidayDatesInRange`), mientras el motor de multiplicadores respeta el alcance. No se cambia en este rediseño.
- **Riesgo:** un tipo con `BLOQUEA_NUEVA_CARGA` aprobado rechaza la **salida** del fichador (`clockPhotoPunch` OUT → `ensureDayIsNotBlocked`, comportamiento existente). Revisar antes de configurar Vacaciones con bloqueo.
- `allowsHours` se retira en una etapa de limpieza cuando ya no tenga consumidores (patrón 15L.6).

## 11. Auditoría documental

| Documento | Qué decía | Estado |
|---|---|---|
| `NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md` | Novedades nunca genera ni modifica horas; Carga Horaria las muestra sólo como información; Llegada tarde no descuenta; no hace falta respetar cierres | Reemplazado parcialmente. Siguen vigentes §2.1–§2.5: no escribe `TimeEntry` y el bloqueo de nueva carga sólo aplica a APROBADO |
| `NOVELTY_QUANTITY_SEMANTICS_15L5.md` §5 | `quantityHours` es 100% manual y nunca se relaciona con horas | Reemplazado parcialmente: en tipos `MANUAL_MINUTES` la cantidad canónica es `quantityMinutes`; `quantityDays` sigue igual |
| `NOVELTY_TYPE_MODEL_NORMALIZATION_15L2A.md` §8 | Novedades nunca crea, modifica ni pone en 0 un `TimeEntry` | Sigue vigente (la cobertura no es un `TimeEntry`); la parte "no tiene efecto horario" se reemplaza |
| `NOVELTY_TYPE_LEGACY_REMOVAL_15L6.md` §3 | `allowsHours` alcanza para "registrar horas no trabajadas" | Reemplazado parcialmente: lo representa `coverageMode = MANUAL_MINUTES` |
| `docs/NOVEDADES_HORAS_FINNEGANS.md`, `docs/PROJECT_CONTEXT.md` (15G), `docs/BACKEND_API_CONTRACTS.md` | Resúmenes de 15G.1 | Nota de reemplazo parcial; contratos actualizados en cada etapa |
| `WORKED_TIME_ACCOUNTING_MODEL.md` | La contabilidad no recibe novedades | Se amplía en la etapa 4 (nueva sección) |
