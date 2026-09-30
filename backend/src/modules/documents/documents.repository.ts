import type { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { documentListSortKeys, ListDocumentsQuery } from "./documents.schemas";
import { resolveOrderBy, type SortOrderByMap } from "../../shared/validation/listSort";

// `status` ordena por el ciclo de vida del enum DocumentStatus (orden de
// declaración en schema.prisma), no alfabéticamente por la etiqueta visible.
const documentListOrderBy: SortOrderByMap<(typeof documentListSortKeys)[number], Prisma.EmployeeDocumentOrderByWithRelationInput> = {
  legajo: (order) => [{ employee: { legajo: order } }],
  employee: (order) => [{ employee: { lastName: order } }, { employee: { firstName: order } }],
  category: (order) => [{ category: { name: order } }],
  fileName: (order) => [{ fileName: order }],
  createdAt: (order) => [{ createdAt: order }],
  expiresAt: (order) => [{ expiresAt: { sort: order, nulls: "last" } }],
  status: (order) => [{ status: order }, { createdAt: "desc" }],
};

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

function buildWhere(
  query: ListDocumentsQuery,
  employeeAccessWhere: Prisma.EmployeeWhereInput,
  categoryViewWhere: Prisma.EmployeeDocumentWhereInput,
): Prisma.EmployeeDocumentWhereInput {
  const search = query.search?.trim();
  // Etapa 15D.4: compuesto vía AND (no spread plano) a propósito — evita que
  // categoryViewWhere (que puede traer una clave sentinela como `id`) pise o
  // sea pisado por otro filtro que use la misma clave (p. ej. query.categoryId).
  return {
    AND: [
      { employee: employeeAccessWhere },
      categoryViewWhere,
      ...(query.employeeId ? [{ employeeId: query.employeeId }] : []),
      ...(query.categoryId ? [{ categoryId: query.categoryId }] : []),
      ...(query.status ? [{ status: query.status }] : []),
      ...(search
        ? [
            {
              OR: [
                { fileName: { contains: search, mode: "insensitive" as const } },
                { category: { name: { contains: search, mode: "insensitive" as const } } },
                { employee: { legajo: { contains: search, mode: "insensitive" as const } } },
                { employee: { cuil: { contains: search, mode: "insensitive" as const } } },
                { employee: { dni: { contains: search, mode: "insensitive" as const } } },
                { employee: { firstName: { contains: search, mode: "insensitive" as const } } },
                { employee: { lastName: { contains: search, mode: "insensitive" as const } } },
              ],
            },
          ]
        : []),
    ],
  };
}

export const documentsRepository = {
  findById(
    id: string,
    employeeAccessWhere: Prisma.EmployeeWhereInput,
    categoryViewWhere: Prisma.EmployeeDocumentWhereInput,
  ) {
    return prisma.employeeDocument.findFirst({
      where: {
        AND: [{ id }, { employee: employeeAccessWhere }, categoryViewWhere],
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

  findMany(
    query: ListDocumentsQuery,
    employeeAccessWhere: Prisma.EmployeeWhereInput,
    categoryViewWhere: Prisma.EmployeeDocumentWhereInput,
  ) {
    const where = buildWhere(query, employeeAccessWhere, categoryViewWhere);
    const skip = (query.page - 1) * query.take;
    // Etapa 14I.2: findMany + count son lecturas independientes (ninguna
    // depende del resultado de la otra) — $transaction([...]) las pinaba a
    // una única conexión de Neon en serie sin ganar concurrencia real.
    // Mismo patrón ya corregido 15 veces en las series 14C/14G/14H. Ver
    // docs/decisions/BACKEND_TRANSACTION_CLEANUP_P0_14I2.md.
    return Promise.all([
      prisma.employeeDocument.findMany({
        where,
        include: documentListInclude,
        orderBy: resolveOrderBy(query, documentListOrderBy, [{ createdAt: "desc" }, { employee: { lastName: "asc" } }], { id: "asc" }),
        skip,
        take: query.take,
      }),
      prisma.employeeDocument.count({ where }),
    ]);
  },
};
