import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { createRepositoryListCache } from "../../shared/cache/repositoryListCache";
import type { CreateNoveltyTypeInput, ListNoveltyTypesQuery, UpdateNoveltyTypeInput } from "./noveltyTypes.schemas";

const noveltyTypeInclude = {
  finnegansLinks: { orderBy: [{ priority: "asc" }, { code: "asc" }] },
} satisfies Prisma.NoveltyTypeInclude;

// Cache en memoria para listados sin filtros. Etapa 14I.3: helper compartido
// (backend/src/shared/cache/repositoryListCache.ts) — mismo TTL, misma
// semántica, sin cambio de comportamiento. Ver docs/decisions/
// BACKEND_REPOSITORY_LIST_CACHE_HELPER_14I3.md.
type NoveltyTypeRow = Awaited<ReturnType<typeof prisma.noveltyType.findMany<{ include: typeof noveltyTypeInclude }>>>[number];
const CACHE_TTL_MS = 120_000; // 2 minutos
const listCache = createRepositoryListCache<NoveltyTypeRow[]>(CACHE_TTL_MS);

export function invalidateNoveltyTypesCache() {
  listCache.clear();
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
      // Etapa 14H.8: findMany + count son lecturas independientes (ninguna
      // depende del resultado de la otra) — $transaction([...]) las pinaba a
      // una única conexión de Neon en serie sin ganar concurrencia real.
      // Mismo patrón ya corregido 13+ veces en las series 14G/14H. Nota: hoy
      // ningún caller real del frontend pasa kind/origin/status/search (los
      // 4 call sites de noveltyTypeApiService.getAll() en todo el frontend
      // llaman sin filtros, confirmado por grep) — se corrige igual porque
      // es la misma corrección trivial y sin riesgo ya estandarizada en toda
      // la serie, y el endpoint sigue siendo API pública real y validada
      // (GET /novelty-types?kind=...). Ver docs/decisions/
      // NOVELTY_TYPES_PERFORMANCE_14H8.md.
      return Promise.all([
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

    const data = await listCache.getOrLoad(() =>
      prisma.noveltyType.findMany({
        include: noveltyTypeInclude,
        orderBy: [{ status: "asc" }, { name: "asc" }],
        take: 500,
      }),
    );

    const skip = (query.page - 1) * query.take;
    const page = data.slice(skip, skip + query.take);
    return [page, data.length];
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
