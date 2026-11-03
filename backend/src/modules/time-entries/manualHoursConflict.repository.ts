import type { ApprovalStatus, Prisma, WorkShiftSource } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { calendarDatesOf, MANUAL_HOURS_CONFLICT_ALERT_TYPE, normalBaseConceptWhere } from "./manualHoursConflict";

/**
 * Acceso a datos de la revisión de una fichada sobre horas cargadas a mano
 * (docs/decisions/MANUAL_HOURS_VS_CLOCK_PUNCH.md). La revisión ES la alerta
 * `ACTIVIDAD_SOBRE_CARGA_MANUAL` de la jornada; las horas son las filas de
 * Horas base (NORMAL_BASE) de sus fechas.
 */

type Db = PrismaTransactionClient;

export const manualHoursConflictSelect = {
  id: true,
  status: true,
  resolutionNote: true,
  resolvedAt: true,
  actualAt: true,
  resolvedBy: { select: { name: true } },
  employee: { select: { id: true, legajo: true, firstName: true, lastName: true } },
  workShift: {
    select: {
      id: true,
      source: true,
      startAt: true,
      endAt: true,
      totalMinutes: true,
      observation: true,
      hourConceptId: true,
      shiftTemplate: { select: { startTime: true, endTime: true, crossesMidnight: true } },
      timeSegments: { select: { id: true, date: true, minutes: true, fromDateTime: true, toDateTime: true }, orderBy: { fromDateTime: "asc" } },
    },
  },
} as const satisfies Prisma.ShiftAlertSelect;

export type ManualHoursConflictRow = Prisma.ShiftAlertGetPayload<{ select: typeof manualHoursConflictSelect }>;

export type NormalEntryRow = {
  id: string;
  employeeId: string;
  date: Date;
  hours: Prisma.Decimal;
  totalMinutes: number;
  actualMinutes: number | null;
  status: ApprovalStatus;
  source: WorkShiftSource | null;
  observation: string | null;
};

const normalEntrySelect = { id: true, employeeId: true, date: true, hours: true, totalMinutes: true, actualMinutes: true, status: true, source: true, observation: true } as const;

export const manualHoursConflictRepository = {
  findConflicts(where: Prisma.ShiftAlertWhereInput, db: Pick<Db, "shiftAlert"> = prisma): Promise<ManualHoursConflictRow[]> {
    return db.shiftAlert.findMany({ where: { ...where, type: MANUAL_HOURS_CONFLICT_ALERT_TYPE }, select: manualHoursConflictSelect, orderBy: { actualAt: "asc" } });
  },

  findConflict(id: string, db: Pick<Db, "shiftAlert"> = prisma): Promise<ManualHoursConflictRow | null> {
    return db.shiftAlert.findFirst({ where: { id, type: MANUAL_HOURS_CONFLICT_ALERT_TYPE }, select: manualHoursConflictSelect });
  },

  // Sin alcance: el servicio distingue "no existe" (404) de "fuera de alcance" (403).
  findTarget(id: string) {
    return prisma.shiftAlert.findFirst({ where: { id, type: MANUAL_HOURS_CONFLICT_ALERT_TYPE }, select: { id: true, employeeId: true } });
  },

  countEmployeeInScope(employeeId: string, accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.count({ where: { AND: [{ id: employeeId }, accessWhere] } });
  },

  findDecisionState(tx: Db, id: string) {
    return tx.shiftAlert.findUniqueOrThrow({ where: { id }, select: { status: true, resolutionNote: true } });
  },

  /** Filas de Horas base de esas fechas por legajo (la más vieja primero, como closeOpenWorkShift). */
  findNormalEntries(wanted: Array<{ employeeId: string; dateKeys: string[] }>, db: Pick<Db, "timeEntry"> = prisma): Promise<NormalEntryRow[]> {
    const filters = wanted.filter((item) => item.dateKeys.length).map((item) => ({ employeeId: item.employeeId, date: { in: calendarDatesOf(item.dateKeys) } }));
    if (!filters.length) return Promise.resolve([]);
    return db.timeEntry.findMany({ where: { OR: filters, hourConcept: normalBaseConceptWhere }, select: normalEntrySelect, orderBy: { createdAt: "asc" } });
  },

  findNormalHourConceptId(tx: Db) {
    return tx.hourConcept.findFirstOrThrow({ where: normalBaseConceptWhere, select: { id: true } }).then((concept) => concept.id);
  },

  updateEntry(tx: Db, id: string, data: Prisma.TimeEntryUncheckedUpdateInput) {
    return tx.timeEntry.update({ where: { id }, data, select: { id: true } });
  },

  createEntry(tx: Db, data: Prisma.TimeEntryUncheckedCreateInput) {
    return tx.timeEntry.create({ data, select: { id: true } });
  },

  updateShift(tx: Db, id: string, data: { status: "PROCESADO" | "OBSERVADO"; observation: string }) {
    return tx.workShift.update({ where: { id }, data, select: { id: true } });
  },

  /**
   * Auditoría de la decisión (misma transacción que la decisión): su `before`
   * congela las horas cargadas y fichadas que vio quien decidió. La última por
   * revisión.
   */
  async findDecisionAudits(alertIds: string[], db: Pick<Db, "auditLog"> = prisma) {
    if (!alertIds.length) return new Map<string, Prisma.JsonValue>();
    const audits = await db.auditLog.findMany({
      where: { entity: "ShiftAlert", action: "UPDATE", entityId: { in: alertIds } },
      select: { entityId: true, before: true },
      orderBy: { createdAt: "asc" },
    });
    return new Map(audits.map((audit) => [audit.entityId!, audit.before]));
  },

  markResolved(tx: Db, id: string, input: { userId: string; resolutionNote: string }) {
    return tx.shiftAlert.update({ where: { id }, data: { status: "RESUELTA", resolvedAt: new Date(), resolvedByUserId: input.userId, resolutionNote: input.resolutionNote }, select: { id: true } });
  },
};
