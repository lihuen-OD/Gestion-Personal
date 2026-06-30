import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type {
  CreateSalaryCategoryInput,
  ListSalaryCategoriesQuery,
  UpdateSalaryCategoryInput,
} from "./salaryCategories.schemas";

// Cache en memoria para listados sin filtros
type SalaryCategoryRow = Awaited<ReturnType<typeof prisma.salaryCategory.findMany>>[number];
let listCache: { data: SalaryCategoryRow[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 120_000; // 2 minutos

export function invalidateSalaryCategoriesCache() {
  listCache = null;
}

function hasActiveFilters(query: ListSalaryCategoriesQuery): boolean {
  return !!(query.family || query.status || query.search?.trim());
}

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
  async findMany(query: ListSalaryCategoriesQuery): Promise<[SalaryCategoryRow[], number]> {
    if (hasActiveFilters(query)) {
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
    }

    if (!listCache || Date.now() >= listCache.expiresAt) {
      const data = await prisma.salaryCategory.findMany({
        orderBy: [{ status: "asc" }, { order: "asc" }, { name: "asc" }],
        take: 500,
      });
      listCache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    }

    const skip = (query.page - 1) * query.take;
    const page = listCache.data.slice(skip, skip + query.take);
    return [page, listCache.data.length];
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
