import type { EmployeeDayOffStatus, Prisma } from "@prisma/client";
import { employeeReferenceSelect } from "../../shared/audit/employeeReference";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import type { EmployeeDayOffsByDateQuery, ListEmployeeDayOffsQuery } from "./employeeDayOff.schemas";

const employeeSelect = { id: true, ...employeeReferenceSelect } as const;
const dayOffSelect = {
  id: true,
  employeeId: true,
  date: true,
  status: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  employee: { select: employeeSelect },
} as const satisfies Prisma.EmployeeDayOffSelect;

type Writer = Pick<PrismaTransactionClient, "employeeDayOff">;

function searchWhere(search?: string): Prisma.EmployeeWhereInput {
  const value = search?.trim();
  if (!value) return {};
  return {
    OR: [
      { legajo: { contains: value, mode: "insensitive" } },
      { firstName: { contains: value, mode: "insensitive" } },
      { lastName: { contains: value, mode: "insensitive" } },
    ],
  };
}

export const employeeDayOffRepository = {
  findForPeriod(query: ListEmployeeDayOffsQuery, range: { start: Date; end: Date }, accessWhere: Prisma.EmployeeWhereInput) {
    const where: Prisma.EmployeeDayOffWhereInput = {
      date: { gte: range.start, lt: range.end },
      ...(query.status ? { status: query.status } : {}),
      employee: accessWhere,
    };
    return Promise.all([
      prisma.employeeDayOff.findMany({
        where,
        select: dayOffSelect,
        orderBy: [{ date: "asc" }, { employee: { lastName: "asc" } }, { employee: { firstName: "asc" } }, { id: "asc" }],
        skip: (query.page - 1) * query.take,
        take: query.take,
      }),
      prisma.employeeDayOff.count({ where }),
    ]);
  },

  // Personas activas del alcance, con su franco, convocatoria a feriado y
  // estado de cierre de esa fecha: todo lo que el modal necesita para
  // habilitar o explicar cada fila, en una consulta paginada.
  findCandidatesByDate(query: EmployeeDayOffsByDateQuery, date: Date, period: string, accessWhere: Prisma.EmployeeWhereInput) {
    const where: Prisma.EmployeeWhereInput = { AND: [accessWhere, { status: "ACTIVO" }, searchWhere(query.search)] };
    return Promise.all([
      prisma.employee.findMany({
        where,
        select: {
          ...employeeSelect,
          dayOffs: { where: { date }, select: { id: true, status: true, notes: true, updatedAt: true } },
          holidayWorkAssignments: { where: { date, status: "ACTIVA" }, select: { id: true } },
          monthlyClosures: { where: { period }, select: { status: true } },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.take,
        take: query.take,
      }),
      prisma.employee.count({ where }),
    ]);
  },

  countEmployeesInScope(employeeIds: string[], accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.count({ where: { AND: [{ id: { in: employeeIds } }, accessWhere] } });
  },

  findOnDate(db: Writer, date: Date, employeeIds: string[]) {
    return db.employeeDayOff.findMany({ where: { date, employeeId: { in: employeeIds } }, select: dayOffSelect });
  },

  create(db: Writer, input: { employeeId: string; date: Date; notes: string | null; userId: string }) {
    return db.employeeDayOff.create({
      data: { employeeId: input.employeeId, date: input.date, status: "ACTIVO", notes: input.notes, createdByUserId: input.userId, updatedByUserId: input.userId },
      select: dayOffSelect,
    });
  },

  update(db: Writer, id: string, input: { status: EmployeeDayOffStatus; notes: string | null; userId: string }) {
    return db.employeeDayOff.update({
      where: { id },
      data: { status: input.status, notes: input.notes, updatedByUserId: input.userId },
      select: dayOffSelect,
    });
  },

  findActiveHolidayWork(db: Pick<PrismaTransactionClient, "holidayWorkAssignment">, date: Date, employeeIds: string[]) {
    if (!employeeIds.length) return Promise.resolve([]);
    return db.holidayWorkAssignment.findMany({
      where: { date, status: "ACTIVA", employeeId: { in: employeeIds } },
      select: { employee: { select: employeeSelect } },
    });
  },

  // "Franco → no considerar ausencia": los incidentes de falta de ingreso /
  // sin actividad de esa fecha que sigan pendientes se resuelven (nunca se borran).
  resolvePendingInactivity(db: Pick<PrismaTransactionClient, "attendanceInactivityIncident">, date: Date, employeeIds: string[]) {
    if (!employeeIds.length) return Promise.resolve({ count: 0 });
    return db.attendanceInactivityIncident.updateMany({
      where: { employeeId: { in: employeeIds }, operationalDate: date, status: "PENDIENTE" },
      data: { status: "RESUELTA", reviewedAt: new Date(), reviewNote: "Resuelto automáticamente: se asignó franco para esa fecha." },
    });
  },
};

export type EmployeeDayOffRow = Awaited<ReturnType<typeof employeeDayOffRepository.findOnDate>>[number];
