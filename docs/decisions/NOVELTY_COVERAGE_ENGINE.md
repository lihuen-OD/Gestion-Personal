# Motor de cobertura horaria de Novedades

**Estado:** decisión aprobada el 2026-11-13; implementación por etapas en `feat/novelties-coverage-engine`. **Implementado hasta la Etapa 9** (modelo y configuración; jornada esperada; motor y persistencia de la cobertura diaria; contabilidad; recálculo automático por eventos; grilla; pantalla de Tipos de Novedad; carga de Novedades con vista previa; exportación a Finnegans, ver §9 y §12 a §16). Desde la etapa 4, la cobertura APROBADA que suma entra al total computable y a la liquidación. **El total trabajado sigue siendo sólo trabajo real**: el comportamiento productivo sigue siendo el de 15G.1 (justificación administrativa + bloqueo de nueva carga).

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
- **C4 — Relación laboral (2026-11-13):** fuera de una relación laboral conocida (antes del ALTA o desde la BAJA) el día es `OUTSIDE_EMPLOYMENT`, 0 h confirmado. Sin historia de altas y bajas suficiente para saberlo, 0 h provisional en revisión (`EMPLOYMENT_HISTORY_UNRESOLVED`). No se bloquea la carga por faltar el ALTA ni se asume que el legajo estaba activo por existir.
- **C5 — Historia laboral faltante para una regla con alcance (2026-11-13):** es un problema de integridad, no una revisión: error explícito `409 SPECIAL_HOUR_SCOPE_HISTORY_MISSING` y no se calcula ni persiste nada.
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

- `outcome`: `COVERED` · `NO_COVERAGE` · `WEEKDAY_NOT_INCLUDED` · `NO_WORK_OBLIGATION` · `HOLIDAY_NOT_CONVOKED` · `HOLIDAY_EXCLUDED` · `DAY_OFF` · `SCHEDULE_UNRESOLVED` · `OUTSIDE_EMPLOYMENT` (etapa 3).
- `scheduleReviewReason` (sólo `SCHEDULE_UNRESOLVED`; el outcome significa "0 h provisional, revisar" y el motivo dice por qué): `SCHEDULE_MISSING` · `FLEXIBLE_REGIME_NO_ASSIGNMENT` · `REGIME_WITHOUT_SCHEDULE` · `EXPECTED_MINUTES_UNKNOWN` · `SHIFT_ASSIGNMENTS_OVERLAP` (etapa 3) · `EMPLOYMENT_HISTORY_UNRESOLVED` (etapa 3).
- Los tres valores nuevos los agrega la migración aditiva `20261114120000_add_novelty_coverage_employment_and_overlap`, sin tocar la de la etapa 1 (rollback en `backend/prisma/rollbacks/`: aborta si alguna fila usa los valores nuevos; suelta y recrea, idénticos, los CHECKs que referencian el enum). `HOLIDAY_SCOPE_HISTORY_MISSING` nunca se persiste (C5).
- `baseMinutes`, `appliedMultiplier`, `expectedMinutes` (jornada resuelta o `null`), snapshot de `countsTowardTotal` y `realWorkCompatibility`, `shiftTemplateId` de origen.
- Revisión: `reviewStatus` (`NOT_REQUIRED` · `PENDING` · `RESOLVED`) y resolución (`CONFIRMED_ZERO` · `SET_BASE_MINUTES`) con autor, fecha, nota y los minutos reales contra los que se resolvió. Si esos minutos reales cambian después, el día vuelve a revisión.
- Los minutos computados no se persisten: `(resolvedBaseMinutes ?? baseMinutes) × appliedMultiplier`, igual que `TimeEntry`.
- `Novelty` → `NoveltyDayCoverage` es `Cascade` (dato derivado). La historia queda en la auditoría y en los snapshots de cierre.
- `shiftTemplateId` se guarda sólo si la jornada salió de un único turno; con turno partido queda `null`.

### 5.1 Relación laboral (etapa 3)

Fuente única: `LaborMovement` (ALTA/BAJA con `effectiveFrom` `@db.Date`, reingresos incluidos). `employees/laborRelation.ts::laborRelationOnDate` usa la misma regla de vigencia que `employees.repository.ts::resolveLaborStatus` (el estado de hoy): decide el último movimiento con fecha <= el día, y una BAJA rige desde su propia fecha. Un test fija que ambas coinciden siempre que hay evidencia.

- Antes del primer ALTA → `NOT_EMPLOYED`; desde la BAJA → `NOT_EMPLOYED`; con un ALTA vigente → `EMPLOYED`.
- **Ambiguo → `UNKNOWN`** (`resolveLaborStatus` lo completa con un default, que para fechas históricas sería inventar):
  - legajo sin ningún movimiento (el alta mínima no exige ALTA; el frontend sólo la envía si se cargó fecha de ingreso);
  - fecha anterior a una primera BAJA sin ALTA previa;
  - ALTA y BAJA con la misma fecha (el orden no está registrado).
- **En la cobertura:**
  - `NOT_EMPLOYED` → `OUTSIDE_EMPLOYMENT`, 0 h confirmado (distinto de `NO_WORK_OBLIGATION`).
  - `UNKNOWN` → `SCHEDULE_UNRESOLVED / EMPLOYMENT_HISTORY_UNRESOLVED` (0 h provisional, revisión), sólo si el tipo suma al total. Un tipo informativo (no suma) no tiene nada computable que proteger y se calcula normal.
  - Tipos `NONE`: siempre `NO_COVERAGE`.
- El encargado confirma 0 h o indica las horas base; si después se registra el ALTA, el recálculo resuelve el día con la evidencia (§6.2).

CHECKs de integridad: período y día coherentes con la fecha; minutos entre 0 y 1440 y 0 fuera de `COVERED`; multiplicador > 0; `SCHEDULE_UNRESOLVED` siempre con motivo y nunca `NOT_REQUIRED` (0 h provisional ≠ confirmado); `PENDING` sólo en `SCHEDULE_UNRESOLVED`; una resolución completa o ninguna. Los CHECKs con columnas anulables van envueltos en `COALESCE(…, false)`.

## 6. Motor y persistencia (etapa 3)

Implementación:
- `novelties/noveltyCoverage.engine.ts`: motor puro, sin consultas.
- `novelties/noveltyCoverage.service.ts`: contexto en lote, persistencia, guard de cierres y trabajo real del día.
- `novelties/novelties.service.ts`: endpoints.
- `backend/scripts/novelties-coverage-reconcile.ts`: reconciliación.

### 6.1 Algoritmo por día (`evaluateNoveltyCoverageDay`)

1. Tipo `NONE` → `NO_COVERAGE`, 0, sin revisión.
2. Relación laboral (§5.1): `NOT_EMPLOYED` → `OUTSIDE_EMPLOYMENT`; `UNKNOWN` y el tipo suma → revisión `EMPLOYMENT_HISTORY_UNRESOLVED`.
3. `MANUAL_MINUTES` → `Novelty.quantityMinutes`, sin reglas de días (sin cantidad: `NO_COVERAGE`).
4. Regla de días:
   - `WORK_OBLIGATION`: resultado de `expectedWorkday` (§7). `DAY_OFF` / `HOLIDAY_NOT_CONVOKED` / `NO_WORK_OBLIGATION` → 0 confirmado; `UNRESOLVED` → revisión con su motivo; `HOLIDAY_SCOPE_HISTORY_MISSING` → error (C5).
   - `SELECTED_WEEKDAYS`: día no incluido → `WEEKDAY_NOT_INCLUDED`.
   - Calendario (`EVERY_DAY` y `SELECTED_WEEKDAYS`): franco ACTIVO con `NO_COVERAGE` → `DAY_OFF`. Feriado que alcanza al legajo: con `NO_COVERAGE` → `HOLIDAY_EXCLUDED`; con `ONLY_IF_CONVOKED` y sin convocatoria → `HOLIDAY_NOT_CONVOKED`; con `COVER`, o convocado, sigue. Si el alcance del feriado depende de historia faltante y la política lo necesita → error (C5).
5. Minutos base: `FIXED_MINUTES` → `coverageFixedMinutes`; `EXPECTED_SCHEDULE` → minutos de la jornada (más de 1440 o desconocidos → revisión `EXPECTED_MINUTES_UNKNOWN`).
6. Resolución manual previa (§6.2).
7. Multiplicador: si el tipo aplica Horas Especiales y los minutos efectivos son > 0, el del motor único (`evaluateSpecialHourRulesForEmployees`: domingo, feriado con su política de convocatoria, reglas globales y por alcance, prioridades). Historia faltante → error (C5), nunca ×1.
8. Minutos computados = efectivos × multiplicador. No se persisten.

El motor no recibe trabajo real: una fila de Trámite bancario representa 240 aunque ese día haya fichada. El conflicto con trabajo real (D2/C1) se evalúa al contabilizar (§12).

### 6.2 Resoluciones manuales y recálculo

- Una resolución (`CONFIRMED_ZERO` / `SET_BASE_MINUTES`) guarda autor, fecha, nota obligatoria, minutos base resueltos y los minutos reales del día al resolver (`loadRealWorkedMinutesOnDate`, mismo criterio que la grilla).
- El recálculo **conserva** la resolución mientras responda a la misma incertidumbre: mismo outcome `SCHEDULE_UNRESOLVED` con el mismo motivo, o un día que sigue `COVERED` (resoluciones de conflicto con trabajo real, etapa 4); en ese caso, unas horas base indicadas (`SET_BASE_MINUTES`) sólo siguen valiendo si no cambió la jornada esperada contra la que se validaron (etapa 5, §13.4).
- Si los datos ya permiten calcular el día (se registró el ALTA o el turno), **manda la evidencia**: la resolución se descarta y el recálculo lo informa (`droppedResolutions`).
- Si cambia el motivo de revisión, el día vuelve a `PENDING`.
- El multiplicador se vuelve a aplicar sobre los minutos resueltos.
- La invalidación por cambio de los minutos reales (D2) es de lectura: la contabilidad la detecta como `RESOLUTION_OUTDATED` (§12).

