# Franco por empleado y fecha (`EmployeeDayOff`)

**Estado:** implementado en `feat/francos-carga-horaria` (2026-11-03). Migración `20261103120000_add_employee_day_off` validada sólo contra PostgreSQL local desechable. **No aplicada** en staging, demo ni producción.

## 1. Problema

No existía forma de decir "esta persona no tiene que trabajar esta fecha" para un día puntual. El motor de obligación (`resolveWorkObligationCandidates`, 15M.19B) sólo conocía turnos, régimen y feriados. Un franco cargado de palabra producía:

- `FALTA_INGRESO` intradía y `SIN_ACTIVIDAD_REGISTRADA` diaria;
- una celda `—` en la grilla, indistinguible de "no se cargó nada";
- si la persona igual fichaba, horas automáticas que computaban sin que nadie las revisara.

## 2. Regla aprobada

Un franco significa: **ese empleado no tiene obligación de trabajar en esa fecha operativa.**

| Situación | Resultado |
|---|---|
| Franco sin actividad | Horas esperadas 0, horas automáticas 0, sin falta de ingreso, sin "Sin actividad registrada". Grilla: `Franco · 0 h`. |
| Franco con fichada | La fichada nunca se bloquea ni se modifica. Sus horas automáticas **no computan**. Se genera la alerta `ACTIVIDAD_EN_FRANCO` y su notificación. |
| Franco + reconocimiento manual | Un responsable usa la carga/corrección manual existente. Lo reconocido **sí computa**. El franco sigue activo; quedan ambas trazas. |

No se modela como `ShiftTemplate`, `ShiftAssignment`, `HourConcept`, `DoubleHourRule`, `Novelty`, `WorkRegime` ni como un `TimeEntry` de 0 h. Es una condición excepcional de `Empleado + Fecha`.

## 3. Modelo

```prisma
enum EmployeeDayOffStatus { ACTIVO CANCELADO }

model EmployeeDayOff {
  id, employeeId, date @db.Date, status @default(ACTIVO), notes?,
  createdByUserId?, updatedByUserId?, createdAt, updatedAt
  @@unique([employeeId, date])
  @@index([date, status])
}
```

- **Nunca se borra.** Cancelar deja `CANCELADO` y reactivar vuelve a `ACTIVO` sobre la misma fila (mismo patrón que `HolidayWorkAssignment`).
- `@@unique([employeeId, date])` es la garantía real contra duplicados. Además cubre las búsquedas por `employeeId + date`: un `@@index([employeeId, date])` sería redundante y no se creó.
- `date` es `@db.Date` (fecha calendario, `DATABASE_STANDARDS.md`); los instantes son `Timestamptz(3)`.
- Autoría: FK a `User` con `onDelete: SetNull`. Empleado: `Restrict`.
- `ShiftAlertType` suma `ACTIVIDAD_EN_FRANCO` (§9).
- No se agregaron tipos futuros (`DESCANSO`, etc.).

## 4. Fecha operativa de una jornada

`workShiftOperationalDateKey(startAt, template)` (`shifts/workShiftEvaluation.service.ts`) es la única definición. Reutiliza `closestOccurrence`, el mismo criterio con el que el sistema ya decide a qué ocurrencia de turno pertenece una jornada (`evaluateOutOfShiftWorkday`):

1. Si la jornada adoptó un turno (`WorkShift.shiftTemplateId`, lo fija la evaluación de ingreso), se toma la ocurrencia más cercana al ingreso. Si el ingreso cae dentro de `[inicio programado − 240 min, fin programado)`, la fecha operativa es la fecha argentina de **ese inicio programado**.
2. Si no, es la fecha argentina del ingreso (`argentinaDateKey(startAt)`), nunca `toISOString().slice(0, 10)`.

El margen de 240 min es `EARLY_ARRIVAL_REVIEW_THRESHOLD_MINUTES` (13A): más allá de eso un ingreso ya se trata como "muy anticipado". Casos cubiertos por test:

