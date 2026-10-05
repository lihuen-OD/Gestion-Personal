import type { AuditAction, Prisma } from "@prisma/client";
import { clearAuditListCache } from "./audit.cache";
import { auditRepository } from "./audit.repository";
import type { ListAuditQuery } from "./audit.schemas";
import { clearDashboardMetricsCache } from "../dashboard/dashboard.cache";
import { containsTechnicalId, maskTechnicalIds } from "../../shared/audit/technicalIds";

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

function toAuditJson(value: Prisma.InputJsonValue | undefined) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

// La descripción se muestra tal cual en Dashboard, Auditoría e Historial del
// legajo: nunca debe llevar un id técnico. Cada llamador ya arma el texto con
// identidad humana (shared/audit/employeeReference.ts); esto es la última red
// para no persistir un UUID si un llamador nuevo se equivoca, y lo deja
// visible en logs para corregirlo en el origen.
function visibleDescription(input: RegisterAuditInput) {
  if (!containsTechnicalId(input.description)) return input.description;
  console.error("AUDIT_DESCRIPTION_TECHNICAL_ID", { action: input.action, entity: input.entity });
  return maskTechnicalIds(input.description);
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
    try {
      const created = await auditRepository.create({
        action: input.action,
        entity: input.entity,
        entityId: input.entityId || null,
        description: visibleDescription(input),
        before: toAuditJson(input.before),
        after: toAuditJson(input.after),
        userId: input.userId || null,
        ipAddress: input.ipAddress || null,
        userAgent: input.userAgent || null,
      });
      clearAuditListCache();
      clearDashboardMetricsCache();
      return created;
    } catch (error) {
      console.error("AUDIT_REGISTER_FAILED", {
        action: input.action,
        entity: input.entity,
        entityId: input.entityId || null,
        error,
      });
      return null;
    }
  },
};
