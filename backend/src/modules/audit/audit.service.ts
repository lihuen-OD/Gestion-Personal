import type { AuditAction, Prisma } from "@prisma/client";
import { auditRepository } from "./audit.repository";
import type { ListAuditQuery } from "./audit.schemas";

export interface AuditContext {
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface RegisterAuditInput extends AuditContext {
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  description: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

export const auditService = {
  async list(query: ListAuditQuery) {
    const [items, total] = await auditRepository.findMany(query);
    return {
      items,
      meta: {
        total,
        page: query.page,
        pageSize: query.take,
        hasMore: query.page * query.take < total,
      },
    };
  },

  async register(input: RegisterAuditInput) {
    return auditRepository.create({
      action: input.action,
      entity: input.entity,
      entityId: input.entityId || null,
      description: input.description,
      before: input.before,
      after: input.after,
      userId: input.userId || null,
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null,
    });
  },
};
