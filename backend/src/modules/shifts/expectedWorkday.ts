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
import { argentinaCalendarDate, calendarDateKey, calendarDaysInclusive, nextCalendarDateKey } from "../../shared/datetime/argentinaTime";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { buildActiveDatesByRule, ruleMatchesDate, type RecurrenceType } from "../workforce-management/doubleHourRuleMatching";
import { computeExpectedMinutes, parseShiftTime } from "./shiftTemplateTime";
import { activeRegimeKindOn, resolveExpectedShift, type ExpectedShiftPolicy, type ExpectedShiftResolution, type HolidayScopeStatus, type RegimePeriod } from "./expectedShiftResolver";
import { resolveRotationDayPlan, type ExpectedDayPlanConflictReason, type ExpectedDayPlanMissingReason, type RotationConfiguration } from "./rotationPlan";
import { loadRotationConfiguration, type LoadedRotationTemplate } from "./rotationPlan.loader";

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
  // R4.2: plan de rotación (inalcanzable hasta que R4.3 cargue rotaciones).
  | "SHIFT_ROTATION"
  | "NONE";

/** De dónde salieron los minutos esperados (sólo WORKDAY o el intento fallido). */
// El horario libre de la convocatoria (expectedStartTime/EndTime) ya no es
// fuente de minutos (§20, D9): obligación, fichador y Novedades usan sólo
// plantillas y bloques.
export type WorkdayMinutesSource = "CONVOCATION_SHIFT_TEMPLATE" | "SHIFT_ASSIGNMENT" | "ROTATION_BLOCKS";

/**
 * R4.2: problema de configuración de la rotación del día (CONFLICT o MISSING),
 * conservado para diagnóstico. `unresolvedReason` se persiste en el enum de
 * base NoveltyCoverageScheduleReviewReason, que no tiene un valor de conflicto
 * de rotación (agregarlo es una migración, decisión de R4.3): por eso el
 * motivo propio viaja acá y no se oculta como una ausencia normal.
 */
export type WorkdayPlanIssue =
  | { kind: "CONFLICT"; reason: ExpectedDayPlanConflictReason; detail: string[] }
  | { kind: "MISSING"; reason: ExpectedDayPlanMissingReason };

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
  /** R4.2: sólo presente en el camino de rotación cuando el plan es CONFLICT o MISSING. */
  planIssue?: WorkdayPlanIssue;
};

// ── Contexto (lo arma loadEmployeeWorkdayContext) ───────────────────────────

