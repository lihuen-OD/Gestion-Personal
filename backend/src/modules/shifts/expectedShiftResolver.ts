/**
 * Resolución central del turno esperado — Etapa R2
 * (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §22). Núcleo PURO: no consulta
 * la base, no conoce HTTP ni Prisma; los consumidores cargan sus datos en lote
 * (como ya lo hacían) y le pasan el contexto de un empleado + fecha operativa.
 *
 * R2 es una refactorización en MODO PARIDAD: sólo modela las fuentes que ya
 * existen (franco, feriado/convocatoria, régimen, asignaciones fijas) y
 * conserva exactamente el comportamiento actual de cada consumidor, incluidos
 * los bugs conocidos que R1 congeló en shiftBehavior.characterization.test.ts.
 *
 * Tres piezas:
 *   1. Bloque de asignaciones fijas (único lugar con vigencia, día de semana,
 *      estado de la asignación y de la plantilla).
 *   2. `resolveExpectedShift(input, policy)`: precedencia explícita. Hoy los
 *      consumidores difieren en el orden y en la semántica de algunos casos
 *      (SIN_TURNO, TURNO_FLEXIBLE, alcance del feriado), así que la diferencia
 *      se declara como `policy` en vez de esconderse en cada servicio.
 *   3. Reglas de selección LEGACY entre varias asignaciones aplicables
 *      (`pickEarliestFixedCandidate`, `entryReferenceCandidates`). El resolver
 *      NO elige un turno para todos: devuelve `fixedCandidates` y cada
 *      consumidor aplica su regla actual. Corregirlo es una decisión posterior
 *      (R10), no de esta etapa.
 *
 * Extensión prevista (R4/R7): nuevas fuentes `ROTATION` y `OVERRIDE` entran
 * en `resolveExpectedShift` con resultado único (`shift`), sin tocar el bloque
 * legacy de asignaciones fijas.
 */
import type { WorkRegimeKind } from "@prisma/client";
import { argentinaCalendarDate, argentinaDayRange, scheduledInstantForShiftTime } from "../../shared/datetime/argentinaTime";

// ── 1. Asignaciones fijas ───────────────────────────────────────────────────

export type ShiftAssignmentStatusValue = "HABILITADO" | "DESHABILITADO";

// effectiveFrom/effectiveTo/weekdays opcionales a propósito (Etapa 8J): en la
// base siempre existen, pero los fixtures previos a 8I no los cargan —
// ausente = sin restricción ("siempre vigente, todos los días").
export type ShiftAssignmentVigency = {
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
  weekdays?: number[];
};

// Vigencia: effectiveFrom <= fecha y (effectiveTo null o >= fecha), mismo
// criterio que EmployeeWorkRegime. `referenceDate` es una fecha calendario ya
// resuelta (medianoche UTC), no un instante real.
export function isShiftAssignmentActiveOnDate(assignment: Pick<ShiftAssignmentVigency, "effectiveFrom" | "effectiveTo">, referenceDate: Date): boolean {
  if (assignment.effectiveFrom && assignment.effectiveFrom > referenceDate) return false;
  if (assignment.effectiveTo && assignment.effectiveTo < referenceDate) return false;
  return true;
}

// weekdays: 0=domingo..6=sábado (mismo criterio que DoubleHourRule.weekdays).
// Vacío o ausente = todos los días. getUTCDay() sobre la fecha calendario ya
// resuelta da el día correcto sin volver a aplicar el huso.
export function isShiftAssignmentApplicableOnWeekday(assignment: Pick<ShiftAssignmentVigency, "weekdays">, referenceDate: Date): boolean {
  if (!assignment.weekdays?.length) return true;
  return assignment.weekdays.includes(referenceDate.getUTCDay());
}

/** Vigente y aplicable al día de semana de `referenceDate`. */
export function isShiftAssignmentApplicableOnDate(assignment: ShiftAssignmentVigency, referenceDate: Date): boolean {
  return isShiftAssignmentActiveOnDate(assignment, referenceDate) && isShiftAssignmentApplicableOnWeekday(assignment, referenceDate);
}

/** Asignación fija con su plantilla. `template.status` ausente = la consulta ya garantizó ACTIVO. */
export type FixedAssignment<T> = ShiftAssignmentVigency & { status: ShiftAssignmentStatusValue; template: T };

