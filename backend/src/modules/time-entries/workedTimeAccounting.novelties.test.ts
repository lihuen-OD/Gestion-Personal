import { describe, expect, it } from "vitest";
import {
  accountDay,
  accountEmployeePeriod,
  accountEmployeePeriods,
  accountNoveltyDay,
  type AccountingBaseEntry,
  type AccountingBreakdown,
  type AccountingNoveltyCoverage,
} from "./workedTimeAccounting";

// Contabilidad con cobertura de novedades — Etapa 4
// (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §12). totalWorkedMinutes sigue
// siendo trabajo real; la cobertura es un componente aparte.
const H = 60;
const base = (day: number, hours: number, multiplier = 1): AccountingBaseEntry => ({ employeeId: "emp-1", day, minutes: hours * H, multiplier });
const colectivo = (day: number, minutes: number): AccountingBreakdown => ({ employeeId: "emp-1", day, hourConceptId: "colectivo", treatment: "ADDITIVE_TO_WORKED_TOTAL", minutes, multiplier: 1 });

function coverage(overrides: Partial<AccountingNoveltyCoverage> = {}): AccountingNoveltyCoverage {
  return {
    employeeId: "emp-1",
    day: 16,
    dateKey: "2026-11-16",
    noveltyId: "nov-1",
    noveltyTypeId: "type-1",
    status: "APROBADO",
    outcome: "COVERED",
    scheduleReviewReason: null,
    baseMinutes: 480,
    resolvedBaseMinutes: null,
    multiplier: 1,
    countsTowardTotal: true,
    realWorkCompatibility: "INCOMPATIBLE",
    expectedMinutes: 480,
    reviewStatus: "NOT_REQUIRED",
    resolution: null,
    resolvedAgainstWorkedMinutes: null,
    ...overrides,
  };
}
const tramite = (overrides: Partial<AccountingNoveltyCoverage> = {}) => coverage({ baseMinutes: 240, ...overrides });

describe("sin novedades: el resultado es el mismo de siempre", () => {
  it("accountDay sin cobertura: computable = trabajado y la liquidación no cambia", () => {
    const day = accountDay(16, [base(16, 8)], [colectivo(16, 60)]);
    expect(day).toMatchObject({ totalWorkedMinutes: 540, noveltyCoveredMinutes: 0, computableMinutes: 540 });
    expect(day.settlement).toEqual({ normalMinutes: 480, withinBaseMinutes: 0, additiveMinutes: 60, noveltyMinutes: 0, totalMinutes: 540 });
    expect(day.novelty).toEqual({ coveredMinutes: 0, settlementMinutes: 0, informativeMinutes: 0, pendingApprovalMinutes: 0, heldMinutes: 0, reviewRequired: false, items: [] });
  });
});

describe("Trámite bancario (4 h, suma, incompatible)", () => {
  it("sin trabajo real → COUNTED, computable 4 h", () => {
    const day = accountDay(16, [], [], [tramite()]);
    expect(day).toMatchObject({ totalWorkedMinutes: 0, noveltyCoveredMinutes: 240, computableMinutes: 240 });
    expect(day.settlement.totalMinutes).toBe(240);
    expect(day.novelty.items[0]).toMatchObject({ state: "COUNTED", baseMinutes: 240, reviewReasons: [] });
  });

  it.each([4, 8])("con %s h reales → REVIEW_REQUIRED, cobertura retenida, computable = sólo el trabajo real (nunca la suma)", (hours) => {
    const day = accountDay(16, [base(16, hours)], [], [tramite()]);
    expect(day).toMatchObject({ totalWorkedMinutes: hours * H, noveltyCoveredMinutes: 0, computableMinutes: hours * H });
    expect(day.settlement.totalMinutes).toBe(hours * H);
    expect(day.novelty).toMatchObject({ heldMinutes: 240, reviewRequired: true });
    expect(day.novelty.items[0]).toMatchObject({ state: "REVIEW_REQUIRED", reviewReasons: ["REAL_WORK_ON_INCOMPATIBLE"] });
  });

  it("resuelto como \"no cubre este día\" contra este trabajo → sin revisión, cuenta sólo el trabajo real", () => {
    const resolved = tramite({ reviewStatus: "RESOLVED", resolution: "CONFIRMED_ZERO", resolvedBaseMinutes: 0, resolvedAgainstWorkedMinutes: 480 });
    const day = accountDay(16, [base(16, 8)], [], [resolved]);
    expect(day).toMatchObject({ computableMinutes: 480, noveltyCoveredMinutes: 0 });
    expect(day.novelty.reviewRequired).toBe(false);
  });

  it("si el trabajo real cambia después de resolver, vuelve a revisión", () => {
    const resolved = tramite({ reviewStatus: "RESOLVED", resolution: "CONFIRMED_ZERO", resolvedBaseMinutes: 0, resolvedAgainstWorkedMinutes: 480 });
    expect(accountDay(16, [base(16, 6)], [], [resolved]).novelty.items[0]).toMatchObject({ state: "REVIEW_REQUIRED", reviewReasons: ["RESOLUTION_OUTDATED"] });
  });
});