| Turno | Ingreso | Fecha operativa | Por qué |
|---|---|---|---|
| 23:00–07:00 | 22:55 del 10 | 10 | dentro de la ocurrencia del 10 |
| 23:00–07:00 | 00:15 del 11 (tarde) | **10** | pertenece a la noche del 10 |
| 00:00–08:00 | 23:50 del 9 | **10** | ingreso anticipado de la ocurrencia del 10 |
| 08:00–16:00 | 21:00 del 10 (extra) | 10 | la ocurrencia más cercana (11 08:00) está a 11 h: fuera de ventana |
| sin turno | 21:00 del 10 | 10 | fecha del ingreso |

La obligación sigue el mismo criterio: la obligación del día D es el turno programado que empieza el día D.

## 5. Precedencia

1. **Franco activo gana sobre la obligación ordinaria** (turno habilitado + régimen que obliga + día normal).
2. **Feriado + convocatoria + franco** es una contradicción y **se bloquea en la escritura**, en ambos sentidos:
   - guardar un franco `ACTIVO` con convocatoria `ACTIVA` ese día → `409 DAY_OFF_CONFLICTS_HOLIDAY_WORK`;
   - guardar una convocatoria `ACTIVA` con franco `ACTIVO` ese día → `409 HOLIDAY_WORK_CONFLICTS_DAY_OFF`.
   Ambos escritores toman el mismo advisory lock por `empleado + fecha` dentro de su transacción, así que dos guardados concurrentes no pueden dejar las dos filas activas.
3. Defensa en profundidad: si igual coexistieran (datos previos o un camino futuro), el motor de obligación aplica el franco después de la convocatoria. No hay resolución silenciosa en la escritura.

Feriado sin convocatoria: ya no había obligación; el franco no cambia nada.

## 6. Obligación laboral

`resolveWorkObligationCandidates(dateKey)` es la única fuente de verdad. Después de resolver turno, vigencia, día de semana, régimen y convocatoria, descarta a quien tiene `EmployeeDayOff ACTIVO` en `dateKey` (1 consulta por evaluación, sólo sobre los candidatos). `missingEntry` y `attendanceInactivity` **no** tienen filtros propios: heredan el resultado.

Al asignar un franco también se resuelven, en la misma transacción, los incidentes `PENDIENTE` de `AttendanceInactivityIncident` de esa persona y fecha (nota "Resuelto automáticamente: se asignó franco para esa fecha."). Cancelarlo no recrea incidentes: el catch-up de falta de ingreso sólo recorre días que aún no evaluó.

## 7. Contabilidad

### 7.1 Señal automática vs. reconocida (evidencia)

Se pidió reutilizar `TimeEntry.source === ADMIN` si alcanzaba. **No alcanza tal como estaba:**

1. La carga manual (`POST /time-entries`, `timeEntriesRepository.create`) **no escribe `source`**: queda `null`, no `ADMIN`.
2. Hay **una sola** fila `NORMAL_BASE` por empleado + fecha: `ensureNoDuplicate` bloquea una segunda carga y la fichada **fusiona** sus minutos en la fila existente (`closeOpenWorkShift`, `createFromWorkShift`). Si ya hubo fichada, el único camino manual es corregir esa fila (`PATCH /time-entries/:id`, con motivo si está aprobada).
3. Esa corrección **no tocaba `source`**: la fila seguía diciendo `KIOSK`/`PUBLIC_CLOCK_PHOTO`.
4. `ADMIN` sí identifica una jornada registrada a mano por un responsable (`createWorkShift`). El cierre manual de una jornada abierta por el fichador (`closeWorkShiftManually`) conserva el `source` de la jornada (F7.1), así que no la convierte en reconocida.

Nadie lee `TimeEntry.source` con fines de negocio (el frontend muestra el `source` de la jornada/fichada, no el de la fila de horas). **Adaptación mínima elegida, sin columna nueva:** `source` pasa a significar "qué canal fijó el valor vigente de las horas":

