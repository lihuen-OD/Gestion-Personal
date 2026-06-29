import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { salaryCategoriesRepository } from "./salaryCategories.repository";
import type {
  CreateSalaryCategoryInput,
  ListSalaryCategoriesQuery,
  UpdateSalaryCategoryInput,
} from "./salaryCategories.schemas";

function mapPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      throw new AppError("Salary category already exists", 409, "SALARY_CATEGORY_DUPLICATED");
    }
    if (error.code === "P2025") {
      throw new AppError("Salary category not found", 404, "SALARY_CATEGORY_NOT_FOUND");
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

export const salaryCategoriesService = {
  async list(query: ListSalaryCategoriesQuery) {
    const [items, total] = await salaryCategoriesRepository.findMany(query);
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

  async create(input: CreateSalaryCategoryInput, audit?: AuditContext) {
    const item = await execute(() => salaryCategoriesRepository.create(input));
    await auditService.register({
      ...audit,
      action: "CREATE",
      entity: "SalaryCategory",
      entityId: item.id,
      description: `Se creo la categoria salarial ${item.name}.`,
      after: item as Prisma.InputJsonValue,
    });
    return item;
  },

  async update(id: string, input: UpdateSalaryCategoryInput, audit?: AuditContext) {
    const before = await salaryCategoriesRepository.findById(id);
    if (!before) throw new AppError("Salary category not found", 404, "SALARY_CATEGORY_NOT_FOUND");
    const item = await execute(() => salaryCategoriesRepository.update(id, input));
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "SalaryCategory",
      entityId: item.id,
      description: `Se actualizo la categoria salarial ${item.name}.`,
      before: before as Prisma.InputJsonValue,
      after: item as Prisma.InputJsonValue,
    });
    return item;
  },
};