### 6.3 Persistencia (`persistNoveltyCoverageWithin`)

- Idempotente y **por diferencia** (etapa 5), dentro de la transacción del llamador:
  - calcula con el motor, conservando las resoluciones válidas, y sólo borra/crea las filas que cambiaron (una fila idéntica no se reescribe y conserva su `calculatedAt`);
  - `window` opcional: acota el cálculo y la escritura a esas fechas; las filas de afuera no se leen ni se tocan;
  - una novedad RECHAZADA queda sin filas;
  - toda otra novedad, de cualquier modo (también `NONE`), tiene una fila por día.
- **Fechas (decisión del usuario, 2026-11-13):** `toDate` nulo es **exactamente un día** (`fromDate`), para cualquier tipo. `allowsDateRange = true` significa que el tipo **puede** abarcar varias fechas, no que deba. `fromDate = toDate` también es un único día; `toDate > fromDate` es un rango. Nunca un rango abierto infinito. El mismo criterio aplica al bloqueo de nueva carga (`findBlockingNovelty`).
- Consultas fijas por llamada, nunca por día:
  - novedades;
  - contexto de jornada esperada por ventana de hasta 366 días;
  - movimientos de alta y baja;
  - motor de Horas Especiales para todos los legajos;
  - filas previas resueltas;
  - inserción en lotes de 5000.
- Límites:
  - 366 días por novedad que registra tiempo (`toDate` obligatorio si el tipo admite rango);
  - 3660 días para un tipo sin tiempo;
  - 20 000 días-legajo por operación.
- **Concurrencia:** lock global de cobertura compartido, lock transaccional por legajo (`novelty-coverage:<employeeId>`) y lock compartido de cierre por legajo y período (`findProtectedClosurePeriods`), en ese orden (§13.6).
- **Períodos protegidos** (ENVIADO, APROBADO, CORRECCION_PENDIENTE). Sólo cuentan para tipos que registran tiempo:
  - `REJECT` (un usuario sin corrección): `409 PERIOD_CLOSED`.
  - `ALLOW_CORRECTION` (RRHH con motivo): se escribe y se audita el motivo.
  - `SKIP` (recálculo automático y reconciliación): esos días no se calculan (la falta de historia de un período cerrado no bloquea el cambio) ni se tocan, y se informan.
  - Snapshots de cierre: desde la etapa 4 el snapshot (V2) incluye la cobertura y se arma al enviar el cierre, que exige no tener días en revisión. Desde la etapa 5, el recálculo automático reconstruye los snapshots de los cierres no protegidos afectados (§13.5). Una mutación directa de una novedad (alta, aprobación, rechazo, resolución) todavía no reconstruye el snapshot de un cierre devuelto: se rehace en el próximo envío (deuda, §13.9).

### 6.4 Operaciones de una novedad

- **Crear:** valida, crea la novedad y su cobertura en **una** transacción (timeout 30 s). Si la cobertura no se puede calcular sin inventar, o el período está protegido, no se crea nada.
  - Nuevos `400` de validación: `NOVELTY_MANUAL_QUANTITY_REQUIRED`, `NOVELTY_COVERAGE_RANGE_TOO_LONG`, `NOVELTY_COVERAGE_TOO_LARGE`, `NOVELTY_OBSERVATION_REQUIRED` (`requiresObservation` de la etapa 1, ahora exigido).
  - Body opcional `correctionReason` para la corrección de RRHH sobre un período protegido.
- **Aprobar:** no reescribe la cobertura (el estado se lee al contabilizar). Guard de cierres y alcance del legajo en la misma transacción.
- **Aprobación masiva:** una sola transacción. Si una falla, no se aprueba ninguna (antes se aprobaban una por una y un error dejaba el lote a medias). Sin motivo: un período protegido rechaza el lote.
- **Rechazar:** elimina las filas derivadas en la misma transacción. La auditoría conserva la novedad completa; el motivo del rechazo vale como motivo de corrección de RRHH.
- **Eliminar:** la cobertura cae por `Cascade`; guard de cierres, con `correctionReason` opcional.
- **Alcance:** aprobar y rechazar ahora filtran por el alcance del legajo (antes leían sin filtrar).
- **Vista previa** (`POST /novelties/coverage-preview`): la misma `computeNoveltyCoverage` que la persistencia, sin escribir. Mismos permisos y alcance que la carga; hasta 50 legajos.
- **Consulta** (`GET /novelties/:id/coverage`): filas persistidas con etiqueta legible y totales; respeta el alcance.
- **Resolución** (`POST /novelties/:id/coverage-days/:date/resolution`):
  - sólo días `SCHEDULE_UNRESOLVED`, incluida la corrección de una resolución anterior;
  - roles de carga del tipo o RRHH, alcance del legajo, nota obligatoria (5 a 600) y minutos 1..1440;
  - guard de cierres;
  - auditoría con autor, nota y resultado en lenguaje de negocio.

### 6.5 Reconciliación

`npm run novelties:coverage:reconcile`:
- Sólo PostgreSQL local: rechaza cualquier otro host y producción.
- Dry-run por defecto, con transacciones que se revierten.
- `--apply` exige `--backup=<archivo nuevo>` y guarda ahí las filas actuales antes de escribir. Filtros opcionales `--from` y `--to`.
- Usa modo `SKIP`. Procesa en lotes de 25 y aísla las novedades que fallan, por ejemplo por historia faltante.
- Informa novedades, días antes y después, días a revisar, resoluciones descartadas y períodos protegidos.

### 6.6 Errores explícitos

- `409 SPECIAL_HOUR_SCOPE_HISTORY_MISSING`: historia laboral faltante para una regla con alcance, sea de feriado (`expectedWorkday` o política de calendario) o de multiplicador. Mismo código que el motor de Horas Especiales, con legajo y fecha en el mensaje.
- `409 PERIOD_CLOSED`, `400 NOVELTY_CORRECTION_REASON_REQUIRED`.
- `409 NOVELTY_COVERAGE_DAY_NOT_IN_REVIEW`, `404 NOVELTY_COVERAGE_DAY_NOT_FOUND`, `409 NOVELTY_COVERAGE_REJECTED`.

## 7. Jornada esperada para Novedades (etapa 2)

Implementación: `backend/src/modules/shifts/expectedWorkday.ts`. Núcleo puro `evaluateEmployeeWorkday(context, dateKey)`, cargador batch `loadEmployeeWorkdayContext(employeeIds, from, to, db)` y `resolveExpectedWorkdays` (ambos juntos). La duración de un turno sale de una única fórmula, `shifts/shiftTemplateTime.ts::computeExpectedMinutes`, movida sin cambios desde `workforce.service.ts`.

### 7.1 Auditoría (2026-11-13)

- **Varias asignaciones el mismo día están permitidas sin control.** La única restricción es `@@unique([employeeId, shiftTemplateId])`: un legajo puede tener varios turnos **distintos** HABILITADOS, vigentes y aplicables el mismo día de semana, incluso con horarios superpuestos. `shiftAssignment.service.ts` no valida solapamiento de horarios, vigencias ni días.
- **El motor de alertas las trata como alternativas, no como suma.** `matchShiftForEmployee` toma el turno propio más cercano a la fichada. `resolveWorkObligationCandidates` toma el de inicio más temprano. El schema documenta los "rotativos V1" como dos asignaciones con vigencias que se alternan a mano.
- **Duración:** `ShiftTemplate.expectedMinutes` lo escribe sólo el alta/edición del turno con `computeExpectedMinutes(start, end, crossesMidnight)`. Esa fórmula no descuenta descansos. `crossesMidnight = endTime <= startTime`, así que un turno con la misma hora de inicio y fin dura 24 h. No había ningún lector en runtime.
- **Convocatoria a feriado:** `HolidayWorkAssignment.shiftTemplateId` y `expectedStartTime/EndTime` son informativos. El motor de alertas los ignora, así que un convocado sin `ShiftAssignment` aplicable no tiene obligación para alertas. El schema valida los horarios con `^\d{2}:\d{2}$` sin rango (acepta `99:99`).
- **Feriado:** las alertas usan `holidayDatesInRange`, que ignora el alcance de la regla FERIADO (P4). El motor de Horas Especiales sí lo respeta, usando la historia laboral vigente cada día.
- **Régimen:** a lo sumo un `EmployeeWorkRegime` vigente por legajo (el servicio impide solapar vigencias). `SIN_TURNO` excluye de la obligación y `TURNO_FLEXIBLE` suprime alertas de turno faltante.
- **Cruce de medianoche:** la obligación de la fecha D es el turno cuyo inicio programado cae en D (fecha operativa, `EMPLOYEE_DAY_OFF.md` §4). Un franco en D anula ese turno.

### 7.2 Regla canónica P3: varios turnos el mismo día

`expectedMinutesForTemplates`, con intervalos semicerrados `[inicio, inicio + duración)` en minutos desde la medianoche de la fecha operativa:

- **Un turno:** sus minutos canónicos (`expectedMinutes` guardado o, si es `null`, `computeExpectedMinutes` con su horario).
- **Varios turnos que no se superponen** (turno partido; tocarse en el borde no es superponerse): la suma de los minutos de cada uno. 08:00–12:00 + 14:00–18:00 = 480.
- **Varios turnos que se superponen:** `UNRESOLVED (SHIFT_ASSIGNMENTS_OVERLAP)`. 08:00–16:00 + 12:00–20:00 nunca da 960, y tampoco una unión de 720: con el modelo actual no se puede distinguir un turno partido de dos alternativas mal configuradas.
- **Algún horario inválido sin minutos guardados:** `UNRESOLVED (EXPECTED_MINUTES_UNKNOWN)`.
- No se usa la unión de intervalos: con turnos disjuntos coincide con la suma, y con turnos superpuestos inventaría una jornada.

### 7.3 Semántica final (precedencia)

"Planificación vigente" = al menos una `ShiftAssignment` HABILITADA, con template ACTIVO, cuya vigencia incluye la fecha (cualquier día de semana).

| # | Situación | Resultado | `expectedMinutes` |
|---|---|---|---|
| 1 | Franco ACTIVO (gana sobre convocatoria) | `DAY_OFF` | 0 confirmado |
| 2 | Feriado por calendario + convocatoria ACTIVA de la persona | `WORKDAY`; minutos: turno de la convocatoria (ACTIVO) → asignaciones aplicables (regla P3) → horario explícito válido de la convocatoria. Si nada alcanza → `UNRESOLVED (EXPECTED_MINUTES_UNKNOWN)`; con asignaciones superpuestas → `UNRESOLVED (SHIFT_ASSIGNMENTS_OVERLAP)` | minutos o `null` |
| 3 | Feriado que alcanza al legajo, sin convocatoria | `HOLIDAY_NOT_CONVOKED` | 0 confirmado |
| 3b | Feriado con alcance que depende de historia sin registrar ese día, sin convocatoria | `UNRESOLVED (HOLIDAY_SCOPE_HISTORY_MISSING)` | `null` |
| 4 | Régimen vigente `SIN_TURNO` (con o sin asignaciones) | `UNRESOLVED (REGIME_WITHOUT_SCHEDULE)` | `null` |
| 5 | Asignación aplicable ese día | `WORKDAY` (regla P3) o `UNRESOLVED` | minutos o `null` |
| 6 | `TURNO_FLEXIBLE` sin asignación aplicable | `UNRESOLVED (FLEXIBLE_REGIME_NO_ASSIGNMENT)` | `null` |
| 7 | Sin planificación vigente (cualquier régimen o ninguno; legajo mínimo) | `UNRESOLVED (SCHEDULE_MISSING)` | `null` |
| 8 | `TURNO_OBLIGATORIO` o sin régimen, planificación vigente que excluye el día | `NO_WORK_OBLIGATION` | 0 confirmado |

- **Feriado para el legajo** (`resolveEmployeeHolidayStatus`): reglas FERIADO ACTIVAS vigentes cuyo calendario cae en la fecha (`ruleMatchesDate`), con la lista de legajos y `evaluateRuleScope` sobre la historia vigente ese día. Son las mismas piezas que el motor de Horas Especiales, sin la política de convocatoria, porque la convocatoria decide quién trabaja y no si la fecha es feriado.
  - Si alguna regla alcanza al legajo, es `IN_SCOPE`.
  - Si hay FERIADO por calendario pero ninguno lo alcanza, es `OUT_OF_SCOPE` y el día se evalúa como uno normal.
  - Si ninguna lo alcanza con certeza y alguna depende de historia faltante, es `SCOPE_HISTORY_MISSING`.
  - Un legajo mínimo (historia vigente vacía) queda fuera de reglas con alcance y dentro de las globales.
- **Convocatoria:** cuenta sólo si la fecha es feriado por calendario (FERIADO vigente, alcance cualquiera, como en `WORKED_TIME_ACCOUNTING_MODEL.md` §16). Una convocatoria en una fecha sin regla FERIADO se ignora.
- **Resultado:** `ExpectedWorkday = { dateKey, obligation, unresolvedReason, expectedMinutes, shiftTemplateIds, isHoliday, convoked, source, minutesSource }`. `source` es la evidencia: `EMPLOYEE_DAY_OFF` · `HOLIDAY_RULE` · `HOLIDAY_CONVOCATION` · `WORK_REGIME` · `SHIFT_PLAN` · `NONE`. `minutesSource` dice de dónde salieron los minutos: `CONVOCATION_SHIFT_TEMPLATE` · `SHIFT_ASSIGNMENT` · `CONVOCATION_TIMES`.
- **Consultas:** fijas por llamada, nunca por legajo ni por día. Son 5: asignaciones + turnos, francos, convocatorias, regímenes y reglas FERIADO. La historia laboral (5 consultas más) se agrega una sola vez para todos, y sólo si alguna regla FERIADO del rango restringe empresa, sector, centro de costo o puesto. Rango máximo 400 días.

### 7.4 Diferencias con el motor de alertas (deliberadas)

`resolveWorkObligationCandidates`, falta de ingreso, inactividad y alertas de turno **no cambiaron**: sus tests siguen verdes sin tocar expectativas. El resolver de Novedades sólo comparte los bloques puros `isShiftAssignmentActiveOnDate` e `isShiftAssignmentApplicableOnWeekday`.

| Caso | Alertas | Cobertura de Novedades |
|---|---|---|
| `SIN_TURNO` | sin obligación | `UNRESOLVED (REGIME_WITHOUT_SCHEDULE)` |
| `TURNO_FLEXIBLE` sin asignación aplicable | sin obligación | `UNRESOLVED (FLEXIBLE_REGIME_NO_ASSIGNMENT)` |
| Sin ninguna asignación | sin obligación | `UNRESOLVED (SCHEDULE_MISSING)` |
| Varias asignaciones | una (la de inicio más temprano o la más cercana a la fichada) | suma si son disjuntas; `UNRESOLVED` si se superponen |
| Feriado | `holidayDatesInRange`, sin alcance (P4) | alcance de la regla sobre la historia del legajo |
| Convocado sin turno asignado | sin obligación | turno u horario de la convocatoria |

### 7.5 Limitaciones conocidas

- **Motivos detectados en la etapa 2 (decisión del usuario, 2026-11-13):**
  - `SHIFT_ASSIGNMENTS_OVERLAP` es una jornada no resoluble legítima. Se persiste como revisión de cobertura: la etapa 3 agrega el valor a `NoveltyCoverageScheduleReviewReason` con una migración aditiva nueva, sin tocar la de la etapa 1.
  - `HOLIDAY_SCOPE_HISTORY_MISSING` **no** es una revisión de cobertura: es un problema de integridad o de datos insuficientes. La etapa 3 responde un error explícito con el criterio del motor de Horas Especiales (`409 SPECIAL_HOUR_SCOPE_HISTORY_MISSING` o un código equivalente reutilizable). Nunca genera 0 h provisional ni permite que el encargado complete la respuesta.
- **Estado actual, no histórico:** el estado de `ShiftTemplate` y de `ShiftAssignment` (HABILITADO/ACTIVO) es el actual, no el que tenían en la fecha. Lo mismo hace el motor de alertas. La vigencia de la asignación sí es por fecha.
- **Relación laboral:** `expectedWorkday` no verifica si el legajo estaba de alta en la fecha (`Employee.status` es actual). **Decisión del usuario (2026-11-13):** la etapa 3 incorpora la relación laboral vigente en cada fecha antes de generar cobertura. No hay cobertura computable antes del inicio ni después del fin de la relación. Se audita primero la fuente canónica de altas y bajas (`LaborMovement` o equivalente) y se reutiliza, sin crear otra fuente de verdad; una situación histórica ambigua se informa, y nunca se asume que el legajo estaba activo en cualquier fecha por existir.
- **Solapamiento entre fechas operativas distintas:** no se evalúa. Un turno 22:00–06:00 del domingo y uno 05:00–13:00 del lunes son de días operativos distintos.
- **Duración del turno:** no descuenta descansos. Es la definición vigente del sistema y no se cambia acá.
- **Turno de la convocatoria inactivo:** se ignora y se pasa a la siguiente fuente de minutos.

## 8. Revisión de días (D2, C1, D3)

- **Trabajo real en un tipo incompatible:** "No trabajó" → se corrige el trabajo real por el flujo existente y la cobertura cuenta sola; "Trabajó" → se rechaza/elimina la novedad o, en un rango, ese día pasa a `CONFIRMED_ZERO`. Mientras tanto cuenta sólo el trabajo real.
- **Tipo compatible que suma con exceso o sin jornada conocida:** `CONFIRMED_ZERO`, o `SET_BASE_MINUTES` con nota, validando trabajo + cobertura ≤ jornada esperada cuando se conoce.
- **Jornada no resuelta:** `CONFIRMED_ZERO` o `SET_BASE_MINUTES`.

## 9. Etapas