- fichada (crear o fusionar) → canal del fichador (sin cambios);
- **corrección manual de horas (`PATCH` con `hours`) → `ADMIN`** (cambio de una línea en `timeEntriesRepository.update`);
- carga manual → `null` (sin cambios).

Regla única (`workedTimeAccounting.isAutomaticTimeEntrySource`): **automática ⇔ `source` es un canal de fichador** (`PORTAL_DNI`, `PUBLIC_CLOCK_PHOTO`, `KIOSK`, `BIOTIME`, `FACIAL`). `null` y `ADMIN` son horas fijadas por una persona. Para desgloses, `HourConceptBreakdown.source` ya distinguía `AUTOMATIC`/`MANUAL`.

Una fichada nueva que se fusiona sobre una fila reconocida le devuelve el `source` del fichador: la fila vuelve a ser automática y deja de computar en el franco hasta una nueva revisión. Es deliberado: hay actividad nueva sin revisar, y la jornada nueva genera su propia alerta.

### 7.2 Qué deja de computar

Se resuelve en lectura, sin reescribir nada (`TimeEntry.hours` nunca cambia):

- **Horas base automáticas:** de la fila automática de la fecha calendario X se descuentan los minutos de `TimeSegment` de fecha X que pertenecen a jornadas del fichador (`WorkShift.source` ≠ `ADMIN`, estado `PROCESADO`/`OBSERVADO`) cuya **fecha operativa** tiene franco activo. Tope: los minutos de la fila. Así una jornada nocturna con franco el 10 descuenta también sus 7 h del 11, y un franco el 11 **no** descuenta las horas del turno nocturno legítimo del 10 que caen el 11.
- **Desgloses `AUTOMATIC`:** no computan si pertenecen a una jornada en franco (Motor B guarda `HourConceptBreakdown.workShiftId`). Un desglose automático sin jornada se atribuye por su fecha calendario.
- **Lo manual siempre computa:** filas con `source` `null`/`ADMIN` y desgloses `MANUAL`. En un día de franco sólo cuenta lo que una persona cargó o corrigió explícitamente. Si hace falta un concepto dentro de la jornada (p. ej. Sereno) sobre horas reconocidas, se carga manualmente.

Implementación única:

- `employee-day-offs/employeeDayOffAccounting.ts::loadDayOffAccounting` arma el índice (francos activos del rango con un día de margen a cada lado, minutos excluidos por empleado + fecha, jornadas excluidas). Sin francos en el rango hace **1 consulta** y devuelve un índice vacío. Con francos agrega **1 consulta** de jornadas acotada a esas fechas.
- `workedTimeAccounting.applyDayOffExclusions` aplica la exclusión; `accountEmployeePeriods`/`accountEmployeePeriod` la llaman. `DayAccounting`/`PeriodAccounting` suman `dayOffUncountedMinutes`.
- Consumidores que la pasan: grilla por legajo (`time-grid`), grilla de período (`period-employees`), "Por persona", export, cierre (`buildClosureSnapshots`), resumen de Carga de horas y "Horas cargadas" del dashboard. Los dos últimos agregan en SQL: con francos en el período leen sólo las filas automáticas de esas fechas y restan lo excluido con la misma función.

### 7.3 Casos de referencia (tests)

| Caso | Fila base | Computa |
|---|---|---|
| Franco sin actividad | — | 0 h, grilla `Franco · 0 h` |
| Franco + fichada 8 h | `KIOSK` 8 h | 0 h + alerta `ACTIVIDAD_EN_FRANCO` |
| Franco + fichada + corrección a 8 h | `ADMIN` 8 h | 8 h |
| Franco + carga manual 6 h (sin fichada) | `null` 6 h | 6 h |
| Franco cancelado después | `KIOSK` 8 h | 8 h (vuelve la contabilidad normal según fuente) |

## 8. Franco creado después de la fichada

En la **misma transacción** del guardado:

