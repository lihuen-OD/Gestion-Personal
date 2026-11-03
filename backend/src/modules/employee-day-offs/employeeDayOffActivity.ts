import { argentinaCalendarDate, argentinaDayRange, nextCalendarDateKey, previousCalendarDateKey } from "../../shared/datetime/argentinaTime";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { workShiftOperationalDateKey } from "../shifts/workShiftEvaluation.service";
import { createShiftAlert } from "../shifts/workShiftEvaluationRunner";
import { lockEmployeeDays } from "./employeeDayLock";

/**
 * Actividad registrada en un día de franco (docs/decisions/EMPLOYEE_DAY_OFF.md
 * §8-§9). Nunca bloquea ni modifica la fichada: sólo deja la alerta
 * `ACTIVIDAD_EN_FRANCO` (y su notificación) para que un responsable decida si
 * reconoce horas. Todo corre dentro de la transacción del llamador.
 */

export const DAY_OFF_ACTIVITY_ALERT_TYPE = "ACTIVIDAD_EN_FRANCO" as const;
export const DAY_OFF_CANCELED_ALERT_NOTE = "Resuelta automáticamente: se canceló el franco de esa fecha.";

type Db = PrismaTransactionClient;
type ShiftTemplateTimes = { startTime: string; endTime: string; crossesMidnight: boolean } | null;
export type DayOffActivityShift = { id: string; employeeId: string; startAt: Date; shiftTemplate: ShiftTemplateTimes };

const activityShiftSelect = { id: true, employeeId: true, startAt: true, shiftTemplate: { select: { startTime: true, endTime: true, crossesMidnight: true } } } as const;

/** Jornadas del fichador de esas personas cuya fecha operativa es `dateKey`. */
export async function findClockWorkShiftsForOperationalDate(db: Db, employeeIds: string[], dateKey: string): Promise<DayOffActivityShift[]> {
  if (!employeeIds.length) return [];
  const shifts = await db.workShift.findMany({
    where: {
      employeeId: { in: employeeIds },
      source: { not: "ADMIN" },
      // La fecha operativa difiere a lo sumo un día de la del ingreso.
      startAt: { gte: argentinaDayRange(previousCalendarDateKey(dateKey)).startAt, lt: argentinaDayRange(nextCalendarDateKey(dateKey)).endAt },
    },
    select: activityShiftSelect,
  });
  return shifts.filter((shift) => workShiftOperationalDateKey(shift.startAt, shift.shiftTemplate) === dateKey);
}

/**
 * Crea la alerta de la jornada (con notificación a los destinatarios de
 * asistencia, `createShiftAlert`) o reabre la que había resuelto la
 * cancelación del franco. Si ya existe cualquier otra, no la toca: un
 * reintento no duplica la notificación y nunca se reabre una alerta que una
 * persona resolvió o descartó (mismo guard que flagOpenShiftOverflowForReview).
 */
export async function ensureDayOffActivityAlert(db: Db, shift: Pick<DayOffActivityShift, "id" | "employeeId" | "startAt">): Promise<boolean> {
  const existing = await db.shiftAlert.findUnique({
    where: { workShiftId_type: { workShiftId: shift.id, type: DAY_OFF_ACTIVITY_ALERT_TYPE } },
    select: { id: true, status: true, resolutionNote: true },
  });
  const reopensCanceled = existing?.status === "RESUELTA" && existing.resolutionNote === DAY_OFF_CANCELED_ALERT_NOTE;
  if (existing && !reopensCanceled) return false;
  if (existing) await db.shiftAlert.update({ where: { id: existing.id }, data: { resolvedAt: null, resolvedByUserId: null, resolutionNote: null } });
  await createShiftAlert({ employeeId: shift.employeeId, workShiftId: shift.id, type: DAY_OFF_ACTIVITY_ALERT_TYPE, actualAt: shift.startAt, db });
  return true;
}

/** Al cancelar el franco: resuelve (sin borrar) las alertas pendientes de esas jornadas. */
export async function resolveDayOffActivityAlerts(db: Db, workShiftIds: string[]): Promise<number> {
  if (!workShiftIds.length) return 0;
  const result = await db.shiftAlert.updateMany({
    where: { workShiftId: { in: workShiftIds }, type: DAY_OFF_ACTIVITY_ALERT_TYPE, status: "PENDIENTE" },
    data: { status: "RESUELTA", resolvedAt: new Date(), resolutionNote: DAY_OFF_CANCELED_ALERT_NOTE },
  });
  return result.count;
}

/**
 * Paso `day-off-evaluation` del post-proceso durable de la fichada: corre
 * después de la evaluación de ingreso, que ya adoptó el turno que define la
 * fecha operativa. Fuera del request del fichador (cero latencia agregada).
 */
export async function evaluateWorkShiftDayOff(workShiftId: string, options: { db: Db }): Promise<boolean> {
  const shift = await options.db.workShift.findUnique({ where: { id: workShiftId }, select: { ...activityShiftSelect, source: true } });
  if (!shift || shift.source === "ADMIN") return false;
  const dateKey = workShiftOperationalDateKey(shift.startAt, shift.shiftTemplate);
  await lockEmployeeDays(options.db, [{ employeeId: shift.employeeId, dateKey }]);
  const dayOff = await options.db.employeeDayOff.findUnique({
    where: { employeeId_date: { employeeId: shift.employeeId, date: argentinaCalendarDate(dateKey) } },
    select: { status: true },
  });
  if (dayOff?.status !== "ACTIVO") return false;
  return ensureDayOffActivityAlert(options.db, shift);
}
