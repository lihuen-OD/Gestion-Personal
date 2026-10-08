import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService, clearAuditDerivedCaches } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { invalidatePositionsCache, positionsRepository } from "./positions.repository";
import type { CreatePositionInput, ListPositionEmployeesQuery, ListPositionOptionsQuery, ListPositionsQuery, PositionOrgScopeInput, UpdatePositionInput } from "./positions.schemas";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { formatArgentinaDate, todayArgentinaDateKey } from "../../shared/datetime/argentinaTime";
import { isLaborHistoryOverlapError, laborHistoryService, type RecordedHistoryChange } from "../labor-history/laborHistory.service";
import type { ScopeNodeSnapshot } from "../labor-history/laborHistory.scope";

function mapPrismaError(error: unknown) {
  if (isLaborHistoryOverlapError(error)) {
    throw new AppError("Otra operación registró al mismo tiempo una vigencia de alcance que se superpone. Actualizá la pantalla e intentá nuevamente.", 409, "LABOR_HISTORY_OVERLAP");
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") throw new AppError("Position code already exists", 409, "POSITION_UNIQUE_CONSTRAINT");
    if (error.code === "P2025") throw new AppError("Position not found", 404, "POSITION_NOT_FOUND");
    if (error.code === "P2003") throw new AppError("Related sector or salary category not found", 400, "POSITION_RELATION_CONSTRAINT");
    if (error.code === "P2034") throw new AppError("Otra operación modificó el puesto al mismo tiempo. Actualizá la pantalla e intentá nuevamente.", 409, "POSITION_CONCURRENT_CHANGE");
  }
  throw error;
}

async function execute<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    mapPrismaError(error);
    throw error;
  }
}

type ScopeNode = { level: PositionOrgScopeInput["level"]; id: string; name: string; status: string; companyId?: string; businessUnitId?: string; sectorId?: string };

function scopeKey(scope: PositionOrgScopeInput) { return `${scope.level}:${scope.nodeId}`; }

/**
 * Valida el alcance pedido y devuelve los nodos para la historia temporal
 * (D-5): un área guarda el sector padre que tiene HOY, al registrar la
 * vigencia, para que la pertenencia histórica no se deduzca después de la
 * estructura vigente.
 */
async function validateScopes(tx: PrismaTransactionClient, scopes: PositionOrgScopeInput[], currentKeys = new Set<string>()): Promise<ScopeNodeSnapshot[]> {
  const resolved = await positionsRepository.resolveScopeNodes(tx, scopes);
  const nodes: ScopeNode[] = [
    ...resolved.companies.map((node) => ({ level: "COMPANY" as const, id: node.id, name: node.name, status: node.status })),
    ...resolved.businessUnits.map((node) => ({ level: "BUSINESS_UNIT" as const, id: node.id, name: node.name, status: node.status, companyId: node.companyId })),
    ...resolved.sectors.map((node) => ({ level: "SECTOR" as const, id: node.id, name: node.name, status: node.status, businessUnitId: node.businessUnitId || undefined, companyId: node.businessUnit?.companyId })),
    ...resolved.areas.map((node) => ({ level: "AREA" as const, id: node.id, name: node.name, status: node.status, sectorId: node.sectorId || undefined, businessUnitId: node.sector?.businessUnitId || undefined, companyId: node.sector?.businessUnit?.companyId })),
  ];
  const byKey = new Map(nodes.map((node) => [`${node.level}:${node.id}`, node]));
  for (const scope of scopes) {
    const node = byKey.get(scopeKey(scope));
    if (!node) throw new AppError("Uno de los nodos organizacionales seleccionados no existe.", 400, "POSITION_SCOPE_INVALID");
    if ((node.level === "SECTOR" && !node.businessUnitId) || (node.level === "AREA" && (!node.sectorId || !node.businessUnitId))) {
      throw new AppError(`“${node.name}” pertenece a la estructura anterior y no puede asignarse como alcance nuevo.`, 409, "POSITION_SCOPE_LEGACY");
    }
    if (node.status !== "ACTIVO" && !currentKeys.has(scopeKey(scope))) {
      throw new AppError(`“${node.name}” está inactivo y no puede agregarse al alcance.`, 409, "POSITION_SCOPE_INACTIVE");
    }
  }
  const unique = new Set<string>();
  for (const scope of scopes) {
    const key = scopeKey(scope);
    if (unique.has(key)) throw new AppError("El mismo nodo organizacional fue seleccionado más de una vez.", 409, "POSITION_SCOPE_REDUNDANT");
    unique.add(key);
  }
  const isAncestor = (ancestor: ScopeNode, descendant: ScopeNode) =>
    (ancestor.level === "COMPANY" && descendant.companyId === ancestor.id)
    || (ancestor.level === "BUSINESS_UNIT" && descendant.businessUnitId === ancestor.id)
    || (ancestor.level === "SECTOR" && descendant.sectorId === ancestor.id);
  for (let left = 0; left < nodes.length; left += 1) for (let right = left + 1; right < nodes.length; right += 1) {
    if (isAncestor(nodes[left]!, nodes[right]!) || isAncestor(nodes[right]!, nodes[left]!)) {
      const ancestor = isAncestor(nodes[left]!, nodes[right]!) ? nodes[left]! : nodes[right]!;
      const descendant = ancestor === nodes[left] ? nodes[right]! : nodes[left]!;
      throw new AppError(`No selecciones “${descendant.name}”: ya está incluido por “${ancestor.name}”.`, 409, "POSITION_SCOPE_REDUNDANT", { ancestor: ancestor.name, descendant: descendant.name });
    }
  }
  return scopes.map((scope) => {
    const node = byKey.get(scopeKey(scope))!;
    return { level: scope.level, nodeId: scope.nodeId, areaSectorId: scope.level === "AREA" ? node.sectorId ?? null : null };
  });
}

