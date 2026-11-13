/**
 * Jornada esperada de un empleado en una fecha, para la cobertura de Novedades
 * (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §7). Responde, sin inventar:
 *   1. ¿tenía obligación laboral ese día?
 *   2. si la tenía, ¿cuántos minutos?
 *   3. ¿de qué fuente salió?
 *   4. si no se puede saber con certeza, un estado UNRESOLVED con motivo.
 *
 * NO reemplaza a `workObligation.service.ts::resolveWorkObligationCandidates`
 * (falta de ingreso, inactividad, alertas): comparte sus bloques puros
 * (vigencia y día de semana de la asignación) pero tiene semántica propia.
 * Diferencias deliberadas, para no fabricar datos:
 *   - SIN_TURNO: para alertas es "sin obligación"; acá es UNRESOLVED.
 *   - TURNO_FLEXIBLE sin asignación aplicable: acá es UNRESOLVED.
 *   - Varias asignaciones aplicables: alertas toman una (la más temprana o la
 *     más cercana a la fichada); acá, turnos disjuntos suman (turno partido) y
 *     turnos superpuestos quedan UNRESOLVED (configuración ambigua).
 *   - Feriado: se evalúa con el alcance de la regla FERIADO sobre la historia
 *     del legajo (mismas piezas que el motor de Horas Especiales); alertas usan
 *     `holidayDatesInRange`, que ignora el alcance (deuda P4, sin cambios).
 *   - Convocatoria a feriado sin turno asignado: alertas no la ven; acá usa el
 *     turno o el horario de la propia convocatoria.
 *
 * Los minutos se atribuyen a la fecha OPERATIVA (la del inicio programado del
 * turno, docs/decisions/EMPLOYEE_DAY_OFF.md §4): un turno 22:00-06:00 del lunes
 * son 480 min del lunes, nunca se parte por fecha calendario.
 */
import type { WorkRegimeKind } from "@prisma/client";
import { argentinaCalendarDate, calendarDateKey, calendarDaysInclusive, nextCalendarDateKey } from "../../shared/datetime/argentinaTime";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { evaluateRuleScope, type EngineScopeHistory } from "../labor-history/laborHistory.scope";
import { laborHistoryService } from "../labor-history/laborHistory.service";
import type { HistoryReader } from "../labor-history/laborHistory.repository";
import { ruleScopeOf } from "../time-entries/specialHourRuleScope";
import { buildActiveDatesByRule, ruleMatchesDate, type RecurrenceType } from "../workforce-management/doubleHourRuleMatching";
import { computeExpectedMinutes, parseShiftTime } from "./shiftTemplateTime";
import { isShiftAssignmentActiveOnDate, isShiftAssignmentApplicableOnWeekday } from "./workShiftEvaluation.service";

// ── Resultado ───────────────────────────────────────────────────────────────

export type WorkdayObligation = "WORKDAY" | "NO_WORK_OBLIGATION" | "HOLIDAY_NOT_CONVOKED" | "DAY_OFF" | "UNRESOLVED";

/**
 * Los cuatro primeros existen en `NoveltyCoverageScheduleReviewReason`
 * (migración de la etapa 1). Los dos últimos surgieron de la auditoría de la
 * etapa 2 y todavía no son persistibles: la etapa 3 decide si se agregan al
 * enum o cómo se tratan (§7 del ADR).
 */
export type WorkdayUnresolvedReason =
  | "SCHEDULE_MISSING"
  | "FLEXIBLE_REGIME_NO_ASSIGNMENT"
  | "REGIME_WITHOUT_SCHEDULE"
  | "EXPECTED_MINUTES_UNKNOWN"
  | "SHIFT_ASSIGNMENTS_OVERLAP"
  | "HOLIDAY_SCOPE_HISTORY_MISSING";

/** Qué evidencia decidió el resultado. */
export type WorkdaySource =
  | "EMPLOYEE_DAY_OFF"
  | "HOLIDAY_RULE"
  | "HOLIDAY_CONVOCATION"
  | "WORK_REGIME"
  | "SHIFT_PLAN"
  | "NONE";

/** De dónde salieron los minutos esperados (sólo WORKDAY o el intento fallido). */
export type WorkdayMinutesSource = "CONVOCATION_SHIFT_TEMPLATE" | "SHIFT_ASSIGNMENT" | "CONVOCATION_TIMES";

