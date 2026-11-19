import type { Prisma, RecordStatus } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";

type Db = Pick<PrismaTransactionClient, "shiftGroup">;

/** Forma pública de un grupo dentro del catálogo de plantillas (sin autoría). */
export const shiftGroupSummarySelect = { id: true, code: true, name: true, status: true, sortOrder: true } as const;

export const SHIFT_GROUP_ORDER_BY: Prisma.ShiftGroupOrderByWithRelationInput[] = [{ sortOrder: "asc" }, { name: "asc" }];

export const shiftGroupRepository = {
  findMany(status: RecordStatus | undefined, db: Db = prisma) {
    return db.shiftGroup.findMany({
      where: status ? { status } : undefined,
      orderBy: SHIFT_GROUP_ORDER_BY,
      include: { _count: { select: { templates: true } } },
    });
  },

  findById(id: string, db: Db = prisma) {
    return db.shiftGroup.findUnique({ where: { id }, include: { _count: { select: { templates: true } } } });
  },

  /** Otro grupo con el mismo código o nombre, sin distinguir mayúsculas (valores ya normalizados). */
  findConflicting(input: { code?: string; name?: string }, excludeId: string | null, db: Db = prisma) {
    const or: Prisma.ShiftGroupWhereInput[] = [];
    if (input.code) or.push({ code: { equals: input.code, mode: "insensitive" } });
    if (input.name) or.push({ name: { equals: input.name, mode: "insensitive" } });
    if (!or.length) return Promise.resolve([]);
    return db.shiftGroup.findMany({
      where: { OR: or, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, code: true, name: true },
    });
  },

  create(data: { code: string; name: string; sortOrder: number }, userId: string | null, db: Db = prisma) {
    return db.shiftGroup.create({
      data: { ...data, createdByUserId: userId, updatedByUserId: userId },
      include: { _count: { select: { templates: true } } },
    });
  },

  update(id: string, data: Prisma.ShiftGroupUncheckedUpdateInput, db: Db = prisma) {
    return db.shiftGroup.update({ where: { id }, data, include: { _count: { select: { templates: true } } } });
  },

  delete(id: string, db: Db = prisma) {
    return db.shiftGroup.delete({ where: { id } });
  },
};
