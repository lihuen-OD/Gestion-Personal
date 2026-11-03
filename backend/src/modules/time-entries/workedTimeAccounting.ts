import type { HourConceptBreakdownSource, HourConceptWorkTreatment, Prisma, WorkShiftSource } from "@prisma/client";
import { calendarDateKey } from "../../shared/datetime/argentinaTime";
import { AppError } from "../../shared/errors/AppError";

/**
 * Modelo único de contabilidad de tiempo trabajado
 * (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md).
 *
 * Es la ÚNICA implementación de las fórmulas base/residual/total/equivalencia.
 * Grilla de período, detalle por legajo, "Por persona", export, cierre mensual,
 * resumen de Carga de horas y dashboard le pasan sus filas (ya filtradas con
 * el criterio de estado propio de cada consumidor) y leen el resultado — nadie
 * más vuelve a sumar `base - dentro + adicionales`.
 *
 *   totalWorked     = base + ADDITIVE                    (nunca + WITHIN_BASE)
 *   normalResidual  = max(0, base - cobertura(WITHIN_BASE))
 *   equivalencia    = normal×m + Σ WITHIN_BASE×m + Σ ADDITIVE×m
 *
 * Cobertura WITHIN_BASE = unión de los intervalos reales (desgloses
 * AUTOMATIC, que persisten startAt/endAt) + minutos de desgloses sin
 * intervalo (MANUAL: distribución declarada, sin posición en la jornada).
 * Así un minuto compartido por dos conceptos dentro de la jornada nunca se
 * resta dos veces de la base.
 *
 * Francos (docs/decisions/EMPLOYEE_DAY_OFF.md §7): las horas AUTOMÁTICAS de
 * jornadas cuya fecha operativa tiene franco activo no computan; lo cargado o
 * corregido por una persona sí. `applyDayOffExclusions` es la única
 * implementación de esa regla y `accountEmployeePeriods` la aplica.
 */

export type WorkTreatment = HourConceptWorkTreatment;

export type AccountingBaseEntry = {
  employeeId: string;
  day: number;
  minutes: number;
  multiplier: number;
  // Fecha calendario "YYYY-MM-DD" y si las horas vigentes las fijó el fichador
  // (francos). Sin estos datos la fila nunca se excluye.
  dateKey?: string;
  automatic?: boolean;
};

export type AccountingBreakdown = {
  employeeId: string;
  day: number;
  hourConceptId: string;
  treatment: WorkTreatment;
  minutes: number;
  multiplier: number;
  startAt?: Date | null;
  endAt?: Date | null;
  dateKey?: string;
  automatic?: boolean;
  workShiftId?: string | null;
};

export type ConceptAccounting = {
  hourConceptId: string;
  treatment: WorkTreatment;
  realMinutes: number;
  settlementMinutes: number;
};

export type SettlementAccounting = {
  normalMinutes: number;
  withinBaseMinutes: number;
  additiveMinutes: number;
  totalMinutes: number;
};

type AccountingTotals = {
  // Horas base registradas (NORMAL_BASE) — nunca se reescriben.
  baseMinutes: number;
  // Base − cobertura dentro de la jornada (nunca < 0).
  normalResidualMinutes: number;
  // Suma de minutos de conceptos WITHIN_BASE (cada concepto conserva su
  // desglose individual aunque dos se superpongan).
  withinBaseMinutes: number;
  // Minutos de base efectivamente cubiertos (unión, tope = base).
  withinBaseCoveredMinutes: number;
  // Minutos compartidos por más de un concepto WITHIN_BASE.
  withinBaseOverlapMinutes: number;
  // Cobertura que excede la base registrada (inconsistencia a revisar: p. ej.
  // un concepto dentro de la jornada sin Horas base aprobadas ese día).
  withinBaseExcessMinutes: number;
  additiveMinutes: number;
  totalWorkedMinutes: number;
  // Horas base automáticas registradas que no computan por pertenecer a una
  // jornada en franco (evidencia conservada, a revisar).
  dayOffUncountedMinutes: number;
  settlement: SettlementAccounting;
  concepts: ConceptAccounting[];
};

export type DayAccounting = AccountingTotals & {
  day: number;
  // Mayor multiplicador de Hora Especial presente ese día (1 = sin regla).
  multiplier: number;
};

export type PeriodAccounting = AccountingTotals & {
  hasSpecialMultiplier: boolean;
  days: Record<string, DayAccounting>;
};