export type ExpectedWorkday = {
  dateKey: string;
  obligation: WorkdayObligation;
  unresolvedReason: WorkdayUnresolvedReason | null;
  /** 0 = confirmado sin obligación; null = desconocido (UNRESOLVED); > 0 = jornada. */
  expectedMinutes: number | null;
  shiftTemplateIds: string[];
  isHoliday: boolean;
  convoked: boolean;
  source: WorkdaySource;
  minutesSource: WorkdayMinutesSource | null;
};

// ── Contexto (lo arma loadEmployeeWorkdayContext) ───────────────────────────

export type WorkdayShiftTemplate = {
  id: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  expectedMinutes: number | null;
  status: "ACTIVO" | "INACTIVO";
};

export type WorkdayShiftAssignment = {
  status: "HABILITADO" | "DESHABILITADO";
  effectiveFrom: Date;
  effectiveTo: Date | null;
  weekdays: number[];
  template: WorkdayShiftTemplate;
};

export type WorkdayConvocation = {
  template: WorkdayShiftTemplate | null;
  expectedStartTime: string | null;
  expectedEndTime: string | null;
};

export type WorkdayRegimePeriod = { effectiveFrom: Date; effectiveTo: Date | null; kind: WorkRegimeKind };

/**
 * Estado de feriado de una fecha para un legajo. Ausente = ninguna regla
 * FERIADO vigente cae en esa fecha por calendario.
 *   IN_SCOPE: alguna regla FERIADO de la fecha alcanza al legajo.
 *   OUT_OF_SCOPE: hay FERIADO por calendario pero ninguno lo alcanza.
 *   SCOPE_HISTORY_MISSING: ninguna lo alcanza con certeza y alguna depende de
 *     una dimensión sin historia registrada esa fecha.
 */
export type HolidayScopeStatus = "IN_SCOPE" | "OUT_OF_SCOPE" | "SCOPE_HISTORY_MISSING";

export type EmployeeWorkdayContext = {
  employeeId: string;
  assignments: WorkdayShiftAssignment[];
  dayOffDates: ReadonlySet<string>;
  convocations: ReadonlyMap<string, WorkdayConvocation>;
  regimes: WorkdayRegimePeriod[];
  holidays: ReadonlyMap<string, HolidayScopeStatus>;
};

// ── Minutos de uno o varios turnos (P3) ─────────────────────────────────────

/** Minutos canónicos de un turno: el valor guardado o, si falta, la misma fórmula del alta. */
export function shiftTemplateExpectedMinutes(template: WorkdayShiftTemplate): number | null {
  if (template.expectedMinutes != null) return template.expectedMinutes > 0 ? template.expectedMinutes : null;
  if (parseShiftTime(template.startTime) === null || parseShiftTime(template.endTime) === null) return null;
  const minutes = computeExpectedMinutes(template.startTime, template.endTime, template.crossesMidnight);
  return minutes > 0 ? minutes : null;
}

/** Intervalo semicerrado [inicio, fin) en minutos desde la medianoche de la fecha operativa. */
function shiftTemplateInterval(template: WorkdayShiftTemplate): { start: number; end: number } | null {
  const start = parseShiftTime(template.startTime);
  if (start === null || parseShiftTime(template.endTime) === null) return null;
  const span = computeExpectedMinutes(template.startTime, template.endTime, template.crossesMidnight);
  return span > 0 ? { start, end: start + span } : null;
}

export type TemplatesMinutesResult = { minutes: number } | { unresolved: "EXPECTED_MINUTES_UNKNOWN" | "SHIFT_ASSIGNMENTS_OVERLAP" };

/**
 * Regla canónica P3 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §7):
 *   - un turno: sus minutos canónicos;
 *   - varios turnos cuyos horarios no se superponen (turno partido, tocarse
 *     en el borde no es superponerse): la suma de los minutos de cada uno
 *     — 08:00-12:00 + 14:00-18:00 = 480;
 *   - varios turnos con horarios superpuestos: UNRESOLVED. El sistema permite
 *     asignar varios turnos distintos el mismo día sin validar solapamiento,
 *     y el motor de alertas los trata como alternativas (toma uno), así que
 *     08:00-16:00 + 12:00-20:00 no dice si la jornada es de 8 o de 12 h:
 *     nunca 960, tampoco una unión de 720 inventada.
 */