| Etapa | Contenido | Estado |
|---|---|---|
| 1 | Modelo, migración, configuración y validación del tipo, `Novelty.quantityMinutes` | **Implementada y aprobada** (2026-11-13) |
| 2 | `expectedWorkday` (núcleo puro + cargador batch), regla P3 | **Implementada y aprobada** (2026-11-13) |
| 3 | Motor, persistencia de días, preview, resolución, guard de cierres, relación laboral | **Implementada y aprobada** (2026-11-13) |
| 4 | Contabilidad (`accountDay`), consumidores, snapshot de cierre, bloqueo de envío con revisión pendiente | **Implementada y aprobada** (2026-11-13) |
| 5 | Recálculo automático por eventos: relación e historia laboral, turnos, plantillas, regímenes, francos, convocatorias, reglas y configuración del tipo (§13) | **Implementada y aprobada** |
| 6 | Grilla frontend: chips de cobertura, revisión manual, cierre mensual | **Implementada y aprobada** (`1068de7`) |
| 7 | Pantalla de alta y edición de Tipos de Novedad con preguntas de negocio (§14) | **Implementada y aprobada** (`75b96f0`) |
| 8 | Carga de Novedades guiada por el Tipo, con vista previa de cobertura (§15) | **Implementada y aprobada** (`ca187d8`) |
| 9 | Finnegans: Valor 1 desde la cobertura diaria (§16) | **Implementada y aprobada** (`0c70f45`) |
| 10 | QA y cierre | Auditoría integral hecha el 2026-11-16; P5 detectada y corregida (§12.3) |

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
- **P2 (resuelta el 2026-11-16 por el usuario, §16):** `HOURS` = base sin multiplicador; `DAYS` = días corridos; una novedad con cobertura se divide por mes.
- **P3 (resuelta en la etapa 2):** varios turnos el mismo día suman sólo si sus horarios no se superponen; si se superponen, la jornada queda para revisión. Ver §7.2.
- **P4 (deuda documentada):** las alertas consideran feriado una regla FERIADO aunque tenga alcance acotado (`holidayDatesInRange`), mientras el motor de multiplicadores y la jornada esperada de Novedades (§7.3) respetan el alcance. No se cambia en este rediseño.
- **P5 (resuelta el 2026-11-16 por el usuario, auditoría de la etapa 10):** coberturas de tipos distintos el mismo día que, sumadas con el trabajo real, superan la jornada esperada conocida van a revisión con todas las implicadas retenidas. Antes se sumaban sin tope (Vacaciones 7 h + Trámite 3 h = 10 h computables). Ver §12.2 a §12.4.
- **Deuda menor (etapa 2):** `holidayWorkAssignment.schemas.ts` acepta horarios fuera de rango (`99:99`). La jornada esperada los trata como desconocidos y no los convierte en minutos; validar el rango en el schema queda como mejora aparte.
- **Etapa 3 (resuelto, §5.1 y §6):** migración aditiva para `SHIFT_ASSIGNMENTS_OVERLAP`, `OUTSIDE_EMPLOYMENT` y `EMPLOYMENT_HISTORY_UNRESOLVED`; error explícito para la historia faltante; cobertura acotada a la relación laboral.
- **Etapa 5 (resuelto, §13):** recálculo automático en la transacción de cada evento que cambia una fuente del motor. Deudas que quedan: §13.9.
- **Otros lectores con rango abierto (resuelto en la etapa 4, §12.9):** la grilla, el listado por período, la exención de inactividad y falta de ingreso y el dashboard usan el helper único (`toDate` nulo = un día). Finnegans: §16.
- **Incidente (etapa 3, 2026-11-13): conexión accidental de tests unitarios a Neon, sin escrituras confirmadas.**
  - **Qué pasó:** al pasar las mutaciones de novedades a transacciones, `novelties.service.test.ts` abrió Prisma sin mockear el cliente y usó la `DATABASE_URL` del `backend/.env`. El usuario la confirmó como **NEON** (endpoint pooler de desarrollo, base `neondb`). No se documentan host completo, usuario, contraseña ni parámetros de conexión.
  - **Alcance auditado:** las escrituras de novedades estaban mockeadas. Lo que llegó a Prisma fueron lecturas y locks transaccionales (advisory locks), que fallaron porque esa base no tenía las columnas nuevas. La tabla de cobertura no existía ahí. No hay evidencia de mutaciones de datos.
  - **Mitigación:**
    - `backend/vitest.config.ts` fuerza una `DATABASE_URL` local inalcanzable, así que el `.env` nunca entra a los tests;
    - `backend/src/shared/prisma/testDatabaseGuard.ts` (usado por `shared/prisma/client.ts`) bloquea, bajo vitest y antes de conectar, cualquier base que no sea una local de integración;
    - sólo las suites de integración opt-in usan bases locales explícitas (`clock_it*`, `deletion_it*`, `reorg_it_m2*`);
    - los tests del guard (`testDatabaseGuard.test.ts`) corren en la suite. Detalle en `docs/TESTING_QA_STANDARDS.md`, "Base de datos en tests".
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
| `WORKED_TIME_ACCOUNTING_MODEL.md` | La contabilidad no recibe novedades | Ampliado en la etapa 4 (§19, remite a §12 de este documento) |

## 12. Contabilidad con cobertura (etapa 4)

Implementación única: `backend/src/modules/time-entries/workedTimeAccounting.ts` (`accountNoveltyDay`, `accountDay`, `accountEmployeePeriods`). Carga en lote: `backend/src/modules/novelties/noveltyCoverageAccounting.ts`.

### 12.1 Modelo

`TimeEntry`, fichadas, jornadas y segmentos siguen siendo la única fuente de `totalWorkedMinutes`. La cobertura es un tercer componente:

```
totalWorkedMinutes      = base + adicionales                  (trabajo real, sin cambios)
noveltyCoveredMinutes   = Σ cobertura COUNTED (minutos base efectivos)
computableMinutes       = totalWorkedMinutes + noveltyCoveredMinutes
settlement.noveltyMinutes = Σ cobertura COUNTED × su multiplicador
settlement.totalMinutes = normal + dentro de la jornada + adicionales + noveltyMinutes
```

- Minutos base efectivos = `resolvedBaseMinutes ?? baseMinutes` (`CONFIRMED_ZERO` deja 0). La fila persistida no se modifica para calcular.
- El multiplicador afecta sólo la liquidación. Vacaciones de domingo ×2 son 8 h computables y 16 h para liquidación, nunca "16 h trabajadas".
- `day.multiplier` sigue siendo el del trabajo real. `hasSpecialMultiplier` del período también se enciende si la cobertura tiene un multiplicador distinto de 1.
- La salida agrega, por día, `novelty = { coveredMinutes, settlementMinutes, informativeMinutes, pendingApprovalMinutes, heldMinutes, reviewRequired, items[] }` y, por período, `novelty = { …, reviewDays, reviewDates, types[] }`. Cada ítem trae `state`, `reviewReasons`, `baseMinutes`, `multiplier` y `settlementMinutes`.

### 12.2 Estados de una cobertura (al leer)

| Estado | Cuándo | Efecto |
|---|---|---|
| `PENDING_APPROVAL` | Novedad no APROBADA | Visible con su cantidad; no suma ni bloquea |
| `REVIEW_REQUIRED` | Ver motivos abajo | No suma (`heldMinutes`); bloquea el envío del cierre |
| `INFORMATIVE` | `countsTowardTotal = false` (p. ej. Llegada tarde) | Visible; no suma |
| `COUNTED` | APROBADA, suma y sin revisión | Suma al computable y, × multiplicador, a la liquidación |

Una novedad RECHAZADA se ignora (no debería tener filas desde la etapa 3; defensa).

Motivos de revisión (`reviewReasons`):
- `SCHEDULE_UNRESOLVED`: jornada o relación laboral sin resolver (0 h provisional).
- `RESOLUTION_OUTDATED`: la resolución manual se hizo contra otros minutos reales; el trabajo del día cambió.
- `REAL_WORK_ON_INCOMPATIBLE`: tipo `INCOMPATIBLE` con trabajo real un día que la novedad cubre (minutos > 0, o una novedad sin tiempo como Falta sin aviso). No se suman: mientras no se resuelva, gana el trabajo real. Los días sin cobertura de la novedad (franco, fin de semana excluido, sin obligación, feriado, fuera de la relación laboral) no son conflicto.
- `REAL_WORK_EXCEEDS_EXPECTED`: tipo `COMPATIBLE` que suma, con trabajo + cobertura mayor a la jornada esperada. No se trunca.
- `REAL_WORK_WITHOUT_EXPECTED`: tipo `COMPATIBLE` que suma, con trabajo real y sin jornada esperada para validarlo.
- `COVERAGE_TOTAL_EXCEEDS_EXPECTED` (P5): dos o más coberturas que quedarían `COUNTED`, sumadas con el trabajo real del día, superan la jornada esperada conocida. Se retienen todas las implicadas (ver §12.3).

El trabajo real del día es `totalWorkedMinutes` después de excluir lo que no computa por franco, con el criterio de la grilla.

### 12.3 Cómo se evita el doble conteo

- La cobertura nunca entra a `baseMinutes`, `additiveMinutes` ni `totalWorkedMinutes`, y nunca escribe `TimeEntry`.
- Un tipo incompatible con trabajo real retiene su cobertura: cuenta sólo el trabajo. Trámite de 4 h con 4 u 8 h reales da 4 u 8 h computables, nunca 8 o 12.
- Un tipo compatible que excede la jornada (o sin jornada para validarlo) va a revisión, sin sumar.
- **P5, varias coberturas el mismo día (decisión del usuario, 2026-11-16):** trabajo real + Σ coberturas candidatas a `COUNTED` no puede superar la jornada esperada conocida. `accountNoveltyDay` evalúa primero cada cobertura como siempre y después valida juntas las candidatas: si hay dos o más y la suma excede, todas pasan a `REVIEW_REQUIRED` (`COVERAGE_TOTAL_EXCEEDS_EXPECTED`) y ninguna suma. No se trunca, no se elige una por orden (el resultado no depende del orden) y no cuenta una parte arbitraria. Dentro de la jornada, dos novedades de tipos distintos conviven: no hay matriz de incompatibilidad entre novedades. Rechazadas, pendientes e informativas no participan. Con jornada desconocida en alguna candidata no se inventa un límite: rigen las reglas individuales. Una cobertura sola conserva el comportamiento de su tipo (por ejemplo Maternidad que cubre un franco con jornada 0); trabajo real + una cobertura ya lo validan las reglas individuales. Se calcula al leer, así que corregir la evidencia (confirmar 0 en una, quitar o rechazar una novedad, corregir el trabajo o el turno) resuelve el día sin otro paso. El cierre y Finnegans lo bloquean por el mismo `REVIEW_REQUIRED`.
- Cada día se cuenta una sola vez por consumidor: la cobertura entra por la misma función pura que el trabajo real.

