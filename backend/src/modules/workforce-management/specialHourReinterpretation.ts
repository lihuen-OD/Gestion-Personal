import type { Prisma } from "@prisma/client";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { calendarDateKey, periodFromCalendarDate } from "../../shared/datetime/argentinaTime";
import { employeePeriodKey, findProtectedClosurePeriods } from "../../shared/monthlyClosure/closurePeriodGuard";
import { evaluateSpecialHourRulesByDate, SpecialHourScopeHistoryMissingError, type SpecialHourEvaluation } from "../time-entries/timeEntries.repository";
import { buildActiveDatesByRule, ruleMatchesDate, specialHourApplicationRows, type DoubleHourRuleForMatching } from "./doubleHourRuleMatching";
import { findClosuresForEmployeePeriods, rebuildClosureSnapshots, type ClosureSnapshotRecalculation, type RebuiltClosureSnapshot } from "./closureSnapshot";

/**
 * Una regla de Hora Especial (feriado, domingo, ...) es una regla vigente
 * sobre la fecha, no una propiedad irreversible de la carga
 * (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §15 y §16). Cuando RRHH crea,
 * edita o quita una regla, o cambia la convocatoria de un feriado, todo lo
 * derivado de la historia se recalcula con el MISMO motor que usa una carga
 * nueva (evaluateSpecialHourRulesByDate), dentro de la transacción del cambio:
 *
 * - TimeEntry.appliedMultiplier y HourConceptBreakdown.appliedMultiplier;
 * - la traza por tramo (SpecialHourRuleApplication y TimeSegment.isSpecial);
 * - los snapshots de los cierres de los empleado + período afectados.
 *
 * Nunca toca minutos reales (TimeEntry.hours/totalMinutes/actualMinutes,
 * minutos de desgloses o tramos), estados, fechas ni conceptos. Así cargar
 * primero y crear el feriado después da exactamente lo mismo que cargar con
 * el feriado ya configurado.
 *
 * D-5 (ORG_LOCATION_REORGANIZATION.md §19): el alcance se evalúa con la
 * historia vigente en cada fecha. Si una fila que se reescribiría no tiene
 * historia suficiente, la operación completa se rechaza
 * (SPECIAL_HOUR_SCOPE_HISTORY_MISSING) antes de escribir. En períodos
 * protegidos, que nunca se reescriben, la falta de historia sólo se informa.
 */

type Db = PrismaTransactionClient;

/** Forma de calendario de una regla, antes o después del cambio. */
export type RuleCalendar = DoubleHourRuleForMatching & { dates: Array<{ date: Date; isActive: boolean }> };

export type SpecialHourReinterpretation = {
  timeEntries: number;
  breakdowns: number;
  segments: number;
  employees: number;
  periods: string[];
  rebuiltClosures: RebuiltClosureSnapshot[];
  // D-5 (ORG_LOCATION_REORGANIZATION.md §18.1): pares empleado + período con
  // cierre ENVIADO/APROBADO/CORRECCION_PENDIENTE. No se modificaron; se informa
  // cuántas filas habrían cambiado para que RRHH decida una corrección explícita.
  // `missingHistory`: filas de ese período cuyo resultado no se puede evaluar
  // por falta de historia (no se sabe si diferirían).
  protectedPeriods: Array<{ employeeId: string; period: string; status: string; timeEntries: number; breakdowns: number; segments: number; missingHistory: number }>;
  // Detalle antes → después (backup/reporte de una reconciliación).
  changes: {
    timeEntries: Array<{ id: string; employeeId: string; date: string; from: number; to: number }>;
    breakdowns: Array<{ id: string; employeeId: string; date: string; from: number; to: number }>;
    segments: Array<{ id: string; fromIsSpecial: boolean; toIsSpecial: boolean; fromTrace: string; toTrace: string }>;
  };
};

type Row = { id: string; employeeId: string; date: Date; period: string; appliedMultiplier: Prisma.Decimal | number };
type SegmentRow = {
  id: string;
  employeeId: string;
  date: Date;
  isSpecial: boolean;
  specialHourRuleApplications: Array<{ doubleHourRuleId: string; multiplierApplied: Prisma.Decimal | number; isWinner: boolean; wasConflicting: boolean }>;
};

const DAY_MS = 86_400_000;

/**
 * Ventana calendario que cubre la regla antes y después del cambio. Una regla
 * sin fin (p. ej. "domingos desde ...") deja la ventana abierta hacia adelante:
 * sólo existen cargas hasta hoy, así que no se recorre más que eso.
 */