export function expectedMinutesForTemplates(templates: WorkdayShiftTemplate[]): TemplatesMinutesResult {
  if (!templates.length) return { unresolved: "EXPECTED_MINUTES_UNKNOWN" };
  if (templates.length === 1) {
    const minutes = shiftTemplateExpectedMinutes(templates[0]!);
    return minutes === null ? { unresolved: "EXPECTED_MINUTES_UNKNOWN" } : { minutes };
  }
  const intervals = templates.map((template) => ({ template, interval: shiftTemplateInterval(template), minutes: shiftTemplateExpectedMinutes(template) }));
  if (intervals.some((item) => item.interval === null || item.minutes === null)) return { unresolved: "EXPECTED_MINUTES_UNKNOWN" };
  const sorted = [...intervals].sort((left, right) => left.interval!.start - right.interval!.start);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index]!.interval!.start < sorted[index - 1]!.interval!.end) return { unresolved: "SHIFT_ASSIGNMENTS_OVERLAP" };
  }
  return { minutes: intervals.reduce((sum, item) => sum + item.minutes!, 0) };
}

// ── Feriado por legajo ──────────────────────────────────────────────────────

export type FeriadoRuleForWorkday = {
  id: string;
  name: string;
  recurrenceType: RecurrenceType;
  fromDate: Date;
  toDate: Date | null;
  weekdays: number[];
  dates: Array<{ date: Date; isActive: boolean }>;
  companyId: string | null;
  sectorId: string | null;
  costCenterId: string | null;
  positionId: string | null;
  sector: null | { isLegacy: boolean };
  employees: Array<{ employeeId: string }>;
};

export function feriadoRuleRestrictsHistory(rule: Pick<FeriadoRuleForWorkday, "companyId" | "sectorId" | "costCenterId" | "positionId">) {
  return Boolean(rule.companyId || rule.sectorId || rule.costCenterId || rule.positionId);
}

/**
 * Estado de feriado por fecha para un legajo, con las mismas piezas que el
 * motor de Horas Especiales (vigencia + `ruleMatchesDate` + lista de legajos +
 * `evaluateRuleScope` sobre la historia vigente ese día) pero SIN la política
 * de convocatoria: la convocatoria decide quién trabaja, no si la fecha es
 * feriado para el legajo. `history` puede omitirse si ninguna regla restringe
 * dimensiones de la historia.
 */
export function resolveEmployeeHolidayStatus(input: {
  employeeId: string;
  dateKeys: string[];
  feriadoRules: FeriadoRuleForWorkday[];
  history: EngineScopeHistory | null;
}): Map<string, HolidayScopeStatus> {
  const result = new Map<string, HolidayScopeStatus>();
  if (!input.feriadoRules.length) return result;
  const activeDates = buildActiveDatesByRule(input.feriadoRules);
  for (const dateKey of input.dateKeys) {
    const date = argentinaCalendarDate(dateKey);
    let matchesCalendar = false;
    let missing = false;
    let inScope = false;
    for (const rule of input.feriadoRules) {
      const vigent = rule.fromDate <= date && (!rule.toDate || rule.toDate >= date);
      if (!vigent || !ruleMatchesDate(rule, date, activeDates)) continue;
      matchesCalendar = true;
      if (rule.employees.length && !rule.employees.some((item) => item.employeeId === input.employeeId)) continue;
      if (!feriadoRuleRestrictsHistory(rule)) {
        inScope = true;
        break;
      }
      if (!input.history) {
        missing = true;
        continue;
      }
      const evaluation = evaluateRuleScope(ruleScopeOf(rule), input.history, dateKey);
      if (evaluation.kind === "MATCH") {
        inScope = true;
        break;
      }
      if (evaluation.kind === "MISSING") missing = true;
    }
    if (!matchesCalendar) continue;
    result.set(dateKey, inScope ? "IN_SCOPE" : missing ? "SCOPE_HISTORY_MISSING" : "OUT_OF_SCOPE");
  }
  return result;
}

// ── Núcleo puro ─────────────────────────────────────────────────────────────

