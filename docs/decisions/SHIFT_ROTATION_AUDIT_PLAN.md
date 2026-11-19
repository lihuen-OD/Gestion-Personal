# Rotaciones de turnos — auditoría y plan (Etapa R0)

Estado: **R0 (auditoría y plan), R1 (caracterización + diagnóstico) y R2 (resolución central en modo paridad) completadas** — cierre de R1 en §21, de R2 en §22. R3 no iniciada. Fecha: 2026-11-19. Rama de trabajo al auditar: `pre-development` (`4de624c`); R1 en `fix/shift-rotation-r1`.

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
- **Entrada:** Roberto (Tarde) ficha 16:55 ⇒ referencia 17:00, sin alerta; ficha 11:30 ⇒ INGRESO_ANTICIPADO contra 17:00 (no INGRESO_TARDE contra 07:00); `WorkShift.shiftTemplateSource = ROTATION`.
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
| **R4** | Rotaciones en backend: tablas, resolver con `ROTATION`, `WorkShift.shiftTemplateSource`, salida, recálculo de cobertura, endpoints sólo RRHH, contratos documentados. | Aditivo | Sólo para miembros de rotaciones (ninguno al desplegar) |
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
