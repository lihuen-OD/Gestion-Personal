import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { FinnegansExportQuery } from "./finnegansExport.schemas";

export type FinnegansExportNovelty = Awaited<ReturnType<typeof finnegansExportRepository.findExportableNovelties>>[number];

function rangeFromQuery(query: FinnegansExportQuery) {
  if (query.from && query.to) {
    return { from: query.from, to: query.to };
  }

  const [yearPart, monthPart] = query.period!.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { from, to };
}

function buildWhere(query: FinnegansExportQuery): Prisma.NoveltyWhereInput {
  const range = rangeFromQuery(query);
  return {
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    status: query.includePending ? { in: ["APROBADO", "PENDIENTE", "EN_REVISION"] } : "APROBADO",
    fromDate: { lte: range.to },
    OR: [{ toDate: null }, { toDate: { gte: range.from } }],
    noveltyType: {
      status: "ACTIVO",
      exportsToFinnegans: true,
      finnegansLinks: {
        some: {
          status: "ACTIVO",
        },
      },
    },
  };
}

export const finnegansExportRepository = {
  findExportableNovelties(query: FinnegansExportQuery) {
    return prisma.novelty.findMany({
      where: buildWhere(query),
      include: {
        employee: { select: { id: true, legajo: true, legajoFinnegans: true, firstName: true, lastName: true, costCenter: { select: { code: true } } } },
        noveltyType: {
          include: {
            finnegansLinks: {
              where: { status: "ACTIVO" },
              orderBy: [{ priority: "asc" }, { code: "asc" }],
              take: 1,
            },
          },
        },
      },
      orderBy: [{ fromDate: "asc" }, { employee: { legajo: "asc" } }],
    });
  },
};
