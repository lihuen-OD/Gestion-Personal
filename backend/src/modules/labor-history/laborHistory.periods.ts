// Reglas puras de la historia temporal (D-5,
// docs/decisions/ORG_LOCATION_REORGANIZATION.md §19). Sin Prisma: reciben las
// vigencias ya leídas (fechas como clave de calendario "YYYY-MM-DD") y deciden
// qué escribir o qué valor rige en una fecha.
//
// Invariantes que garantizan las escrituras (y la exclusión btree_gist en la base):
// - las vigencias de un mismo legajo/puesto y dimensión no se superponen, así
//   que una fecha resuelve a lo sumo una;
// - un cambio desde D sólo toca la vigencia que contiene a D: nunca reescribe
//   fechas anteriores a D;
// - la ausencia de vigencia es falta de evidencia, nunca "valor actual".
import { AppError } from "../../shared/errors/AppError";
import { formatArgentinaDate, previousCalendarDateKey } from "../../shared/datetime/argentinaTime";

export type DateKey = string;

export type Period<V> = { id: string; effectiveFrom: DateKey; effectiveTo: DateKey | null; value: V };

export function periodCovers(period: Pick<Period<unknown>, "effectiveFrom" | "effectiveTo">, dateKey: DateKey) {
  return period.effectiveFrom <= dateKey && (period.effectiveTo === null || dateKey <= period.effectiveTo);
}

/** La vigencia que cubre la fecha, o `undefined` si no hay evidencia para ese día. */
export function periodAt<V>(periods: readonly Period<V>[], dateKey: DateKey): Period<V> | undefined {
  return periods.find((period) => periodCovers(period, dateKey));
}

export function latestPeriod<V>(periods: readonly Period<V>[]): Period<V> | undefined {
  return periods.reduce<Period<V> | undefined>((latest, period) => (!latest || period.effectiveFrom > latest.effectiveFrom ? period : latest), undefined);
}

export type ChangePlan<V> =
  /** El valor pedido ya rige desde esa fecha: no hay nada que registrar. */
  | { kind: "NONE" }
  /** No hay vigencia que contenga a D: se abre una nueva (primera o posterior a una cerrada). Nada anterior a D se completa. */
  | { kind: "OPEN"; effectiveFrom: DateKey; effectiveTo: DateKey | null }
  /** Cambio desde D: la vigencia actual se cierra en D − 1 y la nueva empieza en D. */
  | { kind: "SPLIT"; closePeriodId: string; closeTo: DateKey; previous: V; effectiveFrom: DateKey; effectiveTo: DateKey | null }
  /** D es el inicio de la vigencia actual: corrección de su valor (auditada), sin abrir otra. */
  | { kind: "REPLACE"; periodId: string; previous: V; effectiveFrom: DateKey; effectiveTo: DateKey | null };

/**
 * Decide cómo registrar "desde `effectiveFrom` el valor pasa a ser X" sobre las
 * vigencias existentes de UNA dimensión.
 *
 * - D anterior al inicio de la vigencia actual: rechazado. Reescribiría más de
 *   una vigencia y fechas ya resueltas con la historia anterior.
 * - D futura: rechazada (las columnas vigentes que leen filtros y permisos no
 *   tienen activación programada), salvo que sea el inicio de una vigencia
 *   futura ya registrada (corrección de un alta con fecha futura).
 */
export function planChangeFrom<V>(
  periods: readonly Period<V>[],
  effectiveFrom: DateKey,
  todayKey: DateKey,
  isSameValue: (current: V) => boolean,
  label: string,
): ChangePlan<V> {
  const latest = latestPeriod(periods);
  if (latest && effectiveFrom < latest.effectiveFrom) {
    throw new AppError(
      `${label}: la fecha desde (${formatArgentinaDate(effectiveFrom)}) es anterior al inicio de la vigencia actual (${formatArgentinaDate(latest.effectiveFrom)}). Un cambio con esa fecha reescribiría historia ya registrada; elegí una fecha desde el ${formatArgentinaDate(latest.effectiveFrom)}.`,
      409,
      "LABOR_HISTORY_DATE_BEFORE_CURRENT_PERIOD",
      { label, effectiveFrom, currentFrom: latest.effectiveFrom },
    );
  }
  if (effectiveFrom > todayKey && effectiveFrom !== latest?.effectiveFrom) {
    throw new AppError(
      `${label}: los cambios con fecha futura (${formatArgentinaDate(effectiveFrom)}) todavía no están disponibles. Registrá el cambio el día en que empieza a regir.`,
      409,
      "LABOR_HISTORY_FUTURE_DATE_NOT_SUPPORTED",
      { label, effectiveFrom, today: todayKey },
    );
  }
  if (!latest) return { kind: "OPEN", effectiveFrom, effectiveTo: null };
  if (effectiveFrom === latest.effectiveFrom) {
    return isSameValue(latest.value) ? { kind: "NONE" } : { kind: "REPLACE", periodId: latest.id, previous: latest.value, effectiveFrom, effectiveTo: latest.effectiveTo };
  }
  if (latest.effectiveTo !== null && effectiveFrom > latest.effectiveTo) return { kind: "OPEN", effectiveFrom, effectiveTo: null };
  if (isSameValue(latest.value)) return { kind: "NONE" };
  return { kind: "SPLIT", closePeriodId: latest.id, closeTo: previousCalendarDateKey(effectiveFrom), previous: latest.value, effectiveFrom, effectiveTo: latest.effectiveTo };
}

/** Períodos "YYYY-MM" desde el mes de `fromKey` hasta el de `toKey`, inclusive. */
export function monthsBetween(fromKey: DateKey, toKey: DateKey): string[] {
  const months: string[] = [];
  let year = Number(fromKey.slice(0, 4));
  let month = Number(fromKey.slice(5, 7));
  const last = toKey.slice(0, 7);
  for (;;) {
    const current = `${year}-${String(month).padStart(2, "0")}`;
    if (current > last) break;
    months.push(current);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return months;
}

export const sameIdSet = (a: readonly string[], b: readonly string[]) => {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((item, index) => item === right[index]);
};

export function describeInterval(effectiveFrom: DateKey, effectiveTo: DateKey | null) {
  return effectiveTo ? `${formatArgentinaDate(effectiveFrom)} → ${formatArgentinaDate(effectiveTo)}` : `desde ${formatArgentinaDate(effectiveFrom)}`;
}
