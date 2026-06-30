import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { hourConceptsRepository, invalidateHourConceptsCache } from "./hourConcepts.repository";
import type { CreateHourConceptInput, ListHourConceptsQuery, UpdateHourConceptInput } from "./hourConcepts.schemas";

function mapPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      throw new AppError("Hour concept code already exists", 409, "HOUR_CONCEPT_UNIQUE_CONSTRAINT");
    }
    if (error.code === "P2025") {
      throw new AppError("Hour concept not found", 404, "HOUR_CONCEPT_NOT_FOUND");
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
    entity: "HourConcept",
    entityId: item.id,
    description: `${action === "CREATE" ? "Se creo" : "Se actualizo"} hora especial ${item.code} - ${item.name}.`,
    after: item as Prisma.InputJsonValue,
  });
}

export const hourConceptsService = {
  async list(query: ListHourConceptsQuery) {
    const [items, total] = await hourConceptsRepository.findMany(query);
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

  async create(data: CreateHourConceptInput, audit?: AuditContext) {
    const item = await execute(() => hourConceptsRepository.create(data));
    invalidateHourConceptsCache();
    await auditChange("CREATE", item, audit);
    return item;
  },

  async update(id: string, data: UpdateHourConceptInput, audit?: AuditContext) {
    const item = await execute(() => hourConceptsRepository.update(id, data));
    invalidateHourConceptsCache();
    await auditChange("UPDATE", item, audit);
    return item;
  },
};
