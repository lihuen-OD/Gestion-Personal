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
    return prisma.$transaction([
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