const MINUTE_MS = 60_000;

function unionMinutes(intervals: Array<{ startAt: Date; endAt: Date }>) {
  const sorted = [...intervals].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  let totalMs = 0;
  let currentStart: number | null = null;
  let currentEnd = 0;
  for (const interval of sorted) {
    const start = interval.startAt.getTime();
    const end = interval.endAt.getTime();
    if (currentStart === null || start > currentEnd) {
      if (currentStart !== null) totalMs += currentEnd - currentStart;
      currentStart = start;
      currentEnd = end;
    } else if (end > currentEnd) {
      currentEnd = end;
    }
  }
  if (currentStart !== null) totalMs += currentEnd - currentStart;
  return Math.round(totalMs / MINUTE_MS);
}

/**
 * Minutos de base cubiertos por conceptos WITHIN_BASE de UN empleado+día (sin
 * tope). Usado por accountDay y por la validación de carga manual.
 */
export function withinBaseCoverageMinutes(breakdowns: Array<Pick<AccountingBreakdown, "treatment" | "minutes" | "startAt" | "endAt">>) {
  const within = breakdowns.filter((breakdown) => breakdown.treatment === "WITHIN_BASE");
  const intervals = within.flatMap((breakdown) => (breakdown.startAt && breakdown.endAt ? [{ startAt: breakdown.startAt, endAt: breakdown.endAt }] : []));
  const withoutInterval = within.filter((breakdown) => !(breakdown.startAt && breakdown.endAt)).reduce((sum, breakdown) => sum + breakdown.minutes, 0);
  return unionMinutes(intervals) + withoutInterval;
}

function emptySettlement(): SettlementAccounting {
  return { normalMinutes: 0, withinBaseMinutes: 0, additiveMinutes: 0, totalMinutes: 0 };
}

/** Contabilidad de un único empleado+día. */
export function accountDay(day: number, baseEntries: AccountingBaseEntry[], breakdowns: AccountingBreakdown[]): DayAccounting {
  const baseMinutes = baseEntries.reduce((sum, entry) => sum + entry.minutes, 0);
  const baseWeighted = baseEntries.reduce((sum, entry) => sum + entry.minutes * entry.multiplier, 0);
  // Las Horas normales residuales no tienen posición propia dentro de la
  // jornada: si la base del día mezcla multiplicadores (caso raro: dos
  // jornadas con reglas distintas), el residual se valoriza al promedio
  // ponderado de la base. Con un único multiplicador es exacto.
  const baseMultiplier = baseMinutes > 0 ? baseWeighted / baseMinutes : 1;

  const conceptsById = new Map<string, { treatment: WorkTreatment; realMinutes: number; weighted: number }>();
  for (const breakdown of breakdowns) {
    const current = conceptsById.get(breakdown.hourConceptId) ?? { treatment: breakdown.treatment, realMinutes: 0, weighted: 0 };
    current.realMinutes += breakdown.minutes;
    current.weighted += breakdown.minutes * breakdown.multiplier;
    conceptsById.set(breakdown.hourConceptId, current);
  }
  const concepts: ConceptAccounting[] = Array.from(conceptsById, ([hourConceptId, value]) => ({
    hourConceptId,
    treatment: value.treatment,
    realMinutes: value.realMinutes,
    settlementMinutes: Math.round(value.weighted),
  }));

  const sumBy = (treatment: WorkTreatment, field: "realMinutes" | "settlementMinutes") =>
    concepts.filter((concept) => concept.treatment === treatment).reduce((sum, concept) => sum + concept[field], 0);
  const withinBaseMinutes = sumBy("WITHIN_BASE", "realMinutes");
  const additiveMinutes = sumBy("ADDITIVE_TO_WORKED_TOTAL", "realMinutes");
  const coverage = withinBaseCoverageMinutes(breakdowns);
  const normalResidualMinutes = Math.max(0, baseMinutes - coverage);

  const settlement: SettlementAccounting = {
    normalMinutes: Math.round(normalResidualMinutes * baseMultiplier),
    withinBaseMinutes: sumBy("WITHIN_BASE", "settlementMinutes"),
    additiveMinutes: sumBy("ADDITIVE_TO_WORKED_TOTAL", "settlementMinutes"),
    totalMinutes: 0,
  };
  settlement.totalMinutes = settlement.normalMinutes + settlement.withinBaseMinutes + settlement.additiveMinutes;

  const multipliers = [...baseEntries.map((entry) => entry.multiplier), ...breakdowns.map((breakdown) => breakdown.multiplier)];
  return {
    day,
    multiplier: multipliers.length ? Math.max(1, ...multipliers) : 1,
    baseMinutes,
    normalResidualMinutes,
    withinBaseMinutes,
    withinBaseCoveredMinutes: Math.min(coverage, baseMinutes),
    withinBaseOverlapMinutes: Math.max(0, withinBaseMinutes - coverage),
    withinBaseExcessMinutes: Math.max(0, coverage - baseMinutes),
    additiveMinutes,
    totalWorkedMinutes: baseMinutes + additiveMinutes,
    dayOffUncountedMinutes: 0,
    settlement,
    concepts,
  };
}

