/**
 * Acceso a datos de la administración de rotaciones — R4.6
 * (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.9). Sin reglas de negocio:
 * las decide el servicio. Todas las escrituras reciben la transacción.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { argentinaCalendarDate } from "../../shared/datetime/argentinaTime";
import { AppError } from "../../shared/errors/AppError";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";

type Db = PrismaTransactionClient;

export const rotationTemplateSelect = {
  id: true,
  code: true,
  name: true,
  startTime: true,
  endTime: true,
  crossesMidnight: true,
  status: true,
  shiftGroupId: true,
} as const;

export const employeeLabelSelect = { id: true, legajo: true, firstName: true, lastName: true, status: true } as const;

const versionInclude = {
  days: {
    orderBy: [{ crewId: "asc" }, { cycleWeekIndex: "asc" }, { weekday: "asc" }],
    include: { blocks: { orderBy: { blockIndex: "asc" }, include: { shiftTemplate: { select: rotationTemplateSelect } } } },
  },
} satisfies Prisma.ShiftRotationVersionInclude;

export const rotationFullInclude = {
  shiftGroup: { select: { id: true, code: true, name: true, status: true } },
  crews: {
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    include: { members: { orderBy: { effectiveFrom: "asc" }, include: { employee: { select: employeeLabelSelect } } } },
  },
  versions: { orderBy: { effectiveFrom: "asc" }, include: versionInclude },
} satisfies Prisma.ShiftRotationInclude;

export type RotationFullRow = Prisma.ShiftRotationGetPayload<{ include: typeof rotationFullInclude }>;
export type RotationVersionRow = Prisma.ShiftRotationVersionGetPayload<{ include: typeof versionInclude }>;
export type RotationMemberRow = RotationFullRow["crews"][number]["members"][number];

export type VersionDayData = { crewId: string; cycleWeekIndex: number; weekday: number; kind: "SHIFT" | "REST"; blocks: Array<{ blockIndex: number; shiftTemplateId: string }> };

export const shiftRotationRepository = {
  /** Serializa toda escritura sobre una rotación (FOR UPDATE sobre su fila). */
  async lockRotation(tx: Db, rotationId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "ShiftRotation" WHERE "id" = ${rotationId} FOR UPDATE`;
    if (!rows.length) throw new AppError("No encontramos la rotación solicitada", 404, "ROTATION_NOT_FOUND");
  },

  list(filter: { status?: "ACTIVO" | "INACTIVO"; shiftGroupId?: string }, db: Db = prisma) {
    return db.shiftRotation.findMany({
      where: { ...(filter.status ? { status: filter.status } : {}), ...(filter.shiftGroupId ? { shiftGroupId: filter.shiftGroupId } : {}) },
      orderBy: [{ code: "asc" }],
      include: rotationFullInclude,
    });
  },

  findFull(id: string, db: Db = prisma) {
    return db.shiftRotation.findUnique({ where: { id }, include: rotationFullInclude });
  },

  findVersion(rotationId: string, versionId: string, db: Db = prisma) {
    return db.shiftRotationVersion.findFirst({ where: { id: versionId, rotationId }, include: versionInclude });
  },

  createRotation(data: { code: string; name: string; shiftGroupId: string; observation?: string | null }, userId: string | null, db: Db) {
    return db.shiftRotation.create({ data: { ...data, observation: data.observation ?? null, status: "INACTIVO", createdByUserId: userId, updatedByUserId: userId } });
  },

  updateRotation(id: string, data: Prisma.ShiftRotationUncheckedUpdateInput, db: Db) {
    return db.shiftRotation.update({ where: { id }, data });
  },

  /** Borra una rotación que nunca rigió: versiones (días y bloques en cascada), equipos y la rotación. */
  async deleteRotation(id: string, db: Db) {
    await db.shiftRotationVersion.deleteMany({ where: { rotationId: id } });
    await db.shiftRotationCrew.deleteMany({ where: { rotationId: id } });
    await db.shiftRotation.delete({ where: { id } });
  },

  createCrew(rotationId: string, data: { code: string; name: string; sortOrder: number }, userId: string | null, db: Db) {
    return db.shiftRotationCrew.create({ data: { rotationId, ...data, createdByUserId: userId, updatedByUserId: userId } });
  },

  updateCrew(crewId: string, data: Prisma.ShiftRotationCrewUncheckedUpdateInput, db: Db) {
    return db.shiftRotationCrew.update({ where: { id: crewId }, data });
  },

  /** Crea la versión con su grilla completa: 3 sentencias, sin importar el tamaño. */
  async createVersion(input: { rotationId: string; cycleLengthWeeks: number; anchorWeekStart: string; effectiveFrom: string; effectiveTo: string | null; days: VersionDayData[] }, userId: string | null, db: Db) {
    const version = await db.shiftRotationVersion.create({
      data: {
        rotationId: input.rotationId,
        cycleLengthWeeks: input.cycleLengthWeeks,
        anchorWeekStart: argentinaCalendarDate(input.anchorWeekStart),
        effectiveFrom: argentinaCalendarDate(input.effectiveFrom),
        effectiveTo: input.effectiveTo ? argentinaCalendarDate(input.effectiveTo) : null,
        createdByUserId: userId,
        updatedByUserId: userId,
      },
    });
    await this.writeGrid(version.id, input.days, db);
    return version;
  },

  async writeGrid(versionId: string, days: VersionDayData[], db: Db) {
    const rows = days.map((day) => ({ id: randomUUID(), ...day }));
    await db.shiftRotationDay.createMany({ data: rows.map(({ id, crewId, cycleWeekIndex, weekday, kind }) => ({ id, versionId, crewId, cycleWeekIndex, weekday, kind })) });
    const blocks = rows.flatMap((day) => day.blocks.map((block) => ({ dayId: day.id, blockIndex: block.blockIndex, shiftTemplateId: block.shiftTemplateId })));
    if (blocks.length) await db.shiftRotationBlock.createMany({ data: blocks });
  },

  /** Reemplaza ciclo, ancla, inicio y grilla de una versión futura (los días viejos y sus bloques caen en cascada). */
  async replaceVersion(versionId: string, input: { cycleLengthWeeks: number; anchorWeekStart: string; effectiveFrom: string; days: VersionDayData[] }, userId: string | null, db: Db) {
    await db.shiftRotationDay.deleteMany({ where: { versionId } });
    const version = await db.shiftRotationVersion.update({
      where: { id: versionId },
      data: {
        cycleLengthWeeks: input.cycleLengthWeeks,
        anchorWeekStart: argentinaCalendarDate(input.anchorWeekStart),
        effectiveFrom: argentinaCalendarDate(input.effectiveFrom),
        updatedByUserId: userId,
      },
    });
    await this.writeGrid(versionId, input.days, db);
    return version;
  },

  setVersionEnd(versionId: string, effectiveTo: string | null, userId: string | null, db: Db) {
    return db.shiftRotationVersion.update({ where: { id: versionId }, data: { effectiveTo: effectiveTo ? argentinaCalendarDate(effectiveTo) : null, updatedByUserId: userId } });
  },

  deleteVersion(versionId: string, db: Db) {
    return db.shiftRotationVersion.delete({ where: { id: versionId } });
  },

  templatesByIds(ids: string[], db: Db = prisma) {
    return db.shiftTemplate.findMany({ where: { id: { in: ids } }, select: rotationTemplateSelect });
  },

  employeesByIds(ids: string[], db: Db = prisma) {
    return db.employee.findMany({ where: { id: { in: ids } }, select: employeeLabelSelect });
  },

  /** Membresías de estas personas en CUALQUIER rotación que se superpongan con el rango. */
  overlappingMemberships(employeeIds: string[], from: string, to: string | null, db: Db = prisma) {
    return db.shiftRotationCrewMember.findMany({
      where: {
        employeeId: { in: employeeIds },
        ...(to ? { effectiveFrom: { lte: argentinaCalendarDate(to) } } : {}),
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: argentinaCalendarDate(from) } }],
      },
      include: { crew: { select: { code: true, name: true, rotation: { select: { code: true, name: true } } } } },
    });
  },

  fixedAssignmentsOf(employeeIds: string[], db: Db = prisma) {
    return db.shiftAssignment.findMany({
      where: { employeeId: { in: employeeIds } },
      include: { shiftTemplate: { select: { ...rotationTemplateSelect, absoluteOpenShiftLimitMinutes: true } }, employee: { select: { legajo: true } } },
    });
  },

  regimesOf(employeeIds: string[], db: Db = prisma) {
    return db.employeeWorkRegime.findMany({ where: { employeeId: { in: employeeIds } }, include: { workRegime: { select: { kind: true, name: true } } } });
  },

  createMemberships(rows: Array<{ crewId: string; employeeId: string; effectiveFrom: string; effectiveTo: string | null }>, userId: string | null, db: Db) {
    return db.shiftRotationCrewMember.createManyAndReturn({
      data: rows.map((row) => ({ crewId: row.crewId, employeeId: row.employeeId, effectiveFrom: argentinaCalendarDate(row.effectiveFrom), effectiveTo: row.effectiveTo ? argentinaCalendarDate(row.effectiveTo) : null, createdByUserId: userId })),
    });
  },

  findMember(rotationId: string, memberId: string, db: Db = prisma) {
    return db.shiftRotationCrewMember.findFirst({ where: { id: memberId, crew: { rotationId } }, include: { employee: { select: employeeLabelSelect }, crew: { select: { id: true, code: true, name: true, status: true } } } });
  },

  closeMember(memberId: string, lastDay: string, userId: string | null, db: Db) {
    return db.shiftRotationCrewMember.update({ where: { id: memberId }, data: { effectiveTo: argentinaCalendarDate(lastDay), closedByUserId: userId } });
  },

  deleteMember(memberId: string, db: Db) {
    return db.shiftRotationCrewMember.delete({ where: { id: memberId } });
  },

  closeFixedAssignment(id: string, lastDay: string, db: Db) {
    return db.shiftAssignment.update({ where: { id }, data: { effectiveTo: argentinaCalendarDate(lastDay) } });
  },

  disableFixedAssignment(id: string, userId: string | null, db: Db) {
    return db.shiftAssignment.update({ where: { id }, data: { status: "DESHABILITADO", disabledAt: new Date(), disabledByUserId: userId } });
  },
};
