import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { createRepositoryListCache, pageFromCappedList, REPOSITORY_LIST_CACHE_MAX_ROWS } from "../../shared/cache/repositoryListCache";
import type {
  CreateSalaryCategoryInput,
  ListSalaryCategoriesQuery,
  UpdateSalaryCategoryInput,
} from "./salaryCategories.schemas";

// Cache en memoria para listados sin filtros. Etapa 14I.3: helper compartido
// (backend/src/shared/cache/repositoryListCache.ts) — mismo TTL, misma
// semántica, sin cambio de comportamiento. La rama CON filtros (abajo, con
// `$transaction`) no se toca en esta etapa — ver docs/decisions/
// BACKEND_PERFORMANCE_INFRASTRUCTURE_DIAGNOSTIC_14I1.md (P2, sin caller
// real) y docs/decisions/BACKEND_REPOSITORY_LIST_CACHE_HELPER_14I3.md.
type SalaryCategoryRow = Awaited<ReturnType<typeof prisma.salaryCategory.findMany>>[number];
const CACHE_TTL_MS = 120_000; // 2 minutos
const listCache = createRepositoryListCache<SalaryCategoryRow[]>(CACHE_TTL_MS);

export function invalidateSalaryCategoriesCache() {
  listCache.clear();
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

function findPageFromDatabase(query: ListSalaryCategoriesQuery) {
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

export const salaryCategoriesRepository = {
  async findMany(query: ListSalaryCategoriesQuery): Promise<[SalaryCategoryRow[], number]> {
    if (hasActiveFilters(query)) return findPageFromDatabase(query);

    const data = await listCache.getOrLoad(() =>
      prisma.salaryCategory.findMany({
        orderBy: [{ status: "asc" }, { order: "asc" }, { name: "asc" }],
        take: REPOSITORY_LIST_CACHE_MAX_ROWS + 1,
      }),
    );

    return pageFromCappedList(data, query.page, query.take) ?? findPageFromDatabase(query);
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
