import type { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { ListDocumentsQuery } from "./documents.schemas";

const documentListInclude = {
  category: { select: { id: true, code: true, name: true } },
  employee: {
    select: {
      id: true,
      legajo: true,
      legajoFinnegans: true,
      cuil: true,
      dni: true,
      firstName: true,
      lastName: true,
    },
  },
  novelty: { select: { id: true, fromDate: true, toDate: true, noveltyType: { select: { name: true } } } },
} satisfies Prisma.EmployeeDocumentInclude;

function buildWhere(query: ListDocumentsQuery, employeeAccessWhere: Prisma.EmployeeWhereInput): Prisma.EmployeeDocumentWhereInput {
  const search = query.search?.trim();
  return {
    employee: employeeAccessWhere,
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(search
      ? {
          OR: [
            { fileName: { contains: search, mode: "insensitive" } },
            { category: { name: { contains: search, mode: "insensitive" } } },
            { employee: { legajo: { contains: search, mode: "insensitive" } } },
            { employee: { cuil: { contains: search, mode: "insensitive" } } },
            { employee: { dni: { contains: search, mode: "insensitive" } } },
            { employee: { firstName: { contains: search, mode: "insensitive" } } },
            { employee: { lastName: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
}

export const documentsRepository = {
  findById(id: string, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employeeDocument.findFirst({
      where: {
        id,
        employee: employeeAccessWhere,
      },
      include: {
        category: true,
        storageFile: true,
        employee: {
          select: {
            id: true,
            legajo: true,
            legajoFinnegans: true,
            cuil: true,
            dni: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });
  },

  findMany(query: ListDocumentsQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    const where = buildWhere(query, employeeAccessWhere);
    const skip = (query.page - 1) * query.take;
    return prisma.$transaction([
      prisma.employeeDocument.findMany({
        where,
        include: documentListInclude,
        orderBy: [{ createdAt: "desc" }, { employee: { lastName: "asc" } }],
        skip,
        take: query.take,
      }),
      prisma.employeeDocument.count({ where }),
    ]);
  },
};