1. se escribe/reactiva el franco;
2. se crean las alertas `ACTIVIDAD_EN_FRANCO` (con notificación) de las jornadas del fichador cuya fecha operativa es esa fecha;
3. se resuelven los incidentes de inactividad pendientes de esa fecha;
4. se recalculan los snapshots de cierres **no protegidos** con snapshot (mismo criterio que la reinterpretación de Horas Especiales, §15 de `WORKED_TIME_ACCOUNTING_MODEL.md`).

La contabilidad no necesita reescritura: se deriva al leer, así que deja de computar en cuanto la transacción confirma. Fichadas, fotos, jornadas, tramos y horas quedan intactos.

Cancelar el franco resuelve las alertas `ACTIVIDAD_EN_FRANCO` pendientes de esas jornadas con una nota automática. Reactivarlo reabre sólo las que había resuelto esa nota; nunca reabre una alerta resuelta o descartada por una persona.

## 9. Fichada durante un franco

- El endpoint del fichador **no cambia**: ni rechaza ni consulta francos (cero latencia agregada, sin mensaje al empleado).
- El post-proceso durable (`ClockPunchPostProcessJob`) suma el paso `day-off-evaluation` a los jobs `ENTRY` y `ROLLOVER_ENTRY`, después de la evaluación de ingreso (que adopta el turno que define la fecha operativa).
- **`ShiftAlert` encaja:** exige `workShiftId`, y todo job del fichador nace con su jornada (`ClockPunchPostProcessJob.workShiftId` es obligatorio). La alerta describe exactamente eso: una jornada registrada en un día de franco. Se agregó `ACTIVIDAD_EN_FRANCO` a `ShiftAlertType` en vez de reutilizar un tipo ajeno.
- Idempotencia: la marca del paso (`stepsCompleted`) y, además, nunca se toca una alerta ya existente para `(workShiftId, ACTIVIDAD_EN_FRANCO)`. Un reintento no duplica alerta ni notificación, y nunca reabre una alerta resuelta por una persona (mismo guard que `flagOpenShiftOverflowForReview`).
- Severidad `ADVERTENCIA` (requiere decisión), notificación `ALERTA_FICHADA` a `attendanceRecipients` (RRHH activo + responsables de carga del legajo), igual que el resto de las alertas de fichada.
- Texto: título "Actividad registrada en día de franco"; mensaje "La persona tenía franco asignado para esta fecha y registró actividad. Revisá si corresponde reconocer horas trabajadas." Nunca "incumplimiento", "falta" ni "error del empleado".
- Las alertas de puntualidad/duración existentes (`INGRESO_TARDE`, etc.) no se tocaron.