/** Plantilla utilizable: sin `status` (la consulta ya filtró ACTIVO) o con `status` ACTIVO. */
function isTemplateActive(template: object): boolean {
  return !("status" in template) || template.status === undefined || template.status === "ACTIVO";
}

/**
 * "Planificación vigente": HABILITADA, plantilla ACTIVO y vigente en la fecha,
 * sin mirar el día de semana. Conserva el orden de lectura.
 */
export function fixedAssignmentsInVigency<T extends object>(assignments: FixedAssignment<T>[], referenceDate: Date): FixedAssignment<T>[] {
  return assignments.filter(
    (assignment) =>
      assignment.status === "HABILITADO" && isTemplateActive(assignment.template) && isShiftAssignmentActiveOnDate(assignment, referenceDate),
  );
}

/** Planificación vigente que además aplica al día de semana. Conserva el orden de lectura. */
export function applicableFixedAssignments<T extends object>(assignments: FixedAssignment<T>[], referenceDate: Date): FixedAssignment<T>[] {
  return fixedAssignmentsInVigency(assignments, referenceDate).filter((assignment) => isShiftAssignmentApplicableOnWeekday(assignment, referenceDate));
}

// ── 2. Régimen ──────────────────────────────────────────────────────────────

export type RegimePeriod = { effectiveFrom: Date; effectiveTo: Date | null; kind: WorkRegimeKind };

/** Régimen vigente en la fecha; si hay más de uno, el de effectiveFrom más reciente (mismo criterio que findActiveEmployeeWorkRegime). */
export function activeRegimeKindOn(regimes: RegimePeriod[], date: Date): WorkRegimeKind | null {
  let winner: RegimePeriod | null = null;
  for (const regime of regimes) {
    if (regime.effectiveFrom > date || (regime.effectiveTo && regime.effectiveTo < date)) continue;
    if (!winner || regime.effectiveFrom > winner.effectiveFrom) winner = regime;
  }
  return winner?.kind ?? null;
}

// ── 3. Precedencia ──────────────────────────────────────────────────────────

/**
 * Estado de feriado de la fecha para el legajo. null = no es feriado.
 *   IN_SCOPE: alguna regla FERIADO lo alcanza.
 *   OUT_OF_SCOPE: es feriado por calendario pero ninguna regla lo alcanza.
 *   SCOPE_HISTORY_MISSING: no se puede decidir por falta de historia laboral.
 * La obligación de alertas no evalúa alcance (deuda P7): pasa IN_SCOPE para
 * todo feriado por calendario.
 */
export type HolidayScopeStatus = "IN_SCOPE" | "OUT_OF_SCOPE" | "SCOPE_HISTORY_MISSING";

/**
 * Semántica de cada consumidor. NO es un detalle de implementación: son las
 * diferencias reales que hoy existen (§7.4 de NOVELTY_COVERAGE_ENGINE.md) y
 * que R2 conserva.
 *   WORK_OBLIGATION: falta de ingreso e inactividad ("¿debía fichar?").
 *   EXPECTED_WORKDAY: cobertura de Novedades ("¿cuánta jornada tenía?";
 *     ante la duda, UNRESOLVED en vez de 0).
 */
export type ExpectedShiftPolicy = "WORK_OBLIGATION" | "EXPECTED_WORKDAY";

export type ExpectedShiftObligation = "SHIFT" | "NO_OBLIGATION" | "UNRESOLVED";

/** Evidencia que decidió el resultado. ROTATION y OVERRIDE se agregan en R4/R7. */
export type ExpectedShiftSource = "DAY_OFF" | "HOLIDAY_NOT_CONVOKED" | "HOLIDAY_SCOPE" | "HOLIDAY_CONVOCATION" | "REGIME" | "FIXED_ASSIGNMENT" | "NONE";

export type ExpectedShiftReason =
  | "DAY_OFF"
  | "HOLIDAY_NOT_CONVOKED"
  | "HOLIDAY_SCOPE_HISTORY_MISSING"
  | "REGIME_SIN_TURNO"
  | "FLEXIBLE_REGIME_NO_ASSIGNMENT"
  | "NO_APPLICABLE_ASSIGNMENT"
  | "SCHEDULE_MISSING"
  | "PLAN_EXCLUDES_DAY";

