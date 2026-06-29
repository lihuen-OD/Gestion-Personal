import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type {
  CreateDocumentCategoryInput,
  ListDocumentCategoriesQuery,
  UpdateDocumentCategoryInput,
} from "./documentCategories.schemas";

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
  findMany(query: ListDocumentCategoriesQuery) {
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
