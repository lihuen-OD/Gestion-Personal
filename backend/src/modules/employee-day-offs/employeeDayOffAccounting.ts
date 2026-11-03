import type { Prisma, WorkShiftStatus } from "@prisma/client";
import { argentinaCalendarDate, argentinaDayRange, calendarDateKey, nextCalendarDateKey, periodCalendarBounds, previousCalendarDateKey } from "../../shared/datetime/argentinaTime";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { workShiftOperationalDateKey } from "../shifts/workShiftEvaluation.service";
import {
  accountingBaseEntrySelect,
  accountingBreakdownSelect,
  applyDayOffExclusions,
  CLOCK_TIME_ENTRY_SOURCES,
  countedBreakdownStatusWhere,
  dayOffKey,
  toAccountingBaseEntry,
  toAccountingBreakdown,
  type DayOffAccountingIndex,
} from "../time-entries/workedTimeAccounting";

/**
 * Índice de francos que consume la contabilidad única
 * (docs/decisions/EMPLOYEE_DAY_OFF.md §7.2). Sin francos activos en el rango
 * hace UNA consulta; con francos, una más para las jornadas de esas fechas.
 * Nunca escribe: la exclusión de horas automáticas se deriva al leer.
 */

type Db = Pick<PrismaTransactionClient, "employeeDayOff" | "workShift">;

const DAY_MS = 86_400_000;

// Jornadas cuyos tramos cargaron Horas base (closeOpenWorkShift). OBSERVADO
// incluye las observadas por RRHH, que conservan sus horas.
const LOADED_SHIFT_STATUSES: ReadonlySet<WorkShiftStatus> = new Set(["PROCESADO", "OBSERVADO"]);

export type DayOffAccountingScope = {
  employeeIds?: string[];
  employeeWhere?: Prisma.EmployeeWhereInput;
  // Rango calendario [from, to) de las filas a contabilizar; sin rango, todos
  // los francos activos del alcance (vista "Por persona" sin período).
  from?: Date;
  to?: Date;
};

export type DayOffActivity = {
  id: string;
  employeeId: string;
  dateKey: string;
  notes: string | null;
  // Jornadas del fichador de esa fecha operativa y sus minutos registrados
  // (evidencia; lo que computa lo dice la contabilidad).
  activityShifts: number;
  activityMinutes: number;
};

export type DayOffAccounting = DayOffAccountingIndex & { dayOffs: DayOffActivity[] };

export const emptyDayOffAccounting = (): DayOffAccounting => ({ excludedBaseMinutes: new Map(), excludedWorkShiftIds: new Set(), dayOffDates: new Set(), dayOffs: [] });

export async function loadDayOffAccounting(scope: DayOffAccountingScope, db: Db = prisma): Promise<DayOffAccounting> {
  if (scope.employeeIds && !scope.employeeIds.length) return emptyDayOffAccounting();

  // Un día de margen a cada lado: una noche en franco del día anterior al
  // rango descuenta lo que cae el primer día, y un ingreso anticipado del
  // último día puede pertenecer a la fecha siguiente.
  const dateWhere = scope.from || scope.to
    ? { date: { ...(scope.from ? { gte: new Date(scope.from.getTime() - DAY_MS) } : {}), ...(scope.to ? { lt: new Date(scope.to.getTime() + DAY_MS) } : {}) } }
    : {};
  const rows = await db.employeeDayOff.findMany({
    where: {
      status: "ACTIVO",
      ...(scope.employeeIds ? { employeeId: { in: scope.employeeIds } } : {}),
      ...(scope.employeeWhere ? { employee: scope.employeeWhere } : {}),
      ...dateWhere,
    },
    select: { id: true, employeeId: true, date: true, notes: true },
  });
  if (!rows.length) return emptyDayOffAccounting();

  const dayOffs = new Map<string, DayOffActivity>(rows.map((row) => {
    const dateKey = calendarDateKey(row.date);
    return [dayOffKey(row.employeeId, dateKey), { id: row.id, employeeId: row.employeeId, dateKey, notes: row.notes, activityShifts: 0, activityMinutes: 0 }];
  }));
  const dateKeys = [...dayOffs.values()].map((item) => item.dateKey).sort();
  const shifts = await db.workShift.findMany({
    where: {
      employeeId: { in: [...new Set(rows.map((row) => row.employeeId))] },
      // Lo registrado a mano por un responsable nunca es "actividad automática".
      source: { not: "ADMIN" },
      startAt: { gte: argentinaDayRange(previousCalendarDateKey(dateKeys[0]!)).startAt, lt: argentinaDayRange(nextCalendarDateKey(dateKeys.at(-1)!)).endAt },
    },
    select: {
      id: true,
      employeeId: true,
      startAt: true,
      status: true,
      shiftTemplate: { select: { startTime: true, endTime: true, crossesMidnight: true } },
      timeSegments: { select: { date: true, minutes: true } },
    },
  });

  const excludedBaseMinutes = new Map<string, number>();
  const excludedWorkShiftIds = new Set<string>();
  for (const shift of shifts) {
    const dayOff = dayOffs.get(dayOffKey(shift.employeeId, workShiftOperationalDateKey(shift.startAt, shift.shiftTemplate)));
    if (!dayOff) continue;
    const loaded = LOADED_SHIFT_STATUSES.has(shift.status);
    dayOff.activityShifts += 1;
    excludedWorkShiftIds.add(shift.id);
    for (const segment of shift.timeSegments) {
      dayOff.activityMinutes += segment.minutes;
      if (!loaded) continue;
      const key = dayOffKey(shift.employeeId, calendarDateKey(segment.date));
      excludedBaseMinutes.set(key, (excludedBaseMinutes.get(key) ?? 0) + segment.minutes);
    }
  }

  return { excludedBaseMinutes, excludedWorkShiftIds, dayOffDates: new Set(dayOffs.keys()), dayOffs: [...dayOffs.values()] };
}

