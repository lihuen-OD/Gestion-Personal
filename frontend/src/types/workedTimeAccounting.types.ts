import type { HourConceptWorkTreatment } from "./hourConcept.types";

// Contrato de la contabilidad de tiempo trabajado que calcula el backend
// (backend/src/modules/time-entries/workedTimeAccounting.ts,
// docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md). El frontend sólo lo
// muestra: nunca vuelve a sumar base, residual, adicionales ni equivalencias.

export type ConceptAccounting = {
  hourConceptId: string;
  treatment: HourConceptWorkTreatment;
  realMinutes: number;
  settlementMinutes: number;
};

export type SettlementAccounting = {
  normalMinutes: number;
  withinBaseMinutes: number;
  additiveMinutes: number;
  totalMinutes: number;
};

export type AccountingTotals = {
  baseMinutes: number;
  normalResidualMinutes: number;
  withinBaseMinutes: number;
  withinBaseCoveredMinutes: number;
  withinBaseOverlapMinutes: number;
  withinBaseExcessMinutes: number;
  additiveMinutes: number;
  totalWorkedMinutes: number;
  settlement: SettlementAccounting;
  concepts: ConceptAccounting[];
};

export type DayAccounting = AccountingTotals & {
  day: number;
  multiplier: number;
};

export type PeriodAccounting = AccountingTotals & {
  hasSpecialMultiplier: boolean;
  days: Record<string, DayAccounting>;
};

// "Por persona" no necesita el detalle diario.
export type PeriodAccountingSummary = Omit<PeriodAccounting, "days"> & { days?: Record<string, DayAccounting> };
