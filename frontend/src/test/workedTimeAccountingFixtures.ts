import type { EmployeeTimeGrid, EmployeeTimeGridRow } from "../services/api/employeeApiService";
import type { DayAccounting, PeriodAccounting } from "../types/workedTimeAccounting.types";

// Fixtures del ejemplo canónico de docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md.
// Los valores replican la salida del backend (workedTimeAccounting.ts): los
// tests de UI verifican que la pantalla MUESTRA lo que llega, no que lo calcula.

const CONCEPT_BASE = { createdAt: "2026-01-01", updatedAt: "2026-01-01", status: "ACTIVO" as const };

export const normalConcept = { ...CONCEPT_BASE, id: "normal", code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL" as const, loadMode: null, systemRole: "NORMAL_BASE" as const, workTreatment: null };
export const serenoConcept = { ...CONCEPT_BASE, id: "sereno", code: "HOR-001", name: "Sereno", kind: "SERENO" as const, loadMode: "BOTH" as const, systemRole: null, workTreatment: "WITHIN_BASE" as const };
export const colectivoConcept = { ...CONCEPT_BASE, id: "colectivo", code: "HOR-002", name: "Colectivo", kind: "TRANSPORTE" as const, loadMode: "MANUAL" as const, systemRole: null, workTreatment: "ADDITIVE_TO_WORKED_TOTAL" as const };

const H = 60;

/** Un día con base/Sereno/Colectivo (en horas) y multiplicador; valores = backend. */
export function dayAccounting(day: number, { base = 8, sereno = 3, colectivo = 1, multiplier = 1 } = {}): DayAccounting {
  const residual = Math.max(0, base - sereno);
  const concepts = [
    ...(sereno ? [{ hourConceptId: "sereno", treatment: "WITHIN_BASE" as const, realMinutes: sereno * H, settlementMinutes: sereno * H * multiplier }] : []),
    ...(colectivo ? [{ hourConceptId: "colectivo", treatment: "ADDITIVE_TO_WORKED_TOTAL" as const, realMinutes: colectivo * H, settlementMinutes: colectivo * H * multiplier }] : []),
  ];
  return {
    day,
    multiplier,
    baseMinutes: base * H,
    normalResidualMinutes: residual * H,
    withinBaseMinutes: sereno * H,
    withinBaseCoveredMinutes: Math.min(sereno, base) * H,
    withinBaseOverlapMinutes: 0,
    withinBaseExcessMinutes: Math.max(0, sereno - base) * H,
    additiveMinutes: colectivo * H,
    totalWorkedMinutes: (base + colectivo) * H,
    settlement: {
      normalMinutes: residual * H * multiplier,
      withinBaseMinutes: sereno * H * multiplier,
      additiveMinutes: colectivo * H * multiplier,
      totalMinutes: (residual + sereno + colectivo) * H * multiplier,
    },
    concepts,
  };
}

export function periodAccounting(days: DayAccounting[]): PeriodAccounting {
  const sum = (pick: (day: DayAccounting) => number) => days.reduce((total, day) => total + pick(day), 0);
  const conceptIds = Array.from(new Set(days.flatMap((day) => day.concepts.map((concept) => concept.hourConceptId))));
  return {
    hasSpecialMultiplier: days.some((day) => day.multiplier > 1),
    days: Object.fromEntries(days.map((day) => [String(day.day), day])),
    baseMinutes: sum((day) => day.baseMinutes),
    normalResidualMinutes: sum((day) => day.normalResidualMinutes),
    withinBaseMinutes: sum((day) => day.withinBaseMinutes),
    withinBaseCoveredMinutes: sum((day) => day.withinBaseCoveredMinutes),
    withinBaseOverlapMinutes: sum((day) => day.withinBaseOverlapMinutes),
    withinBaseExcessMinutes: sum((day) => day.withinBaseExcessMinutes),
    additiveMinutes: sum((day) => day.additiveMinutes),
    totalWorkedMinutes: sum((day) => day.totalWorkedMinutes),
    settlement: {
      normalMinutes: sum((day) => day.settlement.normalMinutes),
      withinBaseMinutes: sum((day) => day.settlement.withinBaseMinutes),
      additiveMinutes: sum((day) => day.settlement.additiveMinutes),
      totalMinutes: sum((day) => day.settlement.totalMinutes),
    },
    concepts: conceptIds.map((id) => {
      const matching = days.flatMap((day) => day.concepts.filter((concept) => concept.hourConceptId === id));
      return { hourConceptId: id, treatment: matching[0]!.treatment, realMinutes: matching.reduce((t, c) => t + c.realMinutes, 0), settlementMinutes: matching.reduce((t, c) => t + c.settlementMinutes, 0) };
    }),
  };
}

export function gridRows(days: DayAccounting[]): EmployeeTimeGridRow[] {
  const byDay = (pick: (day: DayAccounting) => number) =>
    Object.fromEntries(days.filter((day) => pick(day) > 0).map((day) => [String(day.day), pick(day)]));
  const row = (concept: EmployeeTimeGridRow["concept"], role: EmployeeTimeGridRow["role"], minutesByDay: Record<string, number>): EmployeeTimeGridRow => ({
    concept, role, enabled: true, minutesByDay, totalMinutes: Object.values(minutesByDay).reduce((t, m) => t + m, 0),
  });
  return [
    row(normalConcept, "NORMAL_BASE", byDay((day) => day.baseMinutes)),
    row(serenoConcept, "ADDITIONAL", byDay((day) => day.withinBaseMinutes)),
    row(colectivoConcept, "ADDITIONAL", byDay((day) => day.additiveMinutes)),
  ];
}

/** Grilla por legajo con los días dados (default: un día común 8/3/1). */
export function timeGridFixture(days: DayAccounting[] = [dayAccounting(4)], overrides: Partial<EmployeeTimeGrid> = {}): EmployeeTimeGrid {
  const accounting = periodAccounting(days);
  return {
    employee: {} as EmployeeTimeGrid["employee"],
    entries: [],
    novelties: [],
    noveltyTypes: [],
    hourConcepts: [],
    rows: gridRows(days),
    accounting,
    attendanceIssues: 0,
    specialHoursByDay: Object.fromEntries(days.filter((day) => day.multiplier > 1).map((day) => [String(day.day), { multiplier: day.multiplier, ruleNames: ["Domingos"], conflict: false }])),
    ...overrides,
  };
}