export function affectedWindow(rules: RuleCalendar[]): { from: Date; to: Date | null } | null {
  if (!rules.length) return null;
  const starts = rules.flatMap((rule) => [rule.fromDate.getTime(), ...rule.dates.map((entry) => entry.date.getTime())]);
  const openEnded = rules.some((rule) => rule.recurrenceType !== "FECHA" && !rule.toDate);
  const ends = rules.flatMap((rule) => [rule.toDate?.getTime() ?? rule.fromDate.getTime(), ...rule.dates.map((entry) => entry.date.getTime())]);
  return { from: new Date(Math.min(...starts)), to: openEnded ? null : new Date(Math.max(...ends)) };
}

/** Predicado: la fecha matchea el calendario de la regla antes o después del cambio. */
export function touchedByRule(rules: RuleCalendar[]) {
  // before/after comparten id: se renombran para que buildActiveDatesByRule no los mezcle.
  const shapes = rules.map((rule, index) => ({ ...rule, id: `rule-state-${index}` }));
  const activeDates = buildActiveDatesByRule(shapes);
  return (date: Date) => shapes.some((rule) => ruleMatchesDate(rule, date, activeDates));
}

function sameMultiplier(current: Prisma.Decimal | number, next: number) {
  return Math.abs(Number(current) - next) < 0.001;
}

function traceSignature(rows: Array<{ doubleHourRuleId: string; multiplierApplied: unknown; isWinner: boolean; wasConflicting: boolean }>) {
  return rows
    .map((row) => `${row.doubleHourRuleId}|${Number(row.multiplierApplied).toFixed(2)}|${row.isWinner}|${row.wasConflicting}`)
    .sort()
    .join(";");
}

/** Agrupa ids por el multiplicador nuevo, para un updateMany por valor (no uno por fila). */
function groupByMultiplier(changes: Array<{ id: string; multiplier: number }>) {
  const groups = new Map<number, string[]>();
  for (const change of changes) groups.set(change.multiplier, [...(groups.get(change.multiplier) ?? []), change.id]);
  return groups;
}

function emptyReinterpretation(): SpecialHourReinterpretation {
  return { timeEntries: 0, breakdowns: 0, segments: 0, employees: 0, periods: [], rebuiltClosures: [], protectedPeriods: [], changes: { timeEntries: [], breakdowns: [], segments: [] } };
}

/** Cambio de una regla: las fechas que matchea antes o después del cambio. */
export async function reinterpretSpecialHours(
  db: Db,
  states: { before: RuleCalendar | null; after: RuleCalendar | null },
  recalculation: { doubleHourRuleId: string; doubleHourRuleName: string },
): Promise<SpecialHourReinterpretation> {
  const rules = [states.before, states.after].filter((rule): rule is RuleCalendar => rule !== null);
  const window = affectedWindow(rules);
  if (!window) return emptyReinterpretation();
  return reinterpretWindow(db, window, touchedByRule(rules), { reason: "SPECIAL_HOUR_RULE_CHANGED", ...recalculation });
}

/**
 * Fechas concretas: cambio de convocatoria de un feriado (todas las cargas
 * de la fecha, porque el primer convocado restringe el FERIADO a los
 * convocados) o reconciliación de cargas existentes.
 */
export async function reinterpretSpecialHoursOnDates(db: Db, dates: Date[], recalculation: ClosureSnapshotRecalculation): Promise<SpecialHourReinterpretation> {
  if (!dates.length) return emptyReinterpretation();
  const keys = new Set(dates.map(calendarDateKey));
  const times = dates.map((date) => date.getTime());
  return reinterpretWindow(db, { from: new Date(Math.min(...times)), to: new Date(Math.max(...times)) }, (date) => keys.has(calendarDateKey(date)), recalculation);
}