/** Francos del índice que caen en [from, to) (los del margen sólo sirven para excluir). */
export function dayOffsWithin(accounting: DayOffAccounting, from: Date, to: Date) {
  const fromKey = calendarDateKey(from);
  const toKey = calendarDateKey(to);
  return accounting.dayOffs.filter((item) => item.dateKey >= fromKey && item.dateKey < toKey);
}

function employeesByDate(keys: Iterable<string>) {
  const byDate = new Map<string, string[]>();
  for (const key of keys) {
    const [employeeId, dateKey] = key.split("|") as [string, string];
    byDate.set(dateKey, [...(byDate.get(dateKey) ?? []), employeeId]);
  }
  return [...byDate.entries()].map(([dateKey, employeeIds]) => ({ date: argentinaCalendarDate(dateKey), employeeId: { in: employeeIds } }));
}

/**
 * Minutos que no computan por francos en un agregado SQL de período (resumen
 * de Carga de horas y "Horas cargadas" del dashboard), con el mismo criterio
 * de estado que esos agregados (base APROBADO/EN_REVISION, adicionales sin
 * RECHAZADO). Sin francos en el período: 1 consulta y cero. Con francos lee
 * sólo las filas automáticas de esas fechas/jornadas y aplica la MISMA regla
 * que la grilla (`applyDayOffExclusions`).
 */
export async function periodDayOffUncountedMinutes(period: string, employeeWhere: Prisma.EmployeeWhereInput, db: Db & Pick<PrismaTransactionClient, "timeEntry" | "hourConceptBreakdown"> = prisma) {
  const { start, end } = periodCalendarBounds(period);
  const dayOffs = await loadDayOffAccounting({ employeeWhere, from: start, to: end }, db);
  if (!dayOffs.excludedBaseMinutes.size && !dayOffs.dayOffDates.size) return { baseMinutes: 0, additiveMinutes: 0 };

  const baseScopes = employeesByDate(dayOffs.excludedBaseMinutes.keys());
  const breakdownScopes = [
    ...(dayOffs.excludedWorkShiftIds.size ? [{ workShiftId: { in: [...dayOffs.excludedWorkShiftIds] } }] : []),
    ...employeesByDate(dayOffs.dayOffDates).map((scope) => ({ ...scope, workShiftId: null })),
  ];
  const [entries, breakdowns] = await Promise.all([
    baseScopes.length
      ? db.timeEntry.findMany({
          where: { period, status: { in: ["APROBADO", "EN_REVISION"] }, hourConcept: { systemRole: "NORMAL_BASE" }, source: { in: [...CLOCK_TIME_ENTRY_SOURCES] }, OR: baseScopes },
          select: accountingBaseEntrySelect,
        })
      : Promise.resolve([]),
    db.hourConceptBreakdown.findMany({
      where: { period, source: "AUTOMATIC", status: countedBreakdownStatusWhere, hourConcept: { workTreatment: "ADDITIVE_TO_WORKED_TOTAL" }, OR: breakdownScopes },
      select: accountingBreakdownSelect,
    }),
  ]);
  const applied = applyDayOffExclusions(entries.map(toAccountingBaseEntry), breakdowns.map(toAccountingBreakdown), dayOffs);
  return {
    baseMinutes: applied.uncountedBase.reduce((sum, item) => sum + item.minutes, 0),
    additiveMinutes: applied.excludedBreakdowns.reduce((sum, item) => sum + item.minutes, 0),
  };
}