describe("Maternidad (8 h L–V, sin multiplicadores)", () => {
  it("lunes → 480 computables; sábado (0) → nada", () => {
    expect(accountDay(16, [], [], [coverage()])).toMatchObject({ computableMinutes: 480, noveltyCoveredMinutes: 480 });
    const saturday = accountDay(21, [], [], [coverage({ day: 21, outcome: "WEEKDAY_NOT_INCLUDED", baseMinutes: 0 })]);
    expect(saturday).toMatchObject({ computableMinutes: 0, noveltyCoveredMinutes: 0 });
    expect(saturday.novelty.items[0]?.state).toBe("COUNTED");
  });
});

describe("Vacaciones (8 h por obligación, multiplicadores)", () => {
  it("domingo con obligación ×2 → computable 8 h, liquidación 16 h (no son 16 h trabajadas)", () => {
    const day = accountDay(22, [], [], [coverage({ day: 22, multiplier: 2 })]);
    expect(day).toMatchObject({ totalWorkedMinutes: 0, noveltyCoveredMinutes: 480, computableMinutes: 480 });
    expect(day.settlement).toMatchObject({ noveltyMinutes: 960, totalMinutes: 960 });
  });

  it("feriado convocado ×2 → computable 480, liquidación 960", () => {
    const day = accountDay(18, [], [], [coverage({ day: 18, multiplier: 2 })]);
    expect(day).toMatchObject({ computableMinutes: 480 });
    expect(day.settlement.noveltyMinutes).toBe(960);
  });

  it.each(["DAY_OFF", "HOLIDAY_NOT_CONVOKED", "NO_WORK_OBLIGATION"] as const)("%s → 0, y el trabajo real de ese día no es conflicto", (outcome) => {
    const day = accountDay(17, [base(17, 8)], [], [coverage({ day: 17, outcome, baseMinutes: 0 })]);
    expect(day).toMatchObject({ computableMinutes: 480, noveltyCoveredMinutes: 0 });
    expect(day.novelty.reviewRequired).toBe(false);
  });

  it("jornada sin resolver (flexible) → 0 provisional en revisión, bloquea", () => {
    const day = accountDay(16, [], [], [coverage({ outcome: "SCHEDULE_UNRESOLVED", scheduleReviewReason: "FLEXIBLE_REGIME_NO_ASSIGNMENT", baseMinutes: 0, expectedMinutes: null, reviewStatus: "PENDING" })]);
    expect(day).toMatchObject({ computableMinutes: 0, noveltyCoveredMinutes: 0 });
    expect(day.novelty.items[0]).toMatchObject({ state: "REVIEW_REQUIRED", reviewReasons: ["SCHEDULE_UNRESOLVED"] });
  });

  it("resolución manual: domingo flexible, el encargado indica 8 h y ×2 → computable 8 h, liquidación 16 h", () => {
    const resolved = coverage({
      day: 22,
      outcome: "SCHEDULE_UNRESOLVED",
      scheduleReviewReason: "FLEXIBLE_REGIME_NO_ASSIGNMENT",
      baseMinutes: 0,
      expectedMinutes: null,
      reviewStatus: "RESOLVED",
      resolution: "SET_BASE_MINUTES",
      resolvedBaseMinutes: 480,
      resolvedAgainstWorkedMinutes: 0,
      multiplier: 2,
    });
    const day = accountDay(22, [], [], [resolved]);
    expect(day).toMatchObject({ totalWorkedMinutes: 0, noveltyCoveredMinutes: 480, computableMinutes: 480 });
    expect(day.settlement.noveltyMinutes).toBe(960);
  });

  it("resolución CONFIRMED_ZERO → 0 confirmado, sin revisión", () => {
    const resolved = coverage({ outcome: "SCHEDULE_UNRESOLVED", scheduleReviewReason: "SCHEDULE_MISSING", baseMinutes: 0, reviewStatus: "RESOLVED", resolution: "CONFIRMED_ZERO", resolvedBaseMinutes: 0, resolvedAgainstWorkedMinutes: 0 });
    const day = accountDay(16, [], [], [resolved]);
    expect(day).toMatchObject({ computableMinutes: 0 });
    expect(day.novelty.reviewRequired).toBe(false);
  });
});