### 12.4 Resolución de conflictos con trabajo real

`POST /novelties/:id/coverage-days/:date/resolution` acepta, además de los días `SCHEDULE_UNRESOLVED`, un día `COVERED` en conflicto con el trabajo real (C1):
- **Tipo incompatible:** sólo `CONFIRMED_ZERO` ("la novedad no cubre este día"). `SET_BASE_MINUTES` responde `400 NOVELTY_COVERAGE_RESOLUTION_NOT_ALLOWED`.
- **Tipo compatible:** `CONFIRMED_ZERO`, o `SET_BASE_MINUTES` con trabajo + minutos ≤ jornada esperada si se conoce (`400 NOVELTY_COVERAGE_EXCEEDS_EXPECTED`).
- **P5 (`COVERAGE_TOTAL_EXCEEDS_EXPECTED`):** sólo `CONFIRMED_ZERO` sobre una de las coberturas ("no cubre este día"); `SET_BASE_MINUTES` responde `400 NOVELTY_COVERAGE_RESOLUTION_NOT_ALLOWED`. Nunca se acepta un total mayor a la jornada. Es la única salida cuando las dos novedades están aprobadas y son exportables, porque no se pueden rechazar ni eliminar. El endpoint evalúa el día con todas las coberturas de la persona, igual que la grilla.
- Las alternativas siguen vigentes: corregir el trabajo real por su flujo, o rechazar o eliminar la novedad.
- **Tipo `NONE` + `INCOMPATIBLE` (Falta sin aviso + fichada real):** el día queda en `REVIEW_REQUIRED` (`REAL_WORK_ON_INCOMPATIBLE`) porque las dos evidencias se contradicen, pero la revisión es **administrativa**: no hay minutos de cobertura retenidos (`heldMinutes = 0`) ni que resolver, y cuenta sólo el trabajo real. La salida es corregir, rechazar o eliminar la novedad, o corregir el trabajo registrado, según lo que realmente ocurrió. El endpoint de resolución no aplica: cualquier resolución (`SET_BASE_MINUTES` o `CONFIRMED_ZERO`) responde `409 NOVELTY_COVERAGE_DAY_NOT_IN_REVIEW`, porque la fila no es `COVERED`. La UI (etapas 6/8) no debe ofrecer "indicar horas de cobertura" para un tipo `coverageMode = NONE`. Cubierto por `workedTimeAccounting.novelties.test.ts` y `noveltyCoverage.integration.test.ts`.

### 12.5 Consumidores (auditoría)

| Consumidor | Pantalla | Cobertura | Criterio |
|---|---|---|---|
| Grilla por legajo (`employees.service.ts::getTimeGrid`) | `/horas/:id`, revisión de cierre | Sí | Base APROBADO/EN_REVISION, desgloses ≠ RECHAZADO, francos, cobertura del período |
| Grilla de período (`findPeriodEmployees`) | `/horas` | Sí | Ídem, una consulta de cobertura por página |
| Resumen (`timeEntries.repository.ts::summary`) | Tarjetas de Carga de horas | Sí (aditivo) | `countableHours` sigue siendo trabajo real; nuevos `coveredHours` y `computableHours` |
| Export de horas (`exportByPerson`) | Descarga | Sí | Columnas `Cubierto por novedades`, `Total computable` y `Novedades (para liquidación)` sólo si alguien tiene cobertura que cuenta. La equivalencia suma la cobertura. Quien sólo tiene cobertura también se exporta y le aplica el gate de cierre |
| Cierre (`closureSnapshot.ts`, `submitClosures`) | Cierres | Sí | Snapshot V2; envío bloqueado con días en revisión |
| "Por persona" (`findManyByEmployeeGrouped`) | Bandeja | **No** | Es la bandeja de aprobación de horas: filtra por el estado a revisar y puede no tener período. La cobertura se revisa en las grillas y el cierre |
| Dashboard (`loadedHours`) | KPI "Horas cargadas" | **No** | Sigue siendo trabajo real; sin cambio de semántica |

### 12.6 Grilla (contrato para la etapa 6)

- `GET /employees/:id/time-grid` agrega:
  - `noveltyCoveredMinutes` y `computableMinutes` (`totalWorkedMinutes` sigue igual);
  - `accounting.novelty`;
  - `noveltiesByDay[día]`: cada novedad con `label`, `code`, `uiColor`, `minutes`, `settlementMinutes`, `state`, `countsTowardTotal`, `reviewRequired` y `reviewReasons`;
  - `noveltyCoverageRows`: una fila por tipo con `minutesByDay`, `settlementMinutesByDay`, `stateByDay` (el más restrictivo del día) y `totals`.
- `GET /time-entries/period-employees`, en cada `dailyBreakdown[]`, agrega `totalWorkedMinutes`, `noveltyCoveredMinutes`, `computableMinutes` y `novelties[]` (misma forma). Se conserva `novelty` (marca anterior) por compatibilidad.

### 12.7 Cierre

- Snapshot `accounting.model = "WORKED_TIME_ACCOUNTING_V2"`: V1 más `noveltyCoveredMinutes`, `computableMinutes`, `settlement.noveltyMinutes` y `novelty` (estados, días a revisar y tipos con código y nombre). Los snapshots V1 guardados no se tocan y siguen legibles: V2 sólo agrega campos.
- `submitClosures` arma los snapshots dentro de su transacción (lock exclusivo). Si algún legajo tiene días `REVIEW_REQUIRED`, rechaza el envío completo con `409 CLOSURE_HAS_PENDING_NOVELTY_REVIEW`: mensaje con legajo, cantidad de días y fechas, y `details.employees[] = { employeeId, reviewDays, reviewDates }`.
- Una novedad PENDIENTE no bloquea el envío: no suma.

### 12.8 Cachés

- Backend: las mutaciones de novedades (crear, aprobar, aprobación masiva, rechazar, eliminar, resolver un día) llaman a `clearWorkedTimeDerivedReadCaches()`: grilla por legajo, grilla de período, resumen, asistencia, dashboard y cierres. Antes sólo limpiaban time-entries.
- Frontend: `noveltyApiService` invalida `WORKED_TIME_DERIVED_CACHE_FAMILIES` más `novelties`. Antes no invalidaba `pending`, `employees` ni `monthly-closures`.

### 12.9 `toDate` nulo en otros lectores

Un solo helper, `novelties/novelties.dateRange.ts` (`noveltyCoversDay` y `noveltyOverlapsRangeWhere`): `toDate` nulo es siempre un día. Lo usan:
- la grilla por legajo (lista de novedades);
- la grilla de período (marca del día);
- el listado de novedades por período;
- la exención de inactividad y falta de ingreso (una novedad de un día anterior ya no exime los días siguientes; cambia el comportamiento de esas alertas para datos con `toDate` nulo en tipos con rango);
- el dashboard (`absenceDays`: una ausencia de un mes anterior ya no se cuenta en todos los meses siguientes).

Finnegans ya usaba sólo `fromDate` y no se tocó en la etapa 4; desde la etapa 9 una novedad con cobertura se exporta por mes (§16) y `toDate` nulo sigue siendo un día.

### 12.10 Rendimiento

Una consulta de cobertura por consumidor y lote, nunca por legajo, día ni novedad. Usa los índices existentes `(employeeId, period)` y `(period, reviewStatus)`; no hace falta migración nueva.
- **Grilla por legajo:** +1 consulta.
- **Grilla de período:** +1 consulta por página.
- **Export:** +1 consulta.
- **Cierre:** +1 consulta por envío, en la transacción.
- **Resumen:** +1 consulta. Si hay cobertura que cuenta, +3 más (trabajo y francos sólo de esos legajos), porque la cobertura depende del trabajo real de cada día y no se puede sumar en SQL.
- **Dashboard:** sin cambios.

## 13. Recálculo automático por eventos (etapa 5)

La cobertura persistida se mantiene consistente sola: todo cambio de una fuente que lee el motor recalcula, **en su misma transacción**, sólo las novedades y fechas que puede alterar. La reconciliación (§6.5) queda para datos históricos.

### 13.1 Auditoría de eventos (2026-11-13)

Fuentes que leen `expectedWorkday` y el motor: asignaciones de turno (+ plantilla), francos, convocatorias, régimen vigente (+ su tipo), reglas FERIADO (con historia laboral si tienen alcance), movimientos de alta y baja, reglas de Horas Especiales (multiplicador) y configuración del tipo de novedad.

