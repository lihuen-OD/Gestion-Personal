import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { CreateNoveltyTypeInput, ListNoveltyTypesQuery, UpdateNoveltyTypeInput } from "./noveltyTypes.schemas";

const noveltyTypeInclude = {
  finnegansLinks: { orderBy: [{ priority: "asc" }, { code: "asc" }] },
} satisfies Prisma.NoveltyTypeInclude;

// Cache en memoria para listados sin filtros
type NoveltyTypeRow = Awaited<ReturnType<typeof prisma.noveltyType.findMany<{ include: typeof noveltyTypeInclude }>>>[number];
let listCache: { data: NoveltyTypeRow[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 120_000; // 2 minutos

export function invalidateNoveltyTypesCache() {
  listCache = null;
}

function hasActiveFilters(query: ListNoveltyTypesQuery): boolean {
  return !!(query.kind || query.origin || query.status || query.exportsToFinnegans !== undefined || query.search?.trim());
}

function buildWhere(query: ListNoveltyTypesQuery): Prisma.NoveltyTypeWhereInput {
  const search = query.search?.trim();
  return {
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.origin ? { origin: query.origin } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.exportsToFinnegans !== undefined ? { exportsToFinnegans: query.exportsToFinnegans } : {}),
    ...(search
      ? {
          OR: [
            { code: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
            { finnegansLinks: { some: { code: { contains: search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
}

function createNoveltyTypeData(input: CreateNoveltyTypeInput) {
  const { finnegansLinks: _links, ...data } = input;
  return data;
}

function updateNoveltyTypeData(input: UpdateNoveltyTypeInput) {
  const { finnegansLinks: _links, ...data } = input;
  return data;
}

export const noveltyTypesRepository = {
  async findMany(query: ListNoveltyTypesQuery): Promise<[NoveltyTypeRow[], number]> {
    if (hasActiveFilters(query)) {
      const where = buildWhere(query);
      const skip = (query.page - 1) * query.take;
      return prisma.$transaction([
        prisma.noveltyType.findMany({
          where,
          include: noveltyTypeInclude,
          orderBy: [{ status: "asc" }, { name: "asc" }],
          skip,
          take: query.take,
        }),
        prisma.noveltyType.count({ where }),
      ]);
    }

    if (!listCache || Date.now() >= listCache.expiresAt) {
      const data = await prisma.noveltyType.findMany({
        include: noveltyTypeInclude,
        orderBy: [{ status: "asc" }, { name: "asc" }],
        take: 500,
      });
      listCache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    }

    const skip = (query.page - 1) * query.take;
    const page = listCache.data.slice(skip, skip + query.take);
    return [page, listCache.data.length];
  },

  findById(id: string) {
    return prisma.noveltyType.findUniqueOrThrow({
      where: { id },
      include: noveltyTypeInclude,
    });
  },

  create(input: CreateNoveltyTypeInput) {
    return prisma.noveltyType.create({
      data: {
        ...createNoveltyTypeData(input),
        ...(input.finnegansLinks.length
          ? {
              finnegansLinks: {
                createMany: { data: input.finnegansLinks },
              },
            }
          : {}),
      },
      include: noveltyTypeInclude,
    });
  },

  update(id: string, input: UpdateNoveltyTypeInput) {
    const shouldReplaceLinks = input.finnegansLinks !== undefined;
    return prisma.$transaction(async (tx) => {
      const item = await tx.noveltyType.update({
        where: { id },
        data: updateNoveltyTypeData(input),
      });

      if (shouldReplaceLinks) {
        await tx.finnegansNoveltyLink.deleteMany({ where: { noveltyTypeId: id } });
        if (input.finnegansLinks?.length) {
          await tx.finnegansNoveltyLink.createMany({
            data: input.finnegansLinks.map((link) => ({ ...link, noveltyTypeId: id })),
          });
        }
      }

      return tx.noveltyType.findUniqueOrThrow({ where: { id: item.id }, include: noveltyTypeInclude });
    });
  },
};