describe("Llegada tarde (manual, informativa)", () => {
  it("7 h reales + 1 h informativa → computable 7 h, la novedad sigue visible", () => {
    const day = accountDay(16, [base(16, 7)], [], [coverage({ baseMinutes: 60, countsTowardTotal: false, realWorkCompatibility: "COMPATIBLE" })]);
    expect(day).toMatchObject({ totalWorkedMinutes: 420, noveltyCoveredMinutes: 0, computableMinutes: 420 });
    expect(day.novelty).toMatchObject({ informativeMinutes: 60, reviewRequired: false });
    expect(day.novelty.items[0]).toMatchObject({ state: "INFORMATIVE", baseMinutes: 60 });
  });
});

describe("Falta sin aviso (sin tiempo, incompatible)", () => {
  const falta = (overrides: Partial<AccountingNoveltyCoverage> = {}) => coverage({ outcome: "NO_COVERAGE", baseMinutes: 0, countsTowardTotal: false, ...overrides });

  it("sin trabajo → computable 0, sin revisión", () => {
    const day = accountDay(16, [], [], [falta()]);
    expect(day).toMatchObject({ computableMinutes: 0 });
    expect(day.novelty.items[0]).toMatchObject({ state: "INFORMATIVE", baseMinutes: 0 });
  });

  it("con trabajo registrado → revisión (inconsistencia)", () => {
    const day = accountDay(16, [base(16, 8)], [], [falta()]);
    expect(day).toMatchObject({ computableMinutes: 480 });
    expect(day.novelty.items[0]).toMatchObject({ state: "REVIEW_REQUIRED", reviewReasons: ["REAL_WORK_ON_INCOMPATIBLE"] });
  });

  it("la revisión es administrativa: no hay minutos de cobertura retenidos ni por resolver (ADR §12.4)", () => {
    const day = accountDay(16, [base(16, 8)], [], [falta()]);
    expect(day).toMatchObject({ totalWorkedMinutes: 480, noveltyCoveredMinutes: 0, computableMinutes: 480 });
    expect(day.settlement).toMatchObject({ noveltyMinutes: 0, totalMinutes: 480 });
    expect(day.novelty).toMatchObject({ coveredMinutes: 0, settlementMinutes: 0, heldMinutes: 0, informativeMinutes: 0, reviewRequired: true });
    expect(day.novelty.items[0]).toMatchObject({ baseMinutes: 0 });
  });
});

describe("estado de aprobación", () => {
  it("PENDIENTE: visible con su cantidad, no suma ni bloquea (aunque haya trabajo)", () => {
    const day = accountDay(16, [base(16, 8)], [], [tramite({ status: "PENDIENTE" })]);
    expect(day).toMatchObject({ computableMinutes: 480, noveltyCoveredMinutes: 0 });
    expect(day.novelty).toMatchObject({ pendingApprovalMinutes: 240, reviewRequired: false });
    expect(day.novelty.items[0]).toMatchObject({ state: "PENDING_APPROVAL", reviewReasons: [] });
  });

  it("RECHAZADA (dato histórico inesperado): se ignora por completo", () => {
    const day = accountDay(16, [], [], [tramite({ status: "RECHAZADO" })]);
    expect(day).toMatchObject({ computableMinutes: 0 });
    expect(day.novelty.items).toEqual([]);
    expect(accountEmployeePeriods([], [], undefined, [tramite({ status: "RECHAZADO" })]).size).toBe(0);
  });
});

