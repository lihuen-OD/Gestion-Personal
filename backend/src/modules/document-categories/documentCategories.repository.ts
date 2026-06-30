import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type {
  CreateDocumentCategoryInput,
  ListDocumentCategoriesQuery,
  UpdateDocumentCategoryInput,
} from "./documentCategories.schemas";

// Cache en memoria para listados sin filtros
type DocumentCategoryRow = Awaited<ReturnType<typeof prisma.documentCategory.findMany>>[number];
let listCache: { data: DocumentCategoryRow[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 120_000; // 2 minutos

export function invalidateDocumentCategoriesCache() {
  listCache = null;
}

function hasActiveFilters(query: ListDocumentCategoriesQuery): boolean {
  return !!(
    query.kind ||
    query.status ||
    query.scope ||
    query.mandatory !== undefined ||
    query.expires !== undefined ||
    query.search?.trim()
  );
}

function buildWhere(query: ListDocumentCategoriesQuery): Prisma.DocumentCategoryWhereInput {
  const search = query.search?.trim();
  return {
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.scope ? { scopes: { array_contains: query.scope } } : {}),
    ...(query.mandatory !== undefined ? { rules: { path: ["mandatory"], equals: query.mandatory } } : {}),
    ...(query.expires !== undefined ? { rules: { path: ["expires"], equals: query.expires } } : {}),
    ...(search
      ? {
          OR: [
            { code: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

function mapData(data: CreateDocumentCategoryInput | UpdateDocumentCategoryInput) {
  return {
    ...(data.code !== undefined ? { code: data.code } : {}),
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.kind !== undefined ? { kind: data.kind } : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
    ...(data.description !== undefined ? { description: data.description || null } : {}),
    ...(data.scopes !== undefined ? { scopes: data.scopes } : {}),
    ...(data.rules !== undefined ? { rules: data.rules } : {}),
    ...(data.uploadRoles !== undefined ? { uploadRoles: data.uploadRoles } : {}),
    ...(data.viewRoles !== undefined ? { viewRoles: data.viewRoles } : {}),
    ...(data.approvalRoles !== undefined ? { approvalRoles: data.approvalRoles } : {}),
    ...(data.externalLinks !== undefined ? { externalLinks: data.externalLinks } : {}),
    ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
  };
}

export const documentCategoriesRepository = {
  async findMany(query: ListDocumentCategoriesQuery): Promise<[DocumentCategoryRow[], number]> {
    if (hasActiveFilters(query)) {
      const where = buildWhere(query);
      const skip = (query.page - 1) * query.take;
      return prisma.$transaction([
        prisma.documentCategory.findMany({
          where,
          orderBy: [{ status: "asc" }, { kind: "asc" }, { name: "asc" }],
          skip,
          take: query.take,
        }),
        prisma.documentCategory.count({ where }),
      ]);
    }

    if (!listCache || Date.now() >= listCache.expiresAt) {
      const data = await prisma.documentCategory.findMany({
        orderBy: [{ status: "asc" }, { kind: "asc" }, { name: "asc" }],
        take: 500,
      });
      listCache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    }

    const skip = (query.page - 1) * query.take;
    const page = listCache.data.slice(skip, skip + query.take);
    return [page, listCache.data.length];
  },

  findById(id: string) {
    return prisma.documentCategory.findUnique({ where: { id } });
  },

  create(data: CreateDocumentCategoryInput) {
    const mapped = mapData(data) as Prisma.DocumentCategoryCreateInput;
    return prisma.documentCategory.create({ data: mapped });
  },

  update(id: string, data: UpdateDocumentCategoryInput) {
    const mapped = mapData(data) as Prisma.DocumentCategoryUpdateInput;
    return prisma.documentCategory.update({ where: { id }, data: mapped });
  },
};
