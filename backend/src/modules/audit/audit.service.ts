import type { AuditAction, Prisma } from "@prisma/client";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
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
// legajo: nunca debe llevar un id técnico. Cada llamador arma el texto con
// identidad humana (shared/audit/employeeReference.ts). Esto es sólo la
// última red de seguridad: si se dispara, es un bug del llamador (el log lo
// señala) y se corrige en el origen, no se depende del texto neutro.
function visibleDescription(input: RegisterAuditInput) {
  if (!containsTechnicalId(input.description)) return input.description;
  console.error("AUDIT_DESCRIPTION_TECHNICAL_ID", { action: input.action, entity: input.entity });
  return maskTechnicalIds(input.description);
}

function auditLogData(input: RegisterAuditInput) {
  return {
    action: input.action,
    entity: input.entity,
    entityId: input.entityId || null,
    description: visibleDescription(input),
    before: toAuditJson(input.before),
    after: toAuditJson(input.after),
    userId: input.userId || null,
    ipAddress: input.ipAddress || null,
    userAgent: input.userAgent || null,
  };
}

// Cachés derivados de la auditoría. Para registerWithin se limpian recién
// después del commit (nunca dentro de la transacción: si se revierte, el
// caché no debe haber reaccionado a una fila que no existe).
export function clearAuditDerivedCaches() {
  clearAuditListCache();
  clearDashboardMetricsCache();
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
      const created = await auditRepository.create(auditLogData(input));
      clearAuditDerivedCaches();
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

  /**
   * Auditoría transaccional (ORG_LOCATION_REORGANIZATION.md §3.5): escribe en
   * la transacción `db` del llamador y NO traga errores — si la auditoría
   * falla, la operación auditada se revierte. No limpia cachés: el llamador
   * invoca clearAuditDerivedCaches() después del commit.
   */
  registerWithin(db: PrismaTransactionClient, input: RegisterAuditInput) {
    return auditRepository.create(auditLogData(input), db);
  },
};