| Fuente | Escritor (único) | Antes de la etapa 5 |
|---|---|---|
| `LaborMovement` (ALTA/BAJA) | `employeesService.createLaborMovement` → `employeesRepository.createLaborMovement` | Transacción propia; no hay edición ni borrado de movimientos. El alta del legajo crea los iniciales (sin novedades todavía: no hay nada que recalcular). |
| Historia laboral (puesto, centro de costo, empresas) y alcance de puesto | `laborHistoryService.recordEmployeeChangesWithin` / `recordPositionScopeChangeWithin` (edición del legajo y del puesto, eliminaciones controladas) | Transaccional, con guard de cierres. Nunca reinterpretó el multiplicador de horas ya cargadas (deuda previa, §13.9). |
| `ShiftAssignment` | `shiftAssignmentService.assign/update/remove` | **Sin transacción.** |
| `ShiftTemplate` (horario, minutos, nocturno, estado) | `workforceService.updateShiftTemplate` / `removeShiftTemplate` (inactivación) | Update sin transacción; la inactivación, Serializable. Crear una plantilla no afecta a nadie. |
| `EmployeeWorkRegime` y `WorkRegime.kind` | `workRegimesService.assign/updateAssignment/closeAssignment` y `update` | **Sin transacción.** El estado del régimen no lo lee el motor. |
| `EmployeeDayOff` | `employeeDayOffService.save` | Transacción con lock por día, guard y snapshot. |
| `HolidayWorkAssignment` | `holidayWorkAssignmentService.save` | Transacción con lock por día y reinterpretación de horas de la fecha. |
| `DoubleHourRule` (+ fechas y personas) | `workforceService.createDoubleRule/updateDoubleRule`, eliminación (`planDoubleRuleDeletionWithin`) | Transacción con `reinterpretSpecialHours`. |
| `NoveltyType` (cobertura) | `noveltyTypesService.update` | Sin transacción. |

### 13.2 Matriz evento → alcance

| Evento | Legajos | Fechas | Novedades | Lock |
|---|---|---|---|---|
| ALTA/BAJA | el legajo | desde el movimiento hasta el día anterior al siguiente movimiento; abierta hacia atrás si pasa a ser el primero (`laborMovementAffectedWindow`) | con tiempo | legajo, antes de escribir |
| Cambio de historia laboral | el legajo | desde `effectiveFrom` | con tiempo | legajo, antes que los de cierre |
| Cambio de alcance de un puesto | ocupantes desde `effectiveFrom` | desde `effectiveFrom` | con tiempo | ocupantes, antes que los de cierre |
| Asignar / editar / habilitar / quitar un turno | el legajo (o los del lote) | vigencia anterior ∪ nueva (`coverageWindowOf`) | con tiempo | legajos |
| Cambio de plantilla | quienes la tienen asignada (cualquier estado) o convocada | unión de esas vigencias / fechas | con tiempo | global exclusivo |
| Asignar / editar / cerrar un régimen | el legajo | vigencia anterior ∪ nueva | con tiempo | legajo |
| Cambio del tipo de un régimen | quienes lo tienen asignado | unión de sus vigencias | con tiempo | global exclusivo |
| Franco | quienes cambiaron | ese día | con tiempo | día → legajos |
| Convocatoria a feriado | **todos** (el primer convocado restringe el FERIADO) | ese día | con tiempo | día → global exclusivo |
| Regla de Horas Especiales (alta, edición, inactivación, eliminación) | todos (el motor decide el alcance) | ventana antes ∪ después y sólo novedades con alguna fecha que la regla toca | FERIADO: con tiempo; otra regla: sólo tipos que aplican multiplicadores | global exclusivo |
| Configuración de cobertura del tipo | todos | todo el rango de cada novedad | todas las del tipo (también `NONE`) | global exclusivo |

Sólo la observación de una asignación de turno, o campos del tipo que no son de cobertura (`timeEntryBehavior`, Finnegans, roles), no recalculan.

### 13.3 Función central

`recalculateNoveltyCoverage(tx, scope, reason, options)` en `backend/src/modules/novelties/noveltyCoverageRecalculation.ts`, la única para todos los módulos:

1. toma los locks (§13.6) y busca las novedades no rechazadas del alcance (`employeeIds`, `noveltyIds`, `noveltyTypeIds`, `from`/`to`, `onlySpecialHourTypes`, `includeNoneTypes`, `touchesDate`);
2. las recalcula en tandas de hasta 10 000 días-legajo con `persistNoveltyCoverageWithin` (modo `SKIP`, ventana `from`/`to`), por diferencia;
3. el motor conserva o descarta las resoluciones manuales (§13.4);
4. reconstruye los snapshots de los cierres no protegidos con días cambiados (`NOVELTY_COVERAGE_CHANGED`), salvo `rebuildSnapshots: false` cuando el mismo evento los reconstruye después (francos, convocatorias, reglas);
5. devuelve un resumen auditable: novedades y legajos alcanzados y cambiados, días cambiados, días en revisión, resoluciones descartadas (con su detalle), pares protegidos no reinterpretados y snapshots reconstruidos.

`auditNoveltyCoverageRecalculation` (después del commit) o `auditNoveltyCoverageRecalculationWithin` (flujos que auditan dentro de la transacción) registran **un** resumen por evento ("Se recalculó la cobertura de 12 novedades de 8 empleados por cambio de la regla Domingos (40 días)."), uno por resolución descartada y uno por snapshot reconstruido. Nunca un registro por día ni ids técnicos en el texto.

### 13.4 Resoluciones manuales

- **Se conserva** (con autor, fecha y nota) mientras responda a la misma incertidumbre: `SCHEDULE_UNRESOLVED` con el mismo motivo; o el día sigue `COVERED` y, si se indicaron horas base, la jornada esperada no cambió. Un `CONFIRMED_ZERO` sobre un día cubierto ("la novedad no cubre este día") no depende de la cantidad del tipo y se conserva. El multiplicador se vuelve a aplicar sobre los minutos resueltos.
- **Se descarta** cuando la evidencia ya responde la pregunta (se registró el ALTA o el turno) o cambió la pregunta (otro motivo, otra jornada esperada, el día dejó de estar cubierto). Queda auditada con la resolución anterior completa. No resucita si después la evidencia vuelve a faltar: el día vuelve a `PENDING`.
- **Cambio del trabajo real:** no se persiste nada; la contabilidad lo detecta al leer (`RESOLUTION_OUTDATED`, §12.2).

### 13.5 Períodos protegidos y snapshots

- Fuente canónica: `findProtectedClosurePeriods` (ENVIADO, APROBADO, CORRECCION_PENDIENTE). El recálculo automático nunca modifica la cobertura de esos pares: no la calcula, no la escribe y los informa en el resumen y la auditoría.
- El evento no falla por un período protegido (se guarda el cambio, igual que la reinterpretación de Horas Especiales y los francos). Las reglas de bloqueo propias de cada evento siguen vigentes (p. ej. un franco en un período cerrado exige RRHH con motivo; un cambio de historia laboral que alcanza un cierre protegido se rechaza).
- Snapshots: se reconstruyen sólo los de cierres no protegidos con algún día cambiado; los protegidos nunca. Cuando el evento ya reconstruye un cierre (francos, convocatoria, regla), la cobertura se recalcula antes y ese snapshot no se reconstruye dos veces.
- Falta de historia laboral para evaluar una regla con alcance en un día de un período abierto: `409 SPECIAL_HOUR_SCOPE_HISTORY_MISSING` y el cambio completo se revierte (mismo criterio que la reinterpretación de horas). Nunca cae en silencio a ×1.

### 13.6 Locks y concurrencia

Orden único, dentro de la transacción (evita deadlocks):

1. día del legajo (`employeeDayLock`, francos y convocatorias);
2. **cobertura global**: `novelty-coverage:global`, compartido para todo escritor de cobertura (alta, aprobación, rechazo, borrado y resolución de novedades, y eventos de un legajo); **exclusivo** al empezar un evento que alcanza a cualquier legajo (regla, plantilla, tipo de régimen, configuración del tipo, convocatoria);
3. cobertura por legajo (`novelty-coverage:<employeeId>`, orden estable), tomado **antes de escribir la fuente**;
4. cierres (`findProtectedClosurePeriods`, compartido).

Así un alta de novedad y un cambio de turno del mismo legajo nunca se intercalan: el segundo espera al commit del primero y lee su resultado. La persistencia toma el lock global compartido antes de leer la configuración del tipo.

Residual documentado: una eliminación controlada que retira datos laborales de varios legajos en la misma transacción toma el lock de cobertura de cada legajo después de los cierres del anterior. Un interbloqueo con un envío de cierre concurrente lo detecta PostgreSQL y aborta una de las dos (sin escrituras parciales).

Transacciones nuevas (timeout 30 s): asignación de turno, régimen (asignación, edición, cierre y cambio de tipo), plantilla, configuración del tipo y movimiento laboral. Todas son atómicas: si el recálculo falla, la fuente no cambia.

### 13.7 Cachés

- Backend: `clearNoveltyCoverageReadCaches()` (`novelties/noveltyCoverageReadCaches.ts`) = cachés derivadas de horas + Novedades. La llaman, después del commit, los controllers de novedades, francos, convocatorias, asignaciones de turno, regímenes, plantillas, reglas, tipos de novedad, legajo (edición y movimientos), puestos y eliminaciones controladas.
- Frontend: `NOVELTY_COVERAGE_DERIVED_CACHE_FAMILIES` (`services/cache/cachePolicy.ts`) = familias de horas + `novelties`; la usan novedades, francos, convocatorias, reglas, plantillas, asignaciones de turno, regímenes, tipos de novedad y legajo (edición y movimientos).

### 13.8 Rendimiento

- Nunca una consulta por legajo ni por día: cada tanda hace consultas fijas (novedades del alcance, contexto de jornada por ventana, movimientos, motor de Horas Especiales en lote, filas existentes de la ventana, protegidos, escritura en lotes). Verificado en la integración: el mismo recálculo hace la misma cantidad de consultas para 2 que para 8 legajos.
- Ventana por evento: un franco recalcula un día; un turno, su vigencia; una regla, sólo novedades con alguna fecha alcanzada.
- Escritura por diferencia: sólo filas que cambian.
- Un evento global (regla sin fin, cambio de tipo muy usado) recalcula todas las novedades alcanzadas en tandas dentro de la transacción de 30 s. Si el volumen real lo excede, la salida es un job (como la reconciliación), no implementado: no hay evidencia de que haga falta.

