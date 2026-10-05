import type { SettlementAmount } from "../../utils/workedTimeAccounting";
import { formatCompactDurationMinutes, formatDurationMinutes } from "../../utils/hours";
import { formatMultiplier } from "../attendance/segmentDisplay";

// Presentación compartida de las cantidades para liquidación de la grilla
// mensual por concepto (detalle por legajo y revisión de cierre). Los números
// llegan del backend (utils/workedTimeAccounting.ts); acá sólo se eligen el
// valor principal y el contexto (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §17).

export const realLabel = (minutes: number) => `${formatDurationMinutes(minutes)} ${minutes <= 60 ? "real" : "reales"}`;

/** Valor principal de una celda: lo que se liquida (en un día sin Hora Especial, el real). */
export function amountMinutes(amount: SettlementAmount) {
  return amount.pending ? amount.realMinutes : amount.settlementMinutes;
}

export const isSpecialAmount = (amount: SettlementAmount) => amount.multiplier > 1 && !amount.pending;

/** "Feriados x2 · 1 h real · 2 h para liquidación" */
export function specialHourAmountTitle(amount: SettlementAmount, ruleNames: string[] = []) {
  const rule = `${ruleNames.length ? ruleNames.join(", ") : "Hora especial"} ${formatMultiplier(amount.multiplier)}`;
  if (amount.pending) return `${rule} · recalculando para liquidación…`;
  return `${rule} · ${realLabel(amount.realMinutes)} · ${formatDurationMinutes(amount.settlementMinutes)} para liquidación`;
}

/** Texto accesible/tooltip de una celda con horas. */
export function amountDescription(amount: SettlementAmount, ruleNames: string[] = []) {
  return isSpecialAmount(amount) || amount.pending ? specialHourAmountTitle(amount, ruleNames) : formatDurationMinutes(amount.realMinutes);
}

/** Indicador naranja de Hora Especial con contexto (no sólo el punto). */
export function SpecialHourDot({ amount, ruleNames }: { amount: SettlementAmount; ruleNames?: string[] }) {
  if (amount.multiplier <= 1) return null;
  return <span className="alert-dot orange" title={specialHourAmountTitle(amount, ruleNames)} />;
}

/**
 * Columna TOTAL de una fila que se liquida: el total PARA LIQUIDACIÓN como
 * valor principal y el real como subtexto sólo cuando difiere.
 */
export function SettlementTotalCell({ amount }: { amount: SettlementAmount }) {
  const main = amountMinutes(amount);
  const differs = !amount.pending && amount.settlementMinutes !== amount.realMinutes;
  const title = differs
    ? `${formatDurationMinutes(amount.settlementMinutes)} para liquidación · ${realLabel(amount.realMinutes)}`
    : formatDurationMinutes(main);
  return (
    <td className={amount.pending ? "hours-total-cell is-syncing" : "hours-total-cell"}>
      <b title={title}>{formatCompactDurationMinutes(main)}</b>
      {differs ? <small className="hours-total-real">{formatCompactDurationMinutes(amount.realMinutes)} {amount.realMinutes <= 60 ? "real" : "reales"}</small> : null}
    </td>
  );
}

/**
 * Indicador en "Horas base": la base es tiempo registrado; lo que se liquida
 * está en Horas normales y en cada concepto.
 */
export function baseSpecialHourTitle(multiplier: number, ruleNames: string[] = []) {
  return `${ruleNames.length ? ruleNames.join(", ") : "Hora especial"} ${formatMultiplier(multiplier)} · horas registradas; se liquidan en Horas normales y en cada concepto`;
}