function activeRegimeKind(regimes: WorkdayRegimePeriod[], date: Date): WorkRegimeKind | null {
  // Mismo criterio que findActiveEmployeeWorkRegime: vigente en la fecha y,
  // si hubiera más de uno, el de effectiveFrom más reciente.
  let winner: WorkdayRegimePeriod | null = null;
  for (const regime of regimes) {
    if (regime.effectiveFrom > date || (regime.effectiveTo && regime.effectiveTo < date)) continue;
    if (!winner || regime.effectiveFrom > winner.effectiveFrom) winner = regime;
  }
  return winner?.kind ?? null;
}

function usableAssignments(context: EmployeeWorkdayContext, date: Date) {
  return context.assignments.filter(
    (assignment) => assignment.status === "HABILITADO" && assignment.template.status === "ACTIVO" && isShiftAssignmentActiveOnDate(assignment, date),
  );
}

/**
 * Precedencia (ADR §7): franco → feriado (convocado / no convocado) →
 * SIN_TURNO → asignación aplicable → TURNO_FLEXIBLE → sin planificación →
 * planificación que excluye el día.
 */
export function evaluateEmployeeWorkday(context: EmployeeWorkdayContext, dateKey: string): ExpectedWorkday {
  const date = argentinaCalendarDate(dateKey);
  const holiday = context.holidays.get(dateKey) ?? null;
  const convocation = context.convocations.get(dateKey) ?? null;
  // Una convocatoria sólo cuenta si la fecha es feriado por calendario (una
  // regla FERIADO vigente cae ese día): sin regla FERIADO la convocatoria no
  // aporta nada, igual que en el motor de Horas Especiales (§15/§16).
  const convokedToHoliday = Boolean(holiday && convocation);
  const result = (fields: Omit<ExpectedWorkday, "dateKey" | "convoked" | "isHoliday"> & { isHoliday?: boolean }): ExpectedWorkday => ({
    dateKey,
    convoked: convokedToHoliday,
    isHoliday: fields.isHoliday ?? (holiday === "IN_SCOPE" || convokedToHoliday),
    ...fields,
  });
  const unresolved = (reason: WorkdayUnresolvedReason, source: WorkdaySource, shiftTemplateIds: string[] = [], minutesSource: WorkdayMinutesSource | null = null) =>
    result({ obligation: "UNRESOLVED", unresolvedReason: reason, expectedMinutes: null, shiftTemplateIds, source, minutesSource });
  const confirmedZero = (obligation: "DAY_OFF" | "HOLIDAY_NOT_CONVOKED" | "NO_WORK_OBLIGATION", source: WorkdaySource) =>
    result({ obligation, unresolvedReason: null, expectedMinutes: 0, shiftTemplateIds: [], source, minutesSource: null });

  // 1. Franco: gana incluso sobre una convocatoria (EMPLOYEE_DAY_OFF.md §5).
  if (context.dayOffDates.has(dateKey)) return confirmedZero("DAY_OFF", "EMPLOYEE_DAY_OFF");

  const usable = usableAssignments(context, date);
  const applicable = usable.filter((assignment) => isShiftAssignmentApplicableOnWeekday(assignment, date));

  // 2-3. Feriado.
  if (convokedToHoliday && convocation) {
    const convocationTemplate = convocation.template?.status === "ACTIVO" ? convocation.template : null;
    if (convocationTemplate) {
      const minutes = shiftTemplateExpectedMinutes(convocationTemplate);
      if (minutes !== null) {
        return result({ obligation: "WORKDAY", unresolvedReason: null, expectedMinutes: minutes, shiftTemplateIds: [convocationTemplate.id], source: "HOLIDAY_CONVOCATION", minutesSource: "CONVOCATION_SHIFT_TEMPLATE" });
      }
    }
    if (applicable.length) {
      const templates = applicable.map((assignment) => assignment.template);
      const minutes = expectedMinutesForTemplates(templates);
      if ("minutes" in minutes) {
        return result({ obligation: "WORKDAY", unresolvedReason: null, expectedMinutes: minutes.minutes, shiftTemplateIds: templates.map((template) => template.id), source: "HOLIDAY_CONVOCATION", minutesSource: "SHIFT_ASSIGNMENT" });
      }
      if (minutes.unresolved === "SHIFT_ASSIGNMENTS_OVERLAP") {
        return unresolved("SHIFT_ASSIGNMENTS_OVERLAP", "HOLIDAY_CONVOCATION", templates.map((template) => template.id), "SHIFT_ASSIGNMENT");
      }
    }
    const start = parseShiftTime(convocation.expectedStartTime);
    const end = parseShiftTime(convocation.expectedEndTime);
    if (start !== null && end !== null) {
      const minutes = computeExpectedMinutes(convocation.expectedStartTime!, convocation.expectedEndTime!, end <= start);
      return result({ obligation: "WORKDAY", unresolvedReason: null, expectedMinutes: minutes, shiftTemplateIds: [], source: "HOLIDAY_CONVOCATION", minutesSource: "CONVOCATION_TIMES" });
    }
    return unresolved("EXPECTED_MINUTES_UNKNOWN", "HOLIDAY_CONVOCATION");
  }
  if (holiday === "IN_SCOPE") return confirmedZero("HOLIDAY_NOT_CONVOKED", "HOLIDAY_RULE");
  if (holiday === "SCOPE_HISTORY_MISSING") return unresolved("HOLIDAY_SCOPE_HISTORY_MISSING", "HOLIDAY_RULE");

  // 4. SIN_TURNO: para Novedades nunca es 0 h confirmado por el nombre del régimen.
  const regime = activeRegimeKind(context.regimes, date);
  if (regime === "SIN_TURNO") return unresolved("REGIME_WITHOUT_SCHEDULE", "WORK_REGIME");

  // 5. Asignación aplicable ese día.
  if (applicable.length) {
    const templates = applicable.map((assignment) => assignment.template);
    const minutes = expectedMinutesForTemplates(templates);
    if ("minutes" in minutes) {
      return result({ obligation: "WORKDAY", unresolvedReason: null, expectedMinutes: minutes.minutes, shiftTemplateIds: templates.map((template) => template.id), source: "SHIFT_PLAN", minutesSource: "SHIFT_ASSIGNMENT" });
    }
    return unresolved(minutes.unresolved, "SHIFT_PLAN", templates.map((template) => template.id), "SHIFT_ASSIGNMENT");
  }

  // 6. TURNO_FLEXIBLE sin asignación aplicable: no se puede afirmar que no trabajaba.
  if (regime === "TURNO_FLEXIBLE") return unresolved("FLEXIBLE_REGIME_NO_ASSIGNMENT", "WORK_REGIME");

  // 8. Sin planificación vigente (ninguna asignación habilitada en vigencia): falta configuración.
  if (!usable.length) return unresolved("SCHEDULE_MISSING", "NONE");

  // 7. TURNO_OBLIGATORIO o sin régimen, con planificación vigente que excluye el día.
  return confirmedZero("NO_WORK_OBLIGATION", "SHIFT_PLAN");
}