### 13.9 Fuera de alcance y deudas

- Un cambio de historia laboral no reinterpreta el multiplicador de las horas **ya cargadas** (deuda previa, no introducida acá). La cobertura de novedades sí se recalcula.
- Cambios de estructura organizacional que no pasan por la historia laboral (p. ej. mover un sector) no disparan recálculo; tampoco reinterpretan horas hoy.
- Una mutación directa de una novedad no reconstruye el snapshot de un cierre devuelto (§6.3); se rehace en el próximo envío.
- Grilla frontend, UX de tipos, UX de carga y Finnegans: etapas 6 a 9, implementadas (§9, §14 a §16).

## 14. Pantalla de Tipos de Novedad (etapa 7)

Alta (`/configuracion/tipos-novedades/nuevo`) y edición (`/configuracion/tipos-novedades/:id`) usan el mismo formulario (`NoveltyTypeForm`), por secciones y con un resumen generado desde la configuración (nunca por nombre, código ni categoría). Las pestañas General/Reglas/Finnegans de la edición se reemplazaron por las mismas secciones. Sin cambios de backend, esquema ni contratos: el frontend sólo empezó a leer y enviar los campos de §4.

| Sección | Pregunta en pantalla | Campo |
|---|---|---|
| Datos generales | Nombre, código interno (sólo lectura, no define comportamiento), categoría, estado, color con vista previa del chip, descripción | existentes |
| Tiempo que cubre | ¿Esta novedad representa tiempo? (No registra horas / Cantidad fija HH:mm / Cantidad indicada al cargar / Según la jornada que debía cumplir) | `coverageMode`, `coverageFixedMinutes` |
| Días y situaciones especiales | Sólo con cantidad fija o jornada. ¿Qué días puede cubrir?; con reglas por calendario, ¿qué sucede si tiene franco? y si es feriado (sin opción preseleccionada, C3/P1). Con "días que debía trabajar" se explica que francos y feriados los decide la jornada | `coverageDayRule`, `coverageWeekdays`, `coverageOnDayOff`, `coverageOnHoliday` |
| Impacto en el cálculo | ¿Suma al total? y ¿aplica domingos, feriados u Horas Especiales? (sólo si registra tiempo, con ejemplo 8 h cubiertas → 16 h para liquidación); ¿puede coexistir con horas trabajadas? (siempre) | `coverageCountsTowardTotal`, `coverageAppliesSpecialHours`, `realWorkCompatibility` |
| Carga y control | Varios días (vacío = un día), aprobación, observación obligatoria, documentación, cantidad de horas informativa, bloqueo de nueva carga, roles | `allowsDateRange`, `requiresApproval`, `requiresObservation`, `requiresDocumentation`, `allowsHours`, `timeEntryBehavior`, roles |
| Integración y otras opciones | Finnegans (sin cambios de lógica, etapa 9) y observaciones internas | existentes |

Reglas de la pantalla:

- Los enums sólo viajan como valor; las etiquetas están en `frontend/src/utils/noveltyTypeCoverage.ts`.
- La coherencia la sigue validando el backend (`assertCoverageConfigCoherent` + CHECK). El frontend no la reimplementa: las transiciones (`applyCoverageMode`, `applyCoverageDayRule`) dejan inalcanzables las combinaciones rechazadas (por ejemplo, cantidad indicada al cargar fuerza un día y `allowsHours`; jornada esperada fuerza `WORK_OBLIGATION`; nunca se inventa una política de franco o feriado), y antes de enviar sólo se marcan datos faltantes (cantidad, días, políticas, Finnegans). Si el backend rechaza, se muestra su mensaje de negocio.
- Los días se envían ordenados como los normaliza el backend, así un guardado sin cambios reales no dispara recálculo (§13.2). En edición, si cambia lo que cubre, la pantalla avisa que se recalculan los períodos abiertos.
- El payload siempre viaja en forma canónica (`canonicalCoverage`): lo que el modo o la regla de días no usa va en `null`/`[]`/`EVERY_DAY`. Un tipo ya guardado se reenvía idéntico (round-trip probado en `noveltyTypeApiService.test.ts` y `NoveltyTypeDetailPage.test.tsx`).
- Errores: el mensaje de negocio del backend se muestra tal cual; si trae códigos, enums o JSON (`apiClient.ts::isInternalMessage`), se reemplaza por un texto de negocio por código. Los errores de validación nombran los campos de cobertura en castellano.
- Listado: el nombre se muestra con su color y la columna "Tiempo" resume "4 h fijas" / "Según jornada" / "Cantidad al cargar" / "Sin horas", con "Suma al total" o "Informativa".
- Tipos ya usados: no hay borrado (sólo inactivar/"Ocultar"); el código es de sólo lectura en pantalla; cambiar lo que cubre recalcula períodos abiertos y no toca los protegidos (§13.5).
- `allowsHours` sigue existiendo (deuda: se retira cuando la carga use sólo la cobertura, etapa 8 o limpieza posterior, y Finnegans en horas deje de leer `quantityHours`, etapa 9). Con cantidad indicada al cargar es implícito; en los demás modos está en "Integración y otras opciones" como registro administrativo que no es tiempo cubierto.

Pendientes de la etapa: la carga de Novedades todavía no marca la observación obligatoria ni usa la cobertura para la vista previa (etapa 8).

## 15. Carga de Novedades (etapa 8)

El alta (`NoveltyModal`: Novedades, legajo, alertas y notificaciones) y la novedad asociada a una hora en la grilla por legajo (`EmployeeHoursPage`) usan los mismos campos (`NoveltyLoadFields`), validación, payload (`frontend/src/utils/noveltyLoad.ts`) y vista previa (`NoveltyCoveragePreviewPanel`). El Tipo decide; la persona no vuelve a elegir cantidad fija, compatibilidad, suma ni multiplicadores.

| Tipo | Se pide | Se envía |
|---|---|---|
| Cantidad fija | Nada (se informa "cubre 4 h por día") | sin cantidad |
| Según la jornada | Nada (se informa que se calcula por la jornada) | sin cantidad |
| Cantidad indicada al cargar | "Duración" HH:mm, obligatoria, un día | `quantityHours` = minutos / 60; el backend deriva `quantityMinutes` |
| No registra horas | Nada | sin cantidad |
| Cualquier modo salvo el manual, con `allowsHours` | "Cantidad de horas informativa" (opcional, sólo dato) | `quantityHours`, nunca cobertura |

- **Fechas:** sin rango, sólo "Fecha"; con rango, "Desde" y "Hasta (opcional)". Hasta vacía es un solo día (`toDate = null`), nunca un rango abierto. Hasta es obligatoria sólo si el tipo exige vigencia (regla existente del backend).
- **Observación** siempre visible; obligatoria si el tipo lo pide (el backend ya lo exige). **Documentación** obligatoria si el tipo lo pide, garantizada por el backend (§15.1). Antes el alta sólo validaba que hubiera un archivo elegido y la grilla registraba metadatos sin archivo.
- **Aprobación:** se informa si la novedad quedará pendiente (no suma hasta aprobarse) o, para RRHH, que queda aprobada.
- **Vista previa:** `POST /novelties/coverage-preview` con debounce, cancelando el pedido anterior y sin mostrar respuestas viejas. Muestra por día lo que cubre, el multiplicador, lo que vale para liquidación, francos, feriados, revisión (con 0 h provisional) y, desde esta etapa, el trabajo real ya registrado y si el día quedará para revisión. Para eso la vista previa devuelve `workedMinutes`, `stateWhenApproved` y `reviewReasons` por día (resultado de `accountNoveltyDay`, la misma función que la grilla y el cierre) e `initialStatus`; el frontend sólo traduce y suma lo ya calculado. Un conflicto no bloquea el alta: la novedad se guarda y queda para revisión, como ya hacía el backend. Si la vista previa falla, se informa y se puede guardar igual.
- **Errores:** período cerrado, corrección de RRHH con motivo (`NOVELTY_CORRECTION_REASON_REQUIRED` → pide el motivo y reintenta), duplicados y el resto en lenguaje de negocio (`apiClient.ts`).
- **Edición:** no existe edición de novedades (sólo alta, aprobación, rechazo y eliminación); no hay round-trip que probar.
- **Carga para varias personas:** se mantiene (hasta 250); la vista previa se calcula hasta 50 personas.

Deudas: la lista de "Aplica sobre hora" sigue atada a `allowsHours` (comportamiento previo). `allowsHours` se retira cuando Finnegans deje de leer `quantityHours` (etapa 9).

### 15.1 Documentación obligatoria (`requiresDocumentation`)

**Problema:** la regla vivía sólo en la pantalla; `POST /novelties` creaba una novedad de un tipo con documentación obligatoria sin ningún documento.

**Arquitectura existente:** un documento es un `EmployeeDocument` de un legajo (con `noveltyId` opcional) que apunta a un `StorageFile`; el archivo va al storage configurado para `LEGAJOS` (local, Neon Object Storage o Google Drive, con archivo secundario opcional). La base y el storage externo no comparten transacción; el patrón ya usado por la foto del fichador (F12-PERF-3) es: subir el objeto fuera de la transacción, persistir `StorageFile` y las filas en la transacción, y compensar borrando el objeto si la transacción falla.

**Solución (mismo patrón, sin estados nuevos):**