export type WorkdayShiftTemplate = {
  id: string;
  /** R4.3b: lo carga `loadEmployeeWorkdayContext` (bloque de una convocatoria en rotación). */
  code?: string;
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

/** Alias del período de régimen del resolver central (Etapa R2). */
export type WorkdayRegimePeriod = RegimePeriod;

/**
 * Estado de feriado de una fecha para un legajo. Ausente = ninguna regla
 * FERIADO vigente cae en esa fecha por calendario.
 *   IN_SCOPE: alguna regla FERIADO de la fecha alcanza al legajo.
 *   OUT_OF_SCOPE: hay FERIADO por calendario pero ninguno lo alcanza.
 *   SCOPE_HISTORY_MISSING: ninguna lo alcanza con certeza y alguna depende de
 *     una dimensión sin historia registrada esa fecha.
 * Definido en el resolver central (Etapa R2); se re-exporta para los
 * importadores existentes.
 */
export type { HolidayScopeStatus };

export type EmployeeWorkdayContext = {
  employeeId: string;
  assignments: WorkdayShiftAssignment[];
  dayOffDates: ReadonlySet<string>;
  convocations: ReadonlyMap<string, WorkdayConvocation>;
  regimes: WorkdayRegimePeriod[];
  holidays: ReadonlyMap<string, HolidayScopeStatus>;
  /**
   * R4.3b (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.5): configuración
   * de rotaciones; presente sólo si el legajo tiene alguna membresía en el
   * rango. Ausente ⇒ resultado idéntico al previo.
   */
  rotation?: RotationConfiguration<LoadedRotationTemplate>;
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
  recurrenceType: RecurrenceType;
  fromDate: Date;
  toDate: Date | null;
  weekdays: number[];
  dates: Array<{ date: Date; isActive: boolean }>;
};

/**
 * Feriados de la OBLIGACIÓN (P7 resuelto, WORKED_TIME_ACCOUNTING_MODEL.md §20):
 * una fecha con alguna regla FERIADO ACTIVA vigente que cae en ella por
 * calendario es feriado para TODOS los legajos, sin mirar alcance ni lista de
 * legajos — el mismo criterio que la falta de ingreso, la inactividad y el
 * fichador (`workforceService.holidayDatesInRange`). Sin convocatoria no hay
 * obligación ese día. El alcance de la regla sólo decide el multiplicador de
 * las horas trabajadas (motor de Horas Especiales).
 */
export function resolveCalendarHolidayDates(dateKeys: string[], feriadoRules: FeriadoRuleForWorkday[]): Map<string, HolidayScopeStatus> {
  const result = new Map<string, HolidayScopeStatus>();
  if (!feriadoRules.length) return result;
  const activeDates = buildActiveDatesByRule(feriadoRules);
  for (const dateKey of dateKeys) {
    const date = argentinaCalendarDate(dateKey);
    const isHoliday = feriadoRules.some((rule) => rule.fromDate <= date && (!rule.toDate || rule.toDate >= date) && ruleMatchesDate(rule, date, activeDates));
    if (isHoliday) result.set(dateKey, "IN_SCOPE");
  }
  return result;
}

// ── Núcleo puro ─────────────────────────────────────────────────────────────

export type WorkdayResolution = ExpectedShiftResolution<WorkdayShiftTemplate, WorkdayConvocation>;

/**
 * Jornada esperada de Novedades para un legajo y una fecha.
 *
 * Etapa R2: la PRECEDENCIA la decide el resolver central
 * (`resolveExpectedShift`, política EXPECTED_WORKDAY): franco → feriado
 * (convocado / no convocado / alcance sin historia) → SIN_TURNO → asignación
 * aplicable → TURNO_FLEXIBLE → sin planificación → planificación que excluye
 * el día (ADR de Novedades §7). Acá queda sólo la PROYECCIÓN propia de
 * Novedades: minutos (regla P3), fuente de minutos y motivos persistibles.
 */
export function evaluateEmployeeWorkday(context: EmployeeWorkdayContext, dateKey: string): ExpectedWorkday {
  return projectExpectedWorkday(resolveEmployeeExpectedShift(context, dateKey, "EXPECTED_WORKDAY"));
}

/**
 * Resolución central compartida por Novedades y las vistas de sólo lectura.
 * Mantiene en un único lugar la traducción del contexto batch a
 * `resolveExpectedShift`, incluida la simulación que el llamador haya preparado
 * exclusivamente en su copia de `context.rotation`.
 */
export function resolveEmployeeExpectedShift(
  context: EmployeeWorkdayContext,
  dateKey: string,
  policy: ExpectedShiftPolicy,
): WorkdayResolution {
  const date = argentinaCalendarDate(dateKey);
  return resolveExpectedShift(
    {
      dateKey,
      employeeId: context.employeeId,
      assignments: context.assignments,
      dayOff: context.dayOffDates.has(dateKey),
      holiday: context.holidays.get(dateKey) ?? null,
      convocation: context.convocations.get(dateKey) ?? null,
      regimeKind: activeRegimeKindOn(context.regimes, date),
      convocationTemplate: convocationTemplateOf(context, dateKey),
      ...(context.rotation ? { rotationPlan: resolveRotationDayPlan(context.employeeId, dateKey, context.rotation) } : {}),
    },
    policy,
  );
}

/** Plantilla de la convocatoria del día (P8, §20: reemplaza al turno habitual en fijos y rotaciones). */
function convocationTemplateOf(context: EmployeeWorkdayContext, dateKey: string) {
  const template = context.convocations.get(dateKey)?.template ?? null;
  return template && template.code !== undefined ? { ...template, code: template.code } : null;
}

/** Traduce la resolución central al resultado de Novedades, sin cambiar ningún valor respecto de la implementación previa a R2. */
export function projectExpectedWorkday(resolution: WorkdayResolution): ExpectedWorkday {
  // R4.2: un plan de rotación CONFLICT o MISSING queda visible en todos los
  // resultados (aun si una convocatoria decide la jornada). Ausente en el
  // camino legacy: el resultado es idéntico al previo.
  const plan = resolution.dayPlan;
  const planIssue: WorkdayPlanIssue | undefined =
    plan?.kind === "CONFLICT" ? { kind: "CONFLICT", reason: plan.reason, detail: plan.detail } : plan?.kind === "MISSING" ? { kind: "MISSING", reason: plan.reason } : undefined;
  const result = (fields: Omit<ExpectedWorkday, "dateKey" | "convoked" | "isHoliday">): ExpectedWorkday => ({
    dateKey: resolution.dateKey,
    convoked: resolution.convoked,
    isHoliday: resolution.isHoliday,
    ...fields,
    ...(planIssue ? { planIssue } : {}),
  });
  const rotationBlocksWorkday = (source: WorkdaySource) =>
    result({
      obligation: "WORKDAY",
      unresolvedReason: null,
      expectedMinutes: resolution.blocks.reduce((sum, block) => sum + block.durationMinutes, 0),
      shiftTemplateIds: resolution.blocks.map((block) => block.template.id),
      source,
      minutesSource: "ROTATION_BLOCKS",
    });
  const unresolved = (reason: WorkdayUnresolvedReason, source: WorkdaySource, shiftTemplateIds: string[] = [], minutesSource: WorkdayMinutesSource | null = null) =>
    result({ obligation: "UNRESOLVED", unresolvedReason: reason, expectedMinutes: null, shiftTemplateIds, source, minutesSource });
  const confirmedZero = (obligation: "DAY_OFF" | "HOLIDAY_NOT_CONVOKED" | "NO_WORK_OBLIGATION", source: WorkdaySource) =>
    result({ obligation, unresolvedReason: null, expectedMinutes: 0, shiftTemplateIds: [], source, minutesSource: null });
  const templates = resolution.fixedCandidates;

  switch (resolution.source) {
    case "DAY_OFF":
      // Franco: gana incluso sobre una convocatoria (EMPLOYEE_DAY_OFF.md §5).
      return confirmedZero("DAY_OFF", "EMPLOYEE_DAY_OFF");

    case "HOLIDAY_CONVOCATION": {
      // Una convocatoria sólo cuenta si la fecha es feriado por calendario
      // (lo garantiza el resolver). Fuente de minutos: turno de la
      // convocatoria (si está ACTIVO) → turnos aplicables → bloques de la
      // rotación. Nunca el horario libre (§20).
      const convocation = resolution.convocation!;
      const convocationTemplate = convocation.template?.status === "ACTIVO" ? convocation.template : null;
      if (convocationTemplate) {
        const minutes = shiftTemplateExpectedMinutes(convocationTemplate);
        if (minutes !== null) {
          return result({ obligation: "WORKDAY", unresolvedReason: null, expectedMinutes: minutes, shiftTemplateIds: [convocationTemplate.id], source: "HOLIDAY_CONVOCATION", minutesSource: "CONVOCATION_SHIFT_TEMPLATE" });
        }
      }
      if (templates.length) {
        const minutes = expectedMinutesForTemplates(templates);
        if ("minutes" in minutes) {
          return result({ obligation: "WORKDAY", unresolvedReason: null, expectedMinutes: minutes.minutes, shiftTemplateIds: templates.map((template) => template.id), source: "HOLIDAY_CONVOCATION", minutesSource: "SHIFT_ASSIGNMENT" });
        }
        if (minutes.unresolved === "SHIFT_ASSIGNMENTS_OVERLAP") {
          return unresolved("SHIFT_ASSIGNMENTS_OVERLAP", "HOLIDAY_CONVOCATION", templates.map((template) => template.id), "SHIFT_ASSIGNMENT");
        }
      }
      // R4.2, camino de rotación (sin asignaciones fijas): bloques del plan.
      if (resolution.dayPlan && resolution.blocks.length) return rotationBlocksWorkday("HOLIDAY_CONVOCATION");
      // Convocado sin horario resoluble (sin plantilla y sin turno ese día):
      // nunca se inventa una jornada — queda a revisar (§20, D9).
      return unresolved("EXPECTED_MINUTES_UNKNOWN", "HOLIDAY_CONVOCATION");
    }

    case "HOLIDAY_NOT_CONVOKED":
      return confirmedZero("HOLIDAY_NOT_CONVOKED", "HOLIDAY_RULE");

    case "HOLIDAY_SCOPE":
      return unresolved("HOLIDAY_SCOPE_HISTORY_MISSING", "HOLIDAY_RULE");

    case "REGIME":
      // SIN_TURNO: para Novedades nunca es 0 h confirmado por el nombre del
      // régimen. TURNO_FLEXIBLE sin asignación aplicable: no se puede afirmar
      // que no trabajaba.
      return resolution.reason === "REGIME_SIN_TURNO" ? unresolved("REGIME_WITHOUT_SCHEDULE", "WORK_REGIME") : unresolved("FLEXIBLE_REGIME_NO_ASSIGNMENT", "WORK_REGIME");

    case "FIXED_ASSIGNMENT": {
      if (resolution.obligation === "NO_OBLIGATION") return confirmedZero("NO_WORK_OBLIGATION", "SHIFT_PLAN");
      // LEGACY (P3): turnos disjuntos suman; superpuestos, UNRESOLVED.
      const minutes = expectedMinutesForTemplates(templates);
      if ("minutes" in minutes) {
        return result({ obligation: "WORKDAY", unresolvedReason: null, expectedMinutes: minutes.minutes, shiftTemplateIds: templates.map((template) => template.id), source: "SHIFT_PLAN", minutesSource: "SHIFT_ASSIGNMENT" });
      }
      return unresolved(minutes.unresolved, "SHIFT_PLAN", templates.map((template) => template.id), "SHIFT_ASSIGNMENT");
    }

    case "NONE":
      // Sin planificación vigente (ninguna asignación habilitada en vigencia): falta configuración.
      return unresolved("SCHEDULE_MISSING", "NONE");

    case "ROTATION":
      // R4.2: plan de rotación. Los bloques pertenecen al mismo plan
      // autoritativo, así que la suma es válida (José viernes A: 240 + 720).
      // REST → 0 confirmado. MISSING o CONFLICT → no resuelto, con el motivo
      // propio en `planIssue` (el enum persistido no tiene uno de rotación).
      if (resolution.obligation === "SHIFT") return rotationBlocksWorkday("SHIFT_ROTATION");
      if (resolution.obligation === "NO_OBLIGATION") return confirmedZero("NO_WORK_OBLIGATION", "SHIFT_ROTATION");
      return unresolved("SCHEDULE_MISSING", "SHIFT_ROTATION");
  }
}

// ── Cargador batch ──────────────────────────────────────────────────────────

/** Rango máximo por llamada: el de una novedad (366 días) con margen. */
export const MAX_WORKDAY_RANGE_DAYS = 400;

export type WorkdayContextReader = Pick<
  PrismaTransactionClient,
  "shiftAssignment" | "employeeDayOff" | "holidayWorkAssignment" | "employeeWorkRegime" | "doubleHourRule" | "shiftRotationCrewMember" | "shiftRotation"
>;

const templateSelect = { id: true, code: true, startTime: true, endTime: true, crossesMidnight: true, expectedMinutes: true, status: true } as const;

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
 * (5), más la configuración de rotaciones. Sin historia laboral: el feriado de
 * la obligación es por calendario (P7, §20).
 * Nunca una consulta por legajo ni por día. `db` permite correrlo dentro de
 * una transacción.
 */
export async function loadEmployeeWorkdayContext(employeeIds: string[], from: Date, to: Date, db: WorkdayContextReader): Promise<Map<string, EmployeeWorkdayContext>> {
  const ids = [...new Set(employeeIds)];
  const dateKeys = workdayDateKeys(from, to);
  const result = new Map<string, EmployeeWorkdayContext>();
  if (!ids.length) return result;

  const [assignments, dayOffs, convocations, regimes, feriadoRules, rotation] = await Promise.all([
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
      select: { id: true, recurrenceType: true, fromDate: true, toDate: true, weekdays: true, dates: { select: { date: true, isActive: true } } },
    }),
    // R4.3b: sin membresías es una sola consulta vacía.
    loadRotationConfiguration(db, { fromKey: dateKeys[0]!, toKey: dateKeys[dateKeys.length - 1]!, employeeIds: ids }),
  ]);
  const rotationMembers = new Set(rotation.memberships.map((membership) => membership.employeeId));
  // Iguales para todos los legajos (P7, §20): se resuelven una sola vez.
  const holidays = resolveCalendarHolidayDates(dateKeys, feriadoRules);

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
      holidays,
      ...(rotationMembers.has(employeeId) ? { rotation } : {}),
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