function emptyPeriod(): PeriodAccounting {
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
    dayOffUncountedMinutes: 0,
    settlement: emptySettlement(),
    concepts: [],
  };
}

function addDay(period: PeriodAccounting, day: DayAccounting) {
  period.days[String(day.day)] = day;
  period.hasSpecialMultiplier ||= day.multiplier > 1;
  period.baseMinutes += day.baseMinutes;
  period.normalResidualMinutes += day.normalResidualMinutes;
  period.withinBaseMinutes += day.withinBaseMinutes;
  period.withinBaseCoveredMinutes += day.withinBaseCoveredMinutes;
  period.withinBaseOverlapMinutes += day.withinBaseOverlapMinutes;
  period.withinBaseExcessMinutes += day.withinBaseExcessMinutes;
  period.additiveMinutes += day.additiveMinutes;
  period.totalWorkedMinutes += day.totalWorkedMinutes;
  period.dayOffUncountedMinutes += day.dayOffUncountedMinutes;
  period.settlement.normalMinutes += day.settlement.normalMinutes;
  period.settlement.withinBaseMinutes += day.settlement.withinBaseMinutes;
  period.settlement.additiveMinutes += day.settlement.additiveMinutes;
  period.settlement.totalMinutes += day.settlement.totalMinutes;
  for (const concept of day.concepts) {
    const current = period.concepts.find((item) => item.hourConceptId === concept.hourConceptId);
    if (current) {
      current.realMinutes += concept.realMinutes;
      current.settlementMinutes += concept.settlementMinutes;
    } else {
      period.concepts.push({ ...concept });
    }
  }
}

// ── Francos (docs/decisions/EMPLOYEE_DAY_OFF.md §7) ─────────────────────────

/**
 * Índice de francos de un rango, armado por
 * `employee-day-offs/employeeDayOffAccounting.ts::loadDayOffAccounting`.
 * Claves `employeeId|YYYY-MM-DD` (fecha calendario).
 */
export type DayOffAccountingIndex = {
  // Minutos de tramos de jornadas del fichador cuya fecha operativa tiene
  // franco activo, por la fecha calendario del tramo (una noche en franco
  // también descuenta lo que cae al día siguiente).
  excludedBaseMinutes: ReadonlyMap<string, number>;
  // Esas jornadas: sus desgloses automáticos (Motor B guarda workShiftId) no computan.
  excludedWorkShiftIds: ReadonlySet<string>;
  // Fechas con franco activo: atribución de un desglose automático sin jornada.
  dayOffDates: ReadonlySet<string>;
};

export const EMPTY_DAY_OFF_ACCOUNTING: DayOffAccountingIndex = { excludedBaseMinutes: new Map(), excludedWorkShiftIds: new Set(), dayOffDates: new Set() };

export const dayOffKey = (employeeId: string, dateKey: string) => `${employeeId}|${dateKey}`;

/**
 * Canales del fichador (`WorkShiftSource` salvo ADMIN). Una fila de Horas base
 * es automática si su `source` es uno de estos: el fichador fijó sus horas.
 * `null` (carga manual) y `ADMIN` (jornada registrada a mano o corrección de
 * horas, ver timeEntriesRepository.update) son horas fijadas por una persona.
 */
export const CLOCK_TIME_ENTRY_SOURCES = ["PORTAL_DNI", "PUBLIC_CLOCK_PHOTO", "KIOSK", "BIOTIME", "FACIAL"] as const satisfies readonly WorkShiftSource[];

export function isAutomaticTimeEntrySource(source: WorkShiftSource | null | undefined) {
  return (CLOCK_TIME_ENTRY_SOURCES as readonly string[]).includes(source ?? "");
}

