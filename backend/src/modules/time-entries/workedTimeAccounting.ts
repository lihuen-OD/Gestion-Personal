import type {
  ApprovalStatus,
  HourConceptBreakdownSource,
  HourConceptWorkTreatment,
  NoveltyCoverageOutcome,
  NoveltyCoverageResolution,
  NoveltyCoverageReviewStatus,
  NoveltyCoverageScheduleReviewReason,
  NoveltyRealWorkCompatibility,
  Prisma,
  WorkShiftSource,
} from "@prisma/client";
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
 *
 * Cobertura de novedades (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §12):
 * tercer componente, separado del trabajo real. Nunca entra a
 * `totalWorkedMinutes`:
 *   noveltyCovered  = Σ cobertura COUNTED (minutos base efectivos)
 *   computable      = totalWorked + noveltyCovered
 *   settlement      = … + Σ cobertura COUNTED × su multiplicador
 * `accountNoveltyDay` es la única implementación de los estados COUNTED /
 * INFORMATIVE / PENDING_APPROVAL / REVIEW_REQUIRED.
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
  // Cobertura de novedades COUNTED × su multiplicador (NOVELTY_COVERAGE_ENGINE.md §12).
  noveltyMinutes: number;
  totalMinutes: number;
};

// ── Cobertura de novedades ──────────────────────────────────────────────────

/** Una fila de NoveltyDayCoverage con el estado de su novedad (toAccountingNoveltyCoverage). */
export type AccountingNoveltyCoverage = {
  employeeId: string;
  day: number;
  dateKey?: string;
  noveltyId: string;
  noveltyTypeId: string;
  status: ApprovalStatus;
  outcome: NoveltyCoverageOutcome;
  scheduleReviewReason: NoveltyCoverageScheduleReviewReason | null;
  baseMinutes: number;
  resolvedBaseMinutes: number | null;
  multiplier: number;
  countsTowardTotal: boolean;
  realWorkCompatibility: NoveltyRealWorkCompatibility;
  expectedMinutes: number | null;
  reviewStatus: NoveltyCoverageReviewStatus;
  resolution: NoveltyCoverageResolution | null;
  resolvedAgainstWorkedMinutes: number | null;
};

export type NoveltyCoverageState = "COUNTED" | "INFORMATIVE" | "PENDING_APPROVAL" | "REVIEW_REQUIRED";

export type NoveltyCoverageReviewReason =
  // Jornada o relación laboral sin resolver (0 h provisional).
  | "SCHEDULE_UNRESOLVED"
  // Resuelto contra otros minutos reales: el trabajo del día cambió.
  | "RESOLUTION_OUTDATED"
  // Tipo incompatible con trabajo real y hay trabajo ese día.
  | "REAL_WORK_ON_INCOMPATIBLE"
  // Tipo compatible que suma: trabajo + cobertura supera la jornada esperada.
  | "REAL_WORK_EXCEEDS_EXPECTED"
  // Tipo compatible que suma, con trabajo real y sin jornada esperada para validar.
  | "REAL_WORK_WITHOUT_EXPECTED"
  // P5: dos o más coberturas que suman, más el trabajo real del día, superan
  // la jornada esperada conocida. Se retienen todas las implicadas.
  | "COVERAGE_TOTAL_EXCEEDS_EXPECTED";

export type NoveltyItemAccounting = {
  noveltyId: string;
  noveltyTypeId: string;
  outcome: NoveltyCoverageOutcome;
  state: NoveltyCoverageState;
  reviewReasons: NoveltyCoverageReviewReason[];
  // Minutos base efectivos (resueltos o calculados) y su multiplicador: lo que
  // la novedad representa ese día, cuente o no.
  baseMinutes: number;
  multiplier: number;
  settlementMinutes: number;
  countsTowardTotal: boolean;
};

