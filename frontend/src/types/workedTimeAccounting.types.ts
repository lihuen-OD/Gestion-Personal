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
  noveltyMinutes: number;
  totalMinutes: number;
};

export type NoveltyCoverageState = "COUNTED" | "INFORMATIVE" | "PENDING_APPROVAL" | "REVIEW_REQUIRED";

export type NoveltyCoverageReviewReason =
  | "SCHEDULE_UNRESOLVED"
  | "RESOLUTION_OUTDATED"
  | "REAL_WORK_ON_INCOMPATIBLE"
  | "REAL_WORK_EXCEEDS_EXPECTED"
  | "REAL_WORK_WITHOUT_EXPECTED"
  | "COVERAGE_TOTAL_EXCEEDS_EXPECTED";

export type NoveltyCoverageItem = {
  noveltyId: string;
  noveltyTypeId: string;
  code: string;
  label: string;
  uiColor: string | null;
  minutes: number;
  settlementMinutes: number;
  state: NoveltyCoverageState;
  countsTowardTotal: boolean;
  reviewRequired: boolean;
  reviewReasons: NoveltyCoverageReviewReason[];
};

export type NoveltyDayAccounting = {
  coveredMinutes: number;
  settlementMinutes: number;
  informativeMinutes: number;
  pendingApprovalMinutes: number;
  heldMinutes: number;
  reviewRequired: boolean;
  items: Array<{
    noveltyId: string;
    noveltyTypeId: string;
    state: NoveltyCoverageState;
    reviewReasons: NoveltyCoverageReviewReason[];
    baseMinutes: number;
    multiplier: number;
    settlementMinutes: number;
    countsTowardTotal: boolean;
  }>;
};

export type NoveltyTypeAccounting = {
  noveltyTypeId: string;
  coveredMinutes: number;
  settlementMinutes: number;
  informativeMinutes: number;
  pendingApprovalMinutes: number;
  heldMinutes: number;
};

export type NoveltyPeriodAccounting = Omit<NoveltyDayAccounting, "items" | "reviewRequired"> & {
  reviewDays: number;
  reviewDates: string[];
  types: NoveltyTypeAccounting[];
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
  noveltyCoveredMinutes: number;
  computableMinutes: number;
  // Horas base automáticas registradas que no computan por pertenecer a una
  // jornada en franco (docs/decisions/EMPLOYEE_DAY_OFF.md §7). Opcional:
  // snapshots y respuestas previas al franco no lo traen.
  dayOffUncountedMinutes?: number;
  settlement: SettlementAccounting;
  concepts: ConceptAccounting[];
};

export type DayAccounting = AccountingTotals & {
  day: number;
  multiplier: number;
  novelty: NoveltyDayAccounting;
};

export type PeriodAccounting = AccountingTotals & {
  hasSpecialMultiplier: boolean;
  days: Record<string, DayAccounting>;
  novelty: NoveltyPeriodAccounting;
};

// "Por persona" no necesita el detalle diario.
export type PeriodAccountingSummary = Omit<PeriodAccounting, "days"> & { days?: Record<string, DayAccounting> };
