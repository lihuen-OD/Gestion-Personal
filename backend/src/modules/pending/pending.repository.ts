import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { PendingQuery } from "./pending.schemas";

function periodDateRange(period?: string) {
  if (!period) return {};
  const [yearPart, monthPart] = period.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  return {
    from: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
    to: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
  };
}

export const pendingRepository = {
  findPendingNovelties(query: PendingQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    const range = periodDateRange(query.period);
    return prisma.novelty.findMany({
      where: {
        employee: employeeAccessWhere,
        status: { in: ["PENDIENTE", "EN_REVISION"] },
        ...(range.from && range.to ? { fromDate: { gte: range.from, lte: range.to } } : {}),
      },
      include: {
        employee: { select: { id: true, legajo: true, firstName: true, lastName: true, sectorId: true } },
        noveltyType: true,
        targetHourConcept: true,
      },
      orderBy: [{ fromDate: "asc" }, { createdAt: "asc" }],
      take: query.take,
    });
  },

  findPendingTimeEntries(query: PendingQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.timeEntry.findMany({
      where: {
        employee: employeeAccessWhere,
        status: "EN_REVISION",
        ...(query.period ? { period: query.period } : {}),
      },
      include: {
        employee: { select: { id: true, legajo: true, firstName: true, lastName: true, sectorId: true } },
        hourConcept: true,
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      take: query.take,
    });
  },
};
