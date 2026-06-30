import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { CreateHourConceptInput, ListHourConceptsQuery, UpdateHourConceptInput } from "./hourConcepts.schemas";

// Cache en memoria para listados sin filtros
type HourConceptRow = Awaited<ReturnType<typeof prisma.hourConcept.findMany>>[number];
let listCache: { data: HourConceptRow[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 120_000; // 2 minutos

export function invalidateHourConceptsCache() {
  listCache = null;
}

function hasActiveFilters(query: ListHourConceptsQuery): boolean {
  return !!(query.kind || query.status || query.search?.trim());
}

function buildWhere(query: ListHourConceptsQuery): Prisma.HourConceptWhereInput {
  const search = query.search?.trim();
  return {
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(search
      ? {
          OR: [
            { code: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export const hourConceptsRepository = {
  async findMany(query: ListHourConceptsQuery): Promise<[HourConceptRow[], number]> {
    if (hasActiveFilters(query)) {
      const where = buildWhere(query);
      const skip = (query.page - 1) * query.take;
      return prisma.$transaction([
        prisma.hourConcept.findMany({
          where,
          orderBy: [{ status: "asc" }, { kind: "asc" }, { name: "asc" }],
          skip,
          take: query.take,
        }),
        prisma.hourConcept.count({ where }),
      ]);
    }

    if (!listCache || Date.now() >= listCache.expiresAt) {
      const data = await prisma.hourConcept.findMany({
        orderBy: [{ status: "asc" }, { kind: "asc" }, { name: "asc" }],
        take: 500,
      });
      listCache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    }

    const skip = (query.page - 1) * query.take;
    const page = listCache.data.slice(skip, skip + query.take);
    return [page, listCache.data.length];
  },

  create(data: CreateHourConceptInput) {
    return prisma.hourConcept.create({ data });
  },

  update(id: string, data: UpdateHourConceptInput) {
    return prisma.hourConcept.update({ where: { id }, data });
  },
};
