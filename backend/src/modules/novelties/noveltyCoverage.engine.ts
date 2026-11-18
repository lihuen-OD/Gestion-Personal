/**
 * Motor puro de cobertura diaria de una novedad
 * (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §6). Sin consultas: recibe por
 * día todo lo ya resuelto (configuración del tipo, relación laboral, jornada
 * esperada de la etapa 2, franco/feriado/convocatoria, evaluación del motor
 * único de Horas Especiales y la resolución manual previa) y devuelve la fila
 * de `NoveltyDayCoverage`. La misma función alimenta la vista previa y la
 * persistencia, así que nunca pueden diferir.
 *
 * No decide si la cobertura SUMA (eso es contabilidad, etapa 4) ni compara con
 * el trabajo real: sólo cuánto cubre la novedad ese día y por qué.
 */
import type {
  NoveltyCoverageDayOffPolicy,
  NoveltyCoverageDayRule,
  NoveltyCoverageHolidayPolicy,
  NoveltyCoverageMode,
  NoveltyCoverageOutcome,
  NoveltyCoverageResolution,
  NoveltyCoverageReviewStatus,
  NoveltyCoverageScheduleReviewReason,
  NoveltyRealWorkCompatibility,
} from "@prisma/client";
import { argentinaCalendarDate } from "../../shared/datetime/argentinaTime";
import type { ExpectedWorkday, HolidayScopeStatus } from "../shifts/expectedWorkday";
import type { MissingScopeHistory, SpecialHourEvaluation } from "../time-entries/timeEntries.repository";

export const MAX_COVERAGE_MINUTES_PER_DAY = 1440;

export type CoverageTypeConfig = {
  coverageMode: NoveltyCoverageMode;
  coverageFixedMinutes: number | null;
  coverageDayRule: NoveltyCoverageDayRule;
  coverageWeekdays: number[];
  coverageOnDayOff: NoveltyCoverageDayOffPolicy | null;
  coverageOnHoliday: NoveltyCoverageHolidayPolicy | null;
  coverageAppliesSpecialHours: boolean;
  coverageCountsTowardTotal: boolean;
  realWorkCompatibility: NoveltyRealWorkCompatibility;
};

/** Relación laboral del día, leída de LaborMovement (employees/laborRelation.ts). */
export type CoverageEmployment = "EMPLOYED" | "NOT_EMPLOYED" | "UNKNOWN";

/** Resolución manual ya persistida para el día (sólo filas RESOLVED). */
export type PreviousCoverageResolution = {
  outcome: NoveltyCoverageOutcome;
  scheduleReviewReason: NoveltyCoverageScheduleReviewReason | null;
  /** Jornada esperada contra la que se resolvió (null = desconocida). */
  expectedMinutes: number | null;
  resolution: NoveltyCoverageResolution;
  resolvedBaseMinutes: number;
  resolvedAgainstWorkedMinutes: number;
  resolvedByUserId: string | null;
  resolvedAt: Date;
  resolutionNote: string | null;
};

export type CoverageDayInput = {
  dateKey: string;
  type: CoverageTypeConfig;
  /** Sólo MANUAL_MINUTES: Novelty.quantityMinutes. */
  quantityMinutes: number | null;
  employment: CoverageEmployment;
  workday: ExpectedWorkday;
  /** Reglas por calendario: franco ACTIVO, estado de feriado y convocatoria ACTIVA de la persona. */
  dayOff: boolean;
  holiday: HolidayScopeStatus | null;
  convoked: boolean;
  /** Evaluación del motor de Horas Especiales para la fecha; requerida si el tipo aplica multiplicadores. */
  specialHours: SpecialHourEvaluation | null;
  previous: PreviousCoverageResolution | null;
};

export type CoverageDayResult = {
  dateKey: string;
  outcome: NoveltyCoverageOutcome;
  scheduleReviewReason: NoveltyCoverageScheduleReviewReason | null;
  expectedMinutes: number | null;
  baseMinutes: number;
  multiplier: number;
  reviewStatus: NoveltyCoverageReviewStatus;
  resolution: NoveltyCoverageResolution | null;
  resolvedBaseMinutes: number | null;
  resolvedAgainstWorkedMinutes: number | null;
  resolvedByUserId: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  countsTowardTotal: boolean;
  realWorkCompatibility: NoveltyRealWorkCompatibility;
  shiftTemplateId: string | null;
  /** resolvedBaseMinutes ?? baseMinutes. */
  effectiveBaseMinutes: number;
  /** effectiveBaseMinutes × multiplier, redondeado (no se persiste). */
  computedMinutes: number;
  /** Había una resolución manual y los datos nuevos la dejaron sin objeto. */
  resolutionDropped: boolean;
};

/**
 * Falta historia laboral para saber si una regla con alcance aplica al legajo
 * ese día. Es un problema de integridad de datos, no una revisión de cobertura
 * (decisión del usuario, ADR §7.5): el cálculo se aborta y quien llama lo
 * traduce a `409 SPECIAL_HOUR_SCOPE_HISTORY_MISSING`.
 */