// ── Cargador batch ──────────────────────────────────────────────────────────

/** Rango máximo por llamada: el de una novedad (366 días) con margen. */
export const MAX_WORKDAY_RANGE_DAYS = 400;

export type WorkdayContextReader = Pick<
  PrismaTransactionClient,
  "shiftAssignment" | "employeeDayOff" | "holidayWorkAssignment" | "employeeWorkRegime" | "doubleHourRule"
> &
  HistoryReader;

const templateSelect = { id: true, startTime: true, endTime: true, crossesMidnight: true, expectedMinutes: true, status: true } as const;

export function workdayDateKeys(from: Date, to: Date): string[] {
  const days = calendarDaysInclusive(from, to);
  if (to < from || days > MAX_WORKDAY_RANGE_DAYS) {
    throw new Error(`loadEmployeeWorkdayContext: rango inválido (${calendarDateKey(from)} → ${calendarDateKey(to)}, máximo ${MAX_WORKDAY_RANGE_DAYS} días).`);
  }
  const keys: string[] = [];
  for (let key = calendarDateKey(from), last = calendarDateKey(to); key <= last; key = nextCalendarDateKey(key)) keys.push(key);
  return keys;
}

/**
 * Contexto de jornada esperada de varios legajos para un rango de fechas
 * calendario (UTC medianoche, `@db.Date`), con consultas fijas por llamada:
 * asignaciones + turnos, francos, convocatorias, regímenes y reglas FERIADO
 * (5), más la historia laboral (4 + alcances de puesto) sólo si alguna regla
 * FERIADO del rango restringe empresa, sector, centro de costo o puesto.
 * Nunca una consulta por legajo ni por día. `db` permite correrlo dentro de
 * una transacción.
 */
