import type { HourConceptWorkTreatment } from "../types/hourConcept.types";
import type { DayAccounting, PeriodAccounting } from "../types/workedTimeAccounting.types";

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

// ── Cantidades para liquidación por fila (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §17) ──
// La grilla muestra, por cada concepto que se liquida (Horas normales y cada
// concepto horario), el tiempo PARA LIQUIDACIÓN de cada día y del período,
// con el tiempo real como contexto. Estos helpers sólo LEEN lo que calculó el
// backend (DayAccounting.settlement.normalMinutes, DayAccounting.concepts[],
// PeriodAccounting.concepts[]): nunca multiplican.

export type SettlementAmount = {
  realMinutes: number;
  settlementMinutes: number;
  multiplier: number;
  // La contabilidad todavía no refleja la fila (edición optimista en curso):
  // se muestra el real hasta que llegue la recalculada.
  pending: boolean;
};

const plainAmount = (realMinutes: number, multiplier = 1, pending = false): SettlementAmount => ({ realMinutes, settlementMinutes: realMinutes, multiplier, pending });

/** Concepto horario en un día: real y para liquidación según el backend. */
export function conceptDayAmount(accounting: PeriodAccounting, day: number, hourConceptId: string, rowRealMinutes: number): SettlementAmount {
  const dayAccounting = accounting.days[String(day)];
  const multiplier = dayAccounting?.multiplier ?? 1;
  const concept = dayAccounting?.concepts.find((item) => item.hourConceptId === hourConceptId);
  if (!concept) return plainAmount(rowRealMinutes, multiplier, rowRealMinutes > 0 && multiplier > 1);
  if (concept.realMinutes !== rowRealMinutes) return plainAmount(rowRealMinutes, multiplier, multiplier > 1);
  return { realMinutes: concept.realMinutes, settlementMinutes: concept.settlementMinutes, multiplier, pending: false };
}

/** Concepto horario en el período (columna TOTAL). */
export function conceptPeriodAmount(accounting: PeriodAccounting, hourConceptId: string, rowRealMinutes: number): SettlementAmount {
  const concept = accounting.concepts.find((item) => item.hourConceptId === hourConceptId);
  if (!concept || concept.realMinutes !== rowRealMinutes) return plainAmount(rowRealMinutes, 1, accounting.hasSpecialMultiplier);
  return { realMinutes: concept.realMinutes, settlementMinutes: concept.settlementMinutes, multiplier: 1, pending: false };
}

/** Horas normales (residual) en un día. */
export function normalDayAmount(day: DayAccounting): SettlementAmount {
  return { realMinutes: day.normalResidualMinutes, settlementMinutes: day.settlement.normalMinutes, multiplier: day.multiplier, pending: false };
}

/** Horas normales (residual) en el período. */
export function normalPeriodAmount(accounting: PeriodAccounting): SettlementAmount {
  return { realMinutes: accounting.normalResidualMinutes, settlementMinutes: accounting.settlement.normalMinutes, multiplier: 1, pending: false };
}
