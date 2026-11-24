# Rotaciones de turnos — auditoría y plan (Etapa R0)

Estado: **R0 (auditoría y plan), R1 (caracterización + diagnóstico) y R2 (resolución central en modo paridad) completadas** — cierre de R1 en §21, de R2 en §22. R3: plan en §23, **R3.1 (modelo + API, aplicada en development)** y **R3.2 (UI)** implementadas (§23.14–§23.17); R3.3–R3.4 pendientes. Fecha: 2026-11-19. Rama de trabajo al auditar: `pre-development` (`4de624c`); R1 en `fix/shift-rotation-r1`.

Alcance de esta etapa: no se modificó código productivo, `schema.prisma`, migraciones ni bases. La única ejecución fue la de tests unitarios existentes (mocks, sin base) y un test de reproducción temporal fuera del repositorio (§5.0).

---

## 1. Resumen ejecutivo

- **No existe una única fuente de verdad del "turno esperado".** Hay **cuatro** resoluciones distintas de "qué turno corresponde" (§4), todas leyendo `ShiftAssignment` directamente, con reglas de desempate diferentes cuando hay más de una asignación aplicable el mismo día: *la de inicio más temprano* (falta de ingreso, inactividad), *la más cercana a la fichada* (entrada), *el turno adoptado en la entrada* (salida, olvido de salida, vencimiento, fecha operativa) y *la suma si son disjuntas* (Novedades).
- **El problema planteado está confirmado con código y test.** Con Mañana 07:00–17:00 y Tarde 17:00–03:00 HABILITADAS y aplicables, `resolveWorkObligationCandidates` elige Mañana; a las 07:10 se crea y **notifica** una falta de ingreso falsa; la fichada real de las 17:00 la **auto-resuelve** después (la notificación ya salió). Además: una entrada a las 11:30 se clasifica contra Mañana (INGRESO_TARDE falso y salida evaluada contra 17:00), y Novedades con `EXPECTED_SCHEDULE` calcula **20 h** de jornada esperada para ese día (suma de dos turnos disjuntos).
- **La "rotación V1" que sugiere el comentario del schema (alternar vigencias a mano) no es viable:** `@@unique([employeeId, shiftTemplateId])` impide tener dos ventanas de vigencia del mismo turno para la misma persona, así que RRHH tendría que **editar en el lugar** las fechas cada semana, reescribiendo la historia de la asignación (y disparando recálculos de cobertura sobre la ventana vieja).
- **Recomendación:** nuevas entidades de rotación **resueltas en lectura** por un resolver central (`resolveExpectedShifts`), más una tabla de **excepciones puntuales**. Antes de cualquier esquema: (1) tests de caracterización del comportamiento actual y (2) centralizar la resolución **en modo paridad** (los empleados sin rotación siguen exactamente igual, incluidas sus reglas de desempate actuales).
- **Grupos por lugar:** entidad estructurada `ShiftGroup` (FK opcional en `ShiftTemplate`), conservando `categoryName` como etiqueta secundaria. No reutilizar `categoryName` (texto libre, sin integridad, ya sugerido en la UI con valores como "Sereno").
- **Permisos:** eje nuevo `UserShiftGroupScope` (usuario ↔ grupo), evaluado aparte de `employeeAccessWhere`, sin modificarla. RRHH siempre global.
- **Primera etapa a implementar: R1 — tests de caracterización + diagnóstico de solo lectura** (sin esquema, sin cambio de comportamiento).

---

## 2. Estado actual del sistema

### 2.1 Modelo de datos (`backend/prisma/schema.prisma`)

| Modelo | Campos relevantes | Observaciones |
|---|---|---|
| `ShiftTemplate` (l.1936) | `code` único, `categoryName String?` (índice), `startTime/endTime` "HH:mm", `crossesMidnight`, `expectedMinutes?`, tolerancias de entrada/salida, `minimumMinutesForCompliance`, `maximumInformativeMinutes`, `missingOutAlertAfterMinutes`, `absoluteOpenShiftLimitMinutes`, umbrales, `status` | Es la "definición de horario". `categoryName` es texto libre ≤60 sin catálogo. |
| `ShiftAssignment` (l.1977) | `employeeId`, `shiftTemplateId`, `status` HABILITADO/DESHABILITADO, `effectiveFrom @db.Date`, `effectiveTo?`, `weekdays Int[]` (0=domingo; vacío = todos) | **`@@unique([employeeId, shiftTemplateId])`**. Comentario: "rotativos versión simple V1: RRHH crea 2 asignaciones con vigencias que se alternan manualmente". Edición en el lugar (sin historia de vigencias, sólo auditoría). |
| `WorkShift` | `startAt/endAt TIMESTAMPTZ`, `shiftTemplateId?` (adoptado en la entrada), `maxAllowedMinutes`, `crossesMidnight`, `status`, `reviewStatus` | La jornada real. No guarda *por qué* se adoptó el turno. |
| `WorkRegime` / `EmployeeWorkRegime` | `kind` TURNO_OBLIGATORIO/TURNO_FLEXIBLE/SIN_TURNO, `alertOnOutOfShift`, `openShiftOverflowAction`, `extendedShiftAlertMinutes`; asignación con vigencia | El régimen gobierna supresión de alertas y obligación, no el horario. |
| `EmployeeDayOff` | `employeeId`, `date @db.Date`, `status` ACTIVO/CANCELADO, `@@unique([employeeId, date])` | Franco individual por fecha operativa. |
| `HolidayWorkAssignment` | `date`, `employeeId`, `shiftTemplateId?`, `expectedStartTime?/EndTime?`, `status` ACTIVA, `@@unique([date, employeeId])` | Convocatoria a feriado. También define quién cobra FERIADO (WORKED_TIME_ACCOUNTING_MODEL §16). |
| `DoubleHourRule` (`kind = FERIADO`) | calendario de feriados, alcance opcional | Fuente de "es feriado". |
| `ShiftAlert` | `@@unique([workShiftId, type])` | Alertas ligadas a una jornada real. |
| `AttendanceInactivityIncident` | `@@unique([employeeId, operationalDate])`, **sin columna de tipo** | Falta de ingreso e inactividad comparten fila por persona-día. |
| `SystemNotification` | `eventAt` inmutable | Una notificación enviada no se "desenvía". |
| `NoveltyDayCoverage` | persiste `shiftTemplateId`, `expectedMinutes` por día | Snapshot de la jornada esperada que usó Novedades. |

### 2.2 Permisos actuales

- Roles: `NIVEL_1_RRHH`, `NIVEL_2_SUPERVISION`, `NIVEL_3_CARGA_HORARIA` (`shared/security/roles.ts`).
- `employeeAccessWhere` (`modules/employees/employeeAccess.ts`): RRHH sin restricción; N3 = legajos con `EmployeeAssignment TIME_RESPONSIBLE` vigente propio; N2 = los propios + los de cada N3 ACTIVO que supervisa.
- Escritura de turnos, **sólo RRHH**: `POST/PATCH/DELETE /shifts/assignments` (`shifts.routes.ts`), `POST/PATCH/DELETE /workforce/shift-templates` (`workforce.routes.ts`), `PUT /shifts/holiday-work/assignments`. Lectura: los tres roles; listados de asignaciones y candidatos de feriado filtrados por `employeeAccessWhere`. Resolver alertas: RRHH + N2.
- `shiftAssignmentService.assign` no aplica `employeeAccessWhere` (sólo RRHH puede llamarlo).

### 2.3 Frontend

- `ShiftsPage` (Configuración → Turnos): tabla plana de `ShiftTemplate` con columna "Categoría" (`categoryName`), búsqueda por código/nombre/categoría, contadores habilitados/deshabilitados. Edición sólo nivel 1.
- `ShiftTemplateFormFields`: campo "Categoría / tipo" con placeholder **"Ej: Administrativo, Cosecha, Sereno"**.
- `ShiftDetailPage` + `ShiftEmployeesPanel`: empleados asignados a un turno. `EmployeeShiftsPanel` (legajo): turnos asignados con vigencia/días.
- `HolidayWorkAssignmentsPage`: convocatorias por fecha; los candidatos muestran sus turnos HABILITADOS.
- No existe ninguna vista de "turno esperado por fecha" ni calendario de planificación.

### 2.4 Fichador

La PWA (`fichador/`) sólo conoce la jornada abierta/cerrada (`WorkShift`); nunca lee `ShiftTemplate` ni `ShiftAssignment`. El turno se evalúa **después** de la fichada, en el post-proceso durable (`clock/clockPunchPostProcess.worker.ts` → `evaluateShiftEntry` / `evaluateShiftExit`).

---

## 3. Flujo actual de resolución de turno

```
Fichada INGRESO ─► post-proceso ─► evaluateShiftEntry
                                     │ loadMatchingContext: TODAS las ShiftAssignment del empleado + TODOS los ShiftTemplate ACTIVO
                                     │ matchShiftForEmployee: aplicables el día calendario de la fichada (vigencia + weekday),
                                     │   HABILITADO y DESHABILITADO; gana la ocurrencia (ayer/hoy/mañana) más cercana
                                     │ adopta WorkShift.shiftTemplateId + maxAllowedMinutes
                                     └ alertas: TURNO_NO_IDENTIFICADO / SHIFT_NOT_ENABLED (suprimibles por régimen),
                                       INGRESO_TARDE / INGRESO_ANTICIPADO (tolerancias del turno adoptado)

Fichada SALIDA ─► evaluateShiftExit
                    │ resolveMatchForExit: SOLO WorkShift.shiftTemplateId + ShiftAssignment(employeeId, templateId) sin mirar vigencia
                    └ SALIDA_ANTICIPADA/TARDIA, JORNADA_FUERA_DE_TURNO, JORNADA_INSUFICIENTE/EXTENDIDA

Cron 60 s (clockPunchMaintenance) ─► expireOpenWorkShifts (maxAllowedMinutes adoptado)
                                  ─► checkMissingOutRisk (WorkShift.shiftTemplate)
                                  ─► checkMissingExpectedEntries(hoy) ─► resolveWorkObligationCandidates(fecha)
Cron diario ─► detectAttendanceInactivity(ayer) ─► resolveWorkObligationCandidates(fecha)
Catch-up ─► checkMissingEntriesForElapsedDate(fecha)

Novedades ─► loadEmployeeWorkdayContext + evaluateEmployeeWorkday (expectedWorkday.ts)
```

---

## 4. Consumidores del turno esperado

