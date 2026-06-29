import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type {
  CreateSalaryCategoryInput,
  ListSalaryCategoriesQuery,
  UpdateSalaryCategoryInput,
} from "./salaryCategories.schemas";

function buildWhere(query: ListSalaryCategoriesQuery): Prisma.SalaryCategoryWhereInput {
  const search = query.search?.trim();
  return {
    ...(query.family ? { family: query.family } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { family: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

function mapData(data: CreateSalaryCategoryInput | UpdateSalaryCategoryInput) {
  return {
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.family !== undefined ? { family: data.family || null } : {}),
    ...(data.order !== undefined ? { order: data.order } : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
  };
}

export const salaryCategoriesRepository = {
  findMany(query: ListSalaryCategoriesQuery) {
    const where = buildWhere(query);
    const skip = (query.page - 1) * query.take;
    return prisma.$transaction([
      prisma.salaryCategory.findMany({
        where,
        orderBy: [{ status: "asc" }, { order: "asc" }, { name: "asc" }],
        skip,
        take: query.take,
      }),
      prisma.salaryCategory.count({ where }),
    ]);
  },

  findById(id: string) {
    return prisma.salaryCategory.findUnique({ where: { id } });
  },

  create(data: CreateSalaryCategoryInput) {
    return prisma.salaryCategory.create({ data: mapData(data) as Prisma.SalaryCategoryCreateInput });
  },

  update(id: string, data: UpdateSalaryCategoryInput) {
    return prisma.salaryCategory.update({ where: { id }, data: mapData(data) as Prisma.SalaryCategoryUpdateInput });
  },
};
