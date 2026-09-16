import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { createRepositoryListCache } from "../../shared/cache/repositoryListCache";
import type { CreateNoveltyTypeInput, ListNoveltyTypesQuery, UpdateNoveltyTypeInput } from "./noveltyTypes.schemas";

// Cache en memoria para listados sin filtros. Etapa 14I.3: helper compartido
// (backend/src/shared/cache/repositoryListCache.ts) — mismo TTL, misma
// semántica, sin cambio de comportamiento. Ver docs/decisions/
// BACKEND_REPOSITORY_LIST_CACHE_HELPER_14I3.md.
type NoveltyTypeRow = Awaited<ReturnType<typeof prisma.noveltyType.findMany>>[number];
const CACHE_TTL_MS = 120_000; // 2 minutos
const listCache = createRepositoryListCache<NoveltyTypeRow[]>(CACHE_TTL_MS);

export function invalidateNoveltyTypesCache() {
  listCache.clear();
}

function hasActiveFilters(query: ListNoveltyTypesQuery): boolean {
  return !!(query.kind || query.status || query.exportsToFinnegans !== undefined || query.search?.trim());
}

function buildWhere(query: ListNoveltyTypesQuery): Prisma.NoveltyTypeWhereInput {
  const search = query.search?.trim();
  return {
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.exportsToFinnegans !== undefined ? { exportsToFinnegans: query.exportsToFinnegans } : {}),
    ...(search
      ? {
          OR: [
            { code: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
            { finnegansCode: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

// Etapa 15L.2A (docs/decisions/NOVELTY_TYPE_MODEL_NORMALIZATION_15L2A.md):
// generacion de codigo movida al backend -- antes solo el frontend
// (noveltyTypeApiService.ts::nextCode) calculaba "NOV-XXX", sin ninguna
// fuente de verdad del lado servidor. Mismo formato, mismo criterio (maximo
// sufijo numerico + 1). Sólo se ejercita si el caller no envia `code`
// (el frontend actual sigue enviandolo siempre, así que en la práctica hoy
// esta rama sólo la ejercita un caller directo de la API).
function extractCodeSuffix(code: string) {
  return Number(code.replace(/\D/g, "")) || 0;
}

async function generateNextCode(): Promise<string> {
  const rows = await prisma.noveltyType.findMany({ select: { code: true } });
  const max = rows.reduce((value, row) => Math.max(value, extractCodeSuffix(row.code)), 0);
  return `NOV-${String(max + 1).padStart(3, "0")}`;
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
      // ningún caller real del frontend pasa kind/status/search (los 4 call
      // sites de noveltyTypeApiService.getAll() en todo el frontend llaman
      // sin filtros, confirmado por grep) — se corrige igual porque es la
      // misma corrección trivial y sin riesgo ya estandarizada en toda la
      // serie, y el endpoint sigue siendo API pública real y validada
      // (GET /novelty-types?kind=...). Ver docs/decisions/
      // NOVELTY_TYPES_PERFORMANCE_14H8.md.
      return Promise.all([
        prisma.noveltyType.findMany({
          where,
          orderBy: [{ status: "asc" }, { name: "asc" }],
          skip,
          take: query.take,
        }),
        prisma.noveltyType.count({ where }),
      ]);
    }

    const data = await listCache.getOrLoad(() =>
      prisma.noveltyType.findMany({
        orderBy: [{ status: "asc" }, { name: "asc" }],
        take: 500,
      }),
    );

    const skip = (query.page - 1) * query.take;
    const page = data.slice(skip, skip + query.take);
    return [page, data.length];
  },

  findById(id: string) {
    return prisma.noveltyType.findUniqueOrThrow({ where: { id } });
  },

  // Etapa 15L.2A: hasta 3 intentos sólo cuando el caller no mandó `code` --
  // tolera la colisión de concurrencia de generar el mismo código dos veces
  // (dos altas casi simultáneas) sin inventar una tabla de secuencia nueva.
  // Si el caller sí mandó `code`, un P2002 se propaga directo (mismo
  // comportamiento que antes de esta etapa).
  async create(input: CreateNoveltyTypeInput) {
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const code = input.code || (await generateNextCode());
      try {
        return await prisma.noveltyType.create({
          data: { ...input, code },
        });
      } catch (error) {
        const isRetriableCollision = !input.code && attempt < MAX_ATTEMPTS && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
        if (!isRetriableCollision) throw error;
      }
    }
    throw new Error("noveltyTypesRepository.create: unreachable");
  },

  update(id: string, input: UpdateNoveltyTypeInput) {
    return prisma.noveltyType.update({ where: { id }, data: input });
  },
};