| # | Consumidor | Archivo | Qué decide | Fuente | Con >1 asignación aplicable |
|---|---|---|---|---|---|
| 1 | Obligación de trabajo | `shifts/workObligation.service.ts:54` | ¿quién debía trabajar la fecha operativa y con qué inicio? | `ShiftAssignment` HABILITADO + vigencia + weekday, empleado y turno ACTIVO; régimen ≠ SIN_TURNO; feriado ⇒ sólo convocados; franco anula | **Inicio más temprano** (l.77–88) |
| 1a | Falta de ingreso (intradía y catch-up) | `time-entries/missingEntry.service.ts:131` | tolerancia vencida + sin INGRESO que "pertenezca" a esa ocurrencia | consumidor de #1 | hereda #1 |
| 1b | Inactividad diaria | `time-entries/attendanceInactivity.service.ts:255` | sin fichadas/jornadas/horas/novedades en el día calendario | consumidor de #1 | hereda #1 (sólo el universo; la evidencia es "cualquier actividad") |
| 2 | Entrada | `shifts/workShiftEvaluationRunner.ts` `evaluateShiftEntry` + `workShiftEvaluation.service.ts:170` | turno de referencia, puntualidad de ingreso, alertas de configuración | `ShiftAssignment` del empleado (HABILITADO **y** DESHABILITADO) aplicables el día calendario de la fichada | **Ocurrencia más cercana a la fichada** (`closestOwnMatch`, l.146) |
| 3 | Salida | `workShiftEvaluationRunner.ts` `resolveMatchForExit` / `evaluateShiftExit` | puntualidad de salida, fuera de turno, duración | `WorkShift.shiftTemplateId` (adoptado en #2) + existencia de `ShiftAssignment(employee, template)` | hereda #2 |
| 4 | Olvido de salida | `shifts/openShiftMonitor.service.ts` | POSIBLE_OLVIDO_SALIDA | `WorkShift.shiftTemplate` | hereda #2 |
| 5 | Vencimiento de jornada abierta | `timeEntries.repository.ts` `expireOpenWorkShifts` | rollover/alerta | `WorkShift.maxAllowedMinutes` (de #2) + régimen | hereda #2 |
| 6 | Fecha operativa de una jornada | `workShiftEvaluation.service.ts:254` → `employeeDayOffActivity`, `employeeDayOffAccounting`, `manualHoursConflict*` | a qué día pertenece una jornada (francos, carga manual) | turno adoptado | hereda #2 |
| 7 | Jornada esperada de Novedades | `shifts/expectedWorkday.ts:269` → `noveltyCoverage.service.ts` | `WORK_OBLIGATION` (¿cubre el día?) y `EXPECTED_SCHEDULE` (minutos) | asignaciones + franco + convocatoria (con su turno u horario) + feriado con alcance + régimen | **Suma si son disjuntas; UNRESOLVED si se superponen** (`expectedMinutesForTemplates`, l.160) |
| 8 | Recálculo de cobertura por cambio de plantilla | `workforce.service.ts:104` | qué legajos/fechas recalcular | `ShiftAssignment` por `shiftTemplateId` (cualquier estado) + convocatorias | — |
| 9 | Candidatos de feriado (UI) | `holidayWorkAssignment.repository.ts` `findCandidates` | qué turnos mostrar como sugerencia | `ShiftAssignment` HABILITADO (sin vigencia) | lista todos |

Consumidores que **no** dependen del turno esperado y no deben tocarse: la PWA del fichador y sus endpoints (`clock/*`), la clasificación de conceptos horarios por franja (`hour-concepts/hourConceptClassification.ts`, usa `HourConceptRule`), Horas Especiales/FERIADO (depende de la convocatoria y del trabajo real, no del turno), cierres (consumen cobertura ya persistida).

---

## 5. Problemas reales detectados

### 5.0 Evidencia

- Tests existentes ejecutados (sin base): `workObligation.service.test.ts`, `workShiftEvaluation.service.test.ts`, `missingEntry.service.test.ts`, `missingEntryReconciliation.test.ts`, `expectedWorkday.test.ts`, `dayOffObligation.test.ts` → **6 archivos, 209 tests, verdes.**
- El comportamiento "gana la más temprana" está fijado por el test `workObligation.service.test.ts:203` ("empleado con dos asignaciones aplicables el mismo día: gana la de scheduledStart más temprano"), y el "gana la más cercana" por `workShiftEvaluation.service.test.ts:170` y `:272`.
- Reproducción temporal (fuera del repo, en el scratchpad de la sesión, con las funciones reales y Prisma mockeado): **4/4 confirmados**:
  1. `resolveWorkObligationCandidates("2026-11-16")` con Mañana 07–17 y Tarde 17–03 HABILITADAS L–V → un candidato, **PLANTA-M, 07:00**.
  2. `closestOccurrence(17:00, "07:00")` = 07:00 del mismo día ⇒ la fichada real de la tarde "cumple" la obligación de la mañana; desde las 19:01 ya no (pasa a la ocurrencia del día siguiente).
  3. Entrada 16:55 → Tarde, sin alerta. Entrada 11:30 → **Mañana, `lateArrival = true`**; salida 03:00 contra Mañana → **`lateLeave = true`**.
  4. `evaluateEmployeeWorkday` con ambas asignaciones → `WORKDAY`, **1200 min**.

### 5.1 Hallazgos

| ID | Severidad | Hallazgo |
|---|---|---|
| P1 | Alta | **Falta de ingreso del turno opuesto.** Con dos turnos aplicables, #1 elige el más temprano. Para quien trabaja de tarde: incidente FALTA_INGRESO creado y **notificado** a RRHH/N3/N2 a las 07:10; se auto-resuelve recién al fichar a las 17:00 (si ficha después de las 19:00, ni eso: queda PENDIENTE). Como `AttendanceInactivityIncident` es único por persona-día y sin tipo, ese incidente además ocupa la fila del día. |
| P2 | Alta | **Novedades suma ambos turnos.** Mañana 07–17 + Tarde 17–03 son disjuntos ⇒ jornada esperada de 20 h. Una vacación/licencia `EXPECTED_SCHEDULE` cubriría 20 h por día. |
| P3 | Media | **Entrada mal atribuida.** Con dos turnos aplicables, una entrada anticipada (horas extra, cambio de último momento) cae en el turno incorrecto: INGRESO_TARDE falso, y la salida/duración/olvido de salida/vencimiento/fecha operativa heredan el turno equivocado. |
| P4 | Media | **Rotación manual inviable.** `@@unique([employeeId, shiftTemplateId])` + edición en el lugar ⇒ alternar semanas obliga a reescribir `effectiveFrom/To` de la misma fila: se pierde la historia de "qué turno tenía la semana pasada" (salvo auditoría) y cada edición recalcula cobertura sobre la ventana vieja ∪ nueva. Deshabilitar en vez de editar tampoco sirve: la entrada sigue viendo las DESHABILITADAS (genera SHIFT_NOT_ENABLED_FOR_EMPLOYEE). |
| P5 | Media | **Cuatro reglas de desempate distintas** (§4) para la misma pregunta. Cualquier fuente nueva de turno (rotación) que se agregue sin centralizar debe replicarse en 4–6 lugares. |
| P6 | Media | **Salida depende de `ShiftAssignment`.** `resolveMatchForExit` exige una fila `ShiftAssignment(employee, template)`; un turno que viniera de una rotación (sin asignación fija) caería en `GENERAL_UNASSIGNED` ⇒ sin puntualidad de salida y sin umbrales de duración del turno. |
| P7 | Baja (preexistente, documentado) | Feriado en alertas usa `holidayDatesInRange` sin alcance de la regla (deuda P4 del ADR de Novedades); Novedades sí evalúa alcance. |
| P8 | Baja (preexistente, documentado) | Convocado a feriado **sin** asignación aplicable: alertas no ven obligación; Novedades sí (turno u horario de la convocatoria). Y aun con asignación, alertas usan el turno de la asignación, nunca el `shiftTemplateId` de la convocatoria. |
| P9 | Baja | La entrada evalúa la aplicabilidad con el **día calendario de la fichada**, no con la fecha operativa: una entrada anticipada que cruza la medianoche (turno 00:00 fichado 23:55) se evalúa contra el día anterior. No afecta a 03:00, 07:00, 17:00 ni 19:00. |
| P10 | Baja | La inactividad diaria busca evidencia en el **día calendario** [00:00, 24:00): no impacta los turnos pedidos (todos empiezan dentro del día), pero el resolver futuro debe dar la ventana operativa explícita. |
| P11 | Info | Estado de `ShiftTemplate`/`ShiftAssignment` es el **actual**, no el de la fecha (documentado en NOVELTY_COVERAGE_ENGINE §7.5). |

---

## 6. Riesgos de agregar rotaciones sin centralizar

1. **Divergencia entre consumidores:** si sólo se enseña la rotación a falta de ingreso, la entrada seguiría eligiendo por cercanía entre asignaciones fijas, la salida exigiría `ShiftAssignment`, y Novedades sumaría turnos ⇒ el mismo día tendría hasta cuatro "turnos esperados".
2. **Notificaciones irreversibles:** cualquier error de resolución produce `SystemNotification` con `eventAt` inmutable a varios destinatarios.
3. **Cobertura de Novedades y cierres:** la jornada esperada se persiste en `NoveltyDayCoverage` y entra en snapshots de cierre; una resolución distinta en Novedades que en alertas da montos de licencias inconsistentes con lo que el sistema "esperó" ese día.
4. **Reinterpretación histórica:** si la rotación se calcula en lectura sin vigencias propias, cambiar el ancla o los miembros reescribiría silenciosamente el pasado (cobertura, calendarios).
5. **Regresión en Oficina:** cualquier cambio de la regla de desempate de asignaciones fijas (p. ej. "UNRESOLVED si hay dos") cambia alertas reales de empleados en producción.

---

## 7. Comparativa de alternativas

| Opción | Descripción | Ventajas | Riesgos / costos | Veredicto |
|---|---|---|---|---|
| **A. Extender `ShiftAssignment`** | Campos `cycleWeeks`, `cycleOffset`, fases por fila | Una tabla; reutiliza pantallas | Choca con `@@unique([employeeId, shiftTemplateId])`; una fila ya no significa "turno fijo": **los 6 lectores directos** (§4) interpretarían mal las filas rotativas ⇒ regresión en todos; "grupo A/B" no tiene lugar natural; migración sobre una tabla productiva | Descartada |
| **B. Entidades nuevas de rotación resueltas en lectura** | `ShiftRotation` + equipos + miembros con vigencia + celdas del ciclo; el resolver calcula la semana del ciclo | Aditiva; empleados sin rotación intactos; cambio semanal = cero escrituras; ciclos de N semanas triviales; historia de miembros con vigencia | Requiere centralizar antes la resolución; el cálculo del ciclo debe ser determinístico y con vigencias para no reinterpretar el pasado | **Recomendada** |
| **C. Generar `ShiftAssignment` futuras** | Un job crea/edita asignaciones por semana | Consumidores sin cambios (en teoría) | Imposible sin cambiar la unicidad; explosión de filas; horizonte de generación; regenerar al cambiar el plan; recálculos de cobertura masivos; mezcla datos generados con decisiones humanas; P1–P3 siguen igual (sigue habiendo varias asignaciones) | Descartada |
| **D. Plan diario materializado** (roster `EmployeeShiftPlanDay`) | Una fila por persona-día, generada desde la rotación | Lectura y calendario triviales; excepciones = editar la fila | Job de generación y horizonte; datos obsoletos si cambia la rotación; dos fuentes (regla y materialización) | Sólo para **excepciones** (ver §13): la parte "D" se adopta como overrides explícitos, no como materialización completa |

**Arquitectura elegida: B + overrides explícitos (D acotado) + resolver central.**

---

## 8. Arquitectura recomendada

### 8.1 Resolver central

Ubicación: `backend/src/modules/shifts/expectedShift.ts` (núcleo puro) + cargador batch, mismo patrón que `expectedWorkday.ts` (contexto con consultas fijas por llamada, nunca por legajo ni por día).

```ts
type ExpectedShiftSource =
  | "DAY_OFF" | "HOLIDAY_NOT_CONVOKED" | "HOLIDAY_CONVOCATION"
  | "OVERRIDE" | "ROTATION" | "FIXED_ASSIGNMENT" | "NONE";

type ExpectedShift = {
  employeeId: string;
  dateKey: string;                 // fecha operativa
  obligation: "SHIFT" | "NO_OBLIGATION" | "UNRESOLVED";
  source: ExpectedShiftSource;
  reason: string | null;           // p. ej. REGIME_SIN_TURNO, ROTATION_REST_DAY, FIXED_NOT_APPLICABLE
  shift: null | {                  // exactamente uno cuando obligation = SHIFT y la fuente lo garantiza
    template: ShiftTemplateRef;
    scheduledStartAt: Date;        // instante real (TIMESTAMPTZ)
    scheduledEndAt: Date;          // cruza medianoche ya resuelto
  };
  // Sólo source = FIXED_ASSIGNMENT con >1 asignación aplicable (datos actuales):
  fixedCandidates: ShiftTemplateRef[];
  rotationId: string | null; overrideId: string | null; convocationId: string | null;
};

resolveExpectedShifts(employeeIds, fromDateKey, toDateKey, db) → Map<employeeId, Map<dateKey, ExpectedShift>>
resolveExpectedShiftsForDate(dateKey, db)                     → universo de la fecha (para crons)
```

**Regla de compatibilidad clave:** para `source = FIXED_ASSIGNMENT` el resolver **no decide** entre varias asignaciones: devuelve `fixedCandidates` y cada consumidor aplica **su regla actual** (más temprana / más cercana / suma). Así los empleados sin rotación ni excepción producen exactamente los mismos resultados que hoy. Para `ROTATION`, `OVERRIDE` y convocatoria resuelta, el resultado es **uno solo** y todos los consumidores lo usan sin desempate.

### 8.2 Proyecciones por consumidor (no se mezclan semánticas)

La auditoría de Novedades ya fijó que alertas y Novedades interpretan distinto algunos casos (SIN_TURNO, TURNO_FLEXIBLE, sin asignación). El resolver devuelve el hecho; cada consumidor proyecta:

- `toWorkObligationCandidate(expected)` → alertas (SIN_TURNO ⇒ sin obligación).
- `toExpectedWorkday(expected)` → Novedades (SIN_TURNO ⇒ UNRESOLVED, minutos, alcance de feriado).
- `toEntryReferenceCandidates(expected[D-1..D+1])` → entrada.

### 8.3 Cambios por consumidor (cuando se introduzca la rotación)

| Consumidor | Cambio |
|---|---|
| `resolveWorkObligationCandidates` | Lee el resolver. FIXED con varias ⇒ conserva "más temprana" (paridad). ROTATION/OVERRIDE ⇒ el único turno. |
| `evaluateShiftEntry` | Construye candidatos con **instantes concretos** de las fechas operativas D-1, D y D+1 de la fichada y elige la ocurrencia más cercana. Para FIXED, mismas plantillas que hoy (incluidas DESHABILITADAS, para no perder SHIFT_NOT_ENABLED). Resuelve además P9 para rotaciones. |
| `WorkShift` | Nueva columna nullable `shiftTemplateSource` (`FIXED_ASSIGNMENT`/`ROTATION`/`OVERRIDE`/`HOLIDAY_CONVOCATION`); `null` = jornadas históricas ⇒ comportamiento actual. |
| `resolveMatchForExit` | Si `shiftTemplateSource ∈ {ROTATION, OVERRIDE, HOLIDAY_CONVOCATION}` ⇒ `ENABLED` sin exigir `ShiftAssignment` (resuelve P6). Si `null`/`FIXED_ASSIGNMENT` ⇒ lógica actual intacta. Tolerancias siempre del turno adoptado. |
| `checkMissingOutRisk`, `expireOpenWorkShifts`, `workShiftOperationalDateKey` | Sin cambios: ya usan el turno adoptado en la entrada. |
| `expectedWorkday` | Lee el resolver; ROTATION/OVERRIDE ⇒ un turno (sin suma); FIXED ⇒ regla P3 actual. |
| Recálculo de cobertura | Nuevos eventos: cambio de rotación, de celdas, de miembros, de excepciones ⇒ `recalculateNoveltyCoverage` con la ventana afectada (respetando períodos protegidos). |
| Candidatos de feriado (UI) | Mostrar el turno esperado de esa fecha (resolver), no todas las asignaciones. |

---

## 9. Modelo de datos propuesto (no implementado)

Todo aditivo; ninguna columna existente cambia de tipo ni de semántica.

```prisma
model ShiftGroup {                       // "lugar": Planta, Oficina, Taller, Granja
  id          String       @id @default(uuid())
  code        String       @unique
  name        String
  description String?
  sortOrder   Int          @default(0)
  status      RecordStatus @default(ACTIVO)
  createdByUserId String?  // FK User, onDelete: SetNull
  updatedByUserId String?
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt      @db.Timestamptz(3)
  templates   ShiftTemplate[]
  rotations   ShiftRotation[]
  userScopes  UserShiftGroupScope[]
}

// ShiftTemplate: + shiftGroupId String? (FK Restrict, índice). categoryName se conserva.

model ShiftRotation {
  id              String       @id @default(uuid())
  code            String       @unique
  name            String                      // "Planta Mañana/Tarde"
  shiftGroupId    String                      // alcance de administración (FK Restrict)
  cycleLengthWeeks Int                        // 1..8 (CHECK)
  anchorWeekStart DateTime     @db.Date       // lunes que es "Semana 1" del ciclo (CHECK lunes)
  effectiveFrom   DateTime     @db.Date
  effectiveTo     DateTime?    @db.Date
  status          RecordStatus @default(ACTIVO)
  observation     String?
  createdByUserId/updatedByUserId, createdAt/updatedAt
  crews           ShiftRotationCrew[]
}

model ShiftRotationCrew {                      // "Equipo A", "Equipo B" (no confundir con ShiftGroup)
  id         String @id @default(uuid())
  rotationId String
  code       String                           // "A"
  name       String
  @@unique([rotationId, code])
  members    ShiftRotationCrewMember[]
  slots      ShiftRotationSlot[]
}

model ShiftRotationCrewMember {                // pertenencia con historia
  id            String    @id @default(uuid())
  crewId        String
  employeeId    String                         // FK Restrict
  effectiveFrom DateTime  @db.Date
  effectiveTo   DateTime? @db.Date
  createdByUserId, createdAt
  @@index([employeeId, effectiveFrom])
  // Invariante (servicio + exclusion constraint btree_gist sobre daterange):
  // un empleado pertenece a lo sumo a UN equipo de UNA rotación en cada fecha.
}

model ShiftRotationSlot {                      // celda del ciclo
  id              String  @id @default(uuid())
  crewId          String
  cycleWeekIndex  Int                          // 0..cycleLengthWeeks-1
  weekday         Int                          // 0=domingo..6=sábado (convención del repo)
  shiftTemplateId String                       // FK Restrict
  @@unique([crewId, cycleWeekIndex, weekday])  // ⇒ como máximo un turno por persona y día
}

model EmployeeShiftOverride {                  // excepción puntual
  id              String   @id @default(uuid())
  employeeId      String
  date            DateTime @db.Date             // fecha operativa
  kind            ShiftOverrideKind             // REPLACE_SHIFT | NO_OBLIGATION
  shiftTemplateId String?                       // obligatorio si REPLACE_SHIFT (CHECK)
  reason          String
  status          ShiftOverrideStatus @default(ACTIVO)   // ACTIVO | CANCELADO
  swapGroupId     String?                       // une las dos filas de un intercambio
  createdByUserId/updatedByUserId, createdAt/updatedAt
  // índice único parcial (employeeId, date) WHERE status = 'ACTIVO'
}

model UserShiftGroupScope {                    // permiso de administración de turnos
  id           String @id @default(uuid())
  userId       String                          // FK Restrict
  shiftGroupId String                          // FK Restrict
  createdByUserId String?, createdAt
  @@unique([userId, shiftGroupId])
}

// WorkShift: + shiftTemplateSource ExpectedShiftSourceKind? (nullable; null = histórico)
```

Notas:
- Celda inexistente para un (equipo, semana, día) = **descanso** de ese equipo ese día (sin obligación). La rotación es autoritativa para sus miembros mientras esté vigente (no se "mezcla" con sus asignaciones fijas, ver §10).
- `DELETE` físico no se ofrece para rotaciones con historia: se cierran (`effectiveTo`) o inactivan, mismo criterio que asignaciones de régimen.
- Fechas `@db.Date`, instantes `TIMESTAMPTZ`, toda conversión por `shared/datetime/argentinaTime.ts`.

---

## 10. Reglas de precedencia (`resolveExpectedShift(employeeId, dateKey)`)

Evaluadas en orden; la primera que decide, gana. `dateKey` es la **fecha operativa** (la del inicio programado).

1. **Relación laboral / estado:** sin relación vigente (o `Employee.status` ≠ ACTIVO en la proyección de alertas, como hoy) ⇒ `NO_OBLIGATION` (alertas) / sin cobertura (Novedades, regla ya vigente).
2. **Franco** (`EmployeeDayOff` ACTIVO) ⇒ `NO_OBLIGATION (DAY_OFF)`. Gana sobre todo, incluida la convocatoria (regla vigente).
3. **Feriado:**
   - con convocatoria ACTIVA ⇒ `SHIFT (HOLIDAY_CONVOCATION)`. Turno: en paridad, el mismo que hoy usa cada consumidor (alertas: el de la planificación aplicable; Novedades: el de la convocatoria → planificación → horario). Unificar a "turno de la convocatoria primero" es una **decisión de negocio pendiente** (P8), no se cambia en silencio.
   - sin convocatoria ⇒ `NO_OBLIGATION (HOLIDAY_NOT_CONVOKED)`, **aunque la rotación o el turno fijo digan otra cosa.** (Regla de Juanjo: turno habitual ≠ obligación en feriado.)
4. **Excepción puntual** (`EmployeeShiftOverride` ACTIVA): `REPLACE_SHIFT` ⇒ ese turno; `NO_OBLIGATION` ⇒ sin obligación. Nunca crea obligación en feriado (ya resuelto en 3).
5. **Régimen `SIN_TURNO`** ⇒ sin obligación (alertas) / UNRESOLVED (Novedades) — proyecciones actuales.
6. **Rotación** con pertenencia vigente y rotación vigente/ACTIVA: semana del ciclo = `floor((lunes(dateKey) − anchorWeekStart) / 7) mod cycleLengthWeeks`; celda del equipo ⇒ `SHIFT (ROTATION)`; sin celda ⇒ `NO_OBLIGATION (ROTATION_REST_DAY)`.
7. **Turno fijo** (`ShiftAssignment` HABILITADO, vigente, weekday aplicable, plantilla ACTIVA) ⇒ `FIXED_ASSIGNMENT` con `fixedCandidates` (1 o más; desempate por consumidor como hoy).
8. **TURNO_FLEXIBLE / sin planificación / planificación que excluye el día** ⇒ proyecciones actuales (alertas: sin obligación; Novedades: UNRESOLVED o 0 confirmado, según `expectedWorkday`).
9. **Cruce de medianoche:** `scheduledStartAt` = fecha operativa + `startTime`; `scheduledEndAt` = `scheduledInstantForShiftTime(start, endTime, crossesMidnight)`. 17:00–03:00 y 19:00–07:00 pertenecen al día de inicio.

Validaciones de planificación (advertencias en la UI y en el endpoint de vista previa, no bloqueos del resolver): superposición entre el turno de D y el de D+1 de la misma persona (p. ej. sereno domingo 19:00–lunes 07:00 y lunes 03:00–11:00), persona en una rotación y además con asignaciones fijas vigentes (informativo: la rotación manda).

---

## 11. Diseño de grupos / lugares

### 11.1 `categoryName` vs `ShiftGroup`

| Criterio | Reutilizar `categoryName` | Entidad `ShiftGroup` |
|---|---|---|
| Integridad | Texto libre: "Planta", "planta ", "PLANTA" son tres grupos | FK; renombrar no rompe nada |
| Datos existentes | Valores actuales desconocidos (la UI sugiere "Administrativo, Cosecha, Sereno") ⇒ reinterpretar texto productivo como lugar | No toca lo existente; `categoryName` sigue como etiqueta |
| Permisos | Un permiso por string es frágil (renombrar = perder alcance) | `UserShiftGroupScope` con FK |
| Orden, estado, descripción | No | Sí |
| Rotaciones por lugar | Requiere string match | FK directa |
| Costo | Cero esquema | Una tabla + FK nullable |
| Serenos como subtipo | Se pierde (un solo campo) | `categoryName = "Sereno"` como etiqueta dentro de Planta/Granja |

**Decisión recomendada: `ShiftGroup` + `ShiftTemplate.shiftGroupId` nullable; `categoryName` queda como etiqueta secundaria ("Sereno", "Administrativo").** El argumento decisivo no es la comodidad sino que el grupo será **alcance de permisos**: no puede depender de texto libre.

### 11.2 ¿Y la estructura organizacional (Establecimiento / Unidad)?

Planta/Granja/Taller podrían existir como `Establishment`/`EstablishmentUnit`. **No** se recomienda derivar el grupo de turnos de allí: la ubicación es un atributo **histórico del empleado** (con reglas propias, `.claude/rules/org-structure.md`), mientras el grupo de turnos clasifica **plantillas y rotaciones** y define quién las administra. Un vínculo opcional `ShiftGroup → Establishment` podría evaluarse más adelante sólo como dato informativo, nunca como fuente de permisos ni de obligación.

### 11.3 Migración de grupos

Sin backfill automático. Etapa de grupos: (1) reporte de solo lectura de `categoryName` distintos y cuántas plantillas tienen cada uno; (2) RRHH crea los grupos y asigna el lugar a cada plantilla desde la UI (o un script de mapeo explícito aprobado). Plantillas sin grupo se muestran en "Sin lugar".

---

## 12. Diseño de rotaciones

### 12.1 Planta A/B (ciclo de 2 semanas)

`ShiftRotation "PLANTA-MT"`, grupo Planta, `cycleLengthWeeks = 2`, `anchorWeekStart = <lunes de la semana A>`.

| Equipo | Semana | L | M | X | J | V | S | D |
|---|---|---|---|---|---|---|---|---|
| A (Roberto, Ariel) | 1 | Mañana | Mañana | Mañana | Mañana | Mañana | Mañana* | Mañana* |
| A | 2 | Tarde | Tarde | Tarde | Tarde | Tarde | — | — |
| B (Walter, Carlos) | 1 | Tarde | Tarde | Tarde | Tarde | Tarde | — | — |
| B | 2 | Mañana | Mañana | Mañana | Mañana | Mañana | Mañana* | Mañana* |

\* "en determinadas semanas trabaja el turno mañana": si el fin de semana usa otro horario, se crea una plantilla "Planta fin de semana" y se pone en esa celda. Si no todas las semanas de mañana trabajan el fin de semana, el ciclo pasa a 4 semanas (§12.3) o se usa una excepción (§13).

### 12.2 Serenos Planta

La rotación es autoritativa para sus miembros, así que incluye también su semana fija:

| Equipo | Semana | L–V | S | D |
|---|---|---|---|---|
| Juanchi | 1 | Sereno semana 03:00–11:00 | — | — |
| Juanchi | 2 | Sereno semana 03:00–11:00 | Sereno FDS 19:00–07:00 | Sereno FDS 19:00–07:00 |
| José García | 1 | 07:00–15:00 | Sereno FDS | Sereno FDS |
| José García | 2 | 07:00–15:00 | — | — |

Johanna Ovelar y Juanjo siguen con su `ShiftAssignment` fija L–V 07:00–15:00, sin cambios. Juanjo en feriado: sin convocatoria ⇒ sin obligación (regla 3), igual que hoy.

### 12.3 Ciclos de 3 o 4 semanas

Mismo modelo con `cycleLengthWeeks = 3|4` y celdas con `cycleWeekIndex` 0..n-1; también rotaciones de 3 equipos sobre 3 turnos. Cambiar la longitud del ciclo o el ancla **no se edita en el lugar** sobre una rotación con historia: se cierra la vigente (`effectiveTo`) y se crea una nueva desde una fecha futura, para no reinterpretar semanas pasadas.

### 12.4 Semana del ciclo

Semana = lunes a domingo (convención propuesta; el fin de semana pertenece a la semana que empezó el lunes anterior). A confirmar con el negocio (§20).

---

## 13. Diseño de excepciones

- **Excepción puntual por persona-fecha** (`EmployeeShiftOverride`): "este martes Roberto hace Tarde", "este sábado Ariel no viene" (NO_OBLIGATION). No altera el ciclo: la semana siguiente sigue el patrón.
- **Intercambio:** operación de UI que crea dos overrides con el mismo `swapGroupId` en una transacción (A toma el turno de B y viceversa); cancelar uno cancela ambos.
- **Franco** sigue siendo `EmployeeDayOff` (no se duplica en overrides): tiene contabilidad y reglas propias.
- **Feriado** sigue siendo convocatoria; un override nunca crea obligación en feriado.
- **Corrimiento de todo el ciclo** (p. ej. "desde el lunes 7 invertimos A/B"): nueva versión de la rotación desde esa fecha (o ancla nueva), nunca reescribir la vigente hacia atrás.
- Toda alta/cancelación de excepción: auditoría + recálculo de cobertura de esa fecha, en la misma transacción, respetando cierres protegidos (mismo mecanismo que francos).

---

## 14. Diseño de permisos

```
Rol global (N1/N2/N3)  ×  Alcance de empleados (employeeAccessWhere, sin cambios)
                       ×  Alcance de administración de turnos (UserShiftGroupScope, nuevo)
```

- Helper único `shiftGroupAccess.ts`: `canManageShiftGroup(user, shiftGroupId)`, `manageableShiftGroupIds(user)`. RRHH ⇒ siempre todos (sin filas). N2/N3 ⇒ los grupos de sus filas. Nunca se infiere de `employeeAccessWhere` ni la modifica.
- **Escrituras sobre la planificación** (rotaciones, celdas, excepciones de miembros de rotaciones de su grupo): requieren `canManageShiftGroup` del grupo de la rotación/turno.
- **Escrituras que tocan a una persona** (agregar/quitar miembro, excepción): recomendado exigir **ambos** ejes (grupo administrable **y** legajo dentro de `employeeAccessWhere`) para no abrir datos personales fuera del alcance. Alternativa (sólo grupo) queda como decisión de negocio (§20).
- **Se mantiene sólo RRHH**: CRUD de `ShiftTemplate`, `ShiftAssignment` fijas, `ShiftGroup`, convocatorias a feriado, asignación de `UserShiftGroupScope`.
- Lectura de calendario esperado: alcance de empleados (como todo listado de legajos) ∪ grupos administrables (para ver la planificación aunque un miembro esté fuera del alcance, sólo con datos mínimos — a decidir).
- El backend valida todo; la UI sólo oculta acciones.

---

## 15. Diseño de UI

(La etapa de UI debe leer antes `.claude/rules/frontend-ui.md` y sus referencias visuales.)

1. **Turnos (listado):** agrupado por lugar (secciones colapsables Planta / Oficina / Taller / Granja / Sin lugar), filtro por lugar, `categoryName` como chip secundario. Mismo `ShiftTable`, sin cambiar el modelo de tabla.
2. **Rotaciones** (nueva pestaña dentro de Turnos): listado por lugar; detalle con grilla del ciclo — filas = equipos, columnas = Semana 1..N × L–D, celdas = chip del turno (color por plantilla, leyenda), miembros por equipo con vigencia. Edición sólo con permiso del grupo.
3. **Planificación (calendario de turno esperado):** por lugar y rango (2–6 semanas), filas = personas, columnas = días; cada celda muestra el turno esperado y un indicador de origen (Fijo / Rotación / Excepción / Feriado convocado / Feriado sin convocatoria / Franco / Sin obligación) y advertencias (superposición, varias asignaciones fijas). Es una **vista previa de solo lectura** del resolver: `GET /shifts/expected?from&to&shiftGroupId|employeeIds` — lo que se ve es exactamente lo que usarán alertas y Novedades. Click en celda ⇒ crear excepción / intercambio.
4. **Legajo:** franja "Turno esperado — próximas 2 semanas" en `EmployeeShiftsPanel`, más la rotación a la que pertenece.
5. **Convocatorias a feriado:** candidatos con su turno esperado de esa fecha.

---

## 16. Estrategia de compatibilidad

- **Invariante:** empleado sin pertenencia a rotación y sin excepción ⇒ resultados idénticos a hoy en los 9 consumidores, incluidas las reglas de desempate entre varias asignaciones fijas.
- Se demuestra con **tests de caracterización** escritos *antes* de refactorizar (R1) que no se modifican después.
- No se modifican `ShiftAssignment`, IDs de `ShiftTemplate`, horas cargadas, fichadas, jornadas, alertas ni notificaciones existentes. `WorkShift.shiftTemplateSource` nace `null` para todo lo histórico y `null` significa "lógica actual".
- No se migra ningún empleado a rotaciones; RRHH lo hace explícitamente, con vigencia desde una fecha **no anterior a hoy** (propuesta: bloquear fechas pasadas salvo RRHH con motivo y sólo en períodos abiertos).
- Las nuevas tablas vacías ⇒ comportamiento inerte: se puede desplegar el esquema antes de usarlo.
- La política sobre empleados con **varias asignaciones fijas** (P1–P3 en datos actuales) **no se cambia** dentro de la rotación: se mide primero (R1) y se decide en una etapa propia.

---

## 17. Estrategia de migración

1. Todas las migraciones **aditivas**: tablas nuevas, FKs nullable (`ShiftTemplate.shiftGroupId`, `WorkShift.shiftTemplateSource`), índices, CHECKs y exclusion constraint en tablas nuevas. Validadas con la puerta de migraciones de CI (historial completo sobre base limpia, diff vacío, migraciones existentes inmutables) y el runbook local (sin `db push`).
2. Sin backfill de datos productivos. Grupos: alta manual o script de mapeo explícito aprobado.
3. Orden de despliegue: esquema (inerte) → código que lo lee (sin datos, sin efecto) → carga de grupos → piloto de una rotación (Planta) en `development`/staging → producción con autorización explícita, respaldo verificable y reversión definida (AGENTS.md).
4. Reversión: desactivar/cerrar la rotación ⇒ los miembros vuelven a sus `ShiftAssignment` fijas al día siguiente (que no se tocaron). Las tablas pueden quedar vacías sin efecto.
5. Documentación en el mismo cambio: `BACKEND_API_CONTRACTS.md` (endpoints nuevos), `ARCHITECTURE_STANDARDS.md`/`PROJECT_CONTEXT.md` si nace un módulo, `DATABASE_STANDARDS.md` si aplica, y este ADR.

---

## 18. Plan de tests

### 18.1 Caracterización (R1, antes de tocar nada; expectativas congeladas)

| Caso | Nivel | Expectativa (hoy) |
|---|---|---|
| Oficina fijo L–V 06:30–15:00, lunes | obligación / entrada / salida / Novedades | candidato 06:30; entrada 06:35 sin alerta; 06:45 INGRESO_TARDE; salida con tolerancias del turno; 510 min |
| Oficina fijo, sábado | todos | sin obligación; Novedades `NO_WORK_OBLIGATION` |
| Fijo + feriado sin convocatoria | obligación / Novedades | sin candidato / `HOLIDAY_NOT_CONVOKED` |
| Fijo + feriado con convocatoria | idem | candidato / `WORKDAY` |
| Fijo + franco | idem | sin candidato / `DAY_OFF` |
| SIN_TURNO / TURNO_FLEXIBLE | idem | según 15M.7C/7D y §7.4 del ADR de Novedades |
| Dos fijas aplicables (07–17 y 17–03) | obligación / entrada / Novedades | **comportamiento actual** documentado: más temprana / más cercana / 1200 min (se congela para demostrar paridad, no porque sea correcto) |
| Nocturno 23:00–07:00 y 19:00–07:00 | obligación / fecha operativa / salida | fecha de inicio; salida al día siguiente |

Los tests existentes de `workObligation`, `workShiftEvaluation`, `workShiftEvaluationRunner`, `missingEntry*`, `attendanceInactivity`, `expectedWorkday`, `dayOffObligation`, `employeeDayOff*`, `noveltyCoverage*` deben seguir verdes **sin modificar expectativas** en todas las etapas.

### 18.2 Resolver (núcleo puro, R2/R4)

- Sin rotación ⇒ idéntico a la caracterización (test de paridad tabla-driven sobre los mismos fixtures).
- Rotación A/B: semana 1 A=Mañana/B=Tarde; semana 2 invertido; semana 3 = semana 1; fecha previa a `effectiveFrom` ⇒ fijo; posterior a `effectiveTo` ⇒ fijo.
- Ciclo de 3 y 4 semanas; ancla en el pasado lejano y fechas negativas respecto del ancla (módulo positivo).
- Fin de semana: equipo de mañana con celda S/D ⇒ obligación; equipo de tarde ⇒ `ROTATION_REST_DAY`.
- Serenos: Juanchi/José alternan el FDS; Johanna/Juanjo fijos sin cambios.
- Precedencia: franco > feriado > excepción > SIN_TURNO > rotación > fijo; feriado sin convocatoria anula rotación; excepción nunca crea obligación en feriado.
- Cross-midnight: 17:00–03:00 y 19:00–07:00 ⇒ `scheduledStart` en la fecha operativa, `scheduledEnd` al día siguiente; domingo 19:00 ⇒ fecha domingo.
- Advertencia de superposición D/D+1 (sereno domingo vs lunes 03:00).

### 18.3 Consumidores (R4)

- **Falta de ingreso:** rotación semana 2 (Walter de Mañana, Roberto de Tarde): a las 07:10 sólo Walter es candidato; **nunca** se crea FALTA_INGRESO de 07:00 para Roberto; a las 17:10 sin fichada ⇒ FALTA_INGRESO 17:00 para Roberto.
- **Inactividad:** universo = quienes el resolver da `SHIFT`; FDS sólo el equipo de mañana.
- **Entrada:** Roberto (Tarde) ficha 16:55 ⇒ referencia 17:00, sin alerta; `WorkShift.shiftTemplateSource = ROTATION`. **Corregido en R4.4 (§25.6, decisión del usuario):** la entrada de las 11:30 (330 min antes) queda **sin bloque** por la ventana `[inicio − 240, fin)` aprobada en R4.2 — fuera de ventana, alerta de revisión no suprimible; nunca INGRESO_TARDE contra 07:00.
- **Salida:** jornada con `shiftTemplateSource = ROTATION` ⇒ `ENABLED`, tolerancias de la plantilla esperada; jornada histórica (`null`) ⇒ lógica actual.
- **Feriado:** turno habitual (fijo o rotación) + sin convocatoria ⇒ sin obligación; + convocatoria ⇒ obligación.
- **Franco:** activo ⇒ sin obligación en rotación y en fijo.
- **Novedades:** rotación ⇒ un único turno (600 min), nunca 1200; recálculo de cobertura al cambiar miembros/celdas/excepciones, sin tocar cierres protegidos.
- **Oficina:** toda la batería de caracterización sigue verde sin cambios.

### 18.4 Integración (PostgreSQL efímera, suites opt-in existentes)

Constraint de pertenencia única por fecha, índice único parcial de excepciones, recálculo de cobertura transaccional, post-proceso de fichada end-to-end con rotación.

### 18.5 Permisos

RRHH siempre; N2/N3 con y sin `UserShiftGroupScope`; grupo correcto pero legajo fuera de `employeeAccessWhere` (según decisión §20); `employeeAccessWhere` sin cambios (sus tests existentes intactos).

---

## 19. Plan por etapas

| Etapa | Contenido | Esquema | Cambia comportamiento |
|---|---|---|---|
| **R0** | Esta auditoría | No | No |
| **R1** ✅ (§21) | Tests de caracterización (§18.1) + diagnóstico de solo lectura: script/consulta que lista (a) empleados con >1 `ShiftAssignment` HABILITADA aplicable el mismo día y su superposición, (b) valores distintos de `categoryName`. Ejecución sobre producción sólo con autorización explícita y en lectura. | No | No |
| **R2** ✅ (§22) | Resolver central en **modo paridad** (sólo fuentes actuales) y migración de `workObligation`, `expectedWorkday` y entrada a leer a través de él. Caracterización verde sin cambios. | No | No |
| **R3** | `ShiftGroup` + `ShiftTemplate.shiftGroupId` + UI agrupada por lugar. | Aditivo | No (sólo organización visual) |
| **R4** | Rotaciones en backend: tablas, resolver con `ROTATION`, `WorkShift.shiftTemplateSource`, salida, recálculo de cobertura, endpoints sólo RRHH, contratos documentados. **Diseño definitivo y subetapas R4.1–R4.8 en §24 (R4-P0, sin implementar).** | Aditivo | Sólo para miembros de rotaciones (ninguno al desplegar) |
| **R5** | Vista previa del turno esperado (endpoint + calendario de solo lectura). | No | No |
| **R6** | UI de administración de rotaciones. | No | — |
| **R7** | Excepciones e intercambios (backend + UI). | Aditivo | Sólo personas con excepción |
| **R8** | Permisos por grupo (`UserShiftGroupScope`, helper, endpoints, UI en Usuarios). | Aditivo | Sólo usuarios con alcance asignado |
| **R9** | Piloto Planta en `development`/staging; luego producción con autorización. | — | — |
| **R10** | Decisión sobre empleados con varias asignaciones fijas (P1–P3 en datos actuales), con la evidencia de R1. | Según decisión | Sí, acordado |

Cada etapa con `schema.prisma` requiere plan acordado antes de implementar (AGENTS.md) y cierre con `typecheck`/`test`/`build` verdes.

---

## 20. Qué implementar primero

**R1.** Es la única etapa que hace seguras a todas las demás: congela el comportamiento actual de Oficina y de los casos límite, y mide con datos reales cuántos empleados ya tienen varias asignaciones aplicables (dimensiona P1–P3 hoy) y qué hay en `categoryName` (insumo para R3). No toca esquema, ni datos, ni comportamiento.

### Preguntas de negocio abiertas (no bloquean R1–R2)

1. ¿La semana del ciclo empieza el lunes y el sábado/domingo pertenecen a la semana que empezó ese lunes?
2. Fin de semana de Planta: ¿el equipo de mañana trabaja **todas** sus semanas de mañana o sólo algunas? ¿Con qué horario?
3. Sereno: cuando Juanchi hace el FDS (domingo 19:00 → lunes 07:00), ¿qué pasa con su turno del lunes 03:00–11:00?
4. Feriado convocado con rotación: ¿el turno esperado es el de la convocatoria o el de la rotación?
5. Un administrador de turnos de Planta (N2/N3), ¿puede agregar a una rotación a una persona fuera de su alcance de empleados?
6. ¿Se permiten cambios de planificación retroactivos? ¿Quién y hasta qué período?

---

## 21. Cierre de R1 (2026-11-19)

R1 quedó **completada** en `fix/shift-rotation-r1`. Sin cambios de comportamiento, sin cambios en `schema.prisma` y sin migraciones: sólo se agregaron tests, un módulo de diagnóstico y un script de sólo lectura.

### 21.1 Entregables

| Archivo | Contenido |
|---|---|
| `backend/src/modules/shifts/shiftBehavior.characterization.test.ts` | 65 tests de caracterización A1–A8 (§18.1): Oficina fijo, feriado sin/con convocatoria, franco, regímenes, dos turnos aplicables, cruce de medianoche, HABILITADO vs DESHABILITADO. Los comportamientos incorrectos quedan marcados `COMPORTAMIENTO ACTUAL (bug conocido)`. |
| `backend/src/modules/shifts/diagnostics/shiftAssignmentDiagnostic.ts` | Análisis B1–B3: valores de `categoryName`; empleados ACTIVO con 2+ `ShiftAssignment` HABILITADAS aplicables el mismo día; por día en conflicto, obligación actual, candidatos y ruteo de la entrada (con `matchShiftForEmployee` real), jornada esperada de Novedades (con `loadEmployeeWorkdayContext`/`evaluateEmployeeWorkday` reales) y superposición. La elección "inicio más temprano" de `resolveWorkObligationCandidates` (inline, sin exportar) está replicada y cubierta por un test de paridad contra la función real. |
| `backend/src/modules/shifts/diagnostics/readOnlyDiagnostic.ts` | Guardas: lista blanca de argumentos (sin modo de aplicación), destino declarado (`--env-file` + `--expected-host`; production exige `--production-read-authorized`, remoto exige `--confirm-non-production`), transacción `SET TRANSACTION READ ONLY` verificada con `SHOW transaction_read_only` y proxy que sólo permite operaciones de lectura. |
| `backend/scripts/diagnose-shift-assignments.ts` | CLI: `npx tsx scripts/diagnose-shift-assignments.ts --env-file=<archivo> --expected-host=<host> [--from --to] [--json] [--confirm-non-production]`. Default: hoy + 28 días. Nunca imprime credenciales. |

### 21.2 Validaciones

- 65 tests de caracterización + 57 tests del diagnóstico (guardas, guard estático contra escrituras en el código, paridad, conflictos, formato) = **122 tests nuevos**.
- Suite backend completa: **3944 tests verdes** (222 archivos; las 15 suites de integración opcionales con PostgreSQL se omiten sin base configurada, como antes).
- Typecheck backend verde (el script, fuera del `include` del tsconfig, verificado aparte).
- Sin cambios de comportamiento, sin schema, sin migraciones.

### 21.3 Hallazgos nuevos de la caracterización (no corregidos)

1. **Empate exacto entre dos turnos aplicables:** con Mañana 07:00 y Tarde 17:00, una entrada a las 12:00 (5 h de cada lado) la gana el turno que se lee primero; el matching de entrada depende hoy del **orden de las asignaciones**.
2. **Turno adoptado sin asignación (`GENERAL_UNASSIGNED`, amplía P6):** la salida no evalúa puntualidad y la duración se mide contra el fallback de **600 min** (no contra el turno), pudiendo producir `JORNADA_EXTENDIDA`. Con la asignación DESHABILITADA, en cambio, se usa el umbral del turno.

Ambos quedan congelados en los tests y se tratan cuando la resolución se centralice (R2) o en una decisión explícita posterior.

### 21.4 Diagnóstico real en development (READ ONLY)

Ejecutado por el usuario contra la base de development, rango **2026-11-19 → 2026-12-16** (28 días), dentro de la transacción de sólo lectura.

| Métrica | Valor |
|---|---|
| `ShiftTemplate` | 15 |
| Empleados activos con asignaciones habilitadas | 29 |
| Empleados activos con 2+ asignaciones habilitadas | 0 |
| Empleados con conflicto en el rango | 0 |
| Employee-days en conflicto | 0 |

Valores de `categoryName`:

| Valor | Plantillas |
|---|---|
| Administrativo | 2 |
| Granja | 2 |
| Granja 02 | 1 |
| Medio Ambiente | 1 |
| Obra | 1 |
| Planta | 2 |
| Prueba | 2 |
| Sereno | 2 |
| Taller | 2 |

Conclusiones:

- Hoy, en development, P1–P3 (varios turnos aplicables el mismo día) **no se presentan en datos**; el riesgo aparecería al representar rotaciones con varias `ShiftAssignment`, que es justamente lo que el plan evita.
- Los valores confirman que **`categoryName` NO debe convertirse automáticamente en `ShiftGroup`**: `Sereno` es una función/tipo de turno, no un lugar; hay valores específicos o inconsistentes (`Granja` / `Granja 02`) y de prueba (`Prueba`). R3 introduce un `ShiftGroup` estructurado con **mapeo explícito** por plantilla; `categoryName` queda como etiqueta secundaria (§11).

### 21.5 Deuda de configuración (fuera de alcance de R1)

El entorno de development declara `APP_ENV=staging` y `NODE_ENV=development`. Se registra para revisión por separado (coherencia de nombres de entorno y de las guardas que dependen de `APP_ENV`); no se modifica en esta etapa.

---

## 22. R2 — Resolución central del turno esperado (modo paridad)

R2 quedó **completada** en `feature/shift-rotation-system` (sobre R1, `094f81e`). Es una refactorización estructural del backend: sin rotaciones, sin `ShiftGroup`, sin tablas ni columnas, sin migraciones, sin cambios de API ni de UI, y **sin cambios de comportamiento**.

### 22.1 Arquitectura implementada

`backend/src/modules/shifts/expectedShiftResolver.ts`: núcleo **puro** (sin Prisma, sin HTTP), usable desde jobs y servicios. Los consumidores siguen cargando sus datos en lote como antes (mismas consultas, mismos cortes tempranos) y le pasan el contexto de un empleado + fecha operativa. Cuatro piezas:

1. **Bloque de asignaciones fijas**: único lugar con vigencia, día de semana, estado de la asignación y de la plantilla (`isShiftAssignmentActiveOnDate`, `isShiftAssignmentApplicableOnWeekday`, `isShiftAssignmentApplicableOnDate`, `fixedAssignmentsInVigency`, `applicableFixedAssignments`). `workShiftEvaluation.service.ts` re-exporta los dos primeros para no cambiar a los importadores existentes.
2. **Régimen**: `activeRegimeKindOn` (antes duplicado en `expectedWorkday.ts` y en el diagnóstico).
3. **Precedencia**: `resolveExpectedShift(input, policy)` → `ExpectedShiftResolution`.
4. **Selección legacy** entre varias asignaciones aplicables: `pickEarliestFixedCandidate` (obligación) y `entryReferenceCandidates` (entrada).

```ts
type ExpectedShiftPolicy = "WORK_OBLIGATION" | "EXPECTED_WORKDAY";
type ExpectedShiftSource = "DAY_OFF" | "HOLIDAY_NOT_CONVOKED" | "HOLIDAY_SCOPE" | "HOLIDAY_CONVOCATION" | "REGIME" | "FIXED_ASSIGNMENT" | "NONE";

resolveExpectedShift<T, C>(
  input: { dateKey; assignments: FixedAssignment<T>[]; dayOff; holiday: HolidayScopeStatus | null; convocation: C | null; regimeKind },
  policy: ExpectedShiftPolicy,
): {
  dateKey; policy;
  obligation: "SHIFT" | "NO_OBLIGATION" | "UNRESOLVED";
  source: ExpectedShiftSource;
  reason: ExpectedShiftReason | null;   // DAY_OFF, HOLIDAY_NOT_CONVOKED, REGIME_SIN_TURNO, SCHEDULE_MISSING, PLAN_EXCLUDES_DAY, …
  isHoliday; convoked; convocation;
  fixedCandidates: T[];                 // LEGACY: todas las plantillas aplicables, en orden de lectura
}
```

### 22.2 Cómo preserva las asignaciones múltiples legacy

El resolver **no elige un turno** cuando hay varias asignaciones fijas aplicables: devuelve todas en `fixedCandidates` (orden de lectura) y cada consumidor aplica su regla actual:

| Consumidor | Regla legacy conservada |
|---|---|
| Obligación (falta de ingreso / inactividad) | `pickEarliestFixedCandidate`: inicio más temprano; empate → el primero leído (P1) |
| Novedades | `expectedMinutesForTemplates`: disjuntos suman; superpuestos `UNRESOLVED` (P2/P3) |
| Entrada | `entryReferenceCandidates` + cercanía a la fichada: habilitadas primero, después deshabilitadas; empate exacto → el primero (§21.3) |

### 22.3 Precedencia por política (la real, no la propuesta en §10)

- **WORK_OBLIGATION**: feriado sin convocatoria → sin asignación aplicable → `SIN_TURNO` → franco → obligación (en feriado convocado, con el turno habitual: P8). Empleado y plantilla ACTIVO los sigue filtrando la consulta. Feriado por calendario, sin alcance (P7): el servicio pasa `IN_SCOPE` para todo feriado.
- **EXPECTED_WORKDAY**: franco → feriado + convocatoria (cualquier estado de alcance) → feriado `IN_SCOPE` → alcance sin historia → `SIN_TURNO` → asignación aplicable → `TURNO_FLEXIBLE` → sin planificación vigente → planificación que excluye el día.

Las diferencias entre consumidores se declaran como `policy` en vez de quedar escondidas en cada servicio. Los minutos (regla P3 y fuentes de minutos de la convocatoria) quedan como **proyección propia de Novedades** en `expectedWorkday.ts`.

### 22.4 Consumidores migrados

| Etapa | Consumidor | Cambio |
|---|---|---|
| R2.1 | `workObligation.service.ts` `resolveWorkObligationCandidates` | Mismas consultas; vigencia/día/estado por `applicableFixedAssignments`, decisión por `resolveExpectedShift(WORK_OBLIGATION)`, selección por `pickEarliestFixedCandidate`. Mismo orden de candidatos. |
| R2.2 | `expectedWorkday.ts` `evaluateEmployeeWorkday` | Precedencia por `resolveExpectedShift(EXPECTED_WORKDAY)`; minutos en `projectExpectedWorkday`. `HolidayScopeStatus` y `WorkdayRegimePeriod` pasan a ser del resolver (re-exportados/alias). |
| R2.3 | `workShiftEvaluation.service.ts` `matchShiftForEmployee` | Candidatos por `entryReferenceCandidates`; la cercanía (`closestOwnMatch`) no cambia. |
| — | Diagnóstico R1 (`shiftAssignmentDiagnostic.ts`) | Se eliminó la réplica de "inicio más temprano" y el `activeRegimeKind` duplicado: usa el resolver. Candidatos de entrada en el orden real del matching. |

Sin migrar (no hace falta en R2): salida, olvido de salida, vencimiento y fecha operativa ya usan el turno adoptado en la entrada (`WorkShift.shiftTemplateId`).

### 22.5 Diferencias que permanecen intencionalmente

- Alertas vs Novedades en SIN_TURNO, TURNO_FLEXIBLE sin asignación, sin planificación, alcance del feriado (P7) y convocatoria (P8).
- La entrada no aplica franco, feriado ni régimen al elegir el turno, y usa el día calendario de la fichada (P9).
- Bugs congelados por R1 sin corregir: P1, P2/P3 con turnos disjuntos, empate dependiente del orden, `GENERAL_UNASSIGNED` contra 600 min (§21.3).

### 22.6 Diferencias respecto de lo propuesto en §8–§10

- Archivo `expectedShiftResolver.ts` (no `expectedShift.ts`). Fuentes agregadas `HOLIDAY_SCOPE` y `REGIME` para no mezclar motivos.
- No hay `resolveExpectedShifts(employeeIds, from, to, db)` con carga propia: cada consumidor conserva su cargador en lote (la obligación consulta una fecha para todos; Novedades, legajos × rango; la entrada, un empleado con todos los estados). Unificar la carga cambiaría consultas verificadas por tests y queda para R4, cuando la rotación necesite su propio contexto.
- La precedencia real de alertas evalúa "sin asignación aplicable" antes que SIN_TURNO y el franco al final (§10 proponía otro orden); los resultados son los mismos, pero se conserva el orden del código.

### 22.7 Tests

- `expectedShiftResolver.test.ts`: **24 tests** — bloque de asignaciones (vigencia, weekdays, estados, orden), régimen vigente, los 14 casos pedidos en ambas políticas (turno fijo, sin turno, SIN_TURNO, franco, feriado sin/con convocatoria, dos asignaciones, vigencias, weekdays, cross-midnight, deshabilitada, plantilla inactiva, empate exacto, disjuntos) y paridad con los tres consumidores.
- Los 65 tests de caracterización y los 57 del diagnóstico de R1: **verdes sin modificar ningún archivo de test**.
- Suite backend completa: **3968 tests verdes** (3944 + 24). Typecheck verde.

### 22.8 Deuda que queda para R3/R4

- **R3**: `ShiftGroup` + `ShiftTemplate.shiftGroupId` con mapeo explícito (§11, §21.4). No depende del resolver.
- **R4**: fuentes `ROTATION` (y luego `OVERRIDE`, R7) en `resolveExpectedShift` con resultado único; carga de contexto compartida para los tres consumidores; `WorkShift.shiftTemplateSource` y `resolveMatchForExit` sin exigir `ShiftAssignment` para rotaciones (P6); recálculo de cobertura por cambios de rotación.
- **R10**: decidir la política para varias asignaciones fijas (hoy reglas legacy distintas por consumidor).

---

## 23. R3-P0 — Plan de `ShiftGroup` (análisis previo a la primera migración)

Estado: **propuesta, sin implementar.** Base: `feature/shift-rotation-system` en R2 (`eade44c`). Sin cambios de schema, migraciones ni datos. Decisiones de negocio pendientes en §23.7.

### 23.1 Modelo actual relevante

- `ShiftTemplate` (schema l.1936): `id` uuid, `code @unique`, `name`, `description?`, `categoryName String?` (texto libre ≤ 60, `@@index([categoryName])`), horario/tolerancias/umbrales, `status RecordStatus` (ACTIVO/INACTIVO), `createdByUserId`/`updatedByUserId` (FK `SetNull`), `createdAt`/`updatedAt` `Timestamptz(3)`. Relaciones: `workShifts`, `assignments`, `holidayWorkAssignments`, `noveltyCoverageDays`.
- Escritores: sólo `workforceService.createShiftTemplate` / `updateShiftTemplate` / `removeShiftTemplate` (`POST/PATCH/DELETE /api/workforce/shift-templates`, RRHH) y `prisma/seed.ts` (upsert `TURNO-MANIANA`, `categoryName: "Administrativo"`). Ningún script ni migración escribe plantillas.
- Lectura del catálogo: `workforceService.shiftTemplates()` (`findMany` sin `select`, orden por `startTime`), con caché backend de 30 s (`workforce.cache.ts`, se limpia en cada escritura) y caché frontend `shiftTemplatesCatalog` (`cachePolicy.ts`).
- Convenciones de catálogos del repo: id `uuid`, `code @unique`, `status RecordStatus @default(ACTIVO)` como baja lógica, autoría FK `SetNull`, `Timestamptz(3)`, `@@index([status])`. Orden manual: un único precedente, `SalaryCategory.order Int` (sin `sortOrder` en ningún modelo). Sin `description` obligatoria en catálogos simples.

### 23.2 Usos de `categoryName`

| Capa | Archivo | Uso |
|---|---|---|
| Schema | `schema.prisma` | `categoryName String?` + `@@index([categoryName])` |
| Validación | `workforce-management/workforce.schemas.ts:54` | `z.string().trim().max(60).optional().nullable()` |
| Lectura | `shifts/shiftAssignment.repository.ts:8` | en el `select` de la plantilla de cada asignación |
| Seed | `prisma/seed.ts:460` | `"Administrativo"` |
| Diagnóstico R1 | `shifts/diagnostics/*` | B1 (sólo lectura) |
| UI | `ShiftTemplateFormFields.tsx` | campo "Categoría / tipo" (placeholder "Administrativo, Cosecha, Sereno") |
| UI | `ShiftTable.tsx` | columna "Categoría" ordenable, "Sin categoría" |
| UI | `ShiftsPage.tsx:64` | búsqueda por texto |
| UI | `ShiftDetailPage.tsx:98` | eyebrow `código · categoría` |
| UI | `EmployeeShiftsPanel.tsx:44,164` | columna y selector de turnos del legajo |
| Tipos | `workforceApiService.ts`, `shiftAssignmentApiService.ts` | campo opcional |
| Tests | `ShiftTable.test.tsx`, `HolidayWorkAssignmentsPage.test.tsx`, diagnóstico | fixtures |

Ningún cálculo de negocio (resolver R2, alertas, Novedades, horas, cierres, fichador) lee `categoryName`.

### 23.3 Modelo propuesto

```prisma
model ShiftGroup {
  id              String       @id @default(uuid())
  code            String       @unique            // "PLANTA"; editable, nunca reutilizado como clave de permisos
  name            String       @unique            // "Planta"; unicidad sin distinguir mayúsculas validada en el servicio
  sortOrder       Int          @default(0)        // orden visual; desempate por name
  status          RecordStatus @default(ACTIVO)   // baja lógica
  createdByUserId String?
  updatedByUserId String?
  createdAt       DateTime     @default(now()) @db.Timestamptz(3)
  updatedAt       DateTime     @updatedAt @db.Timestamptz(3)

  templates ShiftTemplate[]
  createdBy User? @relation("ShiftGroupCreatedBy", fields: [createdByUserId], references: [id], onDelete: SetNull)
  updatedBy User? @relation("ShiftGroupUpdatedBy", fields: [updatedByUserId], references: [id], onDelete: SetNull)

  @@index([status, sortOrder])
}

// ShiftTemplate (aditivo):
//   shiftGroupId String?
//   shiftGroup   ShiftGroup? @relation(fields: [shiftGroupId], references: [id], onDelete: Restrict)
//   @@index([shiftGroupId])
```

- **Sin `description`**: hoy no tiene uso; se agrega después si aparece la necesidad (cambio aditivo).
- **`sortOrder` en vez de `order`**: mismo concepto que `SalaryCategory.order`, sin la palabra reservada de SQL; con default para que el alta no exija pensar el orden.
- **`onDelete: Restrict`** (no `SetNull`): borrar un grupo no puede desclasificar plantillas en silencio, mismo criterio que la reorganización aplicó a `DoubleHourRule`.
- **`shiftGroupId` nullable** y sin backfill: `null` = "turno todavía no clasificado", nunca "inválido". Sigue siendo la opción correcta: ningún consumidor de negocio lee el grupo, la migración es aditiva e inerte, y el mapeo es explícito y auditado.
- `categoryName` se conserva sin cambios (etiqueta secundaria: "Sereno", "Administrativo"). Su eventual renombre visual ("Tipo") es sólo UI.

### 23.4 API propuesta (R3, sólo RRHH escribe)

Rutas nuevas en el módulo `shifts` (no es un módulo nuevo), documentadas en `BACKEND_API_CONTRACTS.md`:

| Método | Ruta | Roles | Comportamiento |
|---|---|---|---|
| GET | `/api/shifts/groups` | N1, N2, N3 | Lista ordenada por `sortOrder`, `name`; incluye `templateCount`. Filtro `status?`. |
| GET | `/api/shifts/groups/:id` | N1, N2, N3 | Detalle + plantillas del grupo. |
| POST | `/api/shifts/groups` | N1 | Alta (`code`, `name`, `sortOrder?`). 409 si `code`/`name` (sin distinguir mayúsculas) ya existen. |
| PATCH | `/api/shifts/groups/:id` | N1 | `name`, `code`, `sortOrder`, `status`. Inactivar no desclasifica plantillas. |
| DELETE | `/api/shifts/groups/:id` | N1 | Sólo sin plantillas asociadas; si no, `409 SHIFT_GROUP_IN_USE` (sugiere inactivar). Cuando existan rotaciones/alcances (R4/R8) pasa al protocolo de eliminación controlada. |
| POST/PATCH | `/api/workforce/shift-templates[/:id]` | N1 | Acepta `shiftGroupId` (uuid o `null`). Asignar exige grupo ACTIVO (conservar uno ya inactivo está permitido). No recalcula cobertura (no cambia la jornada). |
| GET | `/api/workforce/shift-templates` | todos | Agrega `shiftGroup: { id, code, name, status, sortOrder } \| null`. |

Auditoría: entidad `ShiftGroup` (CREATE/UPDATE/ACTIVATE/DEACTIVATE/DELETE) y, en la plantilla, descripción con **nombres** de grupo, nunca ids. Cachés: el catálogo de plantillas (backend 30 s y `shiftTemplatesCatalog` del frontend) se invalida también al renombrar, reordenar o inactivar un grupo.

`ShiftGroup.id` es la clave estable para R4 (`ShiftRotation.shiftGroupId`) y R8 (`UserShiftGroupScope.shiftGroupId`); nada de R3 se rediseña para eso.

### 23.5 UI propuesta (R3, sin implementar)

- **Turnos**: secciones por grupo en orden `sortOrder` → `name`, cada una con encabezado (nombre, cantidad de turnos, badge si está inactivo) y la tabla actual (`ShiftTable`) dentro. Al final, **"Sin grupo"** mientras queden plantillas sin clasificar, con un aviso que invita a clasificarlas. Grupos inactivos al final, colapsados. Secciones colapsables con el patrón ya existente (`aria-expanded` como en Alertas de Turnos), abiertas por defecto. Filtro por grupo junto a la búsqueda y al estado; la búsqueda incluye el nombre del grupo.
- `categoryName` pasa a mostrarse como chip secundario junto al nombre ("Tipo"), no como agrupador.
- **Formulario de turno**: selector "Lugar / grupo" (opcional, sólo grupos activos) además del campo de tipo.
- **Gestión de grupos** (RRHH): listado simple con alta, edición de nombre/código/orden y activar/inactivar, dentro de la Configuración de Turnos (pestaña o panel), con los componentes existentes (`Section`, `DataTable`/`TableShell`, `Badge`, `Modal`, `EmptyState`, `LoadingState`, `ErrorState`).
- **Legajo** (`EmployeeShiftsPanel`) y detalle de turno: mostrar el grupo junto a la categoría.
- Antes de implementar: lectura obligatoria de `.claude/rules/frontend-ui.md` y sus documentos/referencias, y QA en 1366×768, 1440×900, 1920×1080, tablet y mobile.

### 23.6 Mapeo de las plantillas actuales (development)

Conocido: los 9 valores de `categoryName` y cuántas plantillas tiene cada uno (§21.4). **No** se conocen todavía los códigos/nombres de cada plantilla en este documento; están en el bloque "Category values" de la salida del diagnóstico R1 ya ejecutado (código · nombre · estado por categoría). El mapeo final se completa con ese bloque; ninguna plantilla se clasifica por deducción.

| `categoryName` | Plantillas | Grupo propuesto | Confianza | Motivo |
|---|---|---|---|---|
| Planta | 2 | Planta | Alta | El valor ya es un lugar. Confirmar con nombres. |
| Taller | 2 | Taller | Alta | Ídem. |
| Granja | 2 | Granja | Media | Lugar, pero ver "Granja 02". |
| Granja 02 | 1 | **REQUIERE DECISIÓN** | — | ¿Segunda granja (lugar distinto, posiblemente con otro responsable → grupo propio) o un segundo turno de la misma granja (→ Granja)? |
| Administrativo | 2 | Oficina | Media | Es una función/área, no un lugar; la seed lo usa para "Turno Mañana". Probable "Oficina" si los nombres son Oficina-01/02. |
| Sereno | 2 | **REQUIERE DECISIÓN** (por plantilla) | — | Función, no lugar: cada sereno va al lugar donde se presta (Planta, Granja, …). |
| Medio Ambiente | 1 | **REQUIERE DECISIÓN** | — | ¿Lugar propio o área que trabaja en Planta/otro lugar? |
| Obra | 1 | **REQUIERE DECISIÓN** | — | ¿Lugar/obra transitoria con grupo propio, o pertenece a otro lugar? |
| Prueba | 2 | **REQUIERE DECISIÓN** | — | Plantillas de prueba: dejar sin grupo, o inactivar/eliminar con el procedimiento existente (decisión aparte, fuera de R3). |
| *(sin categoría)* | 0 | — | — | No hay plantillas sin `categoryName` en development. |

Total: 15 plantillas. Mapeo seguro sin decisión: hasta 6 (Planta, Taller, Granja), sujeto a confirmar con nombres; 9 requieren decisión o confirmación (Administrativo 2, Sereno 2, Granja 02, Medio Ambiente, Obra, Prueba 2).

### 23.7 Decisiones de negocio pendientes

1. Lista de grupos iniciales y su orden (propuesta: Planta, Granja, Oficina, Taller; más los que surjan de 2–4).
2. "Granja 02": ¿mismo grupo Granja o grupo propio?
3. "Medio Ambiente" y "Obra": ¿grupos propios o parte de otro lugar?
4. Cada plantilla "Sereno": ¿a qué lugar pertenece?
5. "Administrativo" → ¿grupo "Oficina"?
6. Plantillas "Prueba": ¿sin grupo, inactivar o eliminar (procedimiento aparte)?
7. Producción: ¿mismo mapeo que development? (producción no se consultó; hace falta su lista de plantillas, en sólo lectura y con autorización).

### 23.8 Estrategia de migración y subetapas

Orden revisado respecto del sugerido (crear grupos/mapear antes de tener API obligaría a escribir datos con scripts o SQL; se prefiere hacerlo por el producto, auditado):

| Subetapa | Contenido | Datos |
|---|---|---|
| **R3.1** | Migración aditiva (`<timestamp posterior a 20261117120000>_add_shift_groups`): tabla `ShiftGroup`, `ShiftTemplate.shiftGroupId` nullable + índice + FK `Restrict`. Backend: rutas de grupos, `shiftGroupId` en plantillas, serialización, auditoría, cachés, tests, contratos. Plan acordado antes de escribir `schema.prisma` (AGENTS.md). | Ninguno: tabla vacía, columna en `null`. |
| **R3.2** | UI: listado agrupado, sección "Sin grupo", gestión de grupos, selector en el formulario, grupo en legajo/detalle. QA visual. | Ninguno. |
| **R3.3** | Clasificación en **development** por RRHH desde la UI (alta de grupos + asignación plantilla por plantilla, 15 casos), con las decisiones de §23.7. Diagnóstico: verificar plantillas sin grupo (extensión de solo lectura del diagnóstico R1, opcional). | Escrituras de producto auditadas, en development. |
| **R3.4** | Producción: deploy del esquema y del código por el flujo normal (`development → main`), luego la misma clasificación por RRHH desde la UI, con autorización explícita. | Escrituras de producto auditadas. |

Sin script de backfill: con 15 plantillas, la clasificación manual por la UI es más segura (auditoría por cambio, sin acceso directo a la base) que un script con `--apply`.

Reversión de R3.1: la columna y la tabla son aditivas; con `shiftGroupId` en `null` y sin grupos, un rollback escrito a mano (`prisma/rollbacks/*.down.sql`) puede eliminarlas; si ya hay grupos o plantillas clasificadas, el rollback aborta sin cambios (regla de DATABASE_STANDARDS).

### 23.9 Compatibilidad

- Plantilla sin grupo: funciona igual en todas partes (sólo aparece en "Sin grupo").
- `ShiftAssignment`, resolver R2, fichadas, alertas, Novedades, horas y cierres no leen el grupo; `ShiftTemplateRef`/`toTemplateRef` no lo incluyen. Asignar grupo no dispara recálculo de cobertura (`affectsWorkday` no cambia).
- Ninguna plantilla se elimina, recrea ni cambia de id; `categoryName` se conserva.
- La snapshot de rendimiento del fichador (`clockPunchPerf`) no depende de columnas de `ShiftTemplate`.
- Los 65 tests de caracterización y los del resolver deben seguir verdes sin cambios.

### 23.10 Tests previstos

- **Backend (unit, Prisma mockeado)**: alta, edición, inactivación, orden (`sortOrder` + nombre), unicidad de `code`/`name` sin distinguir mayúsculas, DELETE bloqueado con plantillas, permisos (N2/N3 sólo lectura), plantilla sin grupo / con grupo / desasignar (`null`), rechazo de grupo inactivo o inexistente, serialización de `shiftGroup` en el catálogo, invalidación de cachés, auditoría sin ids en textos, ningún recálculo de cobertura al asignar grupo.
- **Integración (PostgreSQL efímero, gate de CI)**: la migración aplica sobre la historia completa y `migrate diff` queda vacío; FK `Restrict` impide borrar un grupo en uso.
- **Regresión**: caracterización R1, resolver R2, `shiftAssignment.*`, `workforce.service.test.ts`, suite completa.
- **Frontend**: grupos con varios turnos, grupo sin turnos, sección "Sin grupo" (aparece y desaparece), orden estable, grupo inactivo, filtro y búsqueda por grupo, formulario con selector, estados loading/error/empty, responsive.

### 23.11 Impacto en R4/R8

- `ShiftRotation.shiftGroupId` **obligatorio**, FK directa `Restrict`: el grupo es el alcance de administración de la rotación. Propuesta para R4: las celdas de una rotación sólo usan plantillas del mismo grupo (coherencia con permisos); decidir ahí.
- `UserShiftGroupScope(userId, shiftGroupId)` (R8) referencia `ShiftGroup.id`; inactivar un grupo deja sus alcances inertes, no los borra.
- Calendario/vista previa (R5): filtrar por grupo = personas de rotaciones del grupo ∪ personas con asignaciones fijas a plantillas del grupo. **No** se agrega `Employee.shiftGroupId`: la pertenencia de una persona se deriva de su planificación.
- Excepciones (R7): el permiso se evalúa por el grupo de la plantilla de reemplazo y de la rotación.
- Cuando existan rotaciones/alcances, la eliminación de un grupo pasa al protocolo de eliminación controlada (§ "Eliminación controlada con dependencias" de los contratos).

### 23.12 Riesgos

- Clasificación incorrecta de plantillas "funcionales" (Sereno, Administrativo) → mitigado con decisión explícita (§23.7) y auditoría.
- Duplicados por mayúsculas/espacios ("Granja"/"granja ") → unicidad validada en el servicio.
- Caché del catálogo con nombre de grupo viejo → invalidar en escrituras de grupos.
- `...input` en create/update de plantillas: `shiftGroupId` debe validarse (existencia y estado) antes de escribir; el error FK genérico (`RELATION_CONSTRAINT`) no basta para el mensaje al usuario.
- Grupo inactivo con plantillas activas: es válido (no rompe nada) pero debe verse en la UI.
- Producción puede tener plantillas distintas de development: el mapeo de producción se decide con su propia lista.

### 23.13 Archivos que se modificarían

- **R3.1**: `backend/prisma/schema.prisma`; `backend/prisma/migrations/<ts>_add_shift_groups/migration.sql`; opcional `backend/prisma/rollbacks/<ts>_add_shift_groups.down.sql`; nuevos `backend/src/modules/shifts/shiftGroup.{schemas,repository,service,controller}.ts` + tests; `backend/src/modules/shifts/shifts.routes.ts`; `backend/src/modules/workforce-management/workforce.{schemas,service,cache}.ts` (+ tests); opcional `backend/prisma/seed.ts`; `docs/BACKEND_API_CONTRACTS.md`; `docs/DATABASE_STANDARDS.md` si se agrega una regla; este ADR.
- **R3.2**: `frontend/src/services/api/workforceApiService.ts` (+ servicio de grupos), `frontend/src/services/cache/cachePolicy.ts`, `frontend/src/pages/ShiftsPage.tsx`, `frontend/src/components/shifts/{ShiftTable,ShiftTemplateFormFields}.tsx` + nuevos componentes de grupo, `ShiftDetailPage.tsx`, `ShiftCreatePage.tsx`, `EmployeeShiftsPanel.tsx`, `shiftAssignmentApiService.ts` (tipo), tests correspondientes.

### 23.14 R3.1 implementada (2026-11-19)

**Estado: R3.1 completada; R3 no.** Quedan R3.2 (UI), R3.3 (clasificación en development) y R3.4 (producción).

**Decisiones de negocio recibidas** (resuelven §23.7 salvo serenos): grupos iniciales Oficina, Planta, Granja, Taller, Medio Ambiente y Obra. Mapeo previsto para R3.3 (no aplicado): Oficina-01/02 → Oficina; Planta-01/02 → Planta; Granja-01/02/03 → Granja ("Granja 02" era un `categoryName`, no un lugar distinto); Taller-01/02 → Taller; MA-01 → Medio Ambiente; 01 Obra → Obra; Sereno-01/02 → **pendiente**; Prueba y 02Prueba → sin grupo. `categoryName` se conserva (ej.: grupo Oficina, `categoryName` "Administrativo").

**Modelo** (`schema.prisma`): `ShiftGroup { id uuid, code @unique, name @unique, sortOrder Int @default(0), status RecordStatus @default(ACTIVO), createdByUserId?/updatedByUserId? (FK User SetNull), createdAt/updatedAt Timestamptz(3), @@index([status, sortOrder]) }`; `ShiftTemplate.shiftGroupId String?` + relación `onDelete: Restrict` + `@@index([shiftGroupId])`.

**Migración** `20261119120000_add_shift_groups` — creada, **no aplicada a ninguna base**. Generada sin base con `prisma migrate diff` (datamodel de HEAD → nuevo) e inspeccionada: `ALTER TABLE "ShiftTemplate" ADD COLUMN "shiftGroupId" TEXT` (nullable, sin default), `CREATE TABLE "ShiftGroup"`, índices únicos de `code` y `name`, índices `(status, sortOrder)` y `ShiftTemplate(shiftGroupId)`, FK de autoría `SET NULL` y FK `ShiftTemplate_shiftGroupId_fkey … ON DELETE RESTRICT`. Agregado a mano (ver §23.15): índices únicos `ShiftGroup_code_lower_key` / `ShiftGroup_name_lower_key` sobre `lower(...)` y `CHECK` de forma `ShiftGroup_code_name_shape_check` (columnas NOT NULL: sin caso NULL). Sin `UPDATE`/`INSERT`/`DELETE`/`DROP`, sin tocar `categoryName` ni `ShiftAssignment`. La puerta de migraciones del CI (historial completo sobre PostgreSQL limpio + diff vacío) es la primera ejecución real.

**API** (`shifts`): `GET /api/shifts/groups?status` (N1/N2/N3), `POST`, `PATCH /:id`, `DELETE /:id` (N1). Plantillas: `shiftGroupId` en `POST/PATCH /api/workforce/shift-templates` y `shiftGroup` en el `GET`. Contrato en `BACKEND_API_CONTRACTS.md` (§ Turnos → Grupos de turnos).

**Reglas implementadas**
- Código y nombre normalizados en el schema (trim + espacios internos colapsados) y únicos sin distinguir mayúsculas en el servicio (`409 SHIFT_GROUP_DUPLICATE`); índice único como segunda defensa (P2002 → mismo 409).
- Grupo inactivo: no desclasifica; las plantillas asociadas siguen funcionando y pueden editarse conservando su grupo. Sólo se rechaza asociar un grupo inactivo **nuevo** a una plantilla (`409 SHIFT_GROUP_INACTIVE`).
- DELETE sólo sin plantillas (`409 SHIFT_GROUP_IN_USE`, sugiere inactivar), en transacción Serializable; FK `RESTRICT` como segunda defensa (P2003 → 409).
- Plantilla: `shiftGroupId` opcional; `null` desasigna; grupo inexistente → 404. Cambiar el grupo no entra en `affectsWorkday`: sin lock global ni recálculo de cobertura.
- Auditoría: `ShiftGroup` con código y nombre; en la plantilla, "Grupo: anterior → nuevo" con nombres. Nunca ids en el texto.
- Caché: escrituras de grupos y de plantillas invalidan la caché backend del catálogo de plantillas (sin capa nueva). La caché del frontend (`shiftTemplatesCatalog`) se ocupa en R3.2.

**Tests** (+ 66; suite backend 4034 verdes, typecheck verde; los 65 de caracterización R1, los 57 del diagnóstico y los 24 del resolver R2 sin cambios): `shiftGroup.service.test.ts` (listar/orden, crear, duplicados por código/nombre sin distinguir mayúsculas y por P2002, editar, reordenar, inactivar/reactivar, 404, DELETE sin uso / con plantillas / P2003, auditoría sin ids, `assertShiftGroupAssignable`); `shiftGroup.schemas.test.ts` (normalización, rangos, `shiftGroupId` en plantillas, guarda estática de la migración y de la relación `Restrict`); `shiftGroup.routes.test.ts` (router real: lectura N1/N2/N3, escritura sólo N1, validación de body/query); `shiftGroup.controller.test.ts` (invalidación de caché); `workforce-management/shiftTemplateGroup.test.ts` (catálogo con/sin grupo, alta con/sin grupo, grupo inexistente/inactivo, asignar/cambiar/desasignar sin recálculo, conservar grupo inactivo, control de que cambiar el horario sí recalcula). Sin test de integración PostgreSQL de la FK: requeriría una base clonada más en `ci.yml` (configuración compartida); queda cubierto por la puerta de migraciones del CI, la guarda estática y el mapeo de P2003.

**Diferencias respecto de R3-P0**: sin `GET /groups/:id` (no hace falta todavía: el listado trae todo; se agrega con la UI si se necesita); `sortOrder` acotado a 0–9999; CHECK de forma agregado; el seed no crea grupos.

### 23.15 Corrección previa a aplicar la migración: unicidad sin distinguir mayúsculas en la base

**Inconsistencia (real):** la regla de dominio es "código y nombre únicos sin distinguir mayúsculas", pero `@unique` en PostgreSQL distingue mayúsculas: la base aceptaba `Planta` y `PLANTA` a la vez, y dos altas concurrentes podían pasar ambas la validación previa del servicio. Además, la validación previa usaba `equals` con `mode: "insensitive"`, que en PostgreSQL puede traducirse a `ILIKE`, donde `_`, `%` y `\` del valor buscado actúan como patrón (falsos duplicados o duplicados no detectados).

**Corrección** (migración todavía no aplicada, se corrige en el mismo archivo en vez de agregar una correctiva):
- Índices únicos escritos a mano `ShiftGroup_code_lower_key ON "ShiftGroup"(lower("code"))` y `ShiftGroup_name_lower_key ON "ShiftGroup"(lower("name"))`. Se conservan los `@unique` (unicidad exacta visible para Prisma; redundancia sin costo en una tabla chica).
- El CHECK de no-vacío se reemplaza por un CHECK de forma: `"code" ~ '\S' AND "code" !~ '(^\s|\s$|\s\s)'` (ídem `name`): no vacío, sin espacios en los extremos ni repetidos. Así la base exige la misma normalización que la aplicación y una variante con espacios (" Planta", "Medio  Ambiente") no puede eludir el índice por escritura directa.
- `code` se guarda en MAYÚSCULAS (identificador canónico; la garantía de la base no depende de esto, la da `lower()`). `name` conserva sus mayúsculas.
- El servicio lee código y nombre de los demás grupos y compara con `toLowerCase()` (misma semántica que `lower()`), sin `ILIKE`.
- Concurrencia: la segunda de dos altas/ediciones equivalentes viola un índice único (23505) → Prisma `P2002` → `409 SHIFT_GROUP_DUPLICATE` (ya mapeado en alta y edición). El CHECK sólo podría violarse por escritura fuera de la aplicación (el schema produce siempre valores válidos).

**Prisma Migrate:** Prisma no modela índices funcionales ni CHECK, y no los compara en `migrate diff` (mismo caso que los CHECK y EXCLUDE escritos a mano en migraciones anteriores, que pasan la puerta del CI). Las 9 sentencias que Prisma genera para el schema están en la migración sin cambios; lo agregado a mano es invisible para el diff. La puerta del CI (historial completo sobre PostgreSQL limpio + diff vacío) es la verificación real; si marcara drift por los índices funcionales, la alternativa equivalente ya probada en el repo es `EXCLUDE USING btree (lower(...) WITH =)`. Regla general registrada en `DATABASE_STANDARDS.md` (Constraints).

**Límite conocido:** `toLowerCase()` de JavaScript y `lower()` de PostgreSQL pueden diferir en caracteres poco comunes según la colación; en ese caso la base sigue siendo la garantía final (409 por `P2002`).

### 23.16 Aplicación y validación de R3.1 en development (2026-11-19)

Autorizada por el usuario sólo para development. Producción **no** se tocó. **Desde esta aplicación `20261119120000_add_shift_groups/migration.sql` queda congelada**: cualquier cambio estructural posterior va en una migración nueva.

- **Destino**: `prisma migrate status` mostró base `neondb`, schema `public`, host `ep-gentle-resonance-aiftcbel-pooler.c-4.us-east-1.aws.neon.tech` (comprobado antes de cada operación). El `.env` declara `APP_ENV=staging` / `NODE_ENV=development` (deuda §21.5).
- **Antes**: 77 migraciones en el repo, única pendiente `20261119120000_add_shift_groups`. Rollback escrito antes de aplicar: `backend/prisma/rollbacks/20261119120000_add_shift_groups.down.sql` (aborta si hay grupos o plantillas clasificadas; no se ejecutó). Foto de sólo lectura (transacción `READ ONLY` verificada) de las 15 plantillas y de los conteos de 12 tablas funcionales.
- **Aplicación**: `npx prisma migrate deploy` → "All migrations have been successfully applied". Sin `db push`, `migrate reset`, `migrate dev` ni SQL manual.
- **Después**: `prisma migrate status` → "Database schema is up to date!"; `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code` → exit 0, "No difference detected" (los índices `lower()`, el CHECK y la FK no generan drift).
- **Plantillas**: 15 → 15, mismos ids, 0 diferencias en `code`, `name`, `categoryName`, `status` y `updatedAt`; `shiftGroupId = null` en 15/15. `ShiftGroup`: 0 filas.
- **Catálogos de PostgreSQL** (sólo lectura): FK `ShiftTemplate_shiftGroupId_fkey … ON DELETE RESTRICT`; índices `ShiftGroup_status_sortOrder_idx`, `ShiftTemplate_shiftGroupId_idx`, únicos exactos `ShiftGroup_code_key` / `ShiftGroup_name_key`, únicos funcionales `ShiftGroup_code_lower_key` (`lower(code)`) / `ShiftGroup_name_lower_key` (`lower(name)`); `ShiftGroup_code_name_shape_check`; `shiftGroupId` `text`, nullable, sin default. No se insertaron datos de prueba.
- **Verificación**: 1897 tests verdes (shifts, workforce, time-entries, novelties, employee-day-offs: incluye R1, R2 y R3.1) y typecheck verde.
- **Smoke real** (funciones del backend, sólo lectura): catálogo de 15 plantillas, todas con `shiftGroup: null`; 0 grupos; 29 asignaciones cargadas; obligación del día con 29 candidatos; jornada esperada de 29 legajos × 7 días resuelta (186 WORKDAY, 16 NO_WORK_OBLIGATION, 1 DAY_OFF), ninguna inválida por no tener grupo.
- **Datos**: conteos idénticos antes de migrar, después de migrar y después del smoke en `ShiftTemplate`, `ShiftAssignment`, `WorkShift`, `ShiftAlert`, `AttendanceInactivityIncident`, `SystemNotification`, `Novelty`, `NoveltyDayCoverage`, `TimeEntry`, `HolidayWorkAssignment`, `EmployeeDayOff` y `Employee`: ninguna fila funcional creada ni modificada; el único cambio es estructural.

### 23.17 R3.2 — UI de grupos de turnos (implementada, 2026-11-19)

**Estado: R3.1 y R3.2 completadas; R3 no.** Pendientes R3.3 (clasificación en development) y R3.4 (producción). Sólo frontend: sin cambios de backend, schema, migraciones ni datos.

**Arquitectura**
- `services/api/shiftGroupApiService.ts`: tipos estrictos (`ShiftGroup`, `ShiftGroupSummary`, entradas de alta/edición) y `list/create/update/remove`. Las mutaciones usan `silentErrors` (el error se muestra en contexto, sin el aviso global duplicado) e invalidan la familia `workforce-config`.
- `ShiftTemplate` (tipos del frontend): `shiftGroupId` y `shiftGroup: ShiftGroupSummary | null`; `ShiftTemplateInput.shiftGroupId` (null desasigna).
- `utils/shiftGroups.ts` (lógica pura): secciones, orden, filtro, etiquetas y opciones del selector.
- Componentes: `ShiftGroupSections` (secciones colapsables con `ShiftTable` dentro), `ShiftGroupsPanel` + `ShiftGroupFormModal` (gestión RRHH), `useShiftGroupsCatalog` (alta/detalle de turno).

**Pantalla Turnos** (`ShiftsPage`): pestañas "Turnos por grupo" y "Grupos". Secciones en este orden: grupos activos por `sortOrder` y nombre → "Sin grupo" → grupos inactivos (colapsados, con badge "Grupo inactivo"). Dentro de cada sección se conserva el orden del catálogo y las columnas de siempre (la categoría pasa a tono secundario). Filtro "Grupo" (todos, cada grupo, "Sin grupo") además de estado y búsqueda; la búsqueda también encuentra por nombre de grupo. Con filtros activos no se muestran grupos vacíos. Las secciones usan el patrón accesible de Alertas de Turnos (botón con `aria-expanded`/`aria-controls`).
- **Cero grupos** (estado actual de development): una sola sección "Sin grupo" con las 15 plantillas y el aviso "Aún no hay grupos configurados. Los turnos se muestran en «Sin grupo»." (RRHH: botón "Administrar grupos"; Nivel 2/3: sólo información). "Sin grupo" es un estado válido, no un error.
- **Error al cargar grupos**: los turnos se siguen mostrando agrupados con el grupo que trae cada uno (el catálogo de turnos lo incluye) y un aviso visible con "Reintentar"; nunca se oculta el error.

**Gestión de grupos (sólo RRHH)**: tabla Orden / Código / Nombre / Turnos / Estado / Acciones; alta y edición en modal (código en mayúsculas y normalizado como en el backend, nombre, orden sugerido = máximo + 10, validación en línea accesible con `FieldMessages`); la edición envía sólo los campos cambiados; activar/inactivar con confirmación que explica que los turnos no se borran ni dejan de funcionar; eliminar con confirmación. Mensajes humanos para `SHIFT_GROUP_DUPLICATE` ("Ya existe un grupo con ese código o nombre."), `SHIFT_GROUP_IN_USE` ("Este grupo tiene turnos asociados. Podés inactivarlo, pero no eliminarlo."), `SHIFT_GROUP_INACTIVE` y `SHIFT_GROUP_NOT_FOUND` (en `apiClient`, sin códigos ni ids). Nivel 2/3 ven la lista sin acciones. Permisos por grupo: R8.

**Formulario de turno** (alta y detalle): selector "Grupo (lugar)" con "Sin grupo" + grupos activos; un grupo inactivo que la plantilla ya tiene se muestra como "Nombre (inactivo)" y se puede conservar, pero nunca se ofrece como destino. `categoryName` no cambia y su ayuda aclara que es la función del turno. Si el catálogo de grupos no carga: se puede conservar el grupo actual o quitarlo (con aviso).

**Detalle del turno**: "Grupo: <nombre>" o "Grupo: Sin grupo" y "Categoría: <categoría>" cuando existe; sin ids ni null.

**Legajo** (`EmployeeShiftsPanel`): columna "Grupo" (el grupo del TURNO, resuelto con el catálogo que el panel ya carga; no es un atributo del empleado) y grupo en el selector "Agregar turno". Sin cambios de backend.

**Caché**: política `shiftGroupsCatalog` en la familia `workforce-config` (TTL 30 s, sin persistencia, igual que el catálogo de turnos). Toda mutación de grupos y de turnos invalida la familia: después de crear, editar, reordenar, activar/inactivar o eliminar un grupo, o de asignar/cambiar/quitar el grupo de un turno, ambos catálogos se vuelven a pedir sin refrescar la página. Sin capa de caché nueva.

**Responsive**: en la vista agrupada `ShiftTable` usa `layout="grouped"` (columnas de ancho fijo proporcional alineadas entre grupos, mínimo 960 px, código y horario sin corte, encabezados que cortan entre palabras), porque con el mínimo de 1180 px cada grupo mostraba su propia barra de scroll a 1366/1440. Escritorio sin scroll horizontal ni contenido recortado; en tablet y mobile cada tabla se desplaza dentro de su contenedor (estrategia estándar del sistema de tablas), sin overflow de página.

**Tests** (+44 en 6 archivos, frontend 1561 verdes, 136 archivos; `tsc -b` y `vite build` verdes): `utils/shiftGroups.test.ts` (0 grupos con las 15 plantillas reales, orden, empate por nombre, vacíos, fallback sin catálogo, filtro, etiquetas, opciones con inactivo actual); `shiftGroupApiService.test.ts` (endpoints, `silentErrors`, dedupe, invalidación cruzada de ambos catálogos, mensajes de error sin códigos ni ids); `ShiftsPage.groups.test.tsx` (0 grupos, varios grupos, orden, plegado, filtro, búsqueda por grupo, error de carga, RRHH vs Nivel 2/3); `ShiftGroupsPanel.test.tsx` (alta normalizada, validación, duplicado, edición parcial, inactivar, cancelar, eliminar en uso y sin uso, permisos); `ShiftTemplateFormFields.groups.test.tsx` (opciones, asignar y desasignar sin tocar la categoría, inactivo actual, accesibilidad de las ayudas); `EmployeeShiftsPanel.groups.test.tsx`. Los tests previos de Turnos no se modificaron. Backend R1/R2/R3.1 sin cambios y verdes.

**QA real en navegador** (Playwright, Vite local, API interceptada en el navegador, sin llamadas a ninguna base): estado real de development (15 plantillas leídas en sólo lectura, 0 grupos) y el mapeo previsto para R3.3 **simulado** en el navegador, en 1366×768, 1440×900, 1920×1080, tablet 834×1112 y 1112×834, mobile 390×844 y 320×568; además error de carga de grupos, vista Nivel 3, pestaña Grupos, modal de alta y validación, y detalle de turno. Resultado: 0 px de overflow de página, 0 contenido recortado, 0 errores de consola (salvo el 500 provocado a propósito), 0 escrituras, modales dentro de la pantalla. El legajo no se validó en navegador (requiere muchos endpoints del detalle de empleado): cubierto por test de componente. Development verificado después: 0 grupos, 15 plantillas sin grupo, conteos sin cambios.

**Diferencias respecto del plan (§23.5)**: la gestión de grupos vive en una pestaña de la pantalla Turnos (no en Configuración aparte); `categoryName` se mantiene como columna (con tono secundario) en vez de chip junto al nombre, para no romper el orden por categoría ni los tests de la tabla; se agregó el layout `grouped` de la tabla por el problema de ancho a 1366/1440.

---

## 24. R4-P0 — Diseño definitivo de rotaciones (análisis, SIN implementar)

**Estado: diseño aprobado para planificar R4; R4 NO está iniciada.** Sin cambios de `schema.prisma`, sin migraciones, sin escrituras en ninguna base, sin código ni frontend. Caso piloto: Planta. Esta sección **reemplaza** al modelo de §9, a la precedencia de §10 y a §12–§13 donde difieran; §8 sigue valiendo salvo lo indicado en §24.2.

### 24.1 Estado verificado (2026-11-20)

Rama `feature/shift-rotation-system`, HEAD `f5f0873`. Lectura de development (host `ep-gentle-resonance-aiftcbel-pooler…`) dentro de una transacción `SET TRANSACTION READ ONLY` verificada con `SHOW transaction_read_only = on`; cero escrituras.

- **R3.3 parcial** (hecha a mano por el usuario desde la UI): `OFICINA` (sortOrder 1) → Oficina-01/02 y `PLANTA` (sortOrder 2) → Planta-01/02, ambos ACTIVO. El resto de los grupos no se creó; no bloquea R4.
- **Planta-01 = Mañana** 07:00–17:00 (`crossesMidnight=false`, 600 min). **Planta-02 = Tarde** 17:00–03:00 (`crossesMidnight=true`, 600 min). Ambas: tolerancia de entrada 10/10, de salida 20/20, mínimo 420, **máximo informativo 540**, aviso de olvido 60, límite absoluto 1200.
- Sereno-01 23:00–07:00 y Sereno-02 03:00–11:00, sin grupo.
- Asignaciones fijas: legajos 19 y 20 → Planta-01 L–D desde 2026-08-31; 21 y 22 → Planta-02 L–D desde 2026-06-01; 11 y 12 → Sereno-01; 13 y 14 → Sereno-02. Ninguno tiene régimen vigente y cada uno tiene una sola asignación. Las personas reales del caso (Equipo A, Equipo B, serenos) **no existen en development**: el piloto usará esos legajos de prueba.
- 0 jornadas con Planta-01/02; 10 convocatorias de feriado con cada una.
- **Hallazgo de configuración (fuera de R4):** el máximo informativo de Planta-01/02 (540) es menor que su duración (600) ⇒ toda jornada completa genera `JORNADA_EXTENDIDA`. Requiere decisión (§24.15, pregunta 7).

### 24.2 Comparación con el diseño previo (§8–§13)

| Idea previa | Veredicto después de R2/R3 |
|---|---|
| Resolver central con `ROTATION` de resultado único | **Se mantiene.** `resolveExpectedShift` ya separa `fixedCandidates` (legacy); se agrega `shift` único. |
| `resolveExpectedShifts(employeeIds, from, to, db)` con carga propia | **Se ajusta.** R2 mostró que cada consumidor carga distinto (§22.6). Se agrega un **cargador de rotaciones en lote** (`loadRotationPlans`) que llaman los tres cargadores existentes; no un cargador único. |
| `ShiftRotation` con ciclo/ancla/vigencia en la misma fila; cambiar el ciclo = cerrar y crear otra rotación | **Se reemplaza** por identidad estable `ShiftRotation` + **`ShiftRotationVersion`** (ciclo, ancla, vigencia, grilla). Cambiar el ciclo no rompe la identidad, los equipos ni las membresías. |
| Equipos colgando de la rotación | **Se mantiene** (A/B estables entre versiones). |
| Celda ausente = descanso | **Se descarta.** Celda explícita `SHIFT` o `REST`; grilla completa obligatoria para que una versión rija; celda ausente = `ROTATION_CELL_MISSING` (error de configuración, nunca "no trabaja"). |
| `weekday` 0=domingo | **Se mantiene** (convención de `ShiftAssignment.weekdays`); la semana del ciclo se calcula aparte desde el lunes ancla. |
| `EmployeeShiftOverride` | **Diseño conservado; implementación en R7.** R4 no crea la tabla. |
| `WorkShift.shiftTemplateSource` | **Se mantiene y es necesaria** (salida); se suma `scheduledStartAt` (§24.6). |
| Precedencia §10 | **Se ajusta al orden real de R2** (§22.3): la rotación reemplaza a la "planificación" del día, no es un paso independiente (§24.4). |

### 24.3 Arquitectura

**Planificación del día.** Para (empleado, fecha operativa D) primero se determina la planificación y después se aplican franco, feriado y régimen exactamente como hoy:

```
plan(employee, D) =
  membresía vigente en D en un equipo de una rotación ACTIVA con versión vigente en D
    → ROTATION: celda(version, crew, weekIndex(D), weekday(D)) = SHIFT(template) | REST | MISSING
  si no
    → FIXED: applicableFixedAssignments (legacy, puede haber varias)
```

La rotación **reemplaza** a las asignaciones fijas de esa persona en esa fecha; nunca se mezclan. Quien no está en una rotación recorre exactamente el flujo actual (fijo, SIN_TURNO, TURNO_FLEXIBLE, sin planificación). Una persona en rotación, otra con turno fijo y otra SIN_TURNO conviven sin migrar a nadie.

**Semana del ciclo.** `weekIndex(D) = mod(floor((lunesDe(D) − anchorWeekStart) / 7), cycleLengthWeeks)` con módulo positivo, sobre fechas calendario (`@db.Date`, `argentinaCalendarDate`), sin instantes. Semana = lunes→domingo; el domingo pertenece a la semana que empezó el lunes anterior. Se descartan semana ISO, semana del año y par/impar: con años de 53 semanas ISO o al cruzar el año la paridad se rompe (p. ej. semanas 53 → 1 consecutivas con la misma paridad). El ancla + diferencia de días es independiente del año, sirve igual para ciclos de 2, 3, 4… n semanas y es una función pura testeable. Helpers nuevos en `shared/datetime/argentinaTime.ts` (único helper de fechas del repo): `mondayOfCalendarDate`, `calendarDaysBetween`.

**Componentes nuevos (R4):**
- `shifts/rotationPlan.ts` (puro): `rotationWeekIndex`, `resolveRotationCell(plans, employeeId, dateKey)`.
- `shifts/rotationPlan.loader.ts`: `loadRotationPlans(db, { employeeIds?, fromKey, toKey })` → una consulta (membresías vigentes + equipo + rotación + versiones vigentes en el rango + celdas) → mapa en memoria.
- Resolver: el input gana `rotation: RotationCell | null`; la resolución gana `shift: T | null` (único; sólo ROTATION y, en R7, OVERRIDE); `source` gana `"ROTATION"`; razones nuevas `ROTATION_REST_DAY` y `ROTATION_CELL_MISSING`.

### 24.4 Precedencia (orden real de R2 + rotación)

| Fuente | WORK_OBLIGATION (alertas) | EXPECTED_WORKDAY (Novedades) | Motivo |
|---|---:|---:|---|
| Empleado ACTIVO / plantilla ACTIVO | filtro de la consulta | — | Paridad: no se mueve al resolver. |
| Feriado sin convocatoria | 1 | 3 (IN_SCOPE) / UNRESOLVED (historia faltante) | Paridad: turno habitual (rotativo o fijo) ≠ obligación en feriado. |
| Planificación (ROTATION o FIXED) | 2 | 5 | ROTATION: SHIFT → un turno; REST → `NO_OBLIGATION (ROTATION_REST_DAY)` (0 confirmado en Novedades); MISSING → sin obligación en alertas y `UNRESOLVED (ROTATION_CELL_MISSING)` en Novedades. FIXED: sin cambios (`fixedCandidates` y desempates legacy). |
| Régimen SIN_TURNO | 3 | 4 (UNRESOLVED) | Gana sobre la rotación como defensa; además la validación impide la membresía. |
| Franco `EmployeeDayOff` | 4 | 1 | Anula la rotación en ambas políticas ⇒ `NO_OBLIGATION (DAY_OFF)`. El resultado no depende de su posición en alertas (§22.3). |
| Feriado con convocatoria | 5 (turno = planificación del día, P8) | 2 (convocatoria → planificación → horario) | Paridad: P8 no se corrige en silencio. |
| Override (R7) | después de feriado, antes de régimen | ídem | Reservado. |
| TURNO_FLEXIBLE / sin planificación / planificación que excluye el día | como hoy | como hoy | Paridad. |

### 24.5 Historia y versionado

- **Nunca se edita en el lugar algo que ya rigió.** Vigencias `effectiveFrom`/`effectiveTo` `@db.Date` inclusivas (criterio de `EmployeeWorkRegime` y `ShiftAssignment`).
- `ShiftRotationVersion` es inmutable una vez que `effectiveFrom ≤ hoy` (ciclo, ancla y grilla). Cambiar el ciclo o la grilla desde X = cerrar la vigente (`effectiveTo = X−1`) y crear una versión desde X, en una transacción. Enero queda intacto si febrero cambia. Una versión futura sí se puede editar o borrar.
- `ShiftRotationCrewMember`: alta, baja y cambio de equipo cierran una fila y abren otra; nunca se borra historia. Cambiar el Equipo A en diciembre no altera noviembre.
- Retroactivo (X < hoy): **bloqueado por defecto en R4**; habilitarlo es decisión de negocio (pregunta 6).
- Toda alta o cierre: auditoría (`auditService`, textos con código/nombre/legajo, sin ids) + `recalculateNoveltyCoverage` en la misma transacción con la nueva fuente `"SHIFT_ROTATION_CHANGED"` (union TS en `noveltyCoverageRecalculation.ts`, no enum de base), respetando períodos protegidos.

### 24.6 Modelo propuesto (no aplicado)

```prisma
enum ShiftRotationCellKind { SHIFT REST }
enum ShiftTemplateSource { FIXED_ASSIGNMENT ROTATION OVERRIDE HOLIDAY_CONVOCATION }

model ShiftRotation {                 // identidad estable ("Planta Mañana/Tarde")
  id              String       @id @default(uuid())
  code            String       @unique          // + único lower(code) y CHECK de forma (patrón ShiftGroup)
  name            String
  shiftGroupId    String                         // FK ShiftGroup Restrict; alcance (permisos en R8)
  status          RecordStatus @default(ACTIVO)  // INACTIVO ⇒ deja de resolver; no borra historia
  observation     String?
  createdByUserId String?                        // FK User SetNull
  updatedByUserId String?                        // FK User SetNull
  createdAt       DateTime     @default(now()) @db.Timestamptz(3)
  updatedAt       DateTime     @updatedAt @db.Timestamptz(3)
  @@index([shiftGroupId, status])
}

model ShiftRotationVersion {          // ciclo + ancla + vigencia; dueña de la grilla
  id               String    @id @default(uuid())
  rotationId       String                         // FK Restrict
  cycleLengthWeeks Int                            // CHECK 1..12
  anchorWeekStart  DateTime  @db.Date             // CHECK lunes (isodow = 1)
  effectiveFrom    DateTime  @db.Date
  effectiveTo      DateTime? @db.Date             // CHECK effectiveTo >= effectiveFrom
  createdByUserId  String?                        // FK User SetNull
  createdAt        DateTime  @default(now()) @db.Timestamptz(3)
  @@index([rotationId, effectiveFrom])
  // EXCLUDE gist (rotationId WITH =, daterange(effectiveFrom, effectiveTo, '[]') WITH &&)
}

model ShiftRotationCrew {             // "A", "B": estables entre versiones
  id         String       @id @default(uuid())
  rotationId String                               // FK Restrict
  code       String
  name       String
  sortOrder  Int          @default(0)
  status     RecordStatus @default(ACTIVO)
  @@unique([rotationId, code])
}

model ShiftRotationCrewMember {       // historia de pertenencia
  id              String    @id @default(uuid())
  crewId          String                          // FK Restrict
  employeeId      String                          // FK Employee Restrict
  effectiveFrom   DateTime  @db.Date
  effectiveTo     DateTime? @db.Date              // CHECK effectiveTo >= effectiveFrom
  createdByUserId String?                         // FK User SetNull
  closedByUserId  String?                         // FK User SetNull
  createdAt       DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt       DateTime  @updatedAt @db.Timestamptz(3)
  @@index([employeeId, effectiveFrom])
  @@index([crewId])
  // EXCLUDE gist (employeeId WITH =, daterange(effectiveFrom, effectiveTo, '[]') WITH &&):
  // una sola membresía de rotación por persona y fecha, en TODAS las rotaciones.
}

model ShiftRotationSlot {             // celda de la grilla
  id              String                @id @default(uuid())
  versionId       String                          // FK Cascade (la grilla es parte de la versión)
  crewId          String                          // FK Restrict
  cycleWeekIndex  Int                             // 0..cycleLengthWeeks-1 (servicio; CHECK >= 0)
  weekday         Int                             // 0=domingo..6 (CHECK 0..6)
  kind            ShiftRotationCellKind
  shiftTemplateId String?                         // FK ShiftTemplate Restrict
  // CHECK ((kind = 'SHIFT') = (shiftTemplateId IS NOT NULL))
  @@unique([versionId, crewId, cycleWeekIndex, weekday])
  @@index([shiftTemplateId])
}

// WorkShift (aditivo, nullable; null = jornada histórica ⇒ lógica actual):
//   shiftTemplateSource ShiftTemplateSource?
//   scheduledStartAt    DateTime? @db.Timestamptz(3)   // instante de la ocurrencia adoptada
```

Migración R4.1 puramente aditiva: tablas vacías, dos enums y dos columnas nullable; sin backfill ni cambio de comportamiento; `btree_gist` ya existe (patrón de `20261008090000_labor_history_periods`); rollback `.down.sql` como en R3.1. `ShiftAssignment` no cambia.

### 24.7 Impacto por consumidor

- **Entrada** (`workShiftEvaluationRunner.ts` `loadMatchingContext`/`evaluateShiftEntry`; `workShiftEvaluation.service.ts` `matchShiftForEmployee`). Si la persona tiene membresía en D−1..D+1 (D = día calendario de la fichada): candidatos = celdas SHIFT de esas fechas operativas con **instante concreto** (`scheduledInstantForShiftTime(argentinaDayRange(d).startAt, startTime)`); gana la más cercana y `differenceMinutes` se mide contra ese instante. No se consideran asignaciones fijas ni plantillas ajenas: quien está de Tarde nunca matchea Mañana. Tolerancias, `INGRESO_TARDE`/`INGRESO_ANTICIPADO` y el umbral de 240 min no cambian. Como hoy con los fijos, la entrada no aplica franco ni feriado (paridad A2/A4). Sin celda SHIFT en la ventana ⇒ `NO_MATCH` (`TURNO_NO_IDENTIFICADO`, suprimible por régimen), igual que un fijo que no aplica ese día. Adopta `shiftTemplateId`, `maxAllowedMinutes`, `shiftTemplateSource = ROTATION` y `scheduledStartAt`. Para los fijos se escribe además `FIXED_ASSIGNMENT`, sin tocar su lógica. Resuelve P9 para rotaciones.
- **Salida** (`resolveMatchForExit`, `evaluateExitPunctuality`, `evaluateOutOfShiftWorkday`). Con `shiftTemplateSource ∈ {ROTATION, OVERRIDE}` ⇒ `ENABLED` sin exigir `ShiftAssignment` (resuelve P6) y salida programada = `scheduledStartAt` + duración del turno (no `startAt` real: un ingreso tardío pasada la medianoche no corre la salida un día). Con `null` o `FIXED_ASSIGNMENT` el código actual queda intacto, incluido §21.3. Sin migración de históricos.
- **WorkShift.** `shiftTemplateSource` es necesaria: la salida no puede recalcular la rotación (la configuración puede cambiar entre ingreso y salida); congela la decisión y deja trazabilidad de por qué se adoptó el turno. Enum: sí, valores cerrados. `scheduledStartAt` congela la ocurrencia ⇒ salida y fecha operativa determinísticas; `workShiftOperationalDateKey` la usa cuando existe, si no la lógica actual.
- **Obligación, falta de ingreso, inactividad** (`workObligation.service.ts`, `missingEntry.service.ts`, `attendanceInactivity.service.ts`). `resolveWorkObligationCandidates(D)` suma una consulta en lote a `loadRotationPlans`; universo = empleados con fijo aplicable ∪ miembros vigentes. ROTATION ⇒ un candidato con su `scheduledStartAt` (Tarde: vence 17:10; nada a las 07:10). `findEmployeeIdsWithMatchingEntryEvidence` (ocurrencia más cercana = `scheduledStartAt`) funciona sin cambios. La inactividad hereda el universo; la ventana de evidencia del día calendario sirve para 07:00 y 17:00 (P10 sigue documentado).
- **Olvido de salida y vencimiento** (`openShiftMonitor.service.ts`, `expireOpenWorkShifts`): sin cambios; usan el turno adoptado.
- **Novedades** (`expectedWorkday.ts`). `EmployeeWorkdayContext` gana `rotation` (misma tanda, `loadRotationPlans`); `projectExpectedWorkday` con `source = ROTATION` ⇒ minutos de **un** turno (`shiftTemplateExpectedMinutes`), `shiftTemplateIds = [id]`, nuevo `WorkdaySource "SHIFT_ROTATION"`; REST ⇒ 0 confirmado. FIXED sigue con `expectedMinutesForTemplates` (P2/P3 legacy hasta R10). Semana Mañana 600 y semana Tarde 600, nunca 1200.
- **Recálculo de cobertura.** Membresías, versiones y estado de la rotación lo disparan (personas afectadas × ventana). `recalculateTemplateCoverage` (`workforce.service.ts`) se extiende a los miembros cuyas celdas usan la plantilla modificada.
- **Candidatos de feriado** (`holidayWorkAssignment.repository.ts`): sin cambio en R4; en R5 mostrar el turno resuelto.
- **Sin cambios:** PWA del fichador, clasificación de conceptos horarios, cierres.

### 24.8 Cruce de medianoche (17:00 → 03:00)

La celda pertenece a la fecha de inicio. Lunes Tarde: `scheduledStartAt` lunes 17:00, fin martes 03:00. Entrada: candidato "lunes" dentro de D−1..D+1. Salida del martes 02:55: contra `scheduledStartAt` + 600. Falta de ingreso y Novedades: `dateKey` = lunes. Vencimiento: `maxAllowedMinutes` desde `startAt` (sin cambios). Fecha operativa y reportes: lunes, vía `scheduledStartAt`. Validación de grilla: superposición entre la celda de D y la de D+1 del mismo equipo, incluido domingo→lunes y última semana del ciclo → semana 0, es error; descanso corto, advertencia.

### 24.9 Feriados y francos

- **Comportamiento actual (fijos):** feriado sin convocatoria ⇒ sin obligación. Convocado ⇒ alertas con el turno habitual (no el de la convocatoria, P8); Novedades con convocatoria → planificación → horario. Convocado sin planificación aplicable ⇒ alertas sin obligación (P8).
- **R4 (rotación):** idéntico, con "celda de rotación" en lugar de "turno habitual". Convocado un día REST ⇒ alertas sin obligación (igual que un fijo sin planificación ese día).
- **Recomendación futura (decisión del negocio):** si la convocatoria tiene `shiftTemplateId`, que gane en todos los consumidores.
- **Franco:** gana sobre la rotación en ambas políticas ⇒ `NO_OBLIGATION (DAY_OFF)`.

### 24.10 Excepciones (R7) y serenos

- **Overrides:** sin estructura en R4. Quedan reservados la fuente `OVERRIDE` del resolver y de `ShiftTemplateSource`, su lugar en la precedencia y el diseño de `EmployeeShiftOverride` (§9/§13, con `kind REPLACE_SHIFT | NO_OBLIGATION | WORK_SHIFT`; intercambio = dos overrides con `swapGroupId`). Mientras tanto, "no trabaja excepcionalmente" se cubre con un franco. Ningún cambio puntual exige editar la rotación.
- **Serenos (no en el piloto):** cada persona es una membresía; su equipo tiene grilla completa de ciclo 2 (semana con FDS: V/S/D "Sereno FDS 19–07"; semana sin FDS: horario habitual 03–11 o 07–15, o REST). Representa rotación + horario habitual + FDS alternado sin varias `ShiftAssignment`. El conflicto domingo 19:00→lunes 07:00 contra lunes 03:00–11:00 lo detecta la validación de superposición entre días consecutivos: no se puede activar hasta que el negocio decida. **DECISIÓN DE NEGOCIO PENDIENTE.**
- **Fin de semana de Planta:** se representa con celdas S/D de cada semana de cada equipo (otra plantilla si el horario difiere; ciclo de 4 semanas si no todas las semanas de Mañana trabajan el FDS). **DECISIÓN DE NEGOCIO PENDIENTE** (pregunta 3); el diseño no depende de ella.

### 24.11 Validaciones

| Validación | Dónde |
|---|---|
| Persona en dos membresías superpuestas (cualquier rotación) | DB (EXCLUDE) + servicio (mensaje humano) |
| Dos celdas para la misma versión/equipo/semana/día | DB (unique) + servicio |
| `cycleWeekIndex` fuera de 0..n−1; `weekday` fuera de 0..6 | Servicio + CHECK (≥ 0; 0..6) + UI |
| `SHIFT` sin plantilla o `REST` con plantilla | DB (CHECK) + servicio |
| Plantilla INACTIVA o de otro `ShiftGroup` | Servicio + UI (filtra) |
| Ancla ausente o no lunes; ciclo fuera de 1..12 | DB (NOT NULL + CHECK) + servicio |
| Versiones superpuestas de una rotación | DB (EXCLUDE) + servicio |
| Grilla incompleta (≠ equipos × semanas × 7) | Servicio (no puede regir); resolver: `ROTATION_CELL_MISSING` como defensa |
| Superposición entre celdas consecutivas (incl. cambio de semana/ciclo) | Servicio (error); descanso corto: advertencia en preview |
| Miembro con `ShiftAssignment` HABILITADA superpuesta | **Opción C:** el servicio bloquea (409 con detalle) y ofrece `closeFixedAssignmentsFrom` explícito que las cierra en la misma transacción con auditoría; `shiftAssignment.service` bloquea lo inverso; el resolver hace ganar a la rotación como defensa |
| Miembro con régimen SIN_TURNO vigente | Servicio bloquea; resolver: SIN_TURNO gana |
| Cambio retroactivo o edición de una versión ya vigente | Servicio bloquea (R4) |
| Membresía fuera de la vigencia de la rotación | Servicio |

### 24.12 API propuesta (convenciones reales: `/api/shifts` + `requireAnyRole` + `validateBody` + `asyncHandler`)

Lectura: todos los roles autenticados del módulo; escritura: RRHH (alcance por grupo en R8).
- `GET/POST /api/shifts/rotations`; `GET/PATCH /api/shifts/rotations/:id` (nombre, observación, `status`); `DELETE` sólo si nunca tuvo una versión vigente.
- `POST /rotations/:id/crews`; `PATCH /rotations/:id/crews/:crewId`.
- `POST /rotations/:id/versions` (ciclo, ancla, `effectiveFrom` y grilla completa en un solo body; cierra la anterior en la misma transacción); `GET /rotations/:id/versions/:versionId`; `PATCH`/`DELETE` sólo de versiones futuras.
- `POST /rotations/:id/crews/:crewId/members` (`employeeId`, `effectiveFrom`, `closeFixedAssignmentsFrom?`); `POST /rotations/:id/members/:memberId/close` (`effectiveTo`); `POST /rotations/:id/members/:memberId/move` (cerrar + alta en una transacción).
- **Preview de sólo lectura** (R4.6/R5): `GET /api/shifts/expected?employeeIds|groupId|rotationId&from&to` (≤ 42 días) → por persona y fecha `{ obligation, source (ROTATION | FIXED_ASSIGNMENT | DAY_OFF | HOLIDAY_NOT_CONVOKED | HOLIDAY_CONVOCATION | REGIME | NONE), reason, template {code, startTime, endTime} | null, scheduledStartAt, scheduledEndAt, expectedMinutes, warnings[] }`; variante borrador `POST /api/shifts/rotations/preview` con una versión sin guardar.
- Contratos en `docs/BACKEND_API_CONTRACTS.md` en la misma etapa que los implemente.

### 24.13 Performance (objetivo: ~100 fichadas en pocos minutos)

- Entrada: +1 consulta indexada por fichada (`CrewMember(employeeId, effectiveFrom)` con `include` de equipo, rotación, versión y celdas para D−1..D+1); hoy ya hace 2. Sin N+1.
- Job de 60 s (falta de ingreso), inactividad diaria y catch-up: +1 consulta en lote por corrida, nunca por persona.
- Novedades: +1 consulta por tanda de `loadEmployeeWorkdayContext`.
- Sin caché nueva en R4; si hiciera falta, `backend/src/shared/cache/ttlCache` con invalidación en escrituras. `docs/PERFORMANCE_STANDARDS.md` se lee antes de R4.3/R4.4.

### 24.14 Plan R4 (cada subetapa con tests y `typecheck`/`test`/`build` verdes; los 65 tests de caracterización sin modificar)

| Etapa | Contenido | Esquema | Cambia comportamiento |
|---|---|---|---|
| R4.1 | Schema + migración aditiva (5 tablas, 2 enums, 2 columnas nullable en `WorkShift`, CHECK/EXCLUDE/índices) + rollback; sin uso en código. Validación en base limpia como CI; aplicar en development sólo con autorización | Aditivo | No |
| R4.2 | Núcleo puro: `rotationWeekIndex`, `resolveRotationCell`, resolver con `ROTATION`/`shift` + tests (cambio de año, ancla pasada/futura, ciclos 2/3/4, domingo→lunes) | No | No (sin datos) |
| R4.3 | `loadRotationPlans` + obligación/falta de ingreso/inactividad + Novedades + recálculo de cobertura | No | Sólo miembros (ninguno) |
| R4.4 | Entrada/salida/`WorkShift` (`shiftTemplateSource`, `scheduledStartAt`, `resolveMatchForExit`, fecha operativa) | No | Sólo miembros |
| R4.5 | API de configuración + validaciones + auditoría + contratos | No | — |
| R4.6 | Endpoint de preview de sólo lectura | No | No |
| R4.7 | UI básica de rotaciones (`frontend-ui.md`) | No | — |
| R4.8 | Piloto Planta en development (legajos 19–22, cierre de sus fijos con la opción del alta) + QA | Datos dev | Sólo piloto |

Producción: etapa aparte con autorización explícita.

**Archivos de R4.1:** `backend/prisma/schema.prisma`; `backend/prisma/migrations/<ts>_add_shift_rotations/migration.sql`; `backend/prisma/rollbacks/<ts>_add_shift_rotations.down.sql`; esta ADR. Sin código de aplicación.

### 24.15 Criterio de éxito del piloto Planta

Fixture: rotación PLANTA, ciclo 2, ancla lunes 2026-11-23; A = {19, 20}, B = {21, 22}; semana 0: A = Planta-01 L–V, B = Planta-02 L–V; S/D parametrizados hasta la decisión.

1. A, semana 0 (lunes 23/11): obligación 07:00 (vence 07:10); entrada 07:05 → Planta-01 sin alerta; 07:25 → `INGRESO_TARDE`; salida contra 17:00 ±20; Novedades 600; falta de ingreso a las 07:10 si no fichó.
2. A, semana 1 (lunes 30/11): ningún incidente a las 07:10; obligación 17:00; entrada 16:55 → Planta-02 (nunca Planta-01; una entrada a las 11:30 queda sin bloque, fuera de ventana — corregido en R4.4, §25.6); salida del martes contra 03:00; fecha operativa lunes; Novedades 600 (no 1200).
3. Domingo 29/11 → lunes 30/11 cambia de semana sin editar nada; lunes 2027-01-04 conserva la alternancia tras el cambio de año.
4. B es el inverso de A en ambas semanas.
5. Empleado fijo de Oficina: resultados idénticos (caracterización verde sin tocar).
6. SIN_TURNO idéntico; un miembro con SIN_TURNO ⇒ sin obligación.
7. Franco sobre una celda Tarde ⇒ `DAY_OFF` en alertas y Novedades.
8. Feriado sin convocatoria sobre una celda Mañana ⇒ sin obligación; convocado ⇒ obligación con la celda (alertas) y convocatoria → celda (Novedades).
9. REST explícito ⇒ 0 confirmado; celda faltante ⇒ UNRESOLVED / sin obligación.
10. Alta de miembro con fijo superpuesto ⇒ bloqueada; con datos inconsistentes forzados, gana la rotación.
11. Salida de jornada ROTATION sin `ShiftAssignment` ⇒ `ENABLED` con puntualidad; jornadas históricas (`source = null`) idénticas.
12. Versión nueva desde X y cambio de equipo desde X no alteran nada antes de X.
13. Ingreso tardío 00:30 en Tarde ⇒ salida programada martes 03:00 (no miércoles).

### 24.16 Riesgos

- Entrada y salida están en el camino crítico de las fichadas: fuente nullable y rama legacy intacta, tests de paridad.
- Recálculo de cobertura al activar o cambiar rotaciones: ventanas acotadas y períodos protegidos.
- Restricciones EXCLUDE en la migración: patrón existente, validado en base limpia como CI.
- Convivencia temporal fijo + rotación durante el piloto: Opción C.
- Máximo informativo 540 en Planta ⇒ `JORNADA_EXTENDIDA` en cada jornada completa.
- Semana con inicio lunes y `weekday` 0=domingo: tests de borde explícitos.

### 24.17 Decisiones

**Técnicas, ya tomadas en este diseño (salvo objeción):** versión separada de la rotación; celdas explícitas SHIFT/REST; Opción C (validar + resolver determinístico); `shiftTemplateSource` + `scheduledStartAt` en `WorkShift`; overrides en R7; sin caché nueva; retroactivo bloqueado por defecto; ancla lunes + diferencia de días.

**De negocio, pendientes:**
1. ¿La semana del ciclo es lunes→domingo, con sábado y domingo dentro de la semana que empezó ese lunes?
2. ¿Qué lunes es la "Semana 1" (Equipo A de Mañana) del piloto?
3. Fin de semana de Planta: ¿qué días (S, D, ¿V?)?, ¿qué horario (Planta-01 u otra plantilla)?, ¿todas las semanas de Mañana o algunas?, ¿el equipo de Tarde descansa S/D?
4. Serenos: si un sereno hace domingo 19:00 → lunes 07:00, ¿qué pasa con su lunes 03:00–11:00? ¿Cuál es el horario exacto del FDS?
5. Feriado convocado: ¿manda el turno de la convocatoria o la celda de la rotación? (hoy alertas y Novedades difieren, P8).
6. ¿Se permiten cambios retroactivos de rotación o membresía? ¿Quién y hasta qué período?
7. Planta-01/02: ¿se corrige el máximo informativo 540 frente a turnos de 600?

**Cerradas por el usuario (2026-11-20, antes de R4.1):** 1 → sí, lunes→domingo, con sábado y domingo dentro de la semana que empezó ese lunes. 2 → el lunes **2026-11-23** es la Semana 1 del piloto (dato de tests; no se carga en la base en R4.1). 5 → una convocatoria explícita **con turno** podrá ganar sobre la rotación; sin turno, cae al turno planificado (lógica a implementar después, no en R4.1). 6 → en R4 los cambios retroactivos se bloquean por defecto. Siguen pendientes 3 (fin de semana de Planta), 4 (serenos) y 7; ninguna bloquea R4.1.

### 24.18 R4.1 — Schema + migración aditiva e inerte (implementada, NO aplicada)

**Estado: migración creada y validada en local; NO aplicada a development ni a producción.** R4 no está completa. Sin lógica: no hay lectores ni escritores de las tablas nuevas, ni cambios en el resolver, consumidores, API ni frontend. Con las tablas vacías el comportamiento es idéntico.

**Archivos:** `backend/prisma/schema.prisma`; `backend/prisma/migrations/20261120120000_add_shift_rotations/migration.sql`; `backend/prisma/rollbacks/20261120120000_add_shift_rotations.down.sql`; `backend/src/modules/shifts/shiftRotation.migration.test.ts`. La migración de R3.1 (`20261119120000_add_shift_groups`) no se tocó.

**Modelo implementado** (§24.6, con las diferencias de abajo):
- Enums `ShiftRotationCellKind { SHIFT, REST }` y `ShiftTemplateSource { FIXED_ASSIGNMENT, ROTATION, OVERRIDE, HOLIDAY_CONVOCATION }`.
- `ShiftRotation` (code, name, shiftGroupId obligatorio, status, observation, autoría, timestamps); `ShiftRotationVersion` (cycleLengthWeeks, anchorWeekStart, effectiveFrom/To `@db.Date`, autoría, timestamps); `ShiftRotationCrew` (code, name, sortOrder, status, autoría, timestamps); `ShiftRotationCrewMember` (crewId, employeeId, effectiveFrom/To, createdBy/closedBy, timestamps); `ShiftRotationSlot` (versionId, crewId, cycleWeekIndex, weekday, kind, shiftTemplateId nullable).
- `WorkShift.shiftTemplateSource ShiftTemplateSource?` y `WorkShift.scheduledStartAt DateTime? @db.Timestamptz(3)`, sin default, sin backfill y sin índice (todavía no existe una consulta que lo justifique). No se agregó `scheduledEndAt`: se deriva del inicio y de la duración de la plantilla.
- Relaciones inversas: `ShiftGroup.rotations`, `ShiftTemplate.rotationSlots`, `Employee.shiftRotationMemberships` y ocho relaciones de autoría en `User` con nombre explícito (`ShiftRotation*CreatedBy/UpdatedBy`, `ShiftRotationCrewMemberCreatedBy/ClosedBy`). `prisma format` sólo realineó espacios dentro de `WorkShift`.

**Diferencias respecto de §24.6:**
- `ShiftRotationVersion` suma `updatedByUserId`/`updatedAt`: una versión futura sí se puede editar (§24.5).
- `ShiftRotationCrew` suma autoría y timestamps (convención de `ShiftGroup`: los equipos se renombran o inactivan).
- `ShiftRotation.name` sin unicidad ni CHECK; sólo el código tiene unicidad fuerte.
- CHECK de forma en `ShiftRotation.code` y `ShiftRotationCrew.code` (regla de `DATABASE_STANDARDS.md` para unicidad sin mayúsculas).
- `cycleWeekIndex` con cota global `BETWEEN 0 AND 11` (el máximo de 12 semanas) en vez de sólo `>= 0`; la cota exacta (< `cycleLengthWeeks` de su versión) la valida el servicio.
- `ShiftRotationSlot` sin autoría ni timestamps: la grilla es parte de su versión, que ya los tiene.
- Sin índice propio sobre `ShiftRotationSlot.crewId`: el único acceso por equipo es la comprobación del RESTRICT al borrar un equipo (operación rara sobre una tabla chica). El acceso por versión lo cubre el único.

**Constraints escritos a mano** (Prisma no los modela ni los compara en `migrate diff`; documentados en comentarios de cada modelo):

| Constraint | Regla |
|---|---|
| `ShiftRotation_code_lower_key` | `UNIQUE (lower(code))` |
| `ShiftRotationCrew_rotationId_code_lower_key` | `UNIQUE (rotationId, lower(code))`, nunca global |
| `ShiftRotation_code_shape_check`, `ShiftRotationCrew_code_shape_check` | al menos un carácter visible, sin espacios en los extremos ni repetidos |
| `ShiftRotationVersion_cycle_length_check` | `cycleLengthWeeks BETWEEN 1 AND 12` |
| `ShiftRotationVersion_anchor_monday_check` | `EXTRACT(ISODOW FROM anchorWeekStart) = 1` (sobre `DATE`, sin huso) |
| `ShiftRotationSlot_cycle_week_index_check` | `cycleWeekIndex BETWEEN 0 AND 11` |
| `ShiftRotationSlot_weekday_check` | `weekday BETWEEN 0 AND 6` (0 = domingo) |
| `ShiftRotationSlot_kind_template_check` | `(SHIFT AND plantilla) OR (REST AND sin plantilla)` |
| `ShiftRotationVersion_interval_check`, `ShiftRotationCrewMember_interval_check` | `effectiveTo IS NULL OR effectiveTo >= effectiveFrom` |
| `ShiftRotationVersion_no_overlap` | `EXCLUDE USING gist (rotationId WITH =, daterange(effectiveFrom, effectiveTo, '[]') WITH &&)` |
| `ShiftRotationCrewMember_no_overlap` | `EXCLUDE USING gist (employeeId WITH =, daterange(...) WITH &&)`: **global por persona**, en todas las rotaciones |

Rangos abiertos: `daterange(from, NULL, '[]')` no tiene límite superior, así que una vigencia abierta se superpone con cualquier vigencia posterior; `'[]'` hace inclusivos ambos extremos (empezar el mismo día en que termina otra es superposición; el día siguiente, no). Es el mismo patrón que `20261008090000_labor_history_periods`. `CREATE EXTENSION IF NOT EXISTS btree_gist` es un no-op: la extensión existe desde M1.

**FKs:** RESTRICT hacia `ShiftGroup`, `ShiftTemplate`, `Employee`, rotación y equipo; autoría `SET NULL` hacia `User`. **Única cascada:** `ShiftRotationSlot.versionId → ShiftRotationVersion` (`ON DELETE CASCADE`), porque la grilla es parte de su versión y sólo se podrá borrar una versión futura, nunca vigente (servicio, R4.5). Que el equipo de una celda pertenezca a la misma rotación que su versión lo valida el servicio: la base no puede cruzar tablas en un CHECK.

**SQL de la migración** (aditivo): 2 `CREATE TYPE`, 1 `ALTER TABLE "WorkShift" ADD COLUMN` (×2 nullable), 5 `CREATE TABLE`, 8 índices generados + 2 únicos `lower()`, 16 FKs, 9 CHECK y 2 EXCLUDE. Sin `UPDATE`, `INSERT`, `DELETE`, `DROP`, `ALTER COLUMN` ni `RENAME`; no toca `ShiftAssignment` ni modifica columnas de `ShiftTemplate`, `ShiftGroup`, `Employee` o `User`. El cuerpo generado es exactamente `prisma migrate diff --from-schema-datamodel <schema de HEAD> --to-schema-datamodel prisma/schema.prisma --script` (offline, sin base); el bloque manual va al final.

**Rollback** (`prisma/rollbacks/20261120120000_add_shift_rotations.down.sql`, no ejecutado sobre ninguna base compartida): una transacción, `LOCK ... IN ACCESS EXCLUSIVE MODE` de las cinco tablas y de `WorkShift`, y aborto sin cambios si hay cualquier fila en las cinco tablas o alguna jornada con `shiftTemplateSource` o `scheduledStartAt` cargados. Después borra las columnas de `WorkShift`, las tablas en orden de dependencia y los enums. No usa `CASCADE`, no borra filas ni la extensión.

**Validación:**
- Tests estáticos `shiftRotation.migration.test.ts`: 29 (migración aditiva, enums, tablas, cada CHECK/EXCLUDE/índice/FK, una sola cascada, columnas de `WorkShift` sin default, relaciones y `onDelete` del schema, autoría `SetNull`, rollback con guardas antes de cualquier `DROP`).
- **PostgreSQL 18 local** (Postgres.app, misma versión mayor que el CI; bases descartables `r41_*` creadas y eliminadas, sin datos reales, sin Neon): historial completo con `scripts/ci/migrate-clean-database.ts` (78 migraciones, `migrate status` al día, `migrate diff` contra `schema.prisma`: **No difference detected**). 58 comprobaciones de comportamiento con datos sintéticos, todas OK: unicidad exacta y sin mayúsculas, forma, grupo obligatorio, ciclo 0/13 rechazado y 12 aceptado, ancla martes/domingo rechazada, intervalos invertidos, versión abierta + posterior rechazada, versiones contiguas aceptadas, empezar el último día de otra rechazado, misma persona en otro equipo de la misma rotación **y de otra rotación** rechazada, cambio de equipo con cierre aceptado, SHIFT sin plantilla / REST con plantilla / `MISSING` / día 7 / semana 12 rechazados, celda duplicada rechazada, RESTRICT al borrar grupo, plantilla, empleado, equipo o rotación usados, cascada que sólo borra las celdas de la versión borrada, `WorkShift` nueva con columnas `NULL` y valor de enum inválido rechazado.
- Rollback en local: con datos aborta y deja todo intacto; con una sola jornada con `scheduledStartAt` aborta; sobre la base limpia revierte y `migrate diff` contra el schema anterior a R4.1 da **No difference detected** (`btree_gist` se conserva).
- `prisma validate` y `typecheck` verdes con el cliente regenerado (ningún mock necesitó cambios); `build` verde; suite backend completa **4074 tests verdes** (229 archivos; 15 suites de integración opcionales omitidas como siempre); caracterización R1 65/65 y resolver R2 24/24 sin modificar.

**Riesgos y pendientes:**
- **Cliente Prisma vs development:** con el cliente regenerado, toda lectura de `WorkShift` sin `select` pide las dos columnas nuevas, que en development no existen hasta `migrate deploy`. Un backend que corra el cliente nuevo contra development antes de aplicar la migración falla al leer jornadas. Desplegar la migración antes (o junto con) cualquier código generado desde este schema.
- RESTRICT de PostgreSQL responde `23001` (`restrict_violation`), no `23503`. R4.5 debe mapear el error de Prisma a mensajes de dominio y comprobarlo con un test (borrar un grupo con rotaciones, una plantilla usada por celdas: hoy `shiftGroup.service` y `removeShiftTemplate` no cuentan esos usos).
- `ShiftRotationSlot.crewId` de otra rotación que la versión y `cycleWeekIndex ≥ cycleLengthWeeks` sólo los impide el servicio (R4.5).
- `migrate deploy` en development: pendiente de autorización.

**Antes de autorizar `migrate deploy` en development:** revisar el SQL completo; verificar el host con `migrate status` (línea Datasource) y que la única pendiente sea `20261120120000_add_shift_rotations`; respaldo según el runbook; aplicar con `migrate deploy` (nunca `db push` ni `migrate dev`); después `migrate status` al día y `migrate diff --from-schema-datasource … --exit-code` vacío; conteos de `WorkShift` y de las tablas nuevas (0) sin cambios; reiniciar el backend local con el cliente nuevo y comprobar que lee jornadas.

**Queda para R4.2:** núcleo puro, sin base: helpers de fecha (`mondayOfCalendarDate`, `calendarDaysBetween` en `argentinaTime.ts`), `rotationWeekIndex` (ancla lunes 2026-11-23, módulo positivo, cambio de año, ciclos 1–12), `resolveRotationCell` (SHIFT / REST / celda faltante) y la fuente `ROTATION` en `resolveExpectedShift` con `shift` único y razones `ROTATION_REST_DAY`/`ROTATION_CELL_MISSING`, con tests; sin cargador, consumidores, entrada/salida ni API.

### 24.19 Aplicación y validación de R4.1 en development (2026-11-20)

**Estado: R4.1 CERRADA.** Migración aplicada en development e inerte. Producción y demo no se tocaron. Sin push.

- **Destino:** `prisma migrate status` desde `backend/` → Datasource `neondb` en `ep-gentle-resonance-aiftcbel-pooler.c-4.us-east-1.aws.neon.tech` (rama Neon `development`, `br-dark-resonance-aib3a9t0`). 78 migraciones; la única pendiente era `20261120120000_add_shift_rotations`. La migración y el rollback coincidían byte a byte con `438bc2f` (SHA-256 `7f896ba0…ea73` y `c8755dc9…6427`).
- **Protección previa:** (1) rama hija de Neon `development-a8-backup-20261120` (`br-weathered-heart-ai1ormx0`, LSN `0/1FB14E30`, sin compute), creada con `scripts/org-reorg/neon-admin.ts scripts/org-reorg-branch-backup.ts --apply` después de su modo plan (el prefijo "a8" lo pone el script); (2) snapshot lógico de `WorkShift` (92 filas, columnas originales) en un JSON fuera del repositorio, con SHA-256; (3) rollback validado en local (§24.18), no ejecutado. No se hizo `pg_dump` completo: el cambio es aditivo y la rama Neon conserva una copia completa restaurable.
- **Aplicación:** `npx prisma migrate deploy` (sin `db push`, `migrate dev`, `migrate reset` ni SQL manual) → "Applying migration `20261120120000_add_shift_rotations`… All migrations have been successfully applied."
- **Después:** `migrate status` → "Database schema is up to date!"; `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code` → "No difference detected.", exit 0.
- **Catálogos (sólo lectura, `transaction_read_only = on`):** enums `ShiftRotationCellKind = SHIFT, REST` y `ShiftTemplateSource = FIXED_ASSIGNMENT, ROTATION, OVERRIDE, HOLIDAY_CONVOCATION`; las 5 tablas con **0 filas**; `WorkShift.shiftTemplateSource` (enum) y `WorkShift.scheduledStartAt` (timestamptz) nullable y sin default, **NULL en las 92 filas**. Presentes: los 9 CHECK, los 2 EXCLUDE con su índice gist, los 2 índices únicos `lower()`, los únicos exactos, los índices de §24.18 y las 16 FKs (RESTRICT/SET NULL; la única CASCADE es `ShiftRotationSlot.versionId`). `btree_gist` 1.8. No se insertaron filas para probar constraints en Neon (ya probado en local).
- **Antes / después** (misma consulta de sólo lectura): `ShiftTemplate` 15, `ShiftGroup` 2, `ShiftAssignment` 29, `WorkShift` 92 (74 con turno adoptado), `ShiftAlert` 179, `AttendanceInactivityIncident` 1910, `SystemNotification` 2415, `Novelty` 32, `NoveltyDayCoverage` 86, `TimeEntry` 142, `HolidayWorkAssignment` 137, `EmployeeDayOff` 9, `Employee` 33, `AttendancePunch` 156, `AuditLog` 2839: **todos iguales**. `WorkShift`: mismos ids y mismo hash fila a fila de las 23 columnas originales; hash de `ShiftTemplate` y de `ShiftAssignment` iguales. Las 5 tablas nuevas pasaron de "no existe" a 0.
- **Prisma Client:** `npx prisma generate` recién después de validar (sin errores); se reinició el backend local que corre contra development (`tsx watch`, por cambio de fecha de `src/server.ts` sin cambiar su contenido) → health 200.
- **Smoke de sólo lectura** con el cliente nuevo y funciones reales: catálogo de turnos (15, 4 con grupo), grupos (OFICINA 2, PLANTA 2), asignaciones (29), `workShift.findMany` sin `select` (92 filas, columnas nuevas NULL), detalle de jornada (`findWorkShiftForAdmin`), resumen de asistencia de 30 días, obligación R2 del 16/11 al 29/11 (feriado del 16/11 marcado), `expectedWorkday` de 33 legajos × 14 días y conteo de las 5 tablas nuevas por el cliente (0). Ningún código de `src` lee las tablas nuevas ni `shiftTemplateSource`, así que las tablas vacías no cambian ninguna respuesta. Durante la validación el job intradía creó 2 incidentes FALTA_INGRESO (turno Taller-02, 10:00 + 10 min) y 4 notificaciones: operación normal del backend, independiente de la migración.
- **Tests después de aplicar:** R4.1 29/29, caracterización R1 65/65 y resolver R2 24/24 sin modificar; `shifts` + `workforce-management` 983 verdes; suite backend completa **4074 verdes** (229 archivos; 15 suites de integración opcionales omitidas como siempre); `typecheck` verde.
- **Migración congelada:** desde esta aplicación, `backend/prisma/migrations/20261120120000_add_shift_rotations/migration.sql` no se edita; cualquier cambio estructural de rotaciones es una migración nueva. El rollback sigue disponible con sus guardas.
- **R4.2** puede empezar sin decisiones de negocio nuevas (§24.17: lo pendiente —fin de semana de Planta, serenos, máximo 540— no afecta al núcleo puro).

---

## 25. R4-REAL-P0 — Especificación real de Planta (auditoría aprobada, 2026-11-20)

**La especificación funcional real de Planta es la fuente de verdad de negocio** y corrige hacia adelante a §24 donde difieran. No hubo cambios de código ni de datos en la auditoría.

**Especificación (ciclo de 2 semanas, ancla lunes 02/11/2026 = Semana A; alterna sin reinicios entre meses y años).** Calendario: A = 02–08/11, B = 09–15/11, A = 16–22/11, B = 23–29/11, A = 30/11–06/12, B = 07–13/12. **Reemplaza el ancla "lunes 23/11 = Semana 1" de §24.17** (con el ancla real, 23/11 es B).

| Persona / equipo | Semana A | Semana B |
|---|---|---|
| Equipo Roberto + Ariel | L–J 07–17; V–D 07–19 | L–J 17–03; V–D descanso |
| Equipo Carlos + Walter | L–J 17–03; V–D descanso | L–J 07–17; V–D 07–19 |
| Juanchi | L descanso; M–V 03–11; S–D descanso | L 07–15; M–J 03–11; V–S–D 19–07 |
| José | L–J 07–15; **V 07–11 + 19–07**; S–D 19–07 | L descanso; M–V 07–15; S–D descanso |
| Johanna | L–V 07–15; S–D descanso | L–D 07–15 |
| Juanjo | fuera de la rotación: `ShiftAssignment` fija L–V 07–15; S/D sin obligación, puede fichar (trabajo no programado) | |

Ningún bloque se superpone con el del día siguiente (verificado en dom→lun, jue→vie y fin de ciclo). Juanchi, José y Johanna son equipos de una persona (patrón rotativo real, no excepciones por nombre).

**Conclusiones:**
- R1, R2 y R3 siguen válidos. R4.1 es correcta salvo **`ShiftRotationSlot`**: una fila por versión/equipo/semana/día con una plantilla no puede representar el viernes A de José (dos bloques) → **R4.1A: `ShiftRotationDay` + `ShiftRotationBlock`** (día REST | SHIFT; sin fila = MISSING; un día SHIFT tiene 1..N bloques ordenados).
- La unidad central pasa a ser un **plan diario** (REST | MISSING | bloques 1..N; cada bloque con plantilla, inicio y fin programados, fecha operativa, fuente ROTATION y clave `(employeeId, scheduledStartAt)`), conservando el contrato legacy de fijos (`fixedCandidates`).
- `WorkShift.shiftTemplateId` + `shiftTemplateSource` + `scheduledStartAt` alcanzan para identificar el bloque de una jornada; no se agregan FKs a versión/día/bloque.

**Brechas (G1–G11):**

| # | Brecha | Tipo | Etapa |
|---|---|---|---|
| G1 | Día con 2+ bloques no persistible | Estructural | R4.1A |
| G2 | Incidente de falta de ingreso único por empleado y día, sin bloque | Estructural (tabla con datos reales) | R4.3a |
| G3 | Obligación y falta de ingreso indexadas por empleado (un candidato) | Lógica | R4.3b |
| G4 | Evidencia de ingreso por plantilla aislada (una fichada 07:02 cumple el bloque 19:00) | Lógica (bug latente) | R4.3b |
| G5 | Segundo bloque rechazado (`CLOCK_ALREADY_OPEN`) si el primero quedó abierto < 1200 min | Lógica + decisión | R4.4 |
| G6 | Salida exige `ShiftAssignment` y se programa desde el ingreso real | Lógica | R4.4 |
| G7 | Resolver devuelve "un turno" | Lógica | R4.2 |
| G8 | `NoveltyDayCoverage.shiftTemplateId` singular | Lógica (NULL con varios bloques) | R4.3b |
| G9 | Trabajo no programado se informa como `TURNO_NO_IDENTIFICADO` | Lógica + decisión | R4.5 |
| G10 | `FALTA_SALIDA` no se puede regularizar (close-manual exige ABIERTO) | Preexistente | fuera de R4 salvo decisión |
| G11 | Faltan plantillas 07–19, 19–07, 07–11; máximo informativo 540 < 600 en Planta-01/02 | Datos | R4.9 |

**Plan:** R1.1 (caracterización) → R4.1A (Día + Bloque) → R4.2 (núcleo puro del plan diario) → R4.3a (incidente por bloque) → R4.3b (cargador, obligación/falta de ingreso/evidencia por bloque, Novedades) → R4.4 (entrada/salida/`WorkShift`) → R4.5 (trabajo no programado) → R4.6 (API) → R4.7 (preview) → R4.8 (UI) → R4.9 (plantillas, máximos y carga de Planta en development + QA). Todo R4 queda en `feature/shift-rotation-system` hasta R4.9 y una auditoría integral; recién después se evalúa promoverlo.

**Decisiones de negocio pendientes:** (1) nuevo ingreso con el bloque anterior abierto (recomendado: aceptarlo y dejar el anterior en falta de salida, sin inventar hora); (2) cómo informar el trabajo no programado; (3) plantillas propias de Planta vs. plantillas de otro grupo en la grilla; (4) máximos/mínimos informativos por plantilla; (5) regularización de `FALTA_SALIDA` (fuera de R4).

### 25.1 R1.1 — Caracterización legacy para el piloto (implementada, 2026-11-20)

**Sólo tests**: sin cambios de código productivo, schema, migraciones ni datos; ningún test ni expectativa existente modificados (en `shiftBehavior.characterization.test.ts` sólo cambia la línea de import para sumar `notifyUsers`). Cada test afirma el comportamiento actual; los que contradicen la especificación de Planta están rotulados "COMPORTAMIENTO ACTUAL (cambia en R4.x)".

| Bloque | Archivo | Qué congela |
|---|---|---|
| R1.1-A trabajo sin turno (Juanjo, sábado 07/11) | `shifts/shiftBehavior.characterization.test.ts` (6) | Sin obligación, sin incidente y Novedades 0; la entrada no adopta plantilla y genera `TURNO_NO_IDENTIFICADO` ADVERTENCIA con aviso `ALERTA_FICHADA` (cambia en R4.5); suprimida con SIN_TURNO, TURNO_FLEXIBLE o `alertOnOutOfShift=false`; salida sin plantilla: sin puntualidad ni fuera de turno, `JORNADA_EXTENDIDA` sólo > 600 min, nunca `JORNADA_INSUFICIENTE` |
| R1.1-B nuevo ingreso con jornada abierta (José, viernes 06/11) | `time-entries/timeEntries.service.test.ts` (5, reloj fijo) | 19:00 con la jornada de las 07:00 abierta (720 min) → 409 `CLOCK_ALREADY_OPEN` sin jornada, rollover, revisión ni evidencia (cambia en R4.4); 1200 min → 409 (umbral inclusivo); 1201 → rollover a FALTA_SALIDA; 1201 con ALERT_ONLY → revisión + 409; el umbral ignora `maxAllowedMinutes` de la jornada |
| R1.1-C cierre técnico sin salida | `time-entries/timeEntries.repository.test.ts` (5), `shifts/openShiftMonitor.service.test.ts` (2), `time-entries/clockPunchMaintenance.test.ts` (3, archivo nuevo) | `expireOpenWorkShifts` escribe exactamente `{FALTA_SALIDA, totalMinutes 0, concepto, observación, closedAt}` — **nunca `endAt`, `endPunchId` ni `reviewStatus`**; un `TimeEntry` 0 h APROBADO, sin tramos; respeta `maxAllowedMinutes` de la jornada (720 → vence a los 721); sin concepto resoluble no cierra; el rollover deja sólo `{FALTA_SALIDA, observación}` + `TimeEntry` 0 h. Olvido de salida del bloque 19:00–07:00: sin alerta hasta 799 min, alerta a los 800 (720 + 20 + 60; el umbral se alcanza con `>=`). El tick de mantenimiento avisa `FALTA_SALIDA` por jornada con su inicio, y un aviso fallido no corta los demás |
| R1.1-D evidencia de ingreso (José, viernes A) | `shifts/shiftBehavior.characterization.test.ts` (5) | Fichada 07:02 cuenta como ingreso del bloque 19:00 (bug latente G4, cambia en R4.3b); 06:58 no; el resultado es por empleado (`Set<employeeId>`); una sola consulta de INGRESO en ±24 h; el incidente es uno por empleado y día (`createMany` + `skipDuplicates`, sin bloque; cambia en R4.3a) |

Corrección respecto del plan de R1.1: el olvido de salida se genera **al alcanzar** el umbral (800 min), no al superarlo (801).

**Resultados:** 26 tests nuevos verdes; caracterización R1 76 (65 previos sin cambios + 11); suite backend **4100 verdes** (230 archivos; 15 suites de integración opcionales omitidas como siempre); `typecheck` verde.

### 25.2 R4.1A — Día + Bloque (implementada y validada en local; NO aplicada a ninguna base compartida)

**Estado:** migración nueva `20261120180000_replace_rotation_slots_with_days` creada y validada contra PostgreSQL 18 local; **no aplicada** a development, pre-development ni producción (requiere autorización explícita). La migración de R4.1 (`20261120120000_add_shift_rotations`) no se editó. Sin lógica: ningún código lee las tablas de rotación.

**Precondición verificada (2026-11-20, development, transacción READ ONLY):** `ShiftRotationSlot` y el resto de las tablas de rotación con 0 filas; `WorkShift` sin `shiftTemplateSource` ni `scheduledStartAt` cargados.

**Modelo (reemplaza `ShiftRotationSlot`):**
- `ShiftRotationDay(id, versionId → ShiftRotationVersion CASCADE, crewId → ShiftRotationCrew RESTRICT, cycleWeekIndex, weekday, kind ShiftRotationCellKind)`; `UNIQUE(versionId, crewId, cycleWeekIndex, weekday)`; `UNIQUE(id, kind)` como destino de la FK compuesta.
- `ShiftRotationBlock(id, dayId, dayKind ShiftRotationCellKind DEFAULT 'SHIFT', blockIndex, shiftTemplateId NOT NULL → ShiftTemplate RESTRICT)`; FK compuesta `(dayId, dayKind) → ShiftRotationDay(id, kind) ON DELETE CASCADE ON UPDATE RESTRICT`; `UNIQUE(dayId, blockIndex)`; índice `shiftTemplateId`.
- Relaciones inversas: `ShiftRotationVersion.days`, `ShiftRotationCrew.days`, `ShiftTemplate.rotationBlocks` (reemplazan `slots` / `rotationSlots`). Sin autoría ni timestamps propios (los tiene la versión). Se reutiliza el enum `ShiftRotationCellKind` (SHIFT | REST). Sin cambios en `ShiftRotation`, `ShiftRotationVersion`, `ShiftRotationCrew`, `ShiftRotationCrewMember` ni `WorkShift`.

**Invariantes:**

| Invariante | Garantía |
|---|---|
| MISSING = sin fila de día (nunca descanso) | Modelo: no existe valor MISSING persistido |
| Una configuración por versión/equipo/semana/día | `UNIQUE(versionId, crewId, cycleWeekIndex, weekday)` |
| Un día REST no tiene bloques | FK compuesta + `CHECK dayKind = 'SHIFT'` |
| Un día con bloques no puede pasar a REST | `ON UPDATE RESTRICT` de la FK compuesta |
| Un día SHIFT tiene ≥ 1 bloque | Servicio (R4.6); el núcleo (R4.2) tratará un SHIFT vacío como MISSING. Sin triggers |
| Orden explícito y único de bloques | `UNIQUE(dayId, blockIndex)` + `CHECK blockIndex >= 0` |
| Rangos | `CHECK cycleWeekIndex BETWEEN 0 AND 11`, `CHECK weekday BETWEEN 0 AND 6` |
| Equipo de la misma rotación que la versión; `cycleWeekIndex < cycleLengthWeeks`; sin superposición entre bloques (mismo día, cruce de medianoche, días/semanas consecutivos, fin → inicio del ciclo) | Servicio / núcleo puro (R4.2, R4.6) |

**Migración:** encabezado; `LOCK TABLE "ShiftRotationSlot"` + guarda que **aborta antes de cualquier DROP** si la tabla tiene filas; cuerpo generado offline con `prisma migrate diff` (drop de `ShiftRotationSlot` y sus 3 FKs; create de Día y Bloque, 4 índices, 4 FKs); 4 CHECK escritos a mano. Sin sentencias de datos ni cambios sobre otras tablas existentes; las únicas cascadas son versión → día → bloque.

**Rollback** (`prisma/rollbacks/20261120180000_replace_rotation_slots_with_days.down.sql`): una transacción, `LOCK` de Bloque y Día, aborta si hay filas, `DROP` de ambas tablas, recrea `ShiftRotationSlot` exactamente como en R4.1 (tabla, únicos, índice, 3 FKs, 3 CHECK) y borra su propia fila de `_prisma_migrations` (patrón de `20261009150000_org_location_contract_m2`). Debe correr antes que el rollback de R4.1.

**Hallazgo:** `prisma migrate resolve --rolled-back` sólo acepta migraciones **fallidas** (P3012); después de revertir a mano una migración exitosa, Prisma la sigue considerando aplicada. Los rollbacks de R3.1, R4.1 y otros indican ese comando en su encabezado (instrucción inexacta, deuda preexistente, no corregida en esta etapa); el de R4.1A borra la fila de `_prisma_migrations` dentro de la transacción. `docs/DATABASE_STANDARDS.md` ("Hand-written rollbacks") repite la instrucción inexacta.

**Validación local** (Postgres.app 18, misma versión mayor que el CI; bases descartables `r41a_*` en `localhost`, destino verificado antes de cada operación, línea Datasource de Prisma en `localhost`; ningún comando contra Neon; bases eliminadas al terminar):
1. `prisma format` / `validate` / `generate` sin errores (Prisma acepta la FK compuesta con columna enum y `onUpdate: Restrict`).
2. Historial completo (79 migraciones) en base vacía con `scripts/ci/migrate-clean-database.ts`; `migrate status` al día; `migrate diff` contra `schema.prisma`: **No difference detected**.
3. **32 comprobaciones SQL reales**, todas OK: día REST; día SHIFT; día duplicado (23505); mismo día en otro equipo; semana 12 / −1 y día 7 (23514); `MISSING` inexistente (22P02); versión o equipo inexistentes (23503); **viernes de José con dos bloques** (07–11 y 19–07) y `dayKind` SHIFT por default; **bloque en día REST rechazado** (FK compuesta, 23503) y con `dayKind` REST (CHECK, 23514); `blockIndex` duplicado (23505) y negativo (23514); bloque sin plantilla (23502), plantilla o día inexistentes (23503); **pasar a REST un día con bloques rechazado (23001)** y sin bloques aceptado; cambiar `dayKind` de un bloque (23514); borrar plantilla, equipo o rotación usados (23001); borrar un día borra sus bloques; borrar una versión borra sólo sus días y bloques; `ShiftRotationSlot` eliminada y constraints de R4.1 y columnas de `WorkShift` intactos.
4. **Guarda:** base en estado R4.1 con una fila en `ShiftRotationSlot` → `migrate deploy` falla (P3018, "Migración abortada: ShiftRotationSlot tiene 1 fila(s)…"); la fila queda intacta y no se crea ninguna tabla. Recuperación probada: vaciar la tabla, `migrate resolve --rolled-back` (ahora sí, migración fallida) y `migrate deploy` → aplicada, al día y sin diferencias.
5. **Rollback:** con datos → aborta y no cambia nada; sin datos → revierte, la migración vuelve a figurar pendiente, `migrate diff` contra el schema anterior (R4.1) **No difference detected** y `ShiftRotationSlot` recreada con sus 3 CHECK, 3 FKs, PK, índice y único.

**Tests:** `shiftRotation.migration.test.ts` 38 (29 de R4.1 + 9 de R4.1A; el único test previo ajustado es el que describía el modelo `ShiftRotationSlot` en `schema.prisma`, que ahora describe Día + Bloque — las aserciones sobre el SQL congelado de R4.1 no cambian). Suite backend **4109 verdes**; caracterización R1 76/76 y resolver R2 24/24 sin cambios; `typecheck` y `build` verdes.

**Riesgos y notas:**
- Cliente Prisma local regenerado sin `shiftRotationSlot`; development sigue con la tabla vieja hasta un deploy autorizado. No afecta al backend local: ningún código lee estas tablas (a diferencia de R4.1, no cambian columnas de tablas leídas).
- Los CHECK escritos a mano no los compara `migrate diff`: cubiertos por los tests estáticos y por las pruebas SQL locales.
- RESTRICT responde SQLSTATE 23001: los servicios de R4.6 deben mapearlo a mensajes de dominio.

**Antes de autorizar un deploy en development:** mismo procedimiento que §24.19 (línea Datasource, rama de respaldo Neon, verificar `ShiftRotationSlot` vacía, `migrate deploy`, `migrate status`, `migrate diff --exit-code`, catálogos y conteos, `prisma generate`, reinicio del backend local).

### 25.3 R4.2 — Núcleo de rotaciones y `ExpectedDayPlan` (implementado, 2026-11-20)

**Estado:** núcleo **puro** (sin Prisma, sin HTTP) implementado y probado con la especificación real de Planta. Ningún servicio productivo lo usa todavía: obligación, falta de ingreso, incidentes, entrada/salida, alertas, notificaciones, API y frontend sin cambios; sin schema, migraciones ni datos. Los consumidores se conectan en R4.3/R4.4.

**Archivos:**

| Archivo | Contenido |
|---|---|
| `shared/datetime/argentinaTime.ts` | `calendarDaysBetweenKeys` (con signo), `calendarWeekdayOfKey` (0 = domingo), `mondayOfCalendarDateKey` (semana lunes→domingo) |
| `shifts/rotationPlan.ts` | Snapshot de configuración (espejo de las tablas R4.1/R4.1A, sin tipos Prisma), contrato `ExpectedDayPlan` / `ExpectedBlock`, `rotationWeekIndex`, `rotationWeekLabel`, `templateSchedule`, `buildExpectedBlock`, `resolveRotationDayPlan` |
| `shifts/blockAssignment.ts` | `assignInstantToBlock`, `candidateBlocksAround` |
| `shifts/rotationValidation.ts` | `validateRotationGrid` |
| `shifts/expectedShiftResolver.ts` | Input opcional `rotationPlan` / `convocationTemplate`; fuente `ROTATION`; resultado `dayPlan` + `blocks`; camino de rotación separado (`resolveRotationShift`) |
| `shifts/expectedWorkday.ts` | Caso `ROTATION`, bloques del plan en la cascada de minutos de la convocatoria, `planIssue`; `projectExpectedWorkday` exportada para tests |
| `shifts/plantaRotation.fixture.ts` | Especificación real de Planta como snapshot (reutilizable en R4.3–R4.9) |

**Contrato.** `resolveRotationDayPlan(employeeId, dateKey, { memberships, rotations })` devuelve:
- `null` — no es miembro vigente de una rotación ACTIVA (rotación INACTIVA = deja de resolver): rige el legacy.
- `REST` — descanso programado (`origin`: rotación, versión, equipo, semana, día, fila).
- `MISSING` + motivo (`ROTATION_NOT_FOUND`, `CREW_NOT_IN_ROTATION`, `CREW_INACTIVE`, `NO_VERSION_IN_EFFECT`, `INVALID_VERSION`, `NO_DAY_ROW`, `SHIFT_DAY_WITHOUT_BLOCKS`, `TEMPLATE_UNAVAILABLE`) — configuración inexistente o incompleta, nunca descanso.
- `CONFLICT` + motivo (`MULTIPLE_MEMBERSHIPS`, `MULTIPLE_VERSIONS`, `DUPLICATE_DAY_ROWS`, `REST_DAY_WITH_BLOCKS`, `DUPLICATE_BLOCK_INDEX`, `OVERLAPPING_BLOCKS`) + `detail` con los ids y rangos involucrados — configuración contradictoria: **nunca se elige la primera**, no genera obligación ni candidatos y queda lista para mostrarse a un administrador (sin notificaciones en R4.2). La base ya impide estos casos (EXCLUDE y únicos de R4.1/R4.1A); el núcleo se defiende igual, sin schema nuevo.
- `SHIFTS` — 1..N `ExpectedBlock` ordenados: `obligationKey` (`employeeId|scheduledStartAt ISO`, estable y único por persona; coincide con `WorkShift.scheduledStartAt`), `operationalDate` (fecha del inicio), `blockIndex`, `source` (`ROTATION` | `HOLIDAY_CONVOCATION`), `template`, `scheduledStartAt` (00:00 ART de la fecha + inicio), `scheduledEndAt` (inicio + duración: cruce de medianoche resuelto), `durationMinutes`, `origin`.

**Semanas:** `weekIndex = mod(días(ancla → lunes de la fecha) / 7, ciclo)` con módulo positivo, sobre fechas calendario (sin huso ni DST): continúa entre meses y años y resuelve fechas anteriores al ancla. Planta: 02/11 A, 09/11 B, 16/11 A, 23/11 B, 30/11 A, 07/12 B, 03/01/2027 A, 04/01/2027 B, 26/10 B.

**Asignación de fichadas** (decisión del usuario, 2026-11-20): ventana `[inicio − 240 min, fin)` (240 = `EARLY_ARRIVAL_REVIEW_THRESHOLD_MINUTES`); fuera de todas → `UNASSIGNED` (`NO_CANDIDATES` | `OUTSIDE_ALL_WINDOWS`), que no satisface ninguna obligación y no implica ausencia ni irregularidad. Varias ventanas → el bloque en curso; luego el inicio más cercano; luego el más temprano; con el mismo inicio, el que termina antes (nunca depende del orden recibido). Devuelve a lo sumo un bloque. Asignar no es puntualidad ni cumplimiento definitivo (las tolerancias las aplican los consumidores). `candidateBlocksAround` reúne los bloques de D−1, D y D+1 (sólo planes SHIFTS). El legacy de fijos (`matchShiftForEmployee`, `findEmployeeIdsWithMatchingEntryEvidence`) no cambia: R1.1-D sigue afirmando su comportamiento.

**Resolver.** Sin `rotationPlan` (todos los consumidores actuales) el resultado es el legacy, con `dayPlan: null` y `blocks: []`. Con `rotationPlan`, la rotación reemplaza a los fijos (`fixedCandidates` vacío):
- **WORK_OBLIGATION:** feriado sin convocatoria → no; SIN_TURNO → no; franco → no; **feriado convocado con plantilla ACTIVA → obligación con un único bloque de la convocatoria, aunque el plan sea REST, MISSING, CONFLICT o SHIFTS**; CONFLICT → no (`ROTATION_CONFIG_CONFLICT`); convocado sin plantilla y plan REST/MISSING → no (`HOLIDAY_CONVOCATION_WITHOUT_SCHEDULE`); REST → no (`ROTATION_REST_DAY`); MISSING → no (`ROTATION_DAY_MISSING`); SHIFTS → obligación con sus bloques (`HOLIDAY_CONVOCATION` si convocado).
- **EXPECTED_WORKDAY:** franco → DAY_OFF; convocado → HOLIDAY_CONVOCATION (bloques: convocatoria con plantilla → plan); feriado IN_SCOPE → no; historia faltante → no resuelto; SIN_TURNO → no resuelto; CONFLICT → no resuelto; SHIFTS → obligación; REST → no; MISSING → no resuelto.
- `dayPlan` conserva siempre el plan recibido: **un CONFLICT queda visible aunque una convocatoria decida la obligación**.
- Los turnos fijos conservan el comportamiento P8 (la convocatoria no aporta su plantilla) hasta que se aborde explícitamente.

**Novedades (proyección pura, inalcanzable hasta R4.3):** SHIFTS → `WORKDAY` con la suma de bloques (José viernes A: 240 + 720 = **960**), `source: SHIFT_ROTATION`, `minutesSource: ROTATION_BLOCKS`; REST → 0 confirmado; MISSING/CONFLICT → `UNRESOLVED`. **Contradicción técnica detectada y resuelta sin schema:** `unresolvedReason` se persiste en el enum de base `NoveltyCoverageScheduleReviewReason` (`noveltyCoverage.engine.ts`), que no tiene un valor de conflicto de rotación; agregar uno es una migración. Por eso la proyección usa el motivo persistible `SCHEDULE_MISSING` y conserva el problema real en el campo opcional `planIssue` (`CONFLICT` con motivo y detalle, o `MISSING` con motivo). Persistirlo como motivo propio de la cobertura es una **decisión de R4.3** (migración del enum). El campo no aparece en el camino legacy (resultado idéntico).

**Validación de grillas** (`validateRotationGrid`, puro): `BLOCKS_OVERLAP` con relación `SAME_DAY` / `NEXT_DAY` / `WEEK_BOUNDARY` / `CYCLE_WRAP` (línea de tiempo del ciclo; los bloques que sólo se tocan no se superponen), `SHIFT_DAY_WITHOUT_BLOCKS`, `REST_DAY_WITH_BLOCKS`, `BLOCK_INDEX_DUPLICATED`, `DUPLICATE_DAY`, `CREW_NOT_IN_ROTATION`, `WEEK_OUT_OF_CYCLE`, `INVALID_WEEKDAY`, `TEMPLATE_NOT_FOUND` / `TEMPLATE_INACTIVE` / `TEMPLATE_INVALID_TIMES`, `INVALID_ANCHOR`, `INVALID_CYCLE_LENGTH` (errores) y `DAY_MISSING` (advertencia: grilla incompleta). La especificación de Planta valida sin problemas; el conflicto de los serenos (domingo B 19–07 → lunes A 03–11) se detecta como `CYCLE_WRAP`. Capas: la base ya garantiza unicidad, rangos, FK y REST sin bloques; el servicio de R4.6 llamará a esta función al guardar/activar.

**Pruebas (105 nuevas):** `argentinaTime.test.ts` (3), `rotationPlan.test.ts` (48: semanas, **tabla completa de la especificación 02/11–15/11 por persona y su repetición 16/11–29/11 y 30/11–13/12**, casos de aceptación, historia de membresías y versiones, cada MISSING y cada CONFLICT), `blockAssignment.test.ts` (24: José 07:02 / 18:55 / 11:30, bordes exactos 03:00, 02:59, 10:59, 11:00, 14:59, 15:00, cruce de medianoche, **barrido minuto a minuto de jueves 12:00 a sábado 12:00**, Carlos jueves → viernes 02:30, Juanchi lunes tras el sereno, desempates en ambos órdenes), `rotationValidation.test.ts` (11), `rotationExpectedShift.test.ts` (19: legacy idéntico, Juanjo, REST/MISSING/CONFLICT/SHIFTS, franco y SIN_TURNO, todas las precedencias de convocatoria, CONFLICT + convocatoria con trazabilidad, proyección de Novedades). Caracterización R1/R1.1 76/76 y resolver R2 24/24 sin cambios; suite backend **4214 verdes** (234 archivos; 15 suites de integración opcionales omitidas como siempre); `typecheck` y `build` verdes.

**Pendiente para R4.3:** cargador en lote (Prisma → snapshot), obligación y falta de ingreso por bloque, evidencia por bloque con `assignInstantToBlock`, incidente por bloque (R4.3a), Novedades con rotaciones cargadas, recálculo de cobertura, si el CONFLICT se persiste como motivo propio (migración del enum) y la convocatoria con turno en los consumidores.

### 25.4 R4.3a — Persistencia de incidentes por bloque (implementada y validada en local; NO aplicada a ninguna base compartida)

**Estado:** migración `20261121090000_attendance_incident_block_key` creada y validada contra PostgreSQL 18 local; no aplicada a development, pre-development ni producción. **Ningún código productivo cambió**: nadie escribe todavía `scheduledStartAt` (R4.3b).

**Antes (verificado en development, sólo lectura, PostgreSQL 18.7):** `AttendanceInactivityIncident` con 1912 filas y 1912 pares (empleado, fecha) distintos; único `AttendanceInactivityIncident_employeeId_operationalDate_key` (índice); sin columna de tipo (FALTA_INGRESO y SIN_ACTIVIDAD comparten fila). Ningún código usa la clave compuesta de Prisma `employeeId_operationalDate`; la única dependencia de la unicidad es la deduplicación de `createMany({ skipDuplicates: true })` (`ON CONFLICT DO NOTHING` sin target) en `persistAndNotifyInactivityIncidents`.

**Diseño:**
- Columna `scheduledStartAt TIMESTAMPTZ(3) NULL` sin default ni backfill. NULL = incidente de día (todos los históricos, SIN_ACTIVIDAD_REGISTRADA, falta de ingreso de turnos fijos); NOT NULL = falta de ingreso de un bloque (el mismo instante que `ExpectedBlock.scheduledStartAt` / `WorkShift.scheduledStartAt`).
- Unicidad: índice único de **expresión** escrito a mano `AttendanceInactivityIncident_block_key` sobre `("employeeId", "operationalDate", COALESCE("scheduledStartAt", '-infinity'::timestamptz))` = una fila de día por persona y fecha, y una por bloque (equivale a `NULLS NOT DISTINCT`). Se eligió sobre `NULLS NOT DISTINCT` porque Prisma 6.19 no modela ese atributo: Prisma ignora los índices de expresión (gate verificado: `migrate diff` vacío) y `skipDuplicates` los respeta.
- `schema.prisma`: + `scheduledStartAt`; − `@@unique([employeeId, operationalDate])`; el modelo documenta el índice. Regla: nunca `findUnique`/`upsert` sobre esta unicidad (altas con `createMany({ skipDuplicates })`, lecturas y cambios por campos o id).
- Migración: `LOCK ... ACCESS EXCLUSIVE`; precondiciones (columna inexistente, sin pares repetidos); `ADD COLUMN` (sólo metadata); índice nuevo **antes** de `DROP INDEX` del anterior; postcondiciones (sin filas con bloque, filas = pares, índices esperados). Sin UPDATE, INSERT ni DELETE. Todo en una transacción.
- Rollback (`prisma/rollbacks/20261121090000_attendance_incident_block_key.down.sql`): transacción + lock; **aborta si existe algún incidente por bloque**; restaura el índice anterior antes de quitar el nuevo; quita la columna; borra su fila de `_prisma_migrations` (P3012). Debe correr antes que los rollbacks de R4.1A y R4.1.

**Compatibilidad:** las filas existentes quedan con `scheduledStartAt = NULL` y la unicidad nueva es, para ellas, idéntica a la anterior. Fijos y SIN_ACTIVIDAD siguen escribiendo filas de día. Francos (`resolvePendingInactivity`) resuelven todas las filas del día (también las de bloque). **Cambio de garantía para R4.3b:** una fila de día ya no colisiona con filas de bloque (coexisten estructuralmente); evitar la duplicación semántica (p. ej. un SIN_ACTIVIDAD además de faltas por bloque) es lógica de R4.3b.

**Validación local** (Postgres.app 18; bases descartables `r43a_*` en `localhost`, destino verificado antes de cada escritura; ningún comando contra Neon; bases eliminadas al terminar):
1. **Gate Prisma:** historial completo (80 migraciones) en base limpia; `migrate status` al día; `migrate diff` contra `schema.prisma` **No difference detected**.
2. **Historial preservado:** base en estado previo con incidentes sintéticos de todos los estados (PENDIENTE notificado y sin notificar, RESUELTA por usuario, automática y por franco, DESCARTADA por supervisor) y avisos `SystemNotification` asociados → `migrate deploy` → **hashes idénticos** de las columnas originales (ids, estados, observaciones, fechas, revisión, usuarios) y de los avisos con su incidente; `scheduledStartAt` NULL en todas las filas.
3. **Unicidad (SQL real):** dos incidentes de día mismo empleado y fecha → 23505; bloques 07:00 y 19:00 el mismo día → admitidos; mismo bloque repetido → 23505; día + dos bloques coexisten; otro empleado u otra fecha → admitidos; pasar un bloque a NULL con un incidente de día existente → 23505; `ON CONFLICT DO NOTHING` descarta duplicados de día y de bloque.
4. **Prisma real** (cliente regenerado): `createMany({ skipDuplicates: true })` con filas de día y de bloque → 3 la primera vez, 0 al reintentar; `persistAndNotifyInactivityIncidents` (código productivo actual) no duplica el incidente legacy existente, crea el nuevo y un reintento no crea ni vuelve a notificar; `attendanceObservedCount` correcto; el franco resuelve las 3 filas pendientes del día.
5. **Precondición:** ejecutar la migración sobre una base que ya tiene la columna aborta sin cambios.
6. **Rollback:** con incidentes por bloque → aborta y datos, índices e historial de migraciones quedan idénticos (hash); sin bloques → revierte conservando todos los registros legacy y avisos (hash idéntico), la migración vuelve a figurar pendiente, `migrate diff` contra el schema anterior **No difference detected**, y re-aplicarla deja los registros idénticos y el schema sin diferencias.

**Tests:** `time-entries/attendanceIncidentBlockKey.migration.test.ts` (9). Caracterización R1/R1.1 76/76 (incluido R1.1-D, que sigue afirmando que el alta actual no escribe `scheduledStartAt`) y resolver R2 24/24 sin cambios; suites de asistencia, turnos, Novedades y francos 1785 verdes; suite backend **4223 verdes**; `typecheck` y `build` verdes.

**Documentación:** `docs/DATABASE_STANDARDS.md` — unicidad con NULL como valor ⇒ índice de expresión `COALESCE` (y por qué no `NULLS NOT DISTINCT` con Prisma); corrección de la instrucción de rollbacks (`resolve --rolled-back` sólo aplica a migraciones fallidas).

**Novedades (`planIssue`)** — decisión del usuario: se mantiene `SCHEDULE_MISSING` + `planIssue` sin nuevo valor de enum. Limitación: `NoveltyDayCoverage` persiste sólo `SCHEDULE_MISSING`; `planIssue` es efímero. Al recalcular no se pierde (se deriva otra vez del plan, determinístico y con historia inmutable), pero en consultas históricas y auditoría no se distingue "falta configurar" de "configuración contradictoria" sin recalcular. Opciones futuras (sin decidir): columna JSON de diagnóstico en `NoveltyDayCoverage` o valor de enum dedicado.

**Pendiente para R4.3b:** cargador de rotaciones; obligación por bloque; `checkMissingExpectedEntries` y catch-up escribiendo `scheduledStartAt` para bloques de rotación (fijos siguen en NULL); evidencia por bloque con `assignInstantToBlock`; auto-resolución por `(employeeId, scheduledStartAt)`; exclusión en `detectAttendanceInactivity` de quien ya tenga incidentes ese día; textos y avisos por bloque.

**Antes de un deploy en development (autorización aparte):** procedimiento de §24.19 (Datasource, rama de respaldo Neon, snapshot lógico de `AttendanceInactivityIncident` con hash, `migrate deploy`, `migrate status`, `migrate diff --exit-code`, catálogos, conteos y hash fila a fila, `prisma generate`, reinicio del backend local). Orden: R4.1A y R4.3a pendientes en development.

### 25.5 R4.3b — Obligaciones, faltas de ingreso e incidentes por bloque (implementada y validada en local; sin schema ni migraciones)

**Estado:** código conectado a los procesos reales; inerte mientras no haya membresías de rotación (hoy, todos los entornos). Sin cambios de schema. Entrada/salida/cierre por bloque, puntualidad y alertas siguen en R4.4.

**Piezas:**
- `shifts/rotationPlan.loader.ts` — `loadRotationConfiguration`: snapshot de R4.2 en lote (1 consulta de membresías; si hay, 1 consulta `join` de rotaciones → versiones del rango → días → bloques → plantillas). Sin membresías termina en la primera consulta.
- `shifts/rotationObligation.service.ts` — `resolveRotationObligations`: por (empleado, fecha) el plan del núcleo (`resolveRotationDayPlan`) + **todas** las precedencias del resolver central (`resolveExpectedShift`, WORK_OBLIGATION): feriado, convocatoria con su plantilla, franco, régimen, REST/MISSING/CONFLICT. Feriados, francos, convocatorias y regímenes en lote. Única fuente de bloques efectivos para obligación y evidencia.
- `resolveWorkObligationCandidates`: fijos idénticos (sin clave nueva); miembros ACTIVOS con un candidato por bloque efectivo (`block`, identidad `obligationKey`). Un miembro con plan ese día (aun REST/MISSING/CONFLICT) no usa sus asignaciones fijas.
- `findSatisfiedBlockObligationKeys` (evidencia): bloques efectivos de D−1, D y D+1 + una consulta de fichadas INGRESO en `[min(inicio) − 240 min, max(fin))`; cada fichada satisface a lo sumo el bloque que le asigna `assignInstantToBlock`. Una convocatoria reemplaza al bloque habitual también para la evidencia. Asignar ≠ puntualidad (R4.4).
- Falta de ingreso (`missingEntry.service.ts`): candidatos sin `block` siguen el camino legacy sin cambios; por bloque, sólo bloques **vencidos** (también en el catch-up: respecto del instante real). El tick intradía también mira los bloques de AYER cuya tolerancia vence HOY (cerca de la medianoche). Por (empleado, fecha), una transacción con `lockEmployeeDays`: `createMany({ skipDuplicates })` con `scheduledStartAt`, verificación de que todas las filas existen (si no, lanza y revierte) y, sólo entonces, reemplazo del incidente de día PENDIENTE sin revisión humana (`RESUELTA`, nota "Reemplazado por las faltas de ingreso por bloque de la programación por rotación."). Resolución automática por `obligationKey`; un incidente de día de un miembro se resuelve si algún bloque del día tiene evidencia.
- `detectAttendanceInactivity`: excluye desde el principio a quien tenga candidatos por bloque ⇒ nunca SIN_ACTIVIDAD_REGISTRADA para una obligación por bloques; el resultado no depende del orden entre procesos.
- Avisos internos (`claimAndNotifyInactivityIncidents`, compartido con legacy): por incidente, una transacción que **primero** reclama con un único `UPDATE … WHERE notifiedAt IS NULL` y sólo si ganó crea las filas `SystemNotification`. Concurrencia: un solo juego de avisos; fallo antes de confirmar ⇒ `notifiedAt` sigue NULL y el próximo tick/catch-up reintenta. **Alcance de la garantía: sólo registros internos `SystemNotification`**; este flujo no tiene entregas externas (push/mail) — si se agregaran, necesitarían un mecanismo propio (p. ej. outbox).
- Novedades: `loadEmployeeWorkdayContext` carga la configuración en la misma tanda (`rotation` sólo en legajos con membresía; `templateSelect` + `code`); `evaluateEmployeeWorkday` pasa plan y plantilla de la convocatoria (José viernes A = 960). `recalculateTemplateCoverage` incluye miembros cuyas grillas usan la plantilla editada (membresía ∩ vigencia de las versiones); sin membresías no toca las tablas de grilla.

**Decisión INTERINA (usuario, 2026-11-21) — día ya revisado por una persona:** si el (empleado, fecha) tiene un incidente de día con `reviewedByUserId` o `DESCARTADA`, no se modifica ni reabre la decisión humana, **no** se crean faltas por bloque ni avisos, y el caso se informa de forma determinística en el resultado del detector (`reconciliationRequired: [{ employeeId, dateKey, dayIncidentId, blockKeys }]`, presente sólo si hay casos). Es **provisional**: un log o un contador no equivalen a conciliación persistente.

**T-R4-CONC — tarea técnica obligatoria, BLOQUEANTE de R4.9:** auditar los incidentes históricos (de día) de los futuros miembros de rotaciones y definir un mecanismo persistente de conciliación (estado `CONCILIACION` o estructura específica) para el caso anterior. **No se cargan ni activan rotaciones reales mientras T-R4-CONC esté pendiente** (además del bloqueo por R4.4 de §24).

**Compatibilidad con development (R4.1 aplicada; R4.1A y R4.3a no):** ningún camino legacy lee ni escribe columnas o tablas nuevas; las consultas con `scheduledStartAt` o con las tablas de la grilla corren sólo con candidatos por bloque / membresías. Probado en local con el **mismo cliente** que usa el checkout principal (generado del schema de `e87a53c`, Prisma 6.19.3, idéntico byte a byte) sobre una base con el historial hasta `20261120120000_add_shift_rotations` (gate verde): 5 integraciones legacy (francos, Novedades, recálculo, destinatarios de avisos, post-proceso de fichada) 71/71, y una sonda temporal con registro de cada consulta real (falta de ingreso intradía y catch-up, inactividad, listado de Asistencia, Novedades, edición de plantilla con recálculo): 80 consultas, las de rotación sólo sobre `ShiftRotationCrewMember` (+ su crew), **ninguna** sobre `AttendanceInactivityIncident.scheduledStartAt`, `ShiftRotationDay`, `ShiftRotationBlock` ni `ShiftRotationVersion`.

**Cuándo regenerar el cliente del checkout principal:** sólo cuando development tenga aplicadas R4.1A y R4.3a (autorización aparte, §24.19): `npx prisma generate` y reinicio del backend. Antes de eso, cargar membresías en development rompería el camino por bloque (tablas y columna inexistentes): otra razón para no cargar rotaciones.

**Validación local** (Postgres.app 18, bases descartables `r43b_*`/`clock_it_r43b*`/`clock_it_dev_*` en `localhost`, verificadas antes de escribir; ningún comando contra Neon):
- `time-entries/rotationAttendance.integration.test.ts` (opt-in `ROTATION_ATTENDANCE_IT_DATABASE_URL`, agregado al CI) con la grilla real de Planta: 16/16, estable en 3 corridas — José sin entradas ⇒ 2 faltas por bloque con su aviso; inactividad antes/después/en paralelo ⇒ mismo resultado sin SIN_ACTIVIDAD; reproceso tras interrupción idempotente; 07:02 no cumple el 19:00; la entrada tardía resuelve sólo su bloque; convocatoria que reemplaza el bloque habitual; 6 reclamos concurrentes ⇒ 1 aviso; Juanjo legacy (1 fila de día, 1 aviso); nocturnos de Juanchi; día revisado por persona y DESCARTADO ⇒ conciliación informada sin cambios; día PENDIENTE con un bloque vencido y otro futuro; Novedades 960/0.
- Unitarias: `time-entries/missingEntry.rotation.test.ts` (10: orden lock → alta → verificación → reemplazo, fallo de verificación sin reemplazo ni avisos, sólo vencidos, novedad, evidencia por clave, resolución por bloque, catch-up) y `shifts/rotationPlan.loader.test.ts` (3).
- Con el cliente de la feature: integraciones existentes afectadas (francos, Novedades ×2, destinatarios, post-proceso, fichada) + la nueva: 109/109. Suite backend **4236 verdes**; `typecheck` y `build` verdes. Tests existentes: sólo mocks ampliados (membresías vacías, `updateMany` en transacciones); ninguna expectativa cambió. Caracterización R1/R1.1 y resolver R2 sin cambios.

**Pendiente:** R4.4 (adopción del bloque en la entrada, salida, cierre, puntualidad); T-R4-CONC; deploy de R4.1A + R4.3a en development (autorización aparte).

### 25.6 R4.4 — Fichador con bloques de rotación (implementada y validada en local; sin schema ni migraciones)

**Estado:** código listo, inerte sin membresías (hoy, todos los entornos). Plan v4 aprobado por el usuario el 2026-11-20. **Retiradas** por el usuario, sin implementar: `SALIDA_EN_REVISION`, `WorkShift.reviewExitPunchId`, `ACCEPT_EXIT`/`REJECT_EXIT`, pantalla obligatoria de aprobación, job `OBSERVED_EXIT` y la 201 de «salida observada». Nada depende de que RRHH apruebe fichadas.

**Motor único:** bloques efectivos de R4.3b (`effectiveBlocksAround`, que ahora también usa la evidencia) + `assignInstantToBlock` (R4.2). `shifts/rotationEntry.ts` (puro) sólo clasifica: entrada `ASSIGNED` (puntualidad con las tolerancias del bloque) | `CONFIGURATION` (MISSING/CONFLICT de la fecha) | `DAY_OFF` | `OUTSIDE_WINDOW` (bloque más tarde la misma fecha) | `UNSCHEDULED`; salida `NORMAL` | `LIKELY_FORGOTTEN_EXIT` | `LIMIT_EXCEEDED`. Miembro detectado con un `_count` filtrado en la MISMA consulta del contexto de la fichada: no miembros, 0 sentencias nuevas (presupuesto PERF-5 idéntico: IN 4/11/0, OUT 15/18/0, ROLLOVER 5/17/0).

**Entrada:** se congela en la apertura (`shiftTemplateId`, `shiftTemplateSource`, `scheduledStartAt`, `maxAllowedMinutes` de la plantilla) y en el payload del job (`rotationEntry`); el post-proceso nunca recalcula ni usa asignaciones fijas. **Cambio de bloque** (entrada asignada a un bloque posterior al de la jornada abierta): rollover existente, siempre aceptado (aun `ALERT_ONLY` y < 1200): anterior `FALTA_SALIDA` sin `endAt`/`endPunchId`/horas (0 h), nueva jornada con su bloque; si el vencimiento cerró la anterior en paralelo, una sola reapertura simple. Con `ALERT_ONLY`, `POSIBLE_OLVIDO_SALIDA` queda CRÍTICA y pendiente (nunca reabre una resuelta). Fijos: `shiftTemplateSource` NULL (no bloquea el rollback de R4.1).

**Salida:** jornada con bloque ⇒ plantilla del bloque sin `ShiftAssignment` (G6) y salida programada = `scheduledStartAt` + plantilla (un ingreso tardío pasada la medianoche no corre la salida). Cuatro valores, todos de configuración existente: salida programada, tolerancia, umbral de jornada extendida (régimen → plantilla → 600 legacy) y límite absoluto. Posible olvido de salida — confirmación previa **sólo** si (a) el instante se asignaría como entrada a un bloque posterior, (b) cae en `[inicio − entryToleranceBefore, fin)` de ese bloque y (c) el anterior ya terminó con su tolerancia. José viernes A: 11:02, 12:30, 15:00 y 18:49 cierran solos; 18:55 y 19:02 preguntan; nocturnos legítimos (Juanchi 07:05, Carlos 03:05) nunca. Nada se persiste antes de confirmar; el fichador ofrece «Registrar ENTRADA» (recomendado) o «Confirmar SALIDA anterior». Confirmar no saltea límite, superposición (`WORK_SHIFT_OVERLAP`), horas manuales ni períodos protegidos. Límite superado: no se registra, AuditLog `REJECT` del intento y `FALTA_SALIDA` por el mantenimiento.

**Avisos (sistema existente):** sólo por anomalías persistidas, al responsable asignado y RRHH: falta de ingreso (R4.3b), falta de salida (texto propio en el cambio de bloque), jornada extendida, salida tardía cerca de otro turno (un solo aviso por jornada, con contexto; nunca por abrir o cancelar la confirmación), D3: `POSSIBLE_SHIFT_CONFIGURATION_MISSING` no suprimible (un aviso por persona y día), `OUTSIDE_WINDOW` con `TURNO_NO_IDENTIFICADO` no suprimible, `UNSCHEDULED` suprimible (provisional, R4.5); franco sólo `ACTIVIDAD_EN_FRANCO`. **D5:** `rotationDiagnosis` versionado en el AuditLog de la transacción de cada fichada de miembro.

**Fichador:** `ExitDecisionDialog` (Modal accesible, foco en ENTRADA, misma foto, cierre automático a los 45 s, sin códigos ni ids); contrato aditivo `exitConfirmation` + `clockGuidance` (ver `BACKEND_API_CONTRACTS.md`). QA visual en 320×568, 390×844, 844×390, 768×1024, 1024×768, 1366×768, 1440×900 y 1920×1080 sin desbordes y con objetivos ≥ 44 px.

**Validación local** (bases descartables en `localhost`; ningún comando contra Neon): backend 4260 tests, `typecheck`, `build`; `clock/rotationClock.integration.test.ts` (opt-in `ROTATION_CLOCK_IT_DATABASE_URL`, en el CI) 20/20 estable en 3 corridas con fichadas reales por HTTP y la grilla de Planta; 12 integraciones (159 tests) con el cliente de la feature; fichador 501 tests, `tsc`, `build` + aislamiento, 14 e2e (3 nuevas). Compatibilidad con development: base local migrada hasta `20261120120000_add_shift_rotations` + el mismo cliente que el checkout principal (schema de e87a53c): 10 integraciones legacy (123 tests) y sonda de 265 consultas reales (fichadas IN/OUT, 409, rollover legacy, tick de mantenimiento) sin ninguna referencia a columnas o tablas inexistentes.

**Recuperación (2026-11-24):** el worktree temporal con R4.4 sin commitear se perdió por un reinicio (scratchpad en `/private/tmp`); se reprodujo desde la transcripción de la sesión (32 operaciones con verificación de coincidencia exacta) en un worktree permanente y se re-validó completo.

**Requisitos antes de R4.9 (cargar Planta):** configurar por plantilla el límite absoluto (`absoluteOpenShiftLimitMinutes`; el 1200 actual es provisional) y el umbral de jornada extendida, tolerancias reales (definen también el disparador), fichador desplegado en los equipos, y **T-R4-CONC** resuelto.

**Pendiente:** R4.5 (tratamiento informativo de trabajo no programado y de entrada muy anticipada); R4.6–R4.9; deploy de R4.1A + R4.3a en development (autorización aparte).

### 25.7 R4.5 — Trabajo no programado (implementada y validada en local; migración NO aplicada a ninguna base compartida)

**Estado:** plan definitivo aprobado por el usuario el 2026-11-24 (versión simplificada: sin continuidad automática de jornadas). Migración `20261124120000_shift_alert_unscheduled_work_types` validada contra PostgreSQL 18 local; no aplicada a development, pre-development ni producción. **A diferencia de R4.3b/R4.4, cambia el camino legacy** (turnos fijos): el código de R4.5 no se puede desplegar sin su migración.

**Principio:** el motor de obligación decide primero; las alertas que dependen de un turno sólo existen si había obligación. Separación conservada: turno programado ≠ evidencia de fichada ≠ horas ≠ Horas Especiales ≠ Conceptos ≠ alertas/avisos. No cambian horas, Horas Especiales (§15/§16 de `WORKED_TIME_ACCOUNTING_MODEL.md`), Conceptos, Novedades, falta de ingreso ni inactividad.

**Qué ya resolvía R4.4 (sin cambios):** entrada anticipada dentro de la ventana `[inicio − 240, fin)` asignada al bloque sin exigir otra entrada; salidas tardías con tolerancias, límite absoluto, olvido de salida y aviso único (13G); entrada fuera de ventana registrada sin bloque y sin satisfacer el bloque posterior (D3, aviso inmediato); cambio de bloque entre jornadas con bloque; franco de un miembro → sólo `ACTIVIDAD_EN_FRANCO`.

**Precedencia de la entrada (fecha operativa D, igual para fijos y rotación):**

| # | Situación | Resultado | Aviso |
|---|---|---|---|
| 1 | Turno exigible y fichada asignada (bloque o turno fijo) | Puntualidad como siempre | Como siempre |
| 2 | Franco en D | Sólo `ACTIVIDAD_EN_FRANCO` (paso de francos) | Sí, uno |
| 3 | Feriado no convocado en D | `TRABAJO_NO_PROGRAMADO` (`FERIADO_NO_CONVOCADO`) | No |
| 4 | Rotación MISSING/CONFLICT en D | `POSSIBLE_SHIFT_CONFIGURATION_MISSING` | Sí, uno por persona y día |
| 5 | Antes de la ventana de un bloque posterior del mismo día | `INGRESO_FUERA_DE_VENTANA` (ADVERTENCIA, pendiente; antes `TURNO_NO_IDENTIFICADO`) | Sí, inmediato (D3) |
| 6 | Convocado al feriado sin horario aplicable | Sólo diagnóstico | No |
| 7 | SIN_TURNO / TURNO_FLEXIBLE / `alertOnOutOfShift = false` | Ninguna fila (D5) | No |
| 8 | Fijo con asignación HABILITADA vigente que no incluye D (Juanjo sábado/domingo); rotación REST; fuera de los bloques del día | `TRABAJO_NO_PROGRAMADO` (`DIA_NO_PROGRAMADO` / `DESCANSO_ROTACION` / `FUERA_DEL_TURNO`) | No |
| 9 | Fijo sin ninguna asignación HABILITADA vigente | `TURNO_NO_IDENTIFICADO` (configuración legacy, sin cambios) | Sí |

- **Franco y feriado no convocado antes que la configuración** (decisión 1 del usuario): sin obligación ese día, un MISSING/CONFLICT no se avisa por la fichada; queda en `planIssue` del `rotationDiagnosis` (versión 2) y se detecta en días hábiles y en la vista previa (R4.7). `RotationObligation.dayOff` hace que el franco gane aunque la resolución informe feriado o SIN_TURNO (que la preceden en `WORK_OBLIGATION`).
- **Un turno asignado nunca oculta un franco:** el franco de D elimina los bloques de D; sólo se asignan bloques de D−1/D+1 cuya fecha operativa no lo tiene.
- **Fijos (decisión 3):** `matchShiftForEmployee` no cambia (A2/A4). Después del matching se resuelven los hechos de D (`loadEntryDayFacts`: feriado por calendario sin alcance —deuda P7, igual que la obligación—, convocatoria ACTIVA, franco ACTIVO; hasta 3 lecturas, sólo en el post-proceso asíncrono). En franco o feriado no convocado la plantilla **se sigue adoptando** (fija la fecha operativa de la que dependen el paso de francos y la exclusión de horas de §18, y los límites de jornada abierta), pero no hay alertas de puntualidad ni `SHIFT_NOT_ENABLED`; al cerrar, se relee y se omiten fuera de turno, salida anticipada/tardía y jornada insuficiente (un franco cargado después del ingreso también prevalece). Se conservan jornada extendida, conceptos y olvido/falta de salida. Convocado con su turno habitual (P8): sin cambios. Turnos nocturnos: la fecha operativa es la de la ocurrencia adoptada (entrada anticipada 22:00 del domingo → domingo; tardía 00:30 del lunes → domingo).

**Clasificación informativa (`TRABAJO_NO_PROGRAMADO`):** se escribe con `recordInformativeShiftAlert` — `status: RESUELTA`, `severity: INFO`, `resolvedByUserId: null`, `resolvedAt` = alta, `resolutionNote` "Informativa: trabajo sin turno programado el sábado 07/11/2026 (día no incluido en su turno asignado). No requiere revisión." (sin ids). `upsert` con `update` vacío: idempotente ante reintentos del paso, nunca reabre ni avisa (no pasa por `createShiftAlert`, cuyo `update` reabre). No aparece en Pendientes (filtro por defecto) ni ofrece Resolver; en la UI se muestra "Informativa · No requiere revisión" y no cambia el estado del grupo de su jornada. Ningún otro contador lee `ShiftAlert` (verificado).

**Nueva ENTRADA con una jornada abierta sin bloque (decisión 2):** miembro de rotación, jornada abierta sin bloque (fuera de ventana, no programada, franco, sin configuración) y ENTRADA asignada a un bloque válido que empieza después de esa jornada → **el mismo cambio de bloque de R4.4** (`clockBlockChangeEntry`): la anterior pasa a `FALTA_SALIDA` sin `endAt`, `endPunchId` ni horas (`totalMinutes` NULL + `TimeEntry` 0 h, como el rollover), la nueva nace con su bloque congelado y su ENTRADA satisface la obligación. ALERT_ONLY y la carrera con el vencimiento se tratan como en R4.4. Un solo aviso (falta de salida, "No registró la salida de la jornada iniciada a las 11:30; ya ingresó a su turno de las 17:00…"). **Reintento / doble toque:** además del enfriamiento y la idempotencia por `requestId`, `isBlockChangeFromUnblockedShift` exige que el ingreso de la jornada abierta no se asignaría a ese mismo bloque (misma llegada → 409 de siempre). Una ENTRADA que no se asigna a ningún bloque sigue con 409. **Sin continuidad automática** (retirada por el usuario): nunca se adopta el bloque sobre la jornada anterior ni se suman horas entre dos entradas. Fijos: sin cambios.

**Roberto (11:30 / bloque 17:00):** 11:30 → jornada sin bloque, `INGRESO_FUERA_DE_VENTANA` + 1 aviso; sale a las 14:00 → 2 h 30 min reales y a las 17:00 entra normal; si a las 17:00 ficha ENTRADA sin salida → anterior `FALTA_SALIDA` 0 h + 1 aviso, nueva con el bloque de las 17:00, sin falta de ingreso; si no vuelve → `FALTA_INGRESO` del bloque (R4.3b).

**Juanjo (fijo L–V 07–15):** sábado/domingo → jornada y horas reales (DOMINGO según regla), `TRABAJO_NO_PROGRAMADO` resuelta, **0 avisos**, sin falta de ingreso ni SIN_ACTIVIDAD; franco → sólo `ACTIVIDAD_EN_FRANCO` (antes eran 2 avisos); feriado no convocado en día hábil → adopta su turno, sin puntualidad, informativa sin aviso; convocado → como siempre.

**Migración:** dos `ALTER TYPE "ShiftAlertType" ADD VALUE` (`TRABAJO_NO_PROGRAMADO`, `INGRESO_FUERA_DE_VENTANA`); sin datos. Rollback `prisma/rollbacks/20261124120000_shift_alert_unscheduled_work_types.down.sql`: transacción + `LOCK`, **aborta si alguna alerta usa los valores nuevos** (nunca las borra), recrea el tipo con los 16 valores previos en el orden del historial y borra su fila de `_prisma_migrations`. Orden: antes que los rollbacks de R4.3a, R4.1A y R4.1, y con el código anterior a R4.5 ya desplegado.

**Validación local** (Postgres.app 18, bases descartables `r45_mig`, `clock_it_r45_*`, `deletion_it_r45`; ningún comando contra Neon):
- Historial completo (81 migraciones) en base limpia: `migrate status` al día y `migrate diff` **No difference detected**. Rollback con una alerta `TRABAJO_NO_PROGRAMADO` → aborta, hash de `ShiftAlert` idéntico; sin ella → revierte, legacy intacto (hash), `migrate diff` contra el schema de `4b5f15b` sin diferencias, migración otra vez pendiente; re-aplicada sin diferencias.
- **Compatibilidad con development:** base local con el historial de `63d4338` (último aplicado en development, hasta `20261120120000`): `'TRABAJO_NO_PROGRAMADO'::"ShiftAlertType"` falla (22P02) ⇒ **el backend de R4.5 contra development sin migrar haría fallar el paso de entrada del post-proceso de un fijo en fin de semana o feriado** (el job reintenta y queda FAILED; la fichada no se pierde). Aplicando sobre ese estado las tres pendientes (`20261120180000`, `20261121090000`, `20261124120000`) con `migrate deploy`: en orden, sin errores y `migrate diff` sin diferencias.
- Backend 4321 tests (+61), `typecheck`, `build`; 15 suites de integración del CI 201/201 (incluidos PERF-5 de la fichada sin cambios de presupuesto, post-proceso, francos, horas manuales, Novedades); `rotationClock` + `rotationAttendance` 41/41 estables en 3 corridas. Frontend 1564 tests y `build`; QA visual de Alertas (Playwright con API interceptada, sin backend real) en 1366×768, 1440×900, 1920×1080, 768×1024 y 390×844 sin desborde horizontal. Fichador sin cambios: 501 tests, `build` y aislamiento.
- **Expectativas actualizadas (autorizadas, decisión 4):** caracterización A1 sábado, A2 feriado y R1.1-A (Juanjo); `rotationEntry.test.ts` (configuración vs franco); dos casos Juanjo de `workShiftEvaluationRunner.test.ts`; `rotationClock.integration` (REST, fuera de ventana, `rotationDiagnosis.version` 2). El resto de los cambios en tests existentes son mocks ampliados (franco, convocatoria y feriados por defecto vacíos).

**Pendiente antes de R4.9 (requisito del usuario):** revisar tolerancias y política de avisos de las **entradas anticipadas y salidas tardías habituales** de Planta: hoy una entrada anticipada dentro de la ventana fuera de tolerancia genera `INGRESO_ANTICIPADO` (INFO) con aviso y una salida tardía `SALIDA_TARDIA` con aviso (13G); con la operación real (entrar horas antes, salir después) serían avisos frecuentes. Se suma a límites por plantilla, umbrales de jornada extendida, fichador desplegado y **T-R4-CONC** (sigue bloqueando R4.9).

**Riesgos y notas:**
- Al promoverse, los fijos dejan de recibir avisos por trabajar en días no asignados y pierden las alertas de turno en francos y feriados no convocados: medir antes con un conteo de sólo lectura (autorización aparte).
- `POSSIBLE_SHIFT_CONFIGURATION_MISSING` (que R4.4 volvió a generar para rotaciones) sigue rotulado "Registro anterior" en `ShiftAlertsPage` (`LEGACY_ALERT_TYPES`): deuda de R4.4, no corregida.
- Deploy: R4.1A + R4.3a + R4.5 juntas y antes del código (autorización aparte, procedimiento de §24.19).

---

## Anexo — respuestas directas a las 22 preguntas

1. **Fuente real hoy:** `ShiftAssignment` (+ `ShiftTemplate`), filtrada por estado/vigencia/weekday, con franco, feriado/convocatoria y régimen aplicados por cada consumidor. No hay fuente única.
2. **Implementaciones distintas:** cuatro reglas (más temprana, más cercana, turno adoptado, suma/UNRESOLVED) en tres resolutores (`workObligation`, `matchShiftForEmployee`, `expectedWorkday`) + la herencia del turno adoptado.
3. **Dos HABILITADOS aplicables el mismo día:** obligación = el de inicio más temprano; entrada = el más cercano a la fichada; Novedades = suma si disjuntos (1200 min en Mañana+Tarde) o UNRESOLVED si se superponen.
4. **Entrada:** el turno propio aplicable (HABILITADO o DESHABILITADO) con la ocurrencia más cercana a la fichada.
5. **Salida:** el adoptado en la entrada (`WorkShift.shiftTemplateId`), con estado tomado de `ShiftAssignment(employee, template)`.
6. **Falta de ingreso:** el de inicio más temprano de `resolveWorkObligationCandidates`.
7. **Inactividad:** el universo de `resolveWorkObligationCandidates` (el turno sólo define si hay obligación; la evidencia es cualquier actividad del día).
8. **Novedad `WORK_OBLIGATION`/`EXPECTED_SCHEDULE`:** `evaluateEmployeeWorkday` — turno de la convocatoria en feriado; si no, todas las asignaciones aplicables (suma/UNRESOLVED).
9. **Feriados:** sin convocatoria ⇒ sin obligación en todos los consumidores; con convocatoria ⇒ alertas exigen además asignación aplicable y usan su turno; Novedades usan el turno/horario de la convocatoria. Alertas no evalúan el alcance de la regla (P7).
10. **Francos:** `EmployeeDayOff` ACTIVO anula la obligación en alertas y Novedades, gana sobre la convocatoria; la fecha operativa de jornadas nocturnas se resuelve con el turno adoptado.
11. **Depende de `WorkRegime`:** obligación (SIN_TURNO excluye), supresión de alertas de configuración (`kind`/`alertOnOutOfShift`), JORNADA_FUERA_DE_TURNO (no en SIN_TURNO), umbral de jornada extendida, acción de desborde (ROLLOVER/ALERT_ONLY), y en Novedades UNRESOLVED para SIN_TURNO/TURNO_FLEXIBLE sin asignación.
12. **Depende sólo de `ShiftTemplate`:** horarios, cruce de medianoche, tolerancias de entrada/salida, mínimo de cumplimiento, umbral informativo (si no hay régimen), olvido de salida, límite absoluto, minutos esperados.
13. **Riesgo sin centralizar:** hasta cuatro turnos esperados distintos para el mismo día, notificaciones falsas irreversibles, coberturas de Novedades incoherentes con alertas y reinterpretación del pasado (§6).
14. **A/B/C/D:** B (+ overrides explícitos como D acotado) con resolver central; A y C descartadas (§7).
15. **Ciclo A/B:** `ShiftRotation(cycleLengthWeeks=2, anchorWeekStart)` + equipos + celdas (equipo, semana, día → turno) (§12.1).
16. **3–4 semanas:** mismo modelo con `cycleLengthWeeks` 3/4; cambios de ciclo = nueva versión con vigencia (§12.3).
17. **Excepciones:** `EmployeeShiftOverride` por persona-fecha (reemplazo / sin obligación / intercambio), sin tocar el ciclo (§13).
18. **Calendario de verificación:** vista previa de solo lectura que llama al mismo resolver, con origen y advertencias por celda (§15.3).
19. **Grupos:** `ShiftGroup` + `ShiftTemplate.shiftGroupId` nullable, UI agrupada, sin backfill automático (§11).
20. **`categoryName` vs `ShiftGroup`:** `ShiftGroup`; `categoryName` queda como etiqueta secundaria (§11.1).
21. **Permisos por grupo:** `UserShiftGroupScope` + helper propio; `employeeAccessWhere` intacta; RRHH global (§14).
22. **Preservar turnos fijos:** resolver en modo paridad (los fijos conservan su desempate actual), caracterización congelada antes del refactor, tablas nuevas inertes, `shiftTemplateSource = null` ⇒ lógica actual, sin migrar empleados (§16).