export type NoveltyDayAccounting = {
  coveredMinutes: number;
  settlementMinutes: number;
  informativeMinutes: number;
  pendingApprovalMinutes: number;
  heldMinutes: number;
  reviewRequired: boolean;
  items: NoveltyItemAccounting[];
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
  // Fechas (AAAA-MM-DD, o el día del mes si la fila no trae fecha) con revisión pendiente.
  reviewDates: string[];
  types: NoveltyTypeAccounting[];
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
  // Cobertura de novedades COUNTED (minutos base, sin multiplicar). Nunca es
  // trabajo real: no entra a totalWorkedMinutes.
  noveltyCoveredMinutes: number;
  // totalWorkedMinutes + noveltyCoveredMinutes.
  computableMinutes: number;
  settlement: SettlementAccounting;
  concepts: ConceptAccounting[];
};

export type DayAccounting = AccountingTotals & {
  day: number;
  // Mayor multiplicador de Hora Especial presente ese día en el trabajo real
  // (1 = sin regla). El de la cobertura vive en novelty.items.
  multiplier: number;
  novelty: NoveltyDayAccounting;
};

export type PeriodAccounting = AccountingTotals & {
  hasSpecialMultiplier: boolean;
  days: Record<string, DayAccounting>;
  novelty: NoveltyPeriodAccounting;
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
  return { normalMinutes: 0, withinBaseMinutes: 0, additiveMinutes: 0, noveltyMinutes: 0, totalMinutes: 0 };
}

function emptyNoveltyDay(): NoveltyDayAccounting {
  return { coveredMinutes: 0, settlementMinutes: 0, informativeMinutes: 0, pendingApprovalMinutes: 0, heldMinutes: 0, reviewRequired: false, items: [] };
}

// Días en que la novedad no aplica (no hay nada que compatibilizar con el
// trabajo real): franco, fin de semana excluido, sin obligación, feriado,
// fuera de la relación laboral.
const NOVELTY_APPLIES_OUTCOMES: ReadonlySet<NoveltyCoverageOutcome> = new Set(["COVERED", "NO_COVERAGE", "SCHEDULE_UNRESOLVED"]);

/**
 * Estado de cada cobertura de un empleado+día frente al trabajo real del día
 * (`workedMinutes` = totalWorkedMinutes, ya sin lo que no computa por franco).
 * Única implementación (NOVELTY_COVERAGE_ENGINE.md §12):
 *   - RECHAZADO: se ignora (no debería tener filas; defensa).
 *   - no APROBADO → PENDING_APPROVAL (visible, no suma, no bloquea).
 *   - revisión → REVIEW_REQUIRED (no suma; bloquea el envío del cierre):
 *     jornada/relación sin resolver; resolución hecha contra otros minutos
 *     reales; tipo INCOMPATIBLE con trabajo real en un día que la novedad
 *     cubre (nunca se suman, gana el trabajo real); tipo COMPATIBLE que suma
 *     y supera la jornada esperada, o sin jornada esperada para validarlo.
 *   - no suma al total → INFORMATIVE (visible).
 *   - si no → COUNTED: suma sus minutos base y, a liquidación, × multiplicador.
 * Segunda pasada, agregada (P5, §12.3): si dos o más coberturas quedaron
 * COUNTED y trabajo real + su suma supera la jornada esperada conocida, todas
 * pasan a REVIEW_REQUIRED (COVERAGE_TOTAL_EXCEEDS_EXPECTED). No se elige una
 * por orden ni se trunca; con jornada desconocida rigen las reglas
 * individuales. Una cobertura sola conserva el comportamiento de su tipo.
 * Nunca trunca ni ajusta minutos en silencio.
 */