export async function loadEmployeeWorkdayContext(employeeIds: string[], from: Date, to: Date, db: WorkdayContextReader): Promise<Map<string, EmployeeWorkdayContext>> {
  const ids = [...new Set(employeeIds)];
  const dateKeys = workdayDateKeys(from, to);
  const result = new Map<string, EmployeeWorkdayContext>();
  if (!ids.length) return result;

  const [assignments, dayOffs, convocations, regimes, feriadoRules] = await Promise.all([
    db.shiftAssignment.findMany({
      where: { employeeId: { in: ids }, status: "HABILITADO", effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] },
      select: { employeeId: true, status: true, effectiveFrom: true, effectiveTo: true, weekdays: true, shiftTemplate: { select: templateSelect } },
    }),
    db.employeeDayOff.findMany({ where: { employeeId: { in: ids }, status: "ACTIVO", date: { gte: from, lte: to } }, select: { employeeId: true, date: true } }),
    db.holidayWorkAssignment.findMany({
      where: { employeeId: { in: ids }, status: "ACTIVA", date: { gte: from, lte: to } },
      select: { employeeId: true, date: true, expectedStartTime: true, expectedEndTime: true, shiftTemplate: { select: templateSelect } },
    }),
    db.employeeWorkRegime.findMany({
      where: { employeeId: { in: ids }, effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] },
      select: { employeeId: true, effectiveFrom: true, effectiveTo: true, workRegime: { select: { kind: true } } },
    }),
    db.doubleHourRule.findMany({
      where: { kind: "FERIADO", status: "ACTIVO", fromDate: { lte: to }, OR: [{ toDate: null }, { toDate: { gte: from } }] },
      select: {
        id: true,
        name: true,
        recurrenceType: true,
        fromDate: true,
        toDate: true,
        weekdays: true,
        companyId: true,
        sectorId: true,
        costCenterId: true,
        positionId: true,
        dates: { select: { date: true, isActive: true } },
        sector: { select: { isLegacy: true } },
        employees: { select: { employeeId: true } },
      },
    }),
  ]);

  const histories = feriadoRules.some(feriadoRuleRestrictsHistory)
    ? await laborHistoryService.loadEngineScopeHistoryByEmployee(db, ids, { fromKey: dateKeys[0]!, toKey: dateKeys[dateKeys.length - 1]! })
    : null;

  for (const employeeId of ids) {
    result.set(employeeId, {
      employeeId,
      assignments: assignments
        .filter((row) => row.employeeId === employeeId)
        .map((row) => ({ status: row.status, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, weekdays: row.weekdays, template: row.shiftTemplate })),
      dayOffDates: new Set(dayOffs.filter((row) => row.employeeId === employeeId).map((row) => calendarDateKey(row.date))),
      convocations: new Map(
        convocations
          .filter((row) => row.employeeId === employeeId)
          .map((row) => [calendarDateKey(row.date), { template: row.shiftTemplate, expectedStartTime: row.expectedStartTime, expectedEndTime: row.expectedEndTime }]),
      ),
      regimes: regimes
        .filter((row) => row.employeeId === employeeId)
        .map((row) => ({ effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, kind: row.workRegime.kind })),
      holidays: resolveEmployeeHolidayStatus({ employeeId, dateKeys, feriadoRules, history: histories?.get(employeeId) ?? null }),
    });
  }
  return result;
}

/** Jornada esperada de cada legajo para cada fecha del rango (contexto batch + núcleo puro). */
export async function resolveExpectedWorkdays(employeeIds: string[], from: Date, to: Date, db: WorkdayContextReader): Promise<Map<string, Map<string, ExpectedWorkday>>> {
  const contexts = await loadEmployeeWorkdayContext(employeeIds, from, to, db);
  const dateKeys = workdayDateKeys(from, to);
  return new Map(
    [...contexts].map(([employeeId, context]) => [employeeId, new Map(dateKeys.map((dateKey) => [dateKey, evaluateEmployeeWorkday(context, dateKey)]))]),
  );
}