export type ExpectedShiftInput<T extends object, C> = {
  dateKey: string;
  /** Todas las asignaciones conocidas del empleado (el resolver filtra vigencia, día y estado). */
  assignments: FixedAssignment<T>[];
  dayOff: boolean;
  holiday: HolidayScopeStatus | null;
  /** Convocatoria ACTIVA a feriado de esa fecha (sin feriado no aporta nada). */
  convocation: C | null;
  regimeKind: WorkRegimeKind | null;
};

export type ExpectedShiftResolution<T, C> = {
  dateKey: string;
  policy: ExpectedShiftPolicy;
  obligation: ExpectedShiftObligation;
  source: ExpectedShiftSource;
  reason: ExpectedShiftReason | null;
  isHoliday: boolean;
  convoked: boolean;
  convocation: C | null;
  /**
   * Plantillas de las asignaciones fijas aplicables ese día, en orden de
   * lectura. LEGACY: puede haber más de una; el resolver no elige — cada
   * consumidor aplica su regla actual (más temprana, suma, más cercana).
   */
  fixedCandidates: T[];
};

/**
 * Precedencia actual, verificada en código y en los tests de caracterización:
 *
 * WORK_OBLIGATION (workObligation.service.ts):
 *   1. feriado sin convocatoria → sin obligación
 *   2. sin asignación aplicable → sin obligación
 *   3. régimen SIN_TURNO → sin obligación (TURNO_FLEXIBLE con asignación sí obliga)
 *   4. franco → sin obligación
 *   5. asignaciones aplicables → obligación (en feriado convocado, con el turno
 *      habitual: el turno de la convocatoria no se usa — P8)
 *   (El empleado ACTIVO y la plantilla ACTIVO los filtra la consulta.)
 *
 * EXPECTED_WORKDAY (expectedWorkday.ts):
 *   1. franco → DAY_OFF (gana incluso sobre la convocatoria)
 *   2. feriado (cualquier estado de alcance) + convocatoria → obligación de la convocatoria
 *   3. feriado IN_SCOPE → sin obligación; SCOPE_HISTORY_MISSING → no resuelto
 *   4. régimen SIN_TURNO → no resuelto
 *   5. asignaciones aplicables → obligación
 *   6. TURNO_FLEXIBLE sin asignación aplicable → no resuelto
 *   7. sin planificación vigente → no resuelto
 *   8. planificación vigente que excluye el día → sin obligación
 *
 * Los resultados finales de los pasos "sin obligación" no dependen de su orden
 * en WORK_OBLIGATION; sí el `reason`, que se conserva tal cual el código.
 */
export function resolveExpectedShift<T extends object, C>(input: ExpectedShiftInput<T, C>, policy: ExpectedShiftPolicy): ExpectedShiftResolution<T, C> {
  const date = argentinaCalendarDate(input.dateKey);
  const applicable = applicableFixedAssignments(input.assignments, date).map((assignment) => assignment.template);
  const convoked = Boolean(input.holiday && input.convocation);
  const isHoliday = policy === "WORK_OBLIGATION" ? input.holiday !== null : input.holiday === "IN_SCOPE" || convoked;
  const resolution = (obligation: ExpectedShiftObligation, source: ExpectedShiftSource, reason: ExpectedShiftReason | null): ExpectedShiftResolution<T, C> => ({
    dateKey: input.dateKey,
    policy,
    obligation,
    source,
    reason,
    isHoliday,
    convoked,
    convocation: convoked ? input.convocation : null,
    fixedCandidates: applicable,
  });

  if (policy === "WORK_OBLIGATION") {
    if (input.holiday && !convoked) return resolution("NO_OBLIGATION", "HOLIDAY_NOT_CONVOKED", "HOLIDAY_NOT_CONVOKED");
    if (!applicable.length) return resolution("NO_OBLIGATION", "NONE", "NO_APPLICABLE_ASSIGNMENT");
    if (input.regimeKind === "SIN_TURNO") return resolution("NO_OBLIGATION", "REGIME", "REGIME_SIN_TURNO");
    if (input.dayOff) return resolution("NO_OBLIGATION", "DAY_OFF", "DAY_OFF");
    return resolution("SHIFT", convoked ? "HOLIDAY_CONVOCATION" : "FIXED_ASSIGNMENT", null);
  }

  if (input.dayOff) return resolution("NO_OBLIGATION", "DAY_OFF", "DAY_OFF");
  if (convoked) return resolution("SHIFT", "HOLIDAY_CONVOCATION", null);
  if (input.holiday === "IN_SCOPE") return resolution("NO_OBLIGATION", "HOLIDAY_NOT_CONVOKED", "HOLIDAY_NOT_CONVOKED");
  if (input.holiday === "SCOPE_HISTORY_MISSING") return resolution("UNRESOLVED", "HOLIDAY_SCOPE", "HOLIDAY_SCOPE_HISTORY_MISSING");
  if (input.regimeKind === "SIN_TURNO") return resolution("UNRESOLVED", "REGIME", "REGIME_SIN_TURNO");
  if (applicable.length) return resolution("SHIFT", "FIXED_ASSIGNMENT", null);
  if (input.regimeKind === "TURNO_FLEXIBLE") return resolution("UNRESOLVED", "REGIME", "FLEXIBLE_REGIME_NO_ASSIGNMENT");
  if (!fixedAssignmentsInVigency(input.assignments, date).length) return resolution("UNRESOLVED", "NONE", "SCHEDULE_MISSING");
  return resolution("NO_OBLIGATION", "FIXED_ASSIGNMENT", "PLAN_EXCLUDES_DAY");
}