export function accountNoveltyDay(coverages: AccountingNoveltyCoverage[], workedMinutes: number): NoveltyDayAccounting {
  const result = emptyNoveltyDay();
  const evaluated: Array<{ coverage: AccountingNoveltyCoverage; baseMinutes: number; reviewReasons: NoveltyCoverageReviewReason[]; state: NoveltyCoverageState }> = [];
  for (const coverage of coverages) {
    if (coverage.status === "RECHAZADO") continue;
    const baseMinutes = coverage.resolvedBaseMinutes ?? coverage.baseMinutes;
    const resolvedForThisWork = coverage.reviewStatus === "RESOLVED" && coverage.resolvedAgainstWorkedMinutes === workedMinutes;
    const reviewReasons: NoveltyCoverageReviewReason[] = [];
    if (coverage.reviewStatus === "PENDING") reviewReasons.push("SCHEDULE_UNRESOLVED");
    if (coverage.reviewStatus === "RESOLVED" && coverage.resolvedAgainstWorkedMinutes !== workedMinutes) reviewReasons.push("RESOLUTION_OUTDATED");
    // Un ajuste manual con horas (§18) aplica aunque el cálculo automático
    // hubiera dejado el día sin cobertura (p. ej. un feriado que no cuenta).
    const applies = NOVELTY_APPLIES_OUTCOMES.has(coverage.outcome) || (coverage.reviewStatus === "RESOLVED" && baseMinutes > 0);
    if (workedMinutes > 0 && applies) {
      if (coverage.realWorkCompatibility === "INCOMPATIBLE") {
        // Un día que la novedad cubre (o una novedad sin tiempo, p. ej. Falta
        // sin aviso) no admite trabajo real. Sólo deja de serlo una
        // resolución "no cubre este día" (0 min) hecha contra este trabajo.
        if (baseMinutes > 0 || coverage.outcome === "NO_COVERAGE") reviewReasons.push("REAL_WORK_ON_INCOMPATIBLE");
      } else if (coverage.countsTowardTotal && baseMinutes > 0 && !resolvedForThisWork) {
        if (coverage.expectedMinutes === null) reviewReasons.push("REAL_WORK_WITHOUT_EXPECTED");
        else if (workedMinutes + baseMinutes > coverage.expectedMinutes) reviewReasons.push("REAL_WORK_EXCEEDS_EXPECTED");
      }
    }
    const state: NoveltyCoverageState =
      coverage.status !== "APROBADO" ? "PENDING_APPROVAL" : reviewReasons.length ? "REVIEW_REQUIRED" : coverage.countsTowardTotal ? "COUNTED" : "INFORMATIVE";
    evaluated.push({ coverage, baseMinutes, reviewReasons, state });
  }

  // P5: validación agregada de las candidatas a COUNTED contra la jornada
  // esperada conocida. Una jornada desconocida en cualquiera de ellas no
  // inventa un límite. Independiente del orden de las coberturas.
  const candidates = evaluated.filter((item) => item.state === "COUNTED" && item.baseMinutes > 0);
  if (candidates.length > 1 && candidates.every((item) => item.coverage.expectedMinutes !== null)) {
    const expectedMinutes = Math.min(...candidates.map((item) => item.coverage.expectedMinutes!));
    const claimedMinutes = workedMinutes + candidates.reduce((sum, item) => sum + item.baseMinutes, 0);
    if (claimedMinutes > expectedMinutes) {
      for (const item of candidates) {
        item.state = "REVIEW_REQUIRED";
        item.reviewReasons.push("COVERAGE_TOTAL_EXCEEDS_EXPECTED");
      }
    }
  }

  for (const { coverage, baseMinutes, reviewReasons, state } of evaluated) {
    const settlementMinutes = Math.round(baseMinutes * coverage.multiplier);
    if (state === "COUNTED") {
      result.coveredMinutes += baseMinutes;
      result.settlementMinutes += settlementMinutes;
    } else if (state === "INFORMATIVE") {
      result.informativeMinutes += baseMinutes;
    } else if (state === "PENDING_APPROVAL") {
      result.pendingApprovalMinutes += baseMinutes;
    } else {
      result.heldMinutes += baseMinutes;
      result.reviewRequired = true;
    }
    result.items.push({
      noveltyId: coverage.noveltyId,
      noveltyTypeId: coverage.noveltyTypeId,
      outcome: coverage.outcome,
      state,
      reviewReasons: state === "PENDING_APPROVAL" ? [] : reviewReasons,
      baseMinutes,
      multiplier: coverage.multiplier,
      settlementMinutes,
      countsTowardTotal: coverage.countsTowardTotal,
    });
  }
  return result;
}

