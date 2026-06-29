import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { auditParametersRepository } from "./auditParameters.repository";
import type {
  CreateAuditParameterInput,
  ListAuditParametersQuery,
  UpdateAuditParameterInput,
} from "./auditParameters.schemas";

function mapPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      throw new AppError("Audit parameter code already exists", 409, "AUDIT_PARAMETER_DUPLICATED");
    }
    if (error.code === "P2025") {
      throw new AppError("Audit parameter not found", 404, "AUDIT_PARAMETER_NOT_FOUND");
    }
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

export const auditParametersService = {
  async list(query: ListAuditParametersQuery) {
    const [items, total] = await auditParametersRepository.findMany(query);
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

  async create(input: CreateAuditParameterInput, audit?: AuditContext) {
    const item = await execute(() => auditParametersRepository.create(input, audit?.userId || undefined));
    await auditService.register({
      ...audit,
      action: "CREATE",
      entity: "AuditParameter",
      entityId: item.id,
      description: `Se creo el parametro de auditoria ${item.code} - ${item.name}.`,
      after: item as Prisma.InputJsonValue,
    });
    return item;
  },

  async update(id: string, input: UpdateAuditParameterInput, audit?: AuditContext) {
    const before = await auditParametersRepository.findById(id);
    if (!before) throw new AppError("Audit parameter not found", 404, "AUDIT_PARAMETER_NOT_FOUND");
    const item = await execute(() => auditParametersRepository.update(id, input, audit?.userId || undefined));
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "AuditParameter",
      entityId: item.id,
      description: `Se actualizo el parametro de auditoria ${item.code} - ${item.name}.`,
      before: before as Prisma.InputJsonValue,
      after: item as Prisma.InputJsonValue,
    });
    return item;
  },
};
