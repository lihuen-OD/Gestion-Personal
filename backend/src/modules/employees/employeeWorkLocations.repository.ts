import { Prisma } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { argentinaCalendarDate } from "../../shared/datetime/argentinaTime";
import { employeeReferenceSelect } from "../../shared/audit/employeeReference";
import type { EstablishmentSelection } from "./employeeWorkLocations.rules";

const workLocationInclude = {
  zone: { select: { id: true, code: true, name: true, status: true, province: { select: { id: true, name: true } } } },
  establishments: {
    select: {
      coverage: true,
      establishment: { select: { id: true, code: true, name: true, status: true, zoneId: true } },
      units: { select: { unit: { select: { id: true, code: true, name: true, status: true } } }, orderBy: { unit: { name: "asc" } } },
    },
    orderBy: { establishment: { name: "asc" } },
  },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.EmployeeWorkLocationInclude;

export type WorkLocationRow = Prisma.EmployeeWorkLocationGetPayload<{ include: typeof workLocationInclude }>;

type WorkLocationWrite = {
  zoneId: string;
  establishments: EstablishmentSelection[];
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
    return db.zone.findUnique({ where: { id: zoneId }, select: { id: true, name: true, status: true, archivedAt: true } });
  },

  findEstablishments(db: PrismaTransactionClient, ids: string[]) {
    return db.establishment.findMany({ where: { id: { in: Array.from(new Set(ids)) } }, select: { id: true, name: true, status: true, zoneId: true, archivedAt: true } });
  },

  findUnits(db: PrismaTransactionClient, ids: string[]) {
    if (!ids.length) return Promise.resolve([]);
    return db.establishmentUnit.findMany({ where: { id: { in: Array.from(new Set(ids)) } }, select: { id: true, name: true, status: true, establishmentId: true, archivedAt: true } });
  },

  // Establecimientos con su cobertura y, para UNITS, sus unidades. La FK
  // compuesta (unitId, establishmentId) vuelve a garantizar la pertenencia.
  async createSelectionsWithin(db: PrismaTransactionClient, workLocationId: string, selections: EstablishmentSelection[]) {
    await db.employeeWorkLocationEstablishment.createMany({
      data: selections.map((item) => ({ workLocationId, establishmentId: item.establishmentId, coverage: item.coverage })),
    });
    const units = selections.flatMap((item) => (item.coverage === "UNITS" ? item.unitIds.map((unitId) => ({ workLocationId, establishmentId: item.establishmentId, unitId })) : []));
    if (units.length) await db.employeeWorkLocationUnit.createMany({ data: units });
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
    await employeeWorkLocationsRepository.createSelectionsWithin(db, created.id, data.establishments);
    return created;
  },

  closeWithin(db: PrismaTransactionClient, id: string, effectiveTo: string) {
    return db.employeeWorkLocation.update({ where: { id }, data: { effectiveTo: argentinaCalendarDate(effectiveTo) }, select: { id: true } });
  },

  // Corrección: reemplaza explícitamente unidades y establecimientos (sin CASCADE).
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
    await db.employeeWorkLocationUnit.deleteMany({ where: { workLocationId: id } });
    await db.employeeWorkLocationEstablishment.deleteMany({ where: { workLocationId: id } });
    await employeeWorkLocationsRepository.createSelectionsWithin(db, id, data.establishments);
  },

  /**
   * Eliminación controlada: asignaciones que todavía rigen o rigen a futuro
   * (no terminadas antes de `todayKey`) y usan alguno de los nodos que se
   * eliminan. Las pasadas no se tocan: son historia.
   */
  findOpenByNodesWithin(db: PrismaTransactionClient, nodes: { zoneIds: string[]; establishmentIds: string[]; unitIds: string[] }, todayKey: string) {
    const touches: Prisma.EmployeeWorkLocationWhereInput[] = [
      ...(nodes.zoneIds.length ? [{ zoneId: { in: nodes.zoneIds } }] : []),
      ...(nodes.establishmentIds.length ? [{ establishments: { some: { establishmentId: { in: nodes.establishmentIds } } } }] : []),
      ...(nodes.unitIds.length ? [{ establishments: { some: { units: { some: { unitId: { in: nodes.unitIds } } } } } }] : []),
    ];
    if (!touches.length) return Promise.resolve([]);
    return db.employeeWorkLocation.findMany({
      where: { AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: argentinaCalendarDate(todayKey) } }] }, { OR: touches }] },
      include: { ...workLocationInclude, employee: { select: { id: true, ...employeeReferenceSelect } } },
      orderBy: [{ employeeId: "asc" }, { effectiveFrom: "asc" }],
    });
  },

  /** Cancela una asignación que todavía no rige (sin CASCADE: unidades, establecimientos y fila). */
  async cancelWithin(db: PrismaTransactionClient, id: string) {
    await db.employeeWorkLocationUnit.deleteMany({ where: { workLocationId: id } });
    await db.employeeWorkLocationEstablishment.deleteMany({ where: { workLocationId: id } });
    await db.employeeWorkLocation.delete({ where: { id }, select: { id: true } });
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