/** Contabilidad de un único empleado+día. */
export function accountDay(day: number, baseEntries: AccountingBaseEntry[], breakdowns: AccountingBreakdown[], noveltyCoverages: AccountingNoveltyCoverage[] = []): DayAccounting {
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
    noveltyMinutes: 0,
    totalMinutes: 0,
  };
  const totalWorkedMinutes = baseMinutes + additiveMinutes;
  const novelty = accountNoveltyDay(noveltyCoverages, totalWorkedMinutes);
  settlement.noveltyMinutes = novelty.settlementMinutes;
  settlement.totalMinutes = settlement.normalMinutes + settlement.withinBaseMinutes + settlement.additiveMinutes + settlement.noveltyMinutes;

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
    totalWorkedMinutes,
    dayOffUncountedMinutes: 0,
    noveltyCoveredMinutes: novelty.coveredMinutes,
    computableMinutes: totalWorkedMinutes + novelty.coveredMinutes,
    settlement,
    concepts,
    novelty,
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
    noveltyCoveredMinutes: 0,
    computableMinutes: 0,
    settlement: emptySettlement(),
    concepts: [],
    novelty: { coveredMinutes: 0, settlementMinutes: 0, informativeMinutes: 0, pendingApprovalMinutes: 0, heldMinutes: 0, reviewDays: 0, reviewDates: [], types: [] },
  };
}

function addNoveltyDay(period: PeriodAccounting, day: DayAccounting, dateKey: string | undefined) {
  const totals = period.novelty;
  totals.coveredMinutes += day.novelty.coveredMinutes;
  totals.settlementMinutes += day.novelty.settlementMinutes;
  totals.informativeMinutes += day.novelty.informativeMinutes;
  totals.pendingApprovalMinutes += day.novelty.pendingApprovalMinutes;
  totals.heldMinutes += day.novelty.heldMinutes;
  if (day.novelty.reviewRequired) {
    totals.reviewDays += 1;
    totals.reviewDates.push(dateKey ?? String(day.day));
  }
  if (day.novelty.settlementMinutes !== day.novelty.coveredMinutes) period.hasSpecialMultiplier = true;
  for (const item of day.novelty.items) {
    let type = totals.types.find((candidate) => candidate.noveltyTypeId === item.noveltyTypeId);
    if (!type) {
      type = { noveltyTypeId: item.noveltyTypeId, coveredMinutes: 0, settlementMinutes: 0, informativeMinutes: 0, pendingApprovalMinutes: 0, heldMinutes: 0 };
      totals.types.push(type);
    }
    if (item.state === "COUNTED") {
      type.coveredMinutes += item.baseMinutes;
      type.settlementMinutes += item.settlementMinutes;
    } else if (item.state === "INFORMATIVE") type.informativeMinutes += item.baseMinutes;
    else if (item.state === "PENDING_APPROVAL") type.pendingApprovalMinutes += item.baseMinutes;
    else type.heldMinutes += item.baseMinutes;
  }
}