const sameScopeKeys = (current: Set<string>, scopes: PositionOrgScopeInput[]) => current.size === new Set(scopes.map(scopeKey)).size && scopes.every((scope) => current.has(scopeKey(scope)));

function scopeChangeSummary(change: RecordedHistoryChange | null, reason?: string) {
  if (!change) return "";
  return ` Alcance vigente desde el ${formatArgentinaDate(change.effectiveFrom)}${change.kind === "REPLACE" ? " (corrección de la vigencia que empieza ese día)" : ""}. Motivo: ${reason}`;
}

export const positionsService = {
  async list(query: ListPositionsQuery) {
    const [items, total] = await positionsRepository.findMany(query);
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

  getById(id: string) {
    return execute(() => positionsRepository.findById(id));
  },

  // Etapa 14D.4: catálogo liviano para selects/catálogos (Legajos hoy).
  listOptions(query: ListPositionOptionsQuery) {
    return positionsRepository.findOptions(query);
  },

  // Etapa 14H.7: el chequeo de existencia usaba findById() (positionInclude
  // completo, descartado sin usar salvo para el 404) — existsById() hace el
  // mismo chequeo (mismo mapeo de P2025 -> 404) con un select mínimo.
  async listAssignedEmployees(id: string, query: ListPositionEmployeesQuery, user: Express.AuthUser) {
    await execute(() => positionsRepository.existsById(id));
    const [items, total] = await positionsRepository.findAssignedEmployees(id, query, employeeAccessWhere(user));
    return { items, meta: { total, page: query.page, pageSize: query.take, hasMore: query.page * query.take < total } };
  },

  async create(data: CreatePositionInput, audit?: AuditContext) {
    const scopesFrom = data.orgScopesEffectiveFrom ?? todayArgentinaDateKey();
    const item = await execute(() => positionsRepository.transaction(async (tx) => {
      const nodes = await validateScopes(tx, data.orgScopes);
      const created = await positionsRepository.createWithin(tx, data, audit?.userId || undefined);
      // D-5: el alcance inicial abre su historia por fecha en la misma transacción.
      await laborHistoryService.openPositionScopeWithin(tx, { positionId: created.id, effectiveFrom: scopesFrom, nodes, reason: "Alta del puesto", createdByUserId: audit?.userId || null });
      await auditService.registerWithin(tx, { ...audit, action: "CREATE", entity: "Position", entityId: created.id, description: `Se creó puesto ${created.code} - ${created.name}. Alcance vigente desde el ${formatArgentinaDate(scopesFrom)}.`, after: { ...created, orgScopes: data.orgScopes, orgScopesEffectiveFrom: scopesFrom } as Prisma.InputJsonValue });
      return created;
    }));
    invalidatePositionsCache();
    clearAuditDerivedCaches();
    return positionsRepository.findById(item.id);
  },

  async update(id: string, data: UpdatePositionInput, audit?: AuditContext) {
    const item = await execute(() => positionsRepository.transaction(async (tx) => {
      const before = await tx.position.findUniqueOrThrow({ where: { id }, select: { id: true, code: true, name: true, status: true } });
      let currentScopes: Awaited<ReturnType<typeof positionsRepository.findScopeKeys>> = [];
      let scopesChanged = false;
      let scopeChange: RecordedHistoryChange | null = null;
      if (data.orgScopes) {
        currentScopes = await positionsRepository.findScopeKeys(tx, id);
        const currentKeys = new Set(currentScopes.map((scope) => `${scope.level}:${scope.companyId || scope.businessUnitId || scope.sectorId || scope.areaId}`));
        const nodes = await validateScopes(tx, data.orgScopes, currentKeys);
        // Reenviar el mismo alcance no es un cambio: no se reescriben las filas
        // vigentes ni se abre una vigencia nueva.
        scopesChanged = !sameScopeKeys(currentKeys, data.orgScopes);
        if (scopesChanged) {
          if (!data.orgScopesChange) {
            throw new AppError("Para cambiar el alcance del puesto indicá la fecha desde la que rige y el motivo. El cambio alcanza a todas las personas que tengan este puesto.", 400, "POSITION_SCOPE_CHANGE_DATE_REQUIRED");
          }
          // D-5: historia por fecha + protección de cierres de los ocupantes, antes de tocar el alcance vigente.
          scopeChange = await laborHistoryService.recordPositionScopeChangeWithin(tx, { positionId: id, effectiveFrom: data.orgScopesChange.effectiveFrom, nodes, reason: data.orgScopesChange.reason, createdByUserId: audit?.userId || null });
        }
      }
      const updated = await positionsRepository.updateWithin(tx, id, { ...data, orgScopes: scopesChanged ? data.orgScopes : undefined }, audit?.userId || undefined);
      await auditService.registerWithin(tx, { ...audit, action: "UPDATE", entity: "Position", entityId: updated.id, description: `Se actualizó puesto ${updated.code} - ${updated.name}.${scopeChangeSummary(scopeChange, data.orgScopesChange?.reason)}`, before: { ...before, ...(scopesChanged ? { orgScopes: currentScopes } : {}) } as Prisma.InputJsonValue, after: { ...updated, ...(scopesChanged ? { orgScopes: data.orgScopes, orgScopesChange: data.orgScopesChange, scopeHistory: scopeChange } : {}) } as Prisma.InputJsonValue });
      return updated;
    }));
    invalidatePositionsCache();
    clearAuditDerivedCaches();
    return positionsRepository.findById(item.id);
  },

  // Con personas o reglas de horas especiales que lo referencian, el puesto se
  // inactiva (nunca se borra: ver positionsRepository.removeOrInactivate). La
  // auditoría se escribe en la misma transacción; los cachés, después.
  async remove(id: string, audit?: AuditContext) {
    const outcome = await execute(() => positionsRepository.removeOrInactivate(id, (tx, result) => {
      const { position } = result;
      const inactivated = result.kind === "INACTIVATED";
      const reasons = inactivated
        ? [
            result.employees > 0 ? `${result.employees} ${result.employees === 1 ? "persona asignada" : "personas asignadas"}` : null,
            result.doubleHourRules > 0 ? `${result.doubleHourRules} ${result.doubleHourRules === 1 ? "regla de horas especiales" : "reglas de horas especiales"}` : null,
            result.history > 0 ? "historia laboral registrada" : null,
          ].filter(Boolean).join(" y ")
        : "";
      return auditService.registerWithin(tx, {
        ...audit,
        action: inactivated ? "UPDATE" : "DELETE",
        entity: "Position",
        entityId: position.id,
        description: inactivated
          ? `Se inactivó puesto ${position.code} - ${position.name} en lugar de eliminarlo (tiene ${reasons}).`
          : `Se elimino puesto ${position.code} - ${position.name}.`,
        before: position as Prisma.InputJsonValue,
        ...(inactivated ? { after: { ...position, status: "INACTIVO" } as Prisma.InputJsonValue } : {}),
      });
    }));
    if (outcome.kind === "NOT_FOUND") throw new AppError("Position not found", 404, "POSITION_NOT_FOUND");
    invalidatePositionsCache();
    clearAuditDerivedCaches();
    return outcome.kind === "INACTIVATED" ? positionsRepository.findById(id) : null;
  },
};
