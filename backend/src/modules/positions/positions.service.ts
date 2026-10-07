import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService, clearAuditDerivedCaches } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { invalidatePositionsCache, positionsRepository } from "./positions.repository";
import type { CreatePositionInput, ListPositionEmployeesQuery, ListPositionOptionsQuery, ListPositionsQuery, UpdatePositionInput } from "./positions.schemas";
import { employeeAccessWhere } from "../employees/employeeAccess";

function mapPrismaError(error: unknown) {
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

async function auditChange(action: "CREATE" | "UPDATE" | "DELETE", item: { id: string; code: string; name: string }, audit?: AuditContext) {
  await auditService.register({
    ...audit,
    action,
    entity: "Position",
    entityId: item.id,
    description: `${action === "CREATE" ? "Se creo" : action === "UPDATE" ? "Se actualizo" : "Se elimino"} puesto ${item.code} - ${item.name}.`,
    after: item as Prisma.InputJsonValue,
  });
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
    const item = await execute(() => positionsRepository.create(data));
    invalidatePositionsCache();
    await auditChange("CREATE", item, audit);
    return positionsRepository.findById(item.id);
  },

  async update(id: string, data: UpdatePositionInput, audit?: AuditContext) {
    const item = await execute(() => positionsRepository.update(id, data));
    invalidatePositionsCache();
    await auditChange("UPDATE", item, audit);
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
        ? [result.employees > 0 ? `${result.employees} ${result.employees === 1 ? "persona asignada" : "personas asignadas"}` : null, result.doubleHourRules > 0 ? `${result.doubleHourRules} ${result.doubleHourRules === 1 ? "regla de horas especiales" : "reglas de horas especiales"}` : null].filter(Boolean).join(" y ")
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
