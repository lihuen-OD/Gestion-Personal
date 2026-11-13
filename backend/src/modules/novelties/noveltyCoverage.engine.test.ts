import { describe, expect, it } from "vitest";
import {
  CoverageScopeHistoryMissingError,
  evaluateNoveltyCoverageDay,
  type CoverageDayInput,
  type CoverageTypeConfig,
  type PreviousCoverageResolution,
} from "./noveltyCoverage.engine";
import type { ExpectedWorkday } from "../shifts/expectedWorkday";
import type { SpecialHourEvaluation } from "../time-entries/timeEntries.repository";

// Motor de cobertura — Etapa 3 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §6).
const MONDAY = "2026-11-16";
const WEDNESDAY = "2026-11-18";
const SATURDAY = "2026-11-21";
const SUNDAY = "2026-11-22";

const TRAMITE: CoverageTypeConfig = {
  coverageMode: "FIXED_MINUTES",
  coverageFixedMinutes: 240,
  coverageDayRule: "EVERY_DAY",
  coverageWeekdays: [],
  coverageOnDayOff: "NO_COVERAGE",
  coverageOnHoliday: "NO_COVERAGE",
  coverageAppliesSpecialHours: false,
  coverageCountsTowardTotal: true,
  realWorkCompatibility: "INCOMPATIBLE",
};
const MATERNIDAD = (onHoliday: CoverageTypeConfig["coverageOnHoliday"]): CoverageTypeConfig => ({
  coverageMode: "FIXED_MINUTES",
  coverageFixedMinutes: 480,
  coverageDayRule: "SELECTED_WEEKDAYS",
  coverageWeekdays: [1, 2, 3, 4, 5],
  coverageOnDayOff: "COVER",
  coverageOnHoliday: onHoliday,
  coverageAppliesSpecialHours: false,
  coverageCountsTowardTotal: true,
  realWorkCompatibility: "INCOMPATIBLE",
});
const VACACIONES: CoverageTypeConfig = {
  coverageMode: "FIXED_MINUTES",
  coverageFixedMinutes: 480,
  coverageDayRule: "WORK_OBLIGATION",
  coverageWeekdays: [],
  coverageOnDayOff: null,
  coverageOnHoliday: null,
  coverageAppliesSpecialHours: true,
  coverageCountsTowardTotal: true,
  realWorkCompatibility: "INCOMPATIBLE",
};
const LLEGADA_TARDE: CoverageTypeConfig = {
  coverageMode: "MANUAL_MINUTES",
  coverageFixedMinutes: null,
  coverageDayRule: "EVERY_DAY",
  coverageWeekdays: [],
  coverageOnDayOff: null,
  coverageOnHoliday: null,
  coverageAppliesSpecialHours: false,
  coverageCountsTowardTotal: false,
  realWorkCompatibility: "COMPATIBLE",
};
const FALTA_SIN_AVISO: CoverageTypeConfig = { ...LLEGADA_TARDE, coverageMode: "NONE", realWorkCompatibility: "INCOMPATIBLE" };
const JORNADA: CoverageTypeConfig = { ...VACACIONES, coverageMode: "EXPECTED_SCHEDULE", coverageFixedMinutes: null, coverageAppliesSpecialHours: false };

function workday(overrides: Partial<ExpectedWorkday> = {}): ExpectedWorkday {
  return {
    dateKey: MONDAY,
    obligation: "WORKDAY",
    unresolvedReason: null,
    expectedMinutes: 480,
    shiftTemplateIds: ["tpl-day"],
    isHoliday: false,
    convoked: false,
    source: "SHIFT_PLAN",
    minutesSource: "SHIFT_ASSIGNMENT",
    ...overrides,
  };
}
const unresolvedWorkday = (unresolvedReason: ExpectedWorkday["unresolvedReason"]) => workday({ obligation: "UNRESOLVED", unresolvedReason, expectedMinutes: null, shiftTemplateIds: [], source: "NONE", minutesSource: null });
const multiplierOf = (multiplier: number): SpecialHourEvaluation => ({ resolution: { multiplier, matchedRules: [], winners: [], conflicting: false } });

