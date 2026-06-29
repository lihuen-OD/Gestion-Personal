import type { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";

const employeeInclude = {
  address: true,
  transport: true,
  sector: true,
  costCenter: true,
  companies: { include: { company: true } },
  laborMovements: { orderBy: { effectiveFrom: "asc" } },
  assignments: true,
} satisfies Prisma.EmployeeInclude;

export const dashboardRepository = {
  findEmployees(accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.findMany({
      where: accessWhere,
      include: employeeInclude,
      orderBy: [{ status: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
    });
  },

  findTimeEntries(period: string, accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.timeEntry.findMany({
      where: { period, employee: accessWhere },
      include: { hourConcept: true },
    });
  },

  findNovelties(period: string, accessWhere: Prisma.EmployeeWhereInput) {
    const start = new Date(`${period}-01T00:00:00.000Z`);
    const end = nextMonth(period);
    return prisma.novelty.findMany({
      where: {
        employee: accessWhere,
        fromDate: { lt: end },
        OR: [{ toDate: null }, { toDate: { gte: start } }],
      },
      include: { noveltyType: true },
    });
  },

  findAllNovelties(accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.novelty.findMany({
      where: { employee: accessWhere },
      include: { noveltyType: true },
    });
  },

  findDocuments(accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employeeDocument.findMany({
      where: { employee: accessWhere },
      select: { id: true, employeeId: true, status: true },
    });
  },
};

function nextMonth(period: string) {
  const [year = 0, month = 1] = period.split("-").map(Number);
  return new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));
}
