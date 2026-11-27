import type { WorkShiftStatus } from "@prisma/client";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { argentinaDateKey, argentinaDayRange, calendarDateKey, formatArgentinaDate, periodCalendarBounds } from "../../shared/datetime/argentinaTime";

/**
 * Bloqueantes del cierre mensual (fuente única para la vista previa de
 * Cierres mensuales y para la validación definitiva de `closeClosures`).
 *
 * Sólo bloquea lo que todavía puede cambiar las horas del período:
 * - jornada ABIERTA (falta la salida);
 * - jornada incompleta sin revisar (FALTA_SALIDA / FALTA_INGRESO / INVALIDO:
 *   sus horas no están cargadas);
 * - fichada sobre horas cargadas a mano sin decidir (la decisión cambia horas);
 * - días de cobertura de novedades en revisión (NOVELTY_COVERAGE_ENGINE.md §12,
 *   calculados por el mismo snapshot que congela el cierre).
 * Las observaciones de jornadas completas o de fichadas, las faltas sin registro
 * (inactividad) y las demás alertas de turno son informativas: resolverlas sólo
 * deja una nota, no cambia horas, así que no bloquean.
 *
 * Jornadas que atraviesan el cambio de mes: una jornada con fin afecta a todo
 * período con el que se superpone; una jornada sin fin (abierta o sin salida)
 * puede extenderse hasta `maxAllowedMinutes` desde su inicio, así que afecta al
 * período en que empezó y, si su máximo cruza la medianoche del último día, al
 * siguiente. Nunca a meses posteriores.
 */

export type ClosureBlockerType = "OPEN_SHIFT" | "INCOMPLETE_SHIFT" | "MANUAL_CLOCK_CONFLICT" | "NOVELTY_REVIEW";
export type ClosureBlockerModule = "ATTENDANCE" | "HOURS" | "EMPLOYEE_HOURS";

export type ClosureBlockerEmployee = { id: string; legajo: string; firstName: string; lastName: string };

export type ClosureBlocker = {
  /** Estable por registro de origen (permite listas con `key`). */
  id: string;
  type: ClosureBlockerType;
  employee: ClosureBlockerEmployee;
  /** Fecha operativa de la incidencia (`YYYY-MM-DD`, Argentina). */
  date: string;
  title: string;
  reason: string;
  action: string;
  resolution: { module: ClosureBlockerModule; label: string; path: string };
};

type Db = Pick<PrismaTransactionClient, "workShift" | "shiftAlert">;

/** Margen de búsqueda hacia atrás para jornadas sin fin que cruzan el inicio del período. */
export const OPEN_SHIFT_LOOKBACK_MS = 48 * 60 * 60_000;

const employeeSelect = { id: true, legajo: true, firstName: true, lastName: true } as const;

export function periodInstantBounds(period: string) {
  const { start, end } = periodCalendarBounds(period);
  return { startAt: argentinaDayRange(calendarDateKey(start)).startAt, endAt: argentinaDayRange(calendarDateKey(end)).startAt };
}

const INCOMPLETE_SHIFT_TITLE: Partial<Record<WorkShiftStatus, string>> = {
  FALTA_SALIDA: "Jornada sin salida registrada",
  FALTA_INGRESO: "Jornada sin ingreso registrado",
  INVALIDO: "Jornada inválida",
};

function shiftBlocker(shift: { id: string; status: WorkShiftStatus; startAt: Date; employee: ClosureBlockerEmployee }, periodStart: Date): ClosureBlocker {
  const date = argentinaDateKey(shift.startAt);
  const crossesIntoPeriod = shift.startAt < periodStart ? ` Empezó el ${formatArgentinaDate(date)} y puede sumar horas a este período.` : "";
  if (shift.status === "ABIERTO") {
    return {
      id: `shift:${shift.id}`,
      type: "OPEN_SHIFT",
      employee: shift.employee,
      date,
      title: "Jornada abierta sin salida",
      reason: `La jornada todavía no tiene salida: sus horas no están calculadas y cambiarán al cerrarla.${crossesIntoPeriod}`,
      action: "Registrá la salida en el fichador o cerrá la jornada manualmente desde Asistencia.",
      resolution: { module: "ATTENDANCE", label: "Ir a Asistencia", path: `/asistencia?date=${date}` },
    };
  }
  return {
    id: `shift:${shift.id}`,
    type: "INCOMPLETE_SHIFT",
    employee: shift.employee,
    date,
    title: INCOMPLETE_SHIFT_TITLE[shift.status] ?? "Jornada incompleta",
    reason: `La jornada quedó incompleta y sin revisar: sus horas no están cargadas, así que el total del período puede cambiar.${crossesIntoPeriod}`,
    action: "Si la persona trabajó, cargá las horas reales del día en Carga de horas; después resolvé la observación de la jornada en Asistencia.",
    resolution: { module: "ATTENDANCE", label: "Ir a observaciones", path: `/asistencia?observationDate=${date}` },
  };
}