export type DayOffExclusionResult = {
  baseEntries: AccountingBaseEntry[];
  breakdowns: AccountingBreakdown[];
  uncountedBase: Array<{ employeeId: string; day: number; minutes: number }>;
  excludedBreakdowns: AccountingBreakdown[];
};

/**
 * Única regla de francos sobre la contabilidad: a cada fila AUTOMÁTICA de
 * Horas base se le descuentan los minutos de jornadas en franco de esa fecha
 * (tope: sus propios minutos) y los desgloses AUTOMATIC de una jornada en
 * franco no computan. Lo manual nunca se toca. Sin francos devuelve las mismas
 * filas.
 */
export function applyDayOffExclusions(baseEntries: AccountingBaseEntry[], breakdowns: AccountingBreakdown[], index: DayOffAccountingIndex = EMPTY_DAY_OFF_ACCOUNTING): DayOffExclusionResult {
  if (!index.excludedBaseMinutes.size && !index.dayOffDates.size) return { baseEntries, breakdowns, uncountedBase: [], excludedBreakdowns: [] };

  const remaining = new Map(index.excludedBaseMinutes);
  const counted: AccountingBaseEntry[] = [];
  const uncountedBase: DayOffExclusionResult["uncountedBase"] = [];
  for (const entry of baseEntries) {
    const key = entry.automatic && entry.dateKey ? dayOffKey(entry.employeeId, entry.dateKey) : null;
    const excluded = key ? Math.min(entry.minutes, remaining.get(key) ?? 0) : 0;
    if (!excluded) {
      counted.push(entry);
      continue;
    }
    remaining.set(key!, (remaining.get(key!) ?? 0) - excluded);
    uncountedBase.push({ employeeId: entry.employeeId, day: entry.day, minutes: excluded });
    if (entry.minutes > excluded) counted.push({ ...entry, minutes: entry.minutes - excluded });
  }

  const countedBreakdowns: AccountingBreakdown[] = [];
  const excludedBreakdowns: AccountingBreakdown[] = [];
  for (const breakdown of breakdowns) {
    const isExcluded = Boolean(breakdown.automatic) && (breakdown.workShiftId
      ? index.excludedWorkShiftIds.has(breakdown.workShiftId)
      : Boolean(breakdown.dateKey && index.dayOffDates.has(dayOffKey(breakdown.employeeId, breakdown.dateKey))));
    (isExcluded ? excludedBreakdowns : countedBreakdowns).push(breakdown);
  }
  return { baseEntries: counted, breakdowns: countedBreakdowns, uncountedBase, excludedBreakdowns };
}

/**
 * Contabilidad por empleado del período (un recorrido, sin consultas): aplica
 * los francos (`dayOffs`), agrupa por empleado+día y delega cada día en
 * accountDay. Los empleados sin filas no aparecen en el Map — usar
 * `emptyPeriodAccounting()` como default.
 */
export function accountEmployeePeriods(baseEntries: AccountingBaseEntry[], breakdowns: AccountingBreakdown[], dayOffs: DayOffAccountingIndex = EMPTY_DAY_OFF_ACCOUNTING) {
  const applied = applyDayOffExclusions(baseEntries, breakdowns, dayOffs);
  type Bucket = { base: AccountingBaseEntry[]; breakdowns: AccountingBreakdown[]; uncounted: number };
  const grouped = new Map<string, Map<number, Bucket>>();
  const bucket = (employeeId: string, day: number) => {
    const days = grouped.get(employeeId) ?? new Map<number, Bucket>();
    grouped.set(employeeId, days);
    const current = days.get(day) ?? { base: [], breakdowns: [], uncounted: 0 };
    days.set(day, current);
    return current;
  };
  for (const entry of applied.baseEntries) bucket(entry.employeeId, entry.day).base.push(entry);
  for (const breakdown of applied.breakdowns) bucket(breakdown.employeeId, breakdown.day).breakdowns.push(breakdown);
  for (const item of applied.uncountedBase) bucket(item.employeeId, item.day).uncounted += item.minutes;

  const result = new Map<string, PeriodAccounting>();
  for (const [employeeId, days] of grouped) {
    const period = emptyPeriod();
    for (const day of [...days.keys()].sort((a, b) => a - b)) {
      const rows = days.get(day)!;
      addDay(period, { ...accountDay(day, rows.base, rows.breakdowns), dayOffUncountedMinutes: rows.uncounted });
    }
    result.set(employeeId, period);
  }
  return result;
}

