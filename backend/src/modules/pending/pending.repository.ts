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

function pendingNoveltiesWhere(query: PendingQuery, employeeAccessWhere: Prisma.EmployeeWhereInput): Prisma.NoveltyWhereInput {
  const range = periodDateRange(query.period);
  return {
    employee: employeeAccessWhere,
    status: { in: ["PENDIENTE", "EN_REVISION"] },
    ...(range.from && range.to ? { fromDate: { gte: range.from, lte: range.to } } : {}),
  };
}

function pendingTimeEntriesWhere(query: PendingQuery, employeeAccessWhere: Prisma.EmployeeWhereInput): Prisma.TimeEntryWhereInput {
  return {
    employee: employeeAccessWhere,
    status: "EN_REVISION",
    ...(query.period ? { period: query.period } : {}),
  };
}

function pendingBreakdownsWhere(query: PendingQuery, employeeAccessWhere: Prisma.EmployeeWhereInput): Prisma.HourConceptBreakdownWhereInput {
  return {
    employee: employeeAccessWhere,
    source: "MANUAL",
    status: "EN_REVISION",
    ...(query.period ? { period: query.period } : {}),
  };
}

const skipOf = (query: PendingQuery) => ((query.page ?? 1) - 1) * query.take;

export const pendingRepository = {
  findPendingNovelties(query: PendingQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.novelty.findMany({
      where: pendingNoveltiesWhere(query, employeeAccessWhere),
      include: {
        employee: { select: { id: true, legajo: true, firstName: true, lastName: true, sectorId: true } },
        noveltyType: { select: { id: true, code: true, name: true } },
        targetHourConcept: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ fromDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      skip: skipOf(query),
      take: query.take,
    });
  },

  countPendingNovelties(query: PendingQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.novelty.count({ where: pendingNoveltiesWhere(query, employeeAccessWhere) });
  },

  findPendingTimeEntries(query: PendingQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.timeEntry.findMany({
      where: pendingTimeEntriesWhere(query, employeeAccessWhere),
      include: {
        employee: { select: { id: true, legajo: true, firstName: true, lastName: true, sectorId: true } },
        hourConcept: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      skip: skipOf(query),
      take: query.take,
    });
  },

  // Etapa 6L.3: desgloses manuales cargados por Nivel 2/3 quedan EN_REVISION
  // (ver employees.repository.ts saveManualHourConceptBreakdown) y no tienen
  // una acción de aprobación propia todavía — por ahora esta consulta es lo
  // que asegura que RRHH al menos los vea en la bandeja de pendientes.
  findPendingHourConceptBreakdowns(query: PendingQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.hourConceptBreakdown.findMany({
      where: pendingBreakdownsWhere(query, employeeAccessWhere),
      include: {
        employee: { select: { id: true, legajo: true, firstName: true, lastName: true, sectorId: true } },
        hourConcept: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      skip: skipOf(query),
      take: query.take,
    });
  },

  countPendingTimeEntries(query: PendingQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.timeEntry.count({ where: pendingTimeEntriesWhere(query, employeeAccessWhere) });
  },

  countPendingHourConceptBreakdowns(query: PendingQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.hourConceptBreakdown.count({ where: pendingBreakdownsWhere(query, employeeAccessWhere) });
  },
};