/**
 * Bloqueantes operativos (jornadas y fichada sobre horas manuales) de los
 * legajos indicados. Quien llama ya acotó `employeeIds` al alcance del usuario.
 */
export async function findOperationalClosureBlockers(db: Db, employeeIds: string[], period: string): Promise<ClosureBlocker[]> {
  if (!employeeIds.length) return [];
  const { startAt: periodStart, endAt: periodEnd } = periodInstantBounds(period);
  const lookbackStart = new Date(periodStart.getTime() - OPEN_SHIFT_LOOKBACK_MS);
  const [shifts, conflicts] = await Promise.all([
    db.workShift.findMany({
      where: {
        employeeId: { in: employeeIds },
        startAt: { lt: periodEnd },
        AND: [
          { OR: [{ endAt: null, startAt: { gte: lookbackStart } }, { endAt: { gt: periodStart } }] },
          { OR: [{ status: "ABIERTO" }, { status: { in: ["FALTA_SALIDA", "FALTA_INGRESO", "INVALIDO"] }, reviewStatus: "PENDIENTE" }] },
        ],
      },
      select: { id: true, status: true, startAt: true, endAt: true, maxAllowedMinutes: true, employee: { select: employeeSelect } },
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
    }),
    db.shiftAlert.findMany({
      where: { employeeId: { in: employeeIds }, actualAt: { gte: periodStart, lt: periodEnd }, type: "ACTIVIDAD_SOBRE_CARGA_MANUAL", status: "PENDIENTE" },
      select: { id: true, actualAt: true, employee: { select: employeeSelect } },
      orderBy: [{ actualAt: "asc" }, { id: "asc" }],
    }),
  ]);
  // Sin fin: afecta al período si su máximo posible se superpone con él.
  const relevantShifts = shifts.filter((shift) => shift.endAt !== null || shift.startAt >= periodStart || shift.startAt.getTime() + shift.maxAllowedMinutes * 60_000 > periodStart.getTime());
  return [
    ...relevantShifts.map((shift) => shiftBlocker(shift, periodStart)),
    ...conflicts.map((alert): ClosureBlocker => {
      const date = argentinaDateKey(alert.actualAt ?? periodStart);
      return {
        id: `conflict:${alert.id}`,
        type: "MANUAL_CLOCK_CONFLICT",
        employee: alert.employee,
        date,
        title: "Fichada sobre horas cargadas a mano",
        reason: "Hay horas cargadas a mano y una jornada fichada el mismo día: hasta decidir cuáles computan, el total del período puede cambiar.",
        action: "En Carga de horas, decidí si se mantienen las horas manuales o se usan las fichadas.",
        resolution: { module: "HOURS", label: "Ir a Carga de horas", path: `/horas?period=${date.slice(0, 7)}` },
      };
    }),
  ];
}

/** Días de cobertura de novedades en revisión, a partir del snapshot del cierre. */
export function noveltyReviewBlockers(employee: ClosureBlockerEmployee, period: string, reviewDates: string[]): ClosureBlocker[] {
  return reviewDates.map((date) => ({
    id: `novelty-review:${employee.id}:${date}`,
    type: "NOVELTY_REVIEW" as const,
    employee,
    date: date.length === 10 ? date : `${period}-01`,
    title: "Novedad con días para revisar",
    reason: "La cobertura de la novedad choca con trabajo real o excede la jornada: hasta resolverla no se sabe cuántas horas cubre.",
    action: "En el legajo horario, resolvé el día (no cubre o indicá las horas base) o corregí la novedad.",
    resolution: { module: "EMPLOYEE_HOURS" as const, label: "Abrir legajo horario", path: `/horas/${employee.id}?period=${period}` },
  }));
}

/** Agrupa por legajo (orden: apellido, nombre, legajo; incidencias por fecha). */
export function groupClosureBlockers(blockers: ClosureBlocker[]) {
  const byEmployee = new Map<string, { employee: ClosureBlockerEmployee; blockers: ClosureBlocker[] }>();
  for (const blocker of blockers) {
    const group = byEmployee.get(blocker.employee.id) ?? { employee: blocker.employee, blockers: [] };
    group.blockers.push(blocker);
    byEmployee.set(blocker.employee.id, group);
  }
  const collator = new Intl.Collator("es-AR", { sensitivity: "base", numeric: true });
  return [...byEmployee.values()]
    .map((group) => ({ ...group, blockers: [...group.blockers].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)) }))
    .sort((a, b) => collator.compare(a.employee.lastName, b.employee.lastName) || collator.compare(a.employee.firstName, b.employee.firstName) || collator.compare(a.employee.legajo, b.employee.legajo));
}