export class CoverageScopeHistoryMissingError extends Error {
  /** Lo completa quien evalúa varios legajos, para el mensaje de negocio. */
  employeeId: string | null = null;

  constructor(public readonly detail: { kind: "SPECIAL_HOUR"; missing: MissingScopeHistory } | { kind: "HOLIDAY"; dateKey: string }) {
    super(detail.kind === "SPECIAL_HOUR" ? `Missing labor history for special hour rule on ${detail.missing.date}` : `Missing labor history for holiday rule on ${detail.dateKey}`);
    this.name = "CoverageScopeHistoryMissingError";
  }
}

type Draft = {
  outcome: NoveltyCoverageOutcome;
  scheduleReviewReason: NoveltyCoverageScheduleReviewReason | null;
  baseMinutes: number;
};

const covered = (baseMinutes: number): Draft => ({ outcome: "COVERED", scheduleReviewReason: null, baseMinutes });
const zero = (outcome: NoveltyCoverageOutcome): Draft => ({ outcome, scheduleReviewReason: null, baseMinutes: 0 });
const unresolved = (reason: NoveltyCoverageScheduleReviewReason): Draft => ({ outcome: "SCHEDULE_UNRESOLVED", scheduleReviewReason: reason, baseMinutes: 0 });

function holidayError(dateKey: string): never {
  throw new CoverageScopeHistoryMissingError({ kind: "HOLIDAY", dateKey });
}

/** Política de feriado de una regla por calendario; null = el día sigue su cálculo. */
function calendarHolidayDraft(input: CoverageDayInput): Draft | null {
  const { holiday, convoked, dateKey } = input;
  const policy = input.type.coverageOnHoliday;
  if (!holiday || holiday === "OUT_OF_SCOPE" || policy === "COVER") return null;
  if (policy === "ONLY_IF_CONVOKED") {
    // La convocatoria hace feriado convocado aunque el alcance no se pueda evaluar (§16).
    if (convoked) return null;
    return holiday === "IN_SCOPE" ? zero("HOLIDAY_NOT_CONVOKED") : holidayError(dateKey);
  }
  // NO_COVERAGE (o una configuración incompleta, que el CHECK impide).
  return holiday === "IN_SCOPE" ? zero("HOLIDAY_EXCLUDED") : holidayError(dateKey);
}

/** Cuánto cubriría el día, sin resolución manual ni multiplicador. */
function draftDay(input: CoverageDayInput): Draft {
  const { type, workday } = input;
  if (type.coverageMode === "NONE") return zero("NO_COVERAGE");

  // Relación laboral (NOVELTY_COVERAGE_ENGINE.md §17): fuera de la relación
  // conocida (antes del primer ALTA o después de una BAJA registrada) no hay
  // cobertura. La FALTA de historia sólo importa cuando la cantidad sale de la
  // jornada (EXPECTED_SCHEDULE): FIXED_MINUTES y MANUAL_MINUTES ya tienen su
  // cantidad definida por el tipo o la carga y nunca van a revisión por eso.
  if (input.employment === "NOT_EMPLOYED") return zero("OUTSIDE_EMPLOYMENT");
  if (input.employment === "UNKNOWN" && type.coverageMode === "EXPECTED_SCHEDULE" && type.coverageCountsTowardTotal) {
    return unresolved("EMPLOYMENT_HISTORY_UNRESOLVED");
  }

  // Cantidad manual: la indica quien carga para esa fecha; sin reglas de días.
  if (type.coverageMode === "MANUAL_MINUTES") {
    return input.quantityMinutes && input.quantityMinutes > 0 ? covered(Math.min(input.quantityMinutes, MAX_COVERAGE_MINUTES_PER_DAY)) : zero("NO_COVERAGE");
  }

  if (type.coverageDayRule === "WORK_OBLIGATION") {
    switch (workday.obligation) {
      case "DAY_OFF":
        return zero("DAY_OFF");
      case "HOLIDAY_NOT_CONVOKED":
        return zero("HOLIDAY_NOT_CONVOKED");
      case "NO_WORK_OBLIGATION":
        return zero("NO_WORK_OBLIGATION");
      case "UNRESOLVED":
        if (workday.unresolvedReason === "HOLIDAY_SCOPE_HISTORY_MISSING") return holidayError(input.dateKey);
        return unresolved(workday.unresolvedReason ?? "EXPECTED_MINUTES_UNKNOWN");
      case "WORKDAY":
        break;
    }
  } else {
    if (type.coverageDayRule === "SELECTED_WEEKDAYS" && !type.coverageWeekdays.includes(argentinaCalendarDate(input.dateKey).getUTCDay())) {
      return zero("WEEKDAY_NOT_INCLUDED");
    }
    if (input.dayOff && type.coverageOnDayOff !== "COVER") return zero("DAY_OFF");
    const holiday = calendarHolidayDraft(input);
    if (holiday) return holiday;
  }

  if (type.coverageMode === "FIXED_MINUTES") return covered(type.coverageFixedMinutes ?? 0);
  // EXPECTED_SCHEDULE (siempre con WORK_OBLIGATION): la jornada del día.
  const expected = workday.expectedMinutes;
  if (expected === null || expected <= 0 || expected > MAX_COVERAGE_MINUTES_PER_DAY) return unresolved("EXPECTED_MINUTES_UNKNOWN");
  return covered(expected);
}