async function reinterpretWindow(
  db: Db,
  window: { from: Date; to: Date | null },
  touched: (date: Date) => boolean,
  recalculation: ClosureSnapshotRecalculation,
): Promise<SpecialHourReinterpretation> {
  const dateWhere = { gte: window.from, ...(window.to ? { lte: new Date(window.to.getTime() + DAY_MS - 1) } : {}) };
  const [entries, breakdowns, segments] = await Promise.all([
    db.timeEntry.findMany({ where: { date: dateWhere }, select: { id: true, employeeId: true, date: true, period: true, appliedMultiplier: true } }),
    db.hourConceptBreakdown.findMany({ where: { date: dateWhere }, select: { id: true, employeeId: true, date: true, period: true, appliedMultiplier: true } }),
    db.timeSegment.findMany({
      where: { date: dateWhere },
      select: {
        id: true, employeeId: true, date: true, isSpecial: true,
        specialHourRuleApplications: { select: { doubleHourRuleId: true, multiplierApplied: true, isWinner: true, wasConflicting: true } },
      },
    }),
  ]) as [Row[], Row[], SegmentRow[]];

  const touchedRows = {
    entries: entries.filter((row) => touched(row.date)),
    breakdowns: breakdowns.filter((row) => touched(row.date)),
    segments: segments.filter((row) => touched(row.date)),
  };

  // D-5: lock compartido + estado del cierre dentro de esta transacción. Lo
  // protegido no se lee para escribir: se resuelve sólo para informar.
  const segmentPeriod = (row: { employeeId: string; date: Date }) => ({ employeeId: row.employeeId, period: periodFromCalendarDate(row.date) });
  const protectedPairs = await findProtectedClosurePeriods(db, [...touchedRows.entries, ...touchedRows.breakdowns, ...touchedRows.segments.map(segmentPeriod)]);
  const isProtected = (pair: { employeeId: string; period: string }) => protectedPairs.has(employeePeriodKey(pair));
  const candidates = {
    entries: touchedRows.entries.filter((row) => !isProtected(row)),
    breakdowns: touchedRows.breakdowns.filter((row) => !isProtected(row)),
    segments: touchedRows.segments.filter((row) => !isProtected(segmentPeriod(row))),
  };
  const protectedRows = {
    entries: touchedRows.entries.filter((row) => isProtected(row)),
    breakdowns: touchedRows.breakdowns.filter((row) => isProtected(row)),
    segments: touchedRows.segments.filter((row) => isProtected(segmentPeriod(row))),
  };

  // Fechas por empleado → motor vigente, 2 consultas por empleado alcanzado
  // (nunca por fila). El alcance (empresa/sector/centro/puesto/empleados) lo
  // decide el motor: un empleado fuera del alcance resuelve su multiplicador
  // sin la regla y no cambia.
  const datesByEmployee = new Map<string, Map<string, Date>>();
  for (const row of [...touchedRows.entries, ...touchedRows.breakdowns, ...touchedRows.segments]) {
    const dates = datesByEmployee.get(row.employeeId) ?? new Map<string, Date>();
    dates.set(calendarDateKey(row.date), row.date);
    datesByEmployee.set(row.employeeId, dates);
  }
  const evaluations = new Map<string, Map<string, SpecialHourEvaluation>>();
  for (const [employeeId, dates] of datesByEmployee) {
    evaluations.set(employeeId, await evaluateSpecialHourRulesByDate(employeeId, [...dates.values()], db));
  }
  const evaluationFor = (row: { employeeId: string; date: Date }) => evaluations.get(row.employeeId)!.get(calendarDateKey(row.date))!;
  // Sin escrituras parciales: si alguna fila que se reescribiría no tiene
  // historia suficiente, se rechaza todo antes del primer update.
  const missing = [...candidates.entries, ...candidates.breakdowns, ...candidates.segments]
    .flatMap((row) => evaluationFor(row).missingHistory ?? [])
    .sort((a, b) => a.date.localeCompare(b.date) || a.employeeId.localeCompare(b.employeeId));
  if (missing.length) throw new SpecialHourScopeHistoryMissingError(missing[0]!);
  const resolutionFor = (row: { employeeId: string; date: Date }) => evaluationFor(row).resolution!;

  const changedEntries = candidates.entries.flatMap((row) => {
    const { multiplier } = resolutionFor(row);
    return sameMultiplier(row.appliedMultiplier, multiplier) ? [] : [{ ...row, multiplier }];
  });
  const changedBreakdowns = candidates.breakdowns.flatMap((row) => {
    const { multiplier } = resolutionFor(row);
    return sameMultiplier(row.appliedMultiplier, multiplier) ? [] : [{ ...row, multiplier }];
  });
  const changedSegments = candidates.segments.flatMap((row) => {
    const resolution = resolutionFor(row);
    const desired = specialHourApplicationRows(row.id, resolution);
    const isSpecial = resolution.matchedRules.length > 0;
    const unchanged = row.isSpecial === isSpecial && traceSignature(row.specialHourRuleApplications) === traceSignature(desired);
    return unchanged ? [] : [{ id: row.id, isSpecial, desired }];
  });

  // Sólo el multiplicador: nunca minutos, estado, fecha ni concepto.
  for (const [multiplier, ids] of groupByMultiplier(changedEntries)) {
    await db.timeEntry.updateMany({ where: { id: { in: ids } }, data: { appliedMultiplier: multiplier } });
  }
  for (const [multiplier, ids] of groupByMultiplier(changedBreakdowns)) {
    await db.hourConceptBreakdown.updateMany({ where: { id: { in: ids } }, data: { appliedMultiplier: multiplier } });
  }
  if (changedSegments.length) {
    await db.specialHourRuleApplication.deleteMany({ where: { timeSegmentId: { in: changedSegments.map((segment) => segment.id) } } });
    const rows = changedSegments.flatMap((segment) => segment.desired);
    if (rows.length) await db.specialHourRuleApplication.createMany({ data: rows });
    for (const isSpecial of [true, false]) {
      const ids = changedSegments.filter((segment) => segment.isSpecial === isSpecial).map((segment) => segment.id);
      if (ids.length) await db.timeSegment.updateMany({ where: { id: { in: ids } }, data: { isSpecial } });
    }
  }

  // La equivalencia sólo cambia donde cambió un multiplicador. Nunca se
  // reconstruye el snapshot de un cierre protegido (esos pares ya se excluyeron).
  const pairs = new Map<string, { employeeId: string; period: string }>();
  for (const row of [...changedEntries, ...changedBreakdowns]) pairs.set(`${row.employeeId}:${row.period}`, { employeeId: row.employeeId, period: row.period });
  const closures = (await findClosuresForEmployeePeriods(db, [...pairs.values()])).filter((closure) => !isProtected(closure));
  const rebuiltClosures = await rebuildClosureSnapshots(db, closures, recalculation);

  // Informe de lo que habría cambiado en períodos protegidos (sin escribir).
  const pendingByPair = new Map<string, SpecialHourReinterpretation["protectedPeriods"][number]>();
  const pending = (pair: { employeeId: string; period: string }) => {
    const key = employeePeriodKey(pair);
    const current = pendingByPair.get(key) ?? { employeeId: pair.employeeId, period: pair.period, status: protectedPairs.get(key)!, timeEntries: 0, breakdowns: 0, segments: 0, missingHistory: 0 };
    pendingByPair.set(key, current);
    return current;
  };
  const evaluable = <T extends { employeeId: string; date: Date }>(row: T, pairOf: (item: T) => { employeeId: string; period: string }) => {
    if (!evaluationFor(row).missingHistory) return true;
    pending(pairOf(row)).missingHistory += 1;
    return false;
  };
  for (const row of protectedRows.entries) if (evaluable(row, (item) => item) && !sameMultiplier(row.appliedMultiplier, resolutionFor(row).multiplier)) pending(row).timeEntries += 1;
  for (const row of protectedRows.breakdowns) if (evaluable(row, (item) => item) && !sameMultiplier(row.appliedMultiplier, resolutionFor(row).multiplier)) pending(row).breakdowns += 1;
  for (const row of protectedRows.segments) {
    if (!evaluable(row, segmentPeriod)) continue;
    const resolution = resolutionFor(row);
    const desired = specialHourApplicationRows(row.id, resolution);
    if (row.isSpecial !== resolution.matchedRules.length > 0 || traceSignature(row.specialHourRuleApplications) !== traceSignature(desired)) pending(segmentPeriod(row)).segments += 1;
  }

  const rowChange = (row: Row & { multiplier: number }) => ({ id: row.id, employeeId: row.employeeId, date: calendarDateKey(row.date), from: Number(row.appliedMultiplier), to: row.multiplier });
  const segmentsById = new Map(candidates.segments.map((segment) => [segment.id, segment]));
  return {
    timeEntries: changedEntries.length,
    breakdowns: changedBreakdowns.length,
    segments: changedSegments.length,
    employees: new Set([...changedEntries, ...changedBreakdowns].map((row) => row.employeeId)).size,
    periods: [...new Set([...pairs.values()].map((pair) => pair.period))].sort(),
    rebuiltClosures,
    protectedPeriods: [...pendingByPair.values()].sort((a, b) => employeePeriodKey(a).localeCompare(employeePeriodKey(b))),
    changes: {
      timeEntries: changedEntries.map(rowChange),
      breakdowns: changedBreakdowns.map(rowChange),
      segments: changedSegments.map((segment) => {
        const before = segmentsById.get(segment.id)!;
        return { id: segment.id, fromIsSpecial: before.isSpecial, toIsSpecial: segment.isSpecial, fromTrace: traceSignature(before.specialHourRuleApplications), toTrace: traceSignature(segment.desired) };
      }),
    },
  };
}
