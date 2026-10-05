import type { HourConceptWorkTreatment } from "../types/hourConcept.types";
import type { PeriodAccounting } from "../types/workedTimeAccounting.types";

// Lenguaje de negocio para el modelo de tiempo trabajado
// (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md). Sólo presentación: los
// números salen siempre del backend (PeriodAccounting/DayAccounting).
export const workTreatmentLabels: Record<HourConceptWorkTreatment, string> = {
  WITHIN_BASE: "Dentro de la jornada",
  ADDITIVE_TO_WORKED_TOTAL: "Horas adicionales",
};

export const workTreatmentDescriptions: Record<HourConceptWorkTreatment, string> = {
  WITHIN_BASE: "Clasifica horas que ya están dentro de las horas base. No suma al total trabajado.",
  ADDITIVE_TO_WORKED_TOTAL: "Tiempo trabajado fuera de la fichada. Suma al total trabajado.",
};

export const workTreatmentOptions = Object.entries(workTreatmentLabels) as Array<[HourConceptWorkTreatment, string]>;

// Estado inicial/vacío mientras no llegó la contabilidad del backend.
export function emptyPeriodAccounting(): PeriodAccounting {
  return {
    hasSpecialMultiplier: false,
    days: {},
    baseMinutes: 0,
    normalResidualMinutes: 0,
    withinBaseMinutes: 0,
    withinBaseCoveredMinutes: 0,
    withinBaseOverlapMinutes: 0,
    withinBaseExcessMinutes: 0,
    additiveMinutes: 0,
    totalWorkedMinutes: 0,
    settlement: { normalMinutes: 0, withinBaseMinutes: 0, additiveMinutes: 0, totalMinutes: 0 },
    concepts: [],
  };
}
