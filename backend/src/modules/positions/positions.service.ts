import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { positionsRepository } from "./positions.repository";
import type { CreatePositionInput, ListPositionsQuery, UpdatePositionInput } from "./positions.schemas";

function mapPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") throw new AppError("Position code already exists", 409, "POSITION_UNIQUE_CONSTRAINT");
    if (error.code === "P2025") throw new AppError("Position not found", 404, "POSITION_NOT_FOUND");
    if (error.code === "P2003") throw new AppError("Related area or sector not found", 400, "POSITION_RELATION_CONSTRAINT");
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

  async listAssignedEmployees(id: string) {
    await execute(() => positionsRepository.findById(id));
    return positionsRepository.findAssignedEmployees(id);
  },

  async create(data: CreatePositionInput, audit?: AuditContext) {
    const item = await execute(() => positionsRepository.create(data));
    await auditChange("CREATE", item, audit);
    return positionsRepository.findById(item.id);
  },

  async update(id: string, data: UpdatePositionInput, audit?: AuditContext) {
    const item = await execute(() => positionsRepository.update(id, data));
    await auditChange("UPDATE", item, audit);
    return positionsRepository.findById(item.id);
  },

  async remove(id: string, audit?: AuditContext) {
    const current = await execute(() => positionsRepository.findById(id));
    if (current._count.employees > 0) {
      const item = await execute(() => positionsRepository.update(id, { status: "INACTIVO" }));
      await auditChange("UPDATE", item, audit);
      return positionsRepository.findById(item.id);
    }
    const item = await execute(() => positionsRepository.delete(id));
    await auditChange("DELETE", item, audit);
    return null;
  },
};