export function emptyPeriodAccounting(): PeriodAccounting {
  return emptyPeriod();
}

/** Contabilidad de un único empleado (detalle por legajo, cierre). */
export function accountEmployeePeriod(baseEntries: AccountingBaseEntry[], breakdowns: AccountingBreakdown[], dayOffs: DayOffAccountingIndex = EMPTY_DAY_OFF_ACCOUNTING) {
  const employeeIds = new Set([...baseEntries.map((entry) => entry.employeeId), ...breakdowns.map((breakdown) => breakdown.employeeId)]);
  if (employeeIds.size > 1) throw new Error("accountEmployeePeriod recibe filas de un único empleado");
  const [employeeId] = employeeIds;
  return (employeeId ? accountEmployeePeriods(baseEntries, breakdowns, dayOffs).get(employeeId) : undefined) ?? emptyPeriod();
}

// ── Adaptadores desde Prisma ────────────────────────────────────────────────
// Selects compartidos para que cada consumidor traiga exactamente lo que la
// contabilidad necesita (y nada que la vuelva a calcular por su cuenta).

export const accountingBaseEntrySelect = {
  employeeId: true,
  day: true,
  date: true,
  hours: true,
  appliedMultiplier: true,
  source: true,
} satisfies Prisma.TimeEntrySelect;

export const accountingBreakdownSelect = {
  employeeId: true,
  day: true,
  date: true,
  source: true,
  workShiftId: true,
  hourConceptId: true,
  minutes: true,
  appliedMultiplier: true,
  startAt: true,
  endAt: true,
  hourConcept: { select: { workTreatment: true } },
} satisfies Prisma.HourConceptBreakdownSelect;

type DecimalLike = Prisma.Decimal | number | string | null | undefined;

export function toAccountingBaseEntry(entry: { employeeId: string; day: number; hours: DecimalLike; appliedMultiplier?: DecimalLike; date?: Date; source?: WorkShiftSource | null }): AccountingBaseEntry {
  return {
    employeeId: entry.employeeId,
    day: entry.day,
    minutes: Math.round(Number(entry.hours ?? 0) * 60),
    multiplier: Number(entry.appliedMultiplier ?? 1) || 1,
    ...(entry.date ? { dateKey: calendarDateKey(entry.date) } : {}),
    automatic: isAutomaticTimeEntrySource(entry.source),
  };
}

export function toAccountingBreakdown(breakdown: {
  employeeId: string;
  day: number;
  hourConceptId: string;
  minutes: number;
  appliedMultiplier?: DecimalLike;
  startAt?: Date | null;
  endAt?: Date | null;
  date?: Date;
  source?: HourConceptBreakdownSource;
  workShiftId?: string | null;
  hourConcept: { workTreatment: WorkTreatment | null };
}): AccountingBreakdown {
  // El CHECK HourConcept_work_treatment_check garantiza que todo concepto
  // adicional tiene tratamiento; si faltara, es un dato corrupto — nunca se
  // adivina si suma o no al total.
  if (!breakdown.hourConcept.workTreatment) {
    throw new AppError("Hour concept has no work treatment", 500, "HOUR_CONCEPT_WORK_TREATMENT_MISSING");
  }
  return {
    employeeId: breakdown.employeeId,
    day: breakdown.day,
    hourConceptId: breakdown.hourConceptId,
    treatment: breakdown.hourConcept.workTreatment,
    minutes: breakdown.minutes,
    multiplier: Number(breakdown.appliedMultiplier ?? 1) || 1,
    startAt: breakdown.startAt ?? null,
    endAt: breakdown.endAt ?? null,
    ...(breakdown.date ? { dateKey: calendarDateKey(breakdown.date) } : {}),
    automatic: breakdown.source === "AUTOMATIC",
    workShiftId: breakdown.workShiftId ?? null,
  };
}

/**
 * Total trabajado a partir de agregados ya sumados por la base (resúmenes y
 * dashboard, que no necesitan el detalle por día): base + ADDITIVE. Misma
 * regla que accountDay.totalWorkedMinutes.
 */
export function totalWorkedHours(baseHours: number, additiveMinutes: number) {
  return baseHours + additiveMinutes / 60;
}

/** Estados de HourConceptBreakdown que cuentan en grillas/export/dashboard (criterio vigente desde 6M). */
export const countedBreakdownStatusWhere = { not: "RECHAZADO" } as const;