// ── 4. Selección LEGACY entre varias asignaciones aplicables ────────────────

/**
 * Regla de la obligación de trabajo (falta de ingreso / inactividad): gana el
 * inicio programado más temprano de la fecha operativa; en empate, el primero
 * leído. COMPORTAMIENTO ACTUAL (bug conocido P1, §5.1): con Mañana + Tarde
 * aplicables, siempre elige Mañana.
 */
export function pickEarliestFixedCandidate<T extends { startTime: string }>(dateKey: string, templates: T[]): { template: T; scheduledStartAt: Date } | null {
  const referenceInstant = argentinaDayRange(dateKey).startAt;
  let earliest: { template: T; scheduledStartAt: Date } | null = null;
  for (const template of templates) {
    const scheduledStartAt = scheduledInstantForShiftTime(referenceInstant, template.startTime);
    if (!earliest || scheduledStartAt < earliest.scheduledStartAt) earliest = { template, scheduledStartAt };
  }
  return earliest;
}

export type EntryAssignmentRef = ShiftAssignmentVigency & { shiftTemplateId: string; status: ShiftAssignmentStatusValue };

/**
 * Candidatos del matching de entrada (Etapas 8J/13A/13E): las asignaciones
 * propias aplicables a `referenceDate` (el día CALENDARIO de la fichada, P9),
 * primero las HABILITADAS y después las DESHABILITADAS, en orden de lectura,
 * contra plantillas ACTIVO. Las deshabilitadas se incluyen a propósito: si
 * ganan, producen SHIFT_NOT_ENABLED_FOR_EMPLOYEE. Franco, feriado y régimen no
 * intervienen en el matching (A2/A4 de la caracterización). El orden importa:
 * en un empate exacto de cercanía gana el primero (§21.3).
 */
export function entryReferenceCandidates<T extends { id: string }>(input: {
  referenceDate: Date;
  assignments: EntryAssignmentRef[];
  activeTemplates: T[];
}): Array<{ template: T; enabled: boolean }> {
  const appliesToday = (assignment: EntryAssignmentRef) => isShiftAssignmentApplicableOnDate(assignment, input.referenceDate);
  const templatesById = new Map(input.activeTemplates.map((template) => [template.id, template]));
  const enabledIds = new Set(input.assignments.filter((assignment) => assignment.status === "HABILITADO" && appliesToday(assignment)).map((assignment) => assignment.shiftTemplateId));
  const disabledIds = new Set(input.assignments.filter((assignment) => assignment.status === "DESHABILITADO" && appliesToday(assignment)).map((assignment) => assignment.shiftTemplateId));
  return [...enabledIds, ...disabledIds]
    .map((id) => templatesById.get(id))
    .filter((template): template is T => Boolean(template))
    .map((template) => ({ template, enabled: enabledIds.has(template.id) }));
}
