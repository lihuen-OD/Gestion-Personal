import type { Prisma, RecordStatus } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";

type Db = Pick<PrismaTransactionClient, "shiftGroup">;

/** Forma pública de un grupo dentro del catálogo de plantillas (sin autoría). */
export const shiftGroupSummarySelect = { id: true, code: true, name: true, status: true, sortOrder: true } as const;

export const SHIFT_GROUP_ORDER_BY: Prisma.ShiftGroupOrderByWithRelationInput[] = [{ sortOrder: "asc" }, { name: "asc" }];

/** R8: agrega el filtro de alcance sólo si restringe algo (Nivel 1 conserva la query intacta). */
function withScope(where: Prisma.ShiftGroupWhereInput | undefined, scopeWhere: Prisma.ShiftGroupWhereInput) {
  if (!Object.keys(scopeWhere).length) return where;
  return where ? { AND: [where, scopeWhere] } : scopeWhere;
}

export const shiftGroupRepository = {
  findMany(status: RecordStatus | undefined, scopeWhere: Prisma.ShiftGroupWhereInput = {}, db: Db = prisma) {
    return db.shiftGroup.findMany({
      where: withScope(status ? { status } : undefined, scopeWhere),
      orderBy: SHIFT_GROUP_ORDER_BY,
      include: { _count: { select: { templates: true, rotations: true } } },
    });
  },

  findById(id: string, db: Db = prisma) {
    return db.shiftGroup.findUnique({ where: { id }, include: { _count: { select: { templates: true, rotations: true, userScopes: true } } } });
  },

  /**
   * Código y nombre de los demás grupos, para validar duplicados sin distinguir
   * mayúsculas en el servicio. Catálogo chico (decenas de filas): se compara en
   * memoria con la misma semántica que los índices únicos sobre lower(...), en
   * vez de `mode: "insensitive"` (ILIKE: `_`, `%` y `\` actuarían como patrón).
   */
  findOtherKeys(excludeId: string | null, db: Db = prisma) {
    return db.shiftGroup.findMany({
      where: excludeId ? { id: { not: excludeId } } : undefined,
      select: { id: true, code: true, name: true },
    });
  },

  create(data: { code: string; name: string; sortOrder: number }, userId: string | null, db: Db = prisma) {
    return db.shiftGroup.create({
      data: { ...data, createdByUserId: userId, updatedByUserId: userId },
      include: { _count: { select: { templates: true, rotations: true } } },
    });
  },

  update(id: string, data: Prisma.ShiftGroupUncheckedUpdateInput, db: Db = prisma) {
    return db.shiftGroup.update({ where: { id }, data, include: { _count: { select: { templates: true, rotations: true } } } });
  },

  delete(id: string, db: Db = prisma) {
    return db.shiftGroup.delete({ where: { id } });
  },
};