function addDay(period: PeriodAccounting, day: DayAccounting, dateKeyOfDay?: string) {
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
  period.noveltyCoveredMinutes += day.noveltyCoveredMinutes;
  period.computableMinutes += day.computableMinutes;
  period.settlement.normalMinutes += day.settlement.normalMinutes;
  period.settlement.withinBaseMinutes += day.settlement.withinBaseMinutes;
  period.settlement.additiveMinutes += day.settlement.additiveMinutes;
  period.settlement.noveltyMinutes += day.settlement.noveltyMinutes;
  period.settlement.totalMinutes += day.settlement.totalMinutes;
  addNoveltyDay(period, day, dateKeyOfDay);
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
export function accountEmployeePeriods(
  baseEntries: AccountingBaseEntry[],
  breakdowns: AccountingBreakdown[],
  dayOffs: DayOffAccountingIndex = EMPTY_DAY_OFF_ACCOUNTING,
  noveltyCoverages: AccountingNoveltyCoverage[] = [],
) {
  const applied = applyDayOffExclusions(baseEntries, breakdowns, dayOffs);
  type Bucket = { base: AccountingBaseEntry[]; breakdowns: AccountingBreakdown[]; uncounted: number; coverages: AccountingNoveltyCoverage[]; dateKey?: string };
  const grouped = new Map<string, Map<number, Bucket>>();
  const bucket = (employeeId: string, day: number) => {
    const days = grouped.get(employeeId) ?? new Map<number, Bucket>();
    grouped.set(employeeId, days);
    const current = days.get(day) ?? { base: [], breakdowns: [], uncounted: 0, coverages: [] };
    days.set(day, current);
    return current;
  };
  for (const entry of applied.baseEntries) bucket(entry.employeeId, entry.day).base.push(entry);
  for (const breakdown of applied.breakdowns) bucket(breakdown.employeeId, breakdown.day).breakdowns.push(breakdown);
  for (const item of applied.uncountedBase) bucket(item.employeeId, item.day).uncounted += item.minutes;
  for (const coverage of noveltyCoverages) {
    if (coverage.status === "RECHAZADO") continue;
    const target = bucket(coverage.employeeId, coverage.day);
    target.coverages.push(coverage);
    target.dateKey ??= coverage.dateKey;
  }

  const result = new Map<string, PeriodAccounting>();
  for (const [employeeId, days] of grouped) {
    const period = emptyPeriod();
    for (const day of [...days.keys()].sort((a, b) => a - b)) {
      const rows = days.get(day)!;
      addDay(period, { ...accountDay(day, rows.base, rows.breakdowns, rows.coverages), dayOffUncountedMinutes: rows.uncounted }, rows.dateKey);
    }
    result.set(employeeId, period);
  }
  return result;
}

export function emptyPeriodAccounting(): PeriodAccounting {
  return emptyPeriod();
}

/** Contabilidad de un único empleado (detalle por legajo, cierre). */
export function accountEmployeePeriod(
  baseEntries: AccountingBaseEntry[],
  breakdowns: AccountingBreakdown[],
  dayOffs: DayOffAccountingIndex = EMPTY_DAY_OFF_ACCOUNTING,
  noveltyCoverages: AccountingNoveltyCoverage[] = [],
) {
  const employeeIds = new Set([
    ...baseEntries.map((entry) => entry.employeeId),
    ...breakdowns.map((breakdown) => breakdown.employeeId),
    ...noveltyCoverages.map((coverage) => coverage.employeeId),
  ]);
  if (employeeIds.size > 1) throw new Error("accountEmployeePeriod recibe filas de un único empleado");
  const [employeeId] = employeeIds;
  return (employeeId ? accountEmployeePeriods(baseEntries, breakdowns, dayOffs, noveltyCoverages).get(employeeId) : undefined) ?? emptyPeriod();
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
 * Fila de NoveltyDayCoverage + estado de su novedad para la contabilidad
 * (NOVELTY_COVERAGE_ENGINE.md §12). Consumidores: grilla por legajo, grilla de
 * período, resumen, export de horas y cierre.
 */
export const accountingNoveltyCoverageSelect = {
  employeeId: true,
  day: true,
  date: true,
  noveltyId: true,
  noveltyTypeId: true,
  outcome: true,
  scheduleReviewReason: true,
  baseMinutes: true,
  resolvedBaseMinutes: true,
  appliedMultiplier: true,
  countsTowardTotal: true,
  realWorkCompatibility: true,
  expectedMinutes: true,
  reviewStatus: true,
  resolution: true,
  resolvedAgainstWorkedMinutes: true,
  novelty: { select: { status: true } },
} satisfies Prisma.NoveltyDayCoverageSelect;

export function toAccountingNoveltyCoverage(row: Prisma.NoveltyDayCoverageGetPayload<{ select: typeof accountingNoveltyCoverageSelect }>): AccountingNoveltyCoverage {
  return {
    employeeId: row.employeeId,
    day: row.day,
    dateKey: calendarDateKey(row.date),
    noveltyId: row.noveltyId,
    noveltyTypeId: row.noveltyTypeId,
    status: row.novelty.status,
    outcome: row.outcome,
    scheduleReviewReason: row.scheduleReviewReason,
    baseMinutes: row.baseMinutes,
    resolvedBaseMinutes: row.resolvedBaseMinutes,
    multiplier: Number(row.appliedMultiplier ?? 1) || 1,
    countsTowardTotal: row.countsTowardTotal,
    realWorkCompatibility: row.realWorkCompatibility,
    expectedMinutes: row.expectedMinutes,
    reviewStatus: row.reviewStatus,
    resolution: row.resolution,
    resolvedAgainstWorkedMinutes: row.resolvedAgainstWorkedMinutes,
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
