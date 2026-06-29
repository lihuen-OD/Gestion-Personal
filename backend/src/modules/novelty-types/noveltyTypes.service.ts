import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { noveltyTypesRepository } from "./noveltyTypes.repository";
import type { CreateNoveltyTypeInput, ListNoveltyTypesQuery, UpdateNoveltyTypeInput } from "./noveltyTypes.schemas";

function mapPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      throw new AppError("Novelty type code or Finnegans link already exists", 409, "NOVELTY_TYPE_UNIQUE_CONSTRAINT");
    }
    if (error.code === "P2025") {
      throw new AppError("Novelty type not found", 404, "NOVELTY_TYPE_NOT_FOUND");
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

async function auditChange(action: "CREATE" | "UPDATE", item: { id: string; code: string; name: string }, audit?: AuditContext) {
  await auditService.register({
    ...audit,
    action,
    entity: "NoveltyType",
    entityId: item.id,
    description: `${action === "CREATE" ? "Se creo" : "Se actualizo"} tipo de novedad ${item.code} - ${item.name}.`,
    after: item as Prisma.InputJsonValue,
  });
}

export const noveltyTypesService = {
  async list(query: ListNoveltyTypesQuery) {
    const [items, total] = await noveltyTypesRepository.findMany(query);
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
    return execute(() => noveltyTypesRepository.findById(id));
  },

  async create(data: CreateNoveltyTypeInput, audit?: AuditContext) {
    const item = await execute(() => noveltyTypesRepository.create(data));
    await auditChange("CREATE", item, audit);
    return item;
  },

  async update(id: string, data: UpdateNoveltyTypeInput, audit?: AuditContext) {
    const item = await execute(() => noveltyTypesRepository.update(id, data));
    await auditChange("UPDATE", item, audit);
    return item;
  },
};