describe("tipos compatibles que suman (motor genérico)", () => {
  const compatible = (overrides: Partial<AccountingNoveltyCoverage> = {}) => coverage({ baseMinutes: 240, realWorkCompatibility: "COMPATIBLE", expectedMinutes: 480, ...overrides });

  it("dentro de la jornada: 4 h reales + 4 h → COUNTED, computable 8 h", () => {
    const day = accountDay(16, [base(16, 4)], [], [compatible()]);
    expect(day).toMatchObject({ computableMinutes: 480, noveltyCoveredMinutes: 240 });
  });

  it("excediendo la jornada: 8 h + 4 h → revisión, sin truncar", () => {
    const day = accountDay(16, [base(16, 8)], [], [compatible()]);
    expect(day).toMatchObject({ computableMinutes: 480, noveltyCoveredMinutes: 0 });
    expect(day.novelty.items[0]).toMatchObject({ state: "REVIEW_REQUIRED", reviewReasons: ["REAL_WORK_EXCEEDS_EXPECTED"], baseMinutes: 240 });
  });

  it("con trabajo real y sin jornada esperada → revisión", () => {
    const day = accountDay(16, [base(16, 2)], [], [compatible({ expectedMinutes: null })]);
    expect(day.novelty.items[0]).toMatchObject({ state: "REVIEW_REQUIRED", reviewReasons: ["REAL_WORK_WITHOUT_EXPECTED"] });
  });

  it("sin trabajo real no hace falta jornada esperada", () => {
    expect(accountDay(16, [], [], [compatible({ expectedMinutes: null })])).toMatchObject({ computableMinutes: 240 });
  });

  it("resuelto contra este trabajo → cuenta", () => {
    const resolved = compatible({ reviewStatus: "RESOLVED", resolution: "SET_BASE_MINUTES", resolvedBaseMinutes: 120, resolvedAgainstWorkedMinutes: 360 });
    expect(accountDay(16, [base(16, 6)], [], [resolved])).toMatchObject({ computableMinutes: 480, noveltyCoveredMinutes: 120 });
  });
});

describe("varias novedades el mismo día y agregación del período", () => {
  it("Trámite (suma) + Llegada tarde (informativa) sin trabajo: cada una con su estado", () => {
    const result = accountNoveltyDay([tramite({ realWorkCompatibility: "COMPATIBLE" }), coverage({ noveltyId: "nov-2", noveltyTypeId: "type-2", baseMinutes: 60, countsTowardTotal: false, realWorkCompatibility: "COMPATIBLE" })], 0);
    expect(result).toMatchObject({ coveredMinutes: 240, informativeMinutes: 60, reviewRequired: false });
  });

  it("el período suma cobertura, computable, liquidación, días a revisar (con fecha) y totales por tipo", () => {
    const period = accountEmployeePeriod(
      [base(17, 8)],
      [],
      undefined,
      [
        coverage({ day: 16, dateKey: "2026-11-16" }),
        coverage({ day: 22, dateKey: "2026-11-22", multiplier: 2 }),
        tramite({ day: 17, dateKey: "2026-11-17", noveltyId: "nov-3", noveltyTypeId: "type-3" }),
      ],
    );
    expect(period).toMatchObject({ totalWorkedMinutes: 480, noveltyCoveredMinutes: 960, computableMinutes: 1440, hasSpecialMultiplier: true });
    expect(period.settlement).toMatchObject({ noveltyMinutes: 1440, totalMinutes: 480 + 1440 });
    expect(period.novelty).toMatchObject({ coveredMinutes: 960, settlementMinutes: 1440, heldMinutes: 240, reviewDays: 1, reviewDates: ["2026-11-17"] });
    expect(period.novelty.types).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ noveltyTypeId: "type-1", coveredMinutes: 960, settlementMinutes: 1440 }),
        expect.objectContaining({ noveltyTypeId: "type-3", heldMinutes: 240 }),
      ]),
    );
    // Un día sólo con cobertura existe en la contabilidad aunque no haya trabajo.
    expect(period.days["22"]).toMatchObject({ totalWorkedMinutes: 0, computableMinutes: 480 });
  });

  it("la cobertura usa el trabajo que computa después de francos (no las horas automáticas excluidas)", () => {
    const automatic: AccountingBaseEntry = { ...base(17, 8), dateKey: "2026-11-17", automatic: true };
    const dayOffs = { excludedBaseMinutes: new Map([["emp-1|2026-11-17", 480]]), excludedWorkShiftIds: new Set<string>(), dayOffDates: new Set(["emp-1|2026-11-17"]) };
    const period = accountEmployeePeriod([automatic], [], dayOffs, [tramite({ day: 17, dateKey: "2026-11-17" })]);
    expect(period.days["17"]).toMatchObject({ totalWorkedMinutes: 0, noveltyCoveredMinutes: 240, computableMinutes: 240 });
  });
});