- `POST /novelties` rechaza un tipo con documentación obligatoria (`400 NOVELTY_DOCUMENTATION_REQUIRED`); ninguna llamada directa la saltea.
- `POST /novelties/with-document` recibe la novedad y el documento: valida todo lo del alta, la categoría documental de novedades y su permiso de subida; sube una copia por legajo; crea en una transacción novedades, cobertura, `StorageFile` y `EmployeeDocument`; si algo falla, borra lo subido. Es atómico para la base; para el storage externo, la garantía es la compensación (un objeto huérfano posible, sin filas, registrado como crítico), nunca una novedad sin documento.
- Carga para varias personas: no había una regla previa (el alta anterior descartaba el archivo). Cada legajo recibe su propia copia, porque el documento, su carpeta y su visibilidad son del legajo; compartir un `StorageFile` entre legajos mezclaría carpetas y permisos. Como es una subida síncrona por persona, **con documento el alta admite hasta 25 personas** (decisión de negocio, 2026-11-16; constante `MAX_EMPLOYEES_WITH_DOCUMENT` en `noveltyDocuments.ts`, reflejada en `frontend/src/utils/noveltyLoad.ts`). Se valida antes de cualquier lectura o subida (`400 NOVELTY_DOCUMENT_TOO_MANY_EMPLOYEES`); sin documento sigue el máximo general de 250.
- El frontend usa un único pedido cuando hay archivo: si falla, no quedó nada creado y reintentar no duplica.

## 16. Exportación a Finnegans (etapa 9)

**Auditoría (antes de cambiar):** `finnegans-export` exportaba una fila por novedad APROBADA de un tipo ACTIVO con `exportsToFinnegans`, en el mes de `fromDate` (15L.3B.1). Valor 1 dependía sólo de `finnegansValueUnit`: `HOURS` → `quantityHours` (dato manual, sólo con `allowsHours`), `DAYS` → `quantityDays` (días corridos del rango completo), `UNIT` → 1. No leía `TimeEntry`, cobertura ni snapshots; exigía el cierre mensual APROBADO de cada legajo incluido y deja un lote versionado e idempotente (15L.4). Con el motor de cobertura, un tipo "según jornada" o "cantidad fija" no tiene `quantityHours`, así que en horas quedaba sin valor o con un dato informativo. "Aplica sobre hora" (`targetHourConceptId`) no participa de la exportación: es un dato de la novedad que muestran la bandeja y la lista, nada más.

**Decisiones del usuario (2026-11-16, cierra P2):**

| Tema | Decisión |
|---|---|
| Valor 1 en horas | Base efectiva, **sin multiplicador**: el multiplicador vive en la liquidación interna y en el concepto de Finnegans, nunca se manda dos veces. Domingo ×2 de 8 h → 8 |
| Valor 1 en días | Días corridos, como antes |
| Rango que cruza de mes | Se divide: cada mes exporta los días de su porción, con su propio cierre |

**Regla nueva** (`finnegansExport.rows.ts::buildFinnegansNoveltyExportRows`, única para preview y exportación definitiva):

- Tipos **sin cobertura** (`NONE`, incluidos los del backfill de la etapa 1 con horas informativas): contrato anterior sin cambios.
- Tipos **con cobertura**: una fila por novedad y mes; candidata en cada mes que alcanza su rango (`toDate` nulo = un día). Los estados diarios salen de `periodNoveltyCoverageDaysForExport`: la misma contabilidad que la grilla y el cierre (`accountEmployeePeriods`, con el trabajo real del día), en lote (4–5 consultas por período, nunca por día, novedad ni legajo).
  - `HOURS`: suma de la base efectiva de los días COUNTED o INFORMATIVE del mes (la informativa, como Llegada tarde, conserva su duración, que es lo que exportaba `quantityHours`). Sin horas en el mes → sin fila.
  - `DAYS`: días corridos de la porción del mes. `UNIT`: 1, sólo en el mes de inicio.
  - `Fecha Aplicación` y la vigencia (si el tipo la exige) son las de la porción del mes.
  - Un día REVIEW_REQUIRED deja la fila en "Revisión pendiente" y la exportación definitiva responde `409 FINNEGANS_EXPORT_COVERAGE_REVIEW_PENDING`; sin cobertura calculada, la fila queda bloqueada (nunca se inventa una cantidad).
- Fuente y reproducibilidad: datos vivos, como antes, pero la exportación definitiva exige el cierre APROBADO de cada legajo del mes, y la cobertura de un período protegido no se recalcula (§13.5): misma entrada, mismo resultado. Una corrección de RRHH sobre un período cerrado se vuelve a exportar como una versión nueva (15L.4). No se lee el snapshot del cierre porque no guarda la cobertura por novedad.
- Duplicados: una fila por novedad y mes; el lote sigue siendo idempotente por `idempotencyKey` y el diff usa `noveltyId`.

**Lo que sigue dependiendo del tipo vigente:** código, unidad de Valor 1, vigencia y si el tipo tiene cobertura (igual que antes de esta etapa). Una versión ya generada no cambia (§16.1) y un período con cierre congela su configuración (§16.2); sólo los cierres anteriores a §16.2 siguen usando el tipo vigente.

**`allowsHours`/`quantityHours` después de esta etapa:** Finnegans ya no lee `quantityHours` en tipos con cobertura. `allowsHours` sigue siendo necesario para los tipos sin cobertura (decide si se carga `quantityHours`, que es su único valor en horas, o si se calcula `quantityDays`) y para el campo heredado del formulario. `Novelty.valor1` del frontend (calculado con `allowsHours`) no lo muestra ninguna pantalla. Retirarlos exige decidir antes cómo se exportan en horas los tipos sin cobertura.

### 16.1 Reproducibilidad de una versión

**Campos que la exportación lee al construir las filas:** del tipo, `finnegansCode` (Novedad), `finnegansValueUnit` (Valor 1), `finnegansRequiresValidity` (Fecha desde/hasta y bloqueo por vigencia), `coverageMode` (cobertura o contrato anterior), `name` (detalle), `exportsToFinnegans` y `status` (selección); del legajo, `legajoFinnegans`/`legajo`. "Aplica sobre hora" no participa.

**Qué ya quedaba congelado (y se reutiliza, sin duplicar):** cada exportación definitiva guarda un `FinnegansExportBatch` con su hash y, en `FinnegansExportBatchItem`, las celdas finales de cada fila (legajo, nombre, código, detalle, centro de costo, Valor 1, fechas). El reintento con la misma `idempotencyKey` y el detalle del historial (`GET /history/:batchId`) se reconstruyen sólo desde esas filas, nunca desde el tipo ni la cobertura. Por eso una versión N es inmutable: cambiar después nombre, código, unidad, vigencia o configuración de cobertura del tipo no la altera (probado en `finnegansExport.service.test.ts` y en la integración con PostgreSQL: cierre aprobado → exportación → cambio de código, unidad y nombre → mismo resultado en reintento e historial, una sola versión). El snapshot del cierre (V2) guarda código y nombre internos de los tipos, no su configuración de Finnegans; la cobertura diaria guarda la configuración de cobertura, tampoco la de Finnegans.

**Exportaciones nuevas:** resuelto en §16.2 (decisión del usuario, 2026-11-16): la configuración de Finnegans se congela en el snapshot del cierre.

### 16.2 Configuración de Finnegans congelada en el cierre

**Decisión (usuario, 2026-11-16):** la configuración de Finnegans de un período queda congelada al generar el snapshot del cierre; una exportación nueva de ese período no depende de cambios posteriores del tipo. Sin tabla nueva, sin migración y sin historial general de `NoveltyType`.

**Snapshot:** `MonthlyTimeClosure.snapshot.finnegans = { model: "FINNEGANS_CONFIG_V1", types[] }` (`workforce-management/closureSnapshot.ts`). Una entrada por tipo de las novedades no rechazadas del legajo que tocan el período (empiezan en el mes o lo alcanzan por rango), sólo con lo que consume la exportación: `noveltyTypeId`, `name` (detalle), `status` y `exportsToFinnegans` (selección), `finnegansCode` (Novedad), `finnegansValueUnit` (Valor 1), `finnegansRequiresValidity` (Fecha desde/hasta) y `coverageMode` (cobertura o contrato anterior). Una consulta más al construir los snapshots del período. Se arma al enviar el cierre (un cierre devuelto y vuelto a enviar congela de nuevo). Cuando un evento reconstruye el snapshot (concepto horario, regla, franco, cobertura), se conserva la sección congelada tal cual; a un snapshot anterior sin ella no se le agrega una retroactiva.

**Fuente al exportar (preview y definitiva, la misma función `withPeriodFinnegansConfig`):** para cada novedad, la configuración congelada en el cierre de su legajo y período; si el cierre no existe, no tiene la sección (snapshot anterior a §16.2) o no incluye ese tipo (p. ej. una corrección posterior de RRHH), el tipo vigente, que es el comportamiento anterior. La selección del repositorio ya no filtra por la configuración del tipo: si exporta, si está activo y si un rango del mes anterior entra (sólo con cobertura) se decide con esa configuración efectiva. Como la vista previa usa la misma fuente, un cambio del tipo vigente no aparece como "cambio desde la última exportación" de un período congelado.

**Ejemplo probado (integración PostgreSQL):** junio con TBF en horas, cierre aprobado; el tipo pasa a NUEVO en días; la primera exportación de junio sale TBF, Valor 1 = 4; el cierre de julio congela NUEVO en días y julio sale NUEVO, Valor 1 = 1; sin la sección congelada, junio vuelve a leer el tipo vigente y la versión 1 ya generada no cambia.
