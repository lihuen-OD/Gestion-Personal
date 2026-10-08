import { Prisma } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { argentinaCalendarDate } from "../../shared/datetime/argentinaTime";
import { employeeReferenceSelect } from "../../shared/audit/employeeReference";

const workLocationInclude = {
  zone: { select: { id: true, code: true, name: true, status: true } },
  establishments: {
    select: { establishment: { select: { id: true, code: true, name: true, status: true, zoneId: true } } },
    orderBy: { establishment: { name: "asc" } },
  },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.EmployeeWorkLocationInclude;

export type WorkLocationRow = Prisma.EmployeeWorkLocationGetPayload<{ include: typeof workLocationInclude }>;

type WorkLocationWrite = {
  zoneId: string;
  establishmentIds: string[];
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string;
  notes: string | null;
};

type BlockHistoryWrite = { oldValue: string | null; newValue: string; effectiveFrom: string; reason: string };

const calendarDateOrNull = (key: string | null) => (key ? argentinaCalendarDate(key) : null);

export const employeeWorkLocationsRepository = {
  // Serializable: dos escrituras concurrentes sobre la misma persona no
  // pueden validar contra el mismo estado; además la exclusión de M1 protege
  // la superposición en la base.
  transaction<T>(operation: (tx: PrismaTransactionClient) => Promise<T>) {
    return prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  },

  findEmployeeReference(employeeId: string, accessWhere: Prisma.EmployeeWhereInput = {}, db: PrismaTransactionClient = prisma) {
    return db.employee.findFirst({ where: { AND: [{ id: employeeId }, accessWhere] }, select: { id: true, ...employeeReferenceSelect } });
  },

  findByEmployee(employeeId: string, db: PrismaTransactionClient = prisma) {
    return db.employeeWorkLocation.findMany({
      where: { employeeId },
      include: workLocationInclude,
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    });
  },

  findZone(db: PrismaTransactionClient, zoneId: string) {
    return db.zone.findUnique({ where: { id: zoneId }, select: { id: true, name: true, status: true } });
  },

  findEstablishments(db: PrismaTransactionClient, ids: string[]) {
    return db.establishment.findMany({ where: { id: { in: Array.from(new Set(ids)) } }, select: { id: true, name: true, status: true, zoneId: true, archivedAt: true } });
  },

  async createWithin(db: PrismaTransactionClient, employeeId: string, data: WorkLocationWrite, createdByUserId?: string | null) {
    const created = await db.employeeWorkLocation.create({
      data: {
        employeeId,
        zoneId: data.zoneId,
        effectiveFrom: argentinaCalendarDate(data.effectiveFrom),
        effectiveTo: calendarDateOrNull(data.effectiveTo),
        reason: data.reason,
        notes: data.notes,
        createdByUserId: createdByUserId || null,
      },
      select: { id: true },
    });
    await db.employeeWorkLocationEstablishment.createMany({
      data: data.establishmentIds.map((establishmentId) => ({ workLocationId: created.id, establishmentId })),
    });
    return created;
  },

  closeWithin(db: PrismaTransactionClient, id: string, effectiveTo: string) {
    return db.employeeWorkLocation.update({ where: { id }, data: { effectiveTo: argentinaCalendarDate(effectiveTo) }, select: { id: true } });
  },

  // Corrección: reemplaza explícitamente los establecimientos (sin CASCADE).
  async correctWithin(db: PrismaTransactionClient, id: string, data: WorkLocationWrite, replaceEstablishments: boolean) {
    await db.employeeWorkLocation.update({
      where: { id },
      data: {
        zoneId: data.zoneId,
        effectiveFrom: argentinaCalendarDate(data.effectiveFrom),
        effectiveTo: calendarDateOrNull(data.effectiveTo),
        reason: data.reason,
        notes: data.notes,
      },
      select: { id: true },
    });
    if (!replaceEstablishments) return;
    await db.employeeWorkLocationEstablishment.deleteMany({ where: { workLocationId: id } });
    await db.employeeWorkLocationEstablishment.createMany({
      data: data.establishmentIds.map((establishmentId) => ({ workLocationId: id, establishmentId })),
    });
  },

  // Historial visible del legajo, en la misma transacción que las filas.
  createBlockHistoryWithin(db: PrismaTransactionClient, employeeId: string, entry: BlockHistoryWrite, createdByUserId?: string | null) {
    return db.employeeBlockHistory.create({
      data: {
        employeeId,
        section: "DATOS_LABORALES",
        block: "UBICACIONES_TRABAJO",
        blockLabel: "Ubicaciones de trabajo",
        oldValue: entry.oldValue,
        newValue: entry.newValue,
        effectiveFrom: argentinaCalendarDate(entry.effectiveFrom),
        reason: entry.reason,
        createdByUserId: createdByUserId || null,
      },
      select: { id: true },
    });
  },
};
