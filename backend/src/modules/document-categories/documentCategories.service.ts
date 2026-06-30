import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { documentCategoriesRepository, invalidateDocumentCategoriesCache } from "./documentCategories.repository";
import type {
  CreateDocumentCategoryInput,
  ListDocumentCategoriesQuery,
  UpdateDocumentCategoryInput,
} from "./documentCategories.schemas";

function mapPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      throw new AppError("Document category code already exists", 409, "DOCUMENT_CATEGORY_DUPLICATED");
    }
    if (error.code === "P2025") {
      throw new AppError("Document category not found", 404, "DOCUMENT_CATEGORY_NOT_FOUND");
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

export const documentCategoriesService = {
  async list(query: ListDocumentCategoriesQuery) {
    const [items, total] = await documentCategoriesRepository.findMany(query);
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

  async create(input: CreateDocumentCategoryInput, audit?: AuditContext) {
    const item = await execute(() => documentCategoriesRepository.create(input));
    invalidateDocumentCategoriesCache();
    await auditService.register({
      ...audit,
      action: "CREATE",
      entity: "DocumentCategory",
      entityId: item.id,
      description: `Se creo la categoria documental ${item.code} - ${item.name}.`,
      after: item as Prisma.InputJsonValue,
    });
    return item;
  },

  async update(id: string, input: UpdateDocumentCategoryInput, audit?: AuditContext) {
    const before = await documentCategoriesRepository.findById(id);
    if (!before) throw new AppError("Document category not found", 404, "DOCUMENT_CATEGORY_NOT_FOUND");
    const item = await execute(() => documentCategoriesRepository.update(id, input));
    invalidateDocumentCategoriesCache();
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "DocumentCategory",
      entityId: item.id,
      description: `Se actualizo la categoria documental ${item.code} - ${item.name}.`,
      before: before as Prisma.InputJsonValue,
      after: item as Prisma.InputJsonValue,
    });
    return item;
  },
};