function input(overrides: Partial<CoverageDayInput> & { type: CoverageTypeConfig }): CoverageDayInput {
  return {
    dateKey: MONDAY,
    quantityMinutes: null,
    employment: "EMPLOYED",
    workday: workday(),
    dayOff: false,
    holiday: null,
    convoked: false,
    specialHours: multiplierOf(1),
    previous: null,
    ...overrides,
  };
}

const evaluate = (overrides: Partial<CoverageDayInput> & { type: CoverageTypeConfig }) => evaluateNoveltyCoverageDay(input(overrides));

describe("Trámite bancario (FIXED 240, todos los días, suma, incompatible)", () => {
  it("sin trabajo real → 240 cubiertos, sin revisión", () => {
    expect(evaluate({ type: TRAMITE })).toMatchObject({ outcome: "COVERED", baseMinutes: 240, multiplier: 1, computedMinutes: 240, reviewStatus: "NOT_REQUIRED", countsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" });
  });

  it("la fila representa 240 aunque haya trabajo real: el conflicto se resuelve al contabilizar (etapa 4)", () => {
    // El motor no recibe trabajo real: nunca suma ni altera TimeEntry.
    expect(evaluate({ type: TRAMITE }).baseMinutes).toBe(240);
  });

  it("un domingo cubre igual (sin multiplicadores) y un franco no cubre", () => {
    expect(evaluate({ type: TRAMITE, dateKey: SUNDAY })).toMatchObject({ outcome: "COVERED", baseMinutes: 240 });
    expect(evaluate({ type: TRAMITE, dayOff: true })).toMatchObject({ outcome: "DAY_OFF", baseMinutes: 0 });
  });

  it("fuera de la relación laboral → OUTSIDE_EMPLOYMENT, 0 confirmado", () => {
    expect(evaluate({ type: TRAMITE, employment: "NOT_EMPLOYED" })).toMatchObject({ outcome: "OUTSIDE_EMPLOYMENT", baseMinutes: 0, reviewStatus: "NOT_REQUIRED" });
  });

  it("sin historia de altas suficiente → 0 provisional en revisión (EMPLOYMENT_HISTORY_UNRESOLVED)", () => {
    expect(evaluate({ type: TRAMITE, employment: "UNKNOWN" })).toMatchObject({ outcome: "SCHEDULE_UNRESOLVED", scheduleReviewReason: "EMPLOYMENT_HISTORY_UNRESOLVED", baseMinutes: 0, reviewStatus: "PENDING" });
  });
});

describe("Maternidad (FIXED 480, L–V, sin multiplicadores, suma, incompatible)", () => {
  it("lunes → 480", () => {
    expect(evaluate({ type: MATERNIDAD("COVER") })).toMatchObject({ outcome: "COVERED", baseMinutes: 480, computedMinutes: 480 });
  });

  it("sábado y domingo → 0 (WEEKDAY_NOT_INCLUDED), el ×2 de domingo nunca se evalúa", () => {
    expect(evaluate({ type: MATERNIDAD("COVER"), dateKey: SATURDAY })).toMatchObject({ outcome: "WEEKDAY_NOT_INCLUDED", baseMinutes: 0 });
    expect(evaluate({ type: MATERNIDAD("COVER"), dateKey: SUNDAY, specialHours: multiplierOf(2) })).toMatchObject({ outcome: "WEEKDAY_NOT_INCLUDED", baseMinutes: 0, multiplier: 1, computedMinutes: 0 });
  });

  it("feriado entre semana: COVER → 480; NO_COVERAGE → 0 (HOLIDAY_EXCLUDED)", () => {
    expect(evaluate({ type: MATERNIDAD("COVER"), dateKey: WEDNESDAY, holiday: "IN_SCOPE" })).toMatchObject({ outcome: "COVERED", baseMinutes: 480 });
    expect(evaluate({ type: MATERNIDAD("NO_COVERAGE"), dateKey: WEDNESDAY, holiday: "IN_SCOPE" })).toMatchObject({ outcome: "HOLIDAY_EXCLUDED", baseMinutes: 0 });
  });

  it("feriado entre semana con ONLY_IF_CONVOKED: según la convocatoria", () => {
    expect(evaluate({ type: MATERNIDAD("ONLY_IF_CONVOKED"), dateKey: WEDNESDAY, holiday: "IN_SCOPE", convoked: true })).toMatchObject({ outcome: "COVERED", baseMinutes: 480 });
    expect(evaluate({ type: MATERNIDAD("ONLY_IF_CONVOKED"), dateKey: WEDNESDAY, holiday: "IN_SCOPE", convoked: false })).toMatchObject({ outcome: "HOLIDAY_NOT_CONVOKED", baseMinutes: 0 });
  });

  it("un FERIADO que no alcanza al legajo es un día normal para cualquier política", () => {
    expect(evaluate({ type: MATERNIDAD("NO_COVERAGE"), dateKey: WEDNESDAY, holiday: "OUT_OF_SCOPE" })).toMatchObject({ outcome: "COVERED", baseMinutes: 480 });
  });

  it("franco con política COVER → cubre igual", () => {
    expect(evaluate({ type: MATERNIDAD("COVER"), dayOff: true })).toMatchObject({ outcome: "COVERED", baseMinutes: 480 });
  });

  it("feriado con alcance sin historia y política que lo necesita → error explícito (nunca revisión ni 0 provisional)", () => {
    expect(() => evaluate({ type: MATERNIDAD("NO_COVERAGE"), dateKey: WEDNESDAY, holiday: "SCOPE_HISTORY_MISSING" })).toThrow(CoverageScopeHistoryMissingError);
    expect(() => evaluate({ type: MATERNIDAD("ONLY_IF_CONVOKED"), dateKey: WEDNESDAY, holiday: "SCOPE_HISTORY_MISSING" })).toThrow(CoverageScopeHistoryMissingError);
    // Con COVER el estado del feriado no cambia nada, y convocado cubre igual.
    expect(evaluate({ type: MATERNIDAD("COVER"), dateKey: WEDNESDAY, holiday: "SCOPE_HISTORY_MISSING" })).toMatchObject({ outcome: "COVERED" });
    expect(evaluate({ type: MATERNIDAD("ONLY_IF_CONVOKED"), dateKey: WEDNESDAY, holiday: "SCOPE_HISTORY_MISSING", convoked: true })).toMatchObject({ outcome: "COVERED" });
  });
});

describe("Vacaciones (FIXED 480, días que tenía que trabajar, multiplicadores, suma, incompatible)", () => {
  it("lunes con obligación → 480 × 1", () => {
    expect(evaluate({ type: VACACIONES })).toMatchObject({ outcome: "COVERED", baseMinutes: 480, multiplier: 1, computedMinutes: 480, expectedMinutes: 480, shiftTemplateId: "tpl-day" });
  });

  it("franco → 0 (DAY_OFF)", () => {
    expect(evaluate({ type: VACACIONES, workday: workday({ obligation: "DAY_OFF", expectedMinutes: 0, shiftTemplateIds: [] }) })).toMatchObject({ outcome: "DAY_OFF", baseMinutes: 0, computedMinutes: 0 });
  });

  it("domingo con turno + regla DOMINGO ×2 → 480 × 2 = 960 (multiplicador del motor único)", () => {
    expect(evaluate({ type: VACACIONES, dateKey: SUNDAY, specialHours: multiplierOf(2) })).toMatchObject({ outcome: "COVERED", baseMinutes: 480, multiplier: 2, computedMinutes: 960 });
  });

  it("domingo con turno L–V → 0 (NO_WORK_OBLIGATION), sin evaluar multiplicador", () => {
    expect(evaluate({ type: VACACIONES, dateKey: SUNDAY, specialHours: null, workday: workday({ obligation: "NO_WORK_OBLIGATION", expectedMinutes: 0, shiftTemplateIds: [] }) })).toMatchObject({ outcome: "NO_WORK_OBLIGATION", baseMinutes: 0, multiplier: 1 });
  });

  it("feriado no convocado → 0; feriado convocado → 480 × multiplicador de feriado", () => {
    expect(evaluate({ type: VACACIONES, workday: workday({ obligation: "HOLIDAY_NOT_CONVOKED", expectedMinutes: 0, isHoliday: true }) })).toMatchObject({ outcome: "HOLIDAY_NOT_CONVOKED", baseMinutes: 0 });
    expect(evaluate({ type: VACACIONES, workday: workday({ isHoliday: true, convoked: true, source: "HOLIDAY_CONVOCATION" }), specialHours: multiplierOf(2) })).toMatchObject({ outcome: "COVERED", computedMinutes: 960 });
  });

  it.each([
    ["legajo mínimo sin turno", "SCHEDULE_MISSING"],
    ["régimen flexible sin asignación", "FLEXIBLE_REGIME_NO_ASSIGNMENT"],
    ["régimen sin turno", "REGIME_WITHOUT_SCHEDULE"],
    ["turnos superpuestos", "SHIFT_ASSIGNMENTS_OVERLAP"],
    ["convocado sin horario", "EXPECTED_MINUTES_UNKNOWN"],
  ] as const)("%s → 0 provisional en revisión (%s)", (_label, reason) => {
    expect(evaluate({ type: VACACIONES, workday: unresolvedWorkday(reason) })).toMatchObject({ outcome: "SCHEDULE_UNRESOLVED", scheduleReviewReason: reason, baseMinutes: 0, reviewStatus: "PENDING", expectedMinutes: null });
  });

  it("feriado con alcance sin historia (de la jornada esperada) → error explícito", () => {
    expect(() => evaluate({ type: VACACIONES, workday: unresolvedWorkday("HOLIDAY_SCOPE_HISTORY_MISSING") })).toThrow(CoverageScopeHistoryMissingError);
  });

  it("multiplicador con historia faltante y minutos a cubrir → error explícito (nunca ×1)", () => {
    const missing = { missingHistory: { employeeId: "emp-1", date: MONDAY, period: "2026-11", dimensions: ["EMPLOYER" as const], ruleId: "r", ruleName: "Domingos" } } as SpecialHourEvaluation;
    expect(() => evaluate({ type: VACACIONES, specialHours: missing })).toThrow(CoverageScopeHistoryMissingError);
    // Sin minutos a cubrir el multiplicador no se necesita.
    expect(evaluate({ type: VACACIONES, specialHours: missing, workday: workday({ obligation: "DAY_OFF", expectedMinutes: 0 }) })).toMatchObject({ outcome: "DAY_OFF" });
  });

  it("fuera de la relación laboral → OUTSIDE_EMPLOYMENT aunque tuviera turno", () => {
    expect(evaluate({ type: VACACIONES, employment: "NOT_EMPLOYED" })).toMatchObject({ outcome: "OUTSIDE_EMPLOYMENT", baseMinutes: 0, expectedMinutes: 0 });
  });

  it("varios turnos aplicables (turno partido) → no guarda un turno único de origen", () => {
    expect(evaluate({ type: VACACIONES, workday: workday({ shiftTemplateIds: ["a", "b"] }) }).shiftTemplateId).toBeNull();
  });
});

describe("Llegada tarde (manual, informativa)", () => {
  it("60 min → fila cubierta de 60 min que no suma", () => {
    expect(evaluate({ type: LLEGADA_TARDE, quantityMinutes: 60 })).toMatchObject({ outcome: "COVERED", baseMinutes: 60, computedMinutes: 60, countsTowardTotal: false, realWorkCompatibility: "COMPATIBLE" });
  });

  it("no aplica reglas de días: un domingo o un franco igual registra la cantidad", () => {
    expect(evaluate({ type: LLEGADA_TARDE, quantityMinutes: 60, dateKey: SUNDAY, dayOff: true })).toMatchObject({ outcome: "COVERED", baseMinutes: 60 });
  });

  it("informativa: sin historia de altas no va a revisión (no hay nada computable); fuera de la relación sí es 0", () => {
    expect(evaluate({ type: LLEGADA_TARDE, quantityMinutes: 60, employment: "UNKNOWN" })).toMatchObject({ outcome: "COVERED", baseMinutes: 60, reviewStatus: "NOT_REQUIRED" });
    expect(evaluate({ type: LLEGADA_TARDE, quantityMinutes: 60, employment: "NOT_EMPLOYED" })).toMatchObject({ outcome: "OUTSIDE_EMPLOYMENT", baseMinutes: 0 });
  });

  it("sin cantidad (dato legado) → NO_COVERAGE", () => {
    expect(evaluate({ type: LLEGADA_TARDE, quantityMinutes: null })).toMatchObject({ outcome: "NO_COVERAGE", baseMinutes: 0 });
  });
});

describe("Falta sin aviso (NONE)", () => {
  it("fila de 0 minutos sin revisión, sin importar jornada, relación laboral ni multiplicadores", () => {
    expect(evaluate({ type: FALTA_SIN_AVISO, employment: "UNKNOWN", workday: unresolvedWorkday("SCHEDULE_MISSING"), specialHours: null })).toMatchObject({
      outcome: "NO_COVERAGE",
      baseMinutes: 0,
      computedMinutes: 0,
      reviewStatus: "NOT_REQUIRED",
      realWorkCompatibility: "INCOMPATIBLE",
    });
  });
});

describe("Jornada esperada (EXPECTED_SCHEDULE)", () => {
  it("usa los minutos de la jornada esperada", () => {
    expect(evaluate({ type: JORNADA, workday: workday({ expectedMinutes: 450 }) })).toMatchObject({ outcome: "COVERED", baseMinutes: 450 });
  });

  it("jornada no resuelta → revisión", () => {
    expect(evaluate({ type: JORNADA, workday: unresolvedWorkday("SCHEDULE_MISSING") })).toMatchObject({ outcome: "SCHEDULE_UNRESOLVED", reviewStatus: "PENDING" });
  });

  it("una jornada de más de 24 h en un día (configuración rara) → revisión, nunca más de 1440", () => {
    expect(evaluate({ type: JORNADA, workday: workday({ expectedMinutes: 2000 }) })).toMatchObject({ outcome: "SCHEDULE_UNRESOLVED", scheduleReviewReason: "EXPECTED_MINUTES_UNKNOWN", expectedMinutes: null });
  });
});

describe("Resolución manual previa", () => {
  const resolvedSchedule = (overrides: Partial<PreviousCoverageResolution> = {}): PreviousCoverageResolution => ({
    outcome: "SCHEDULE_UNRESOLVED",
    scheduleReviewReason: "SCHEDULE_MISSING",
    expectedMinutes: null,
    resolution: "SET_BASE_MINUTES",
    resolvedBaseMinutes: 480,
    resolvedAgainstWorkedMinutes: 0,
    resolvedByUserId: "user-1",
    resolvedAt: new Date("2026-11-20T12:00:00Z"),
    resolutionNote: "Turno de 8 h",
    ...overrides,
  });

  it("el recálculo no pisa una resolución que sigue valiendo, y le aplica el multiplicador del día", () => {
    const result = evaluate({ type: VACACIONES, dateKey: SUNDAY, workday: unresolvedWorkday("SCHEDULE_MISSING"), specialHours: multiplierOf(2), previous: resolvedSchedule() });
    expect(result).toMatchObject({
      outcome: "SCHEDULE_UNRESOLVED",
      reviewStatus: "RESOLVED",
      resolution: "SET_BASE_MINUTES",
      baseMinutes: 0,
      resolvedBaseMinutes: 480,
      effectiveBaseMinutes: 480,
      multiplier: 2,
      computedMinutes: 960,
      resolutionNote: "Turno de 8 h",
      resolutionDropped: false,
    });
  });

  it("CONFIRMED_ZERO se conserva como 0 confirmado", () => {
    expect(evaluate({ type: VACACIONES, workday: unresolvedWorkday("SCHEDULE_MISSING"), previous: resolvedSchedule({ resolution: "CONFIRMED_ZERO", resolvedBaseMinutes: 0 }) })).toMatchObject({
      reviewStatus: "RESOLVED",
      effectiveBaseMinutes: 0,
      computedMinutes: 0,
    });
  });

  it("si los datos ya permiten calcular el día (p. ej. se registró el turno), manda la evidencia y la resolución se descarta", () => {
    expect(evaluate({ type: VACACIONES, previous: resolvedSchedule() })).toMatchObject({ outcome: "COVERED", reviewStatus: "NOT_REQUIRED", resolution: null, baseMinutes: 480, resolutionDropped: true });
  });

  it("si cambia el motivo de revisión (p. ej. se registró el ALTA y ahora falta el turno), vuelve a PENDING", () => {
    const previous = resolvedSchedule({ scheduleReviewReason: "EMPLOYMENT_HISTORY_UNRESOLVED" });
    expect(evaluate({ type: VACACIONES, workday: unresolvedWorkday("SCHEDULE_MISSING"), previous })).toMatchObject({ reviewStatus: "PENDING", scheduleReviewReason: "SCHEDULE_MISSING", resolutionDropped: true });
  });

  it("una resolución sobre un día cubierto (conflicto con trabajo real, etapa 4) se conserva mientras siga cubierto", () => {
    const previous = resolvedSchedule({ outcome: "COVERED", scheduleReviewReason: null, resolution: "CONFIRMED_ZERO", resolvedBaseMinutes: 0, resolvedAgainstWorkedMinutes: 480 });
    expect(evaluate({ type: TRAMITE, previous })).toMatchObject({ outcome: "COVERED", reviewStatus: "RESOLVED", effectiveBaseMinutes: 0, resolvedAgainstWorkedMinutes: 480 });
    expect(evaluate({ type: TRAMITE, previous, dayOff: true })).toMatchObject({ outcome: "DAY_OFF", reviewStatus: "NOT_REQUIRED", resolutionDropped: true });
  });

  it("etapa 5: CONFIRMED_ZERO en un día cubierto se conserva aunque cambie la cantidad del tipo (la decisión no dependía de ella)", () => {
    const previous = resolvedSchedule({ outcome: "COVERED", scheduleReviewReason: null, expectedMinutes: 480, resolution: "CONFIRMED_ZERO", resolvedBaseMinutes: 0, resolvedAgainstWorkedMinutes: 480 });
    expect(evaluate({ type: { ...TRAMITE, coverageFixedMinutes: 180 }, previous })).toMatchObject({ baseMinutes: 180, reviewStatus: "RESOLVED", effectiveBaseMinutes: 0, resolutionDropped: false });
  });

  it("etapa 5: horas base indicadas contra una jornada esperada se descartan si esa jornada cambia (otra incertidumbre)", () => {
    const compatible = { ...TRAMITE, realWorkCompatibility: "COMPATIBLE" as const };
    const previous = resolvedSchedule({ outcome: "COVERED", scheduleReviewReason: null, expectedMinutes: 480, resolution: "SET_BASE_MINUTES", resolvedBaseMinutes: 120, resolvedAgainstWorkedMinutes: 360 });
    expect(evaluate({ type: compatible, previous, workday: workday({ expectedMinutes: 480 }) })).toMatchObject({ reviewStatus: "RESOLVED", effectiveBaseMinutes: 120, resolutionDropped: false });
    expect(evaluate({ type: compatible, previous, workday: workday({ expectedMinutes: 540 }) })).toMatchObject({ reviewStatus: "NOT_REQUIRED", resolution: null, effectiveBaseMinutes: 240, resolutionDropped: true });
  });
});