/**
 * Una resolución manual previa (docs/decisions/NOVELTY_COVERAGE_ENGINE.md
 * §13.4, §17 y §18):
 * - con cantidad fija o manual, una resolución con horas sólo vale mientras
 *   no supere el valor del tipo o de la carga (§19: se admite un valor parcial);
 * - respuesta a una revisión (el día estaba SCHEDULE_UNRESOLVED): vale
 *   mientras siga la MISMA incertidumbre; si los datos ya permiten calcular
 *   el día (se registró el ALTA o el turno) o la pregunta cambió, manda la
 *   evidencia y la resolución se descarta (queda en la auditoría);
 * - ajuste excepcional sobre un día calculado (§18): prevalece sobre el
 *   cálculo automático hasta que se restaure. "0 h" siempre; con horas,
 *   mientras entre en el valor del tipo o, según jornada, la misma jornada.
 * Un cambio del trabajo real no se mira acá: lo detecta la contabilidad al
 * leer (RESOLUTION_OUTDATED).
 */
function keepsResolution(previous: PreviousCoverageResolution, draft: Draft, expectedMinutes: number | null, typeValueMinutes: number | null) {
  if (previous.resolution === "SET_BASE_MINUTES" && typeValueMinutes !== null && previous.resolvedBaseMinutes > typeValueMinutes) return false;
  if (previous.outcome === "SCHEDULE_UNRESOLVED") {
    return draft.outcome === "SCHEDULE_UNRESOLVED" && draft.scheduleReviewReason === previous.scheduleReviewReason;
  }
  if (previous.resolution === "CONFIRMED_ZERO" || typeValueMinutes !== null) return true;
  return previous.expectedMinutes === expectedMinutes;
}

function expectedMinutesOf(input: CoverageDayInput) {
  if (input.employment === "NOT_EMPLOYED") return 0;
  const minutes = input.workday.obligation === "UNRESOLVED" ? null : input.workday.expectedMinutes;
  return minutes !== null && minutes >= 0 && minutes <= MAX_COVERAGE_MINUTES_PER_DAY ? minutes : null;
}

/** Cantidad máxima que define el propio tipo o la carga (0 sin tiempo); null si sale de la jornada. */
export function coverageTypeValueMinutes(type: Pick<CoverageTypeConfig, "coverageMode" | "coverageFixedMinutes">, quantityMinutes: number | null): number | null {
  if (type.coverageMode === "FIXED_MINUTES") return type.coverageFixedMinutes ?? 0;
  if (type.coverageMode === "MANUAL_MINUTES") return quantityMinutes ?? 0;
  // NONE nunca tiene cobertura positiva (§19); según jornada no tiene valor propio.
  if (type.coverageMode === "NONE") return 0;
  return null;
}

export function evaluateNoveltyCoverageDay(input: CoverageDayInput): CoverageDayResult {
  const draft = draftDay(input);
  const typeValue = coverageTypeValueMinutes(input.type, input.quantityMinutes);
  const kept = input.previous && keepsResolution(input.previous, draft, expectedMinutesOf(input), typeValue) ? input.previous : null;
  const effectiveBaseMinutes = kept ? kept.resolvedBaseMinutes : draft.baseMinutes;

  let multiplier = 1;
  if (input.type.coverageAppliesSpecialHours && effectiveBaseMinutes > 0) {
    if (!input.specialHours) throw new Error(`Special hour evaluation not loaded for ${input.dateKey}`);
    if (input.specialHours.missingHistory) throw new CoverageScopeHistoryMissingError({ kind: "SPECIAL_HOUR", missing: input.specialHours.missingHistory });
    multiplier = input.specialHours.resolution.multiplier;
  }

  return {
    dateKey: input.dateKey,
    outcome: draft.outcome,
    scheduleReviewReason: draft.scheduleReviewReason,
    expectedMinutes: expectedMinutesOf(input),
    baseMinutes: draft.baseMinutes,
    multiplier,
    reviewStatus: kept ? "RESOLVED" : draft.outcome === "SCHEDULE_UNRESOLVED" ? "PENDING" : "NOT_REQUIRED",
    resolution: kept?.resolution ?? null,
    resolvedBaseMinutes: kept?.resolvedBaseMinutes ?? null,
    resolvedAgainstWorkedMinutes: kept?.resolvedAgainstWorkedMinutes ?? null,
    resolvedByUserId: kept?.resolvedByUserId ?? null,
    resolvedAt: kept?.resolvedAt ?? null,
    resolutionNote: kept?.resolutionNote ?? null,
    countsTowardTotal: input.type.coverageCountsTowardTotal,
    realWorkCompatibility: input.type.realWorkCompatibility,
    shiftTemplateId: input.workday.shiftTemplateIds.length === 1 ? input.workday.shiftTemplateIds[0]! : null,
    effectiveBaseMinutes,
    computedMinutes: Math.round(effectiveBaseMinutes * multiplier),
    resolutionDropped: Boolean(input.previous && !kept),
  };
}