## 10. API (`/api/employee-day-offs`)

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/?period=YYYY-MM` | Francos (ACTIVO y CANCELADO) visibles en el período. |
| `GET` | `/by-date?date=YYYY-MM-DD&search=&page=&take=` | Modal de la grilla: personas activas del alcance con su franco, convocatoria a feriado y estado de cierre de esa fecha. |
| `PUT` | `/` | Guardado en lote: `{ date, correctionReason?, employees: [{ employeeId, status, notes }] }`. |

- Lote de hasta 500 personas, sin duplicados. Cada ítem es un upsert independiente: nunca "reemplaza la fecha".
- Idempotente: un ítem sin cambios no escribe ni audita. Un `CANCELADO` sobre una fila inexistente no crea nada.
- Concurrencia: advisory lock por `empleado + fecha` dentro de la transacción, más el `@@unique` como garantía final (un `P2002` residual se traduce a 409).

## 11. Permisos

Los tres niveles operativos pueden leer y guardar, siempre dentro de `employeeAccessWhere(user)`:

- Nivel 1 RRHH: todo el padrón.
- Nivel 2 y Nivel 3: legajos con `EmployeeAssignment TIME_RESPONSIBLE` vigente (hoy es la misma regla para ambos, `PROJECT_CONTEXT.md` §Nivel 2).

El backend verifica el alcance de **cada** `employeeId` del lote antes de escribir: un UUID fuera del alcance devuelve `403 EMPLOYEE_SCOPE_FORBIDDEN` y no se guarda nada. Endpoints autenticados: aplica el limitador global (no son públicos).

## 12. Períodos cerrados

Un franco reinterpreta horas, así que respeta `MonthlyTimeClosure` igual que una corrección horaria (`assertClosurePeriodsWritable`, lock compartido dentro de la transacción):

- Período `ENVIADO`/`APROBADO`/`CORRECCION_PENDIENTE`, Nivel 2/3 → `409 PERIOD_CLOSED`.
- RRHH → permitido sólo con `correctionReason` (si falta, `400 DAY_OFF_CORRECTION_REASON_REQUIRED`). El motivo queda en la auditoría.
- Como en la corrección directa de RRHH de una hora (§14.2 de `WORKED_TIME_ACCOUNTING_MODEL.md`, deuda conocida), el snapshot de un cierre protegido **no** se reconstruye. La grilla y el export leen datos vigentes.
- Un ítem sin cambios en un período cerrado no falla (no escribe nada).

## 13. Auditoría

Un `AuditLog` por fila que cambia, después del commit, con before/after, usuario, empleado y fecha:

- `CREATE` — "Se asignó franco a {Apellido, Nombre · Legajo N} para el {dd/mm/aaaa}."
- `DEACTIVATE` — "Se canceló el franco de … para el …."
- `ACTIVATE` — "Se reactivó el franco de … para el …."
- `UPDATE` — "Se actualizó la nota del franco de … para el …."

Con motivo de corrección de período cerrado se agrega " Motivo: …". Los recálculos de snapshot se auditan con `auditClosureRecalculations`.

## 14. Cachés

- Backend: `clearWorkedTimeDerivedReadCaches()` (grilla por legajo, grilla de período, Por persona, resumen, asistencia, dashboard y cierres), `clearShiftAlertReadCaches()` y `clearNotificationsListCache()`. El módulo nuevo no agrega cachés.
- Frontend: `WORKED_TIME_DERIVED_CACHE_FAMILIES` + `shift-alerts` + `notifications`.

## 15. UI

- Carga de horas (`/horas`): acción "Gestionar francos" en el encabezado y "Gestionar francos de este día" en el detalle de cada celda (mismo modal y mismo servicio). Fecha → personas del alcance con búsqueda → selección múltiple → "Asignar franco" / "Cancelar franco" → guardar → la grilla se refresca sola.
- Celda de franco: `Franco` + horas computadas (`0 h` si no hay nada reconocido) con estilo propio. `—` sigue significando "sin horas registradas".
- Grilla por legajo y panel de cierre: la fila de Horas base muestra el franco del día y, si hubo actividad no computada, la cantidad en el detalle.

## 16. Rollback manual

Ver `backend/prisma/migrations/20261103120000_add_employee_day_off/ROLLBACK.md`. Resumen: quitar el código que usa el modelo, borrar alertas `ACTIVIDAD_EN_FRANCO`, recrear `ShiftAlertType` sin el valor, `DROP TABLE "EmployeeDayOff"`, `DROP TYPE "EmployeeDayOffStatus"` y borrar la fila de `_prisma_migrations`. Las filas `TimeEntry` corregidas a mano quedan con `source = ADMIN` (sin efecto sin franco).

## 17. Límites conocidos

- Una jornada en estado `OBSERVADO` por período protegido no cargó horas, pero sus tramos existen. Si en esa fecha hubo otra jornada y RRHH asigna un franco por corrección, el tope por fila evita minutos negativos pero puede descontar de más. Requiere período cerrado + franco por corrección + dos jornadas el mismo día.
- La reparación técnica de Horas normales (`reconcile-normal-hours.ts`, CLI de staging) reescribe el `source` desde la jornada: una fila reconocida que repare vuelve a ser automática.
- Las alertas de puntualidad/duración de una jornada en franco se siguen generando como hasta hoy.
