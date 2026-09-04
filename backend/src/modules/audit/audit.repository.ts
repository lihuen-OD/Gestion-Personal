import type { AuditAction, Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { ListAuditQuery } from "./audit.schemas";

export interface CreateAuditLogInput {
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  description: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export const auditRepository = {
  findMany(query: ListAuditQuery) {
    const where = {
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.action ? { action: query.action } : {}),
    };
    const skip = (query.page - 1) * query.take;
    // Etapa 14C.2 (ampliada): findMany + count son lecturas independientes
    // (no hay ninguna escritura entre medio que requiera atomicidad), así que
    // $transaction([...]) sólo forzaba que corrieran en serie por la misma
    // conexión. Promise.all las corre en paralelo contra el pool, sin cambiar
    // el resultado (misma respuesta [rows, total]) — mismo patrón ya aplicado
    // en employees/time-entries esta etapa.
    return Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: query.take,
      }),
      prisma.auditLog.count({ where }),
    ]);
  },

  create(data: CreateAuditLogInput) {
    return prisma.auditLog.create({ data });
  },
};
