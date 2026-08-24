import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { CalculatedAutomaticBreakdown } from "./automaticHourConceptBreakdowns";

export const automaticHourConceptBreakdownsRepository = {
  findEmployee(id: string, accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.findFirst({ where: { AND: [{ id }, accessWhere] }, select: { id: true } });
  },

  findClosure(employeeId: string, period: string) {
    return prisma.monthlyTimeClosure.findUnique({
      where: { employeeId_period: { employeeId, period } },
      select: { status: true },
    });
  },

  findEligibleConcepts(employeeId: string) {
    return prisma.employeeHourConcept.findMany({
      where: {
        employeeId,
        hourConcept: {
          systemRole: null,
          status: "ACTIVO",
          deletedAt: null,
          loadMode: { in: ["AUTOMATIC", "BOTH"] },
        },
      },
      select: {
        hourConcept: {
          select: {
            id: true,
            loadMode: true,
            rules: {
              where: { status: "ACTIVO" },
              select: { id: true, hourConceptId: true, startTime: true, endTime: true, crossesMidnight: true },
            },
          },
        },
      },
    });
  },

  findProcessedShifts(employeeId: string, startAt: Date, endAt: Date) {
    return prisma.workShift.findMany({
      where: { employeeId, status: "PROCESADO", endAt: { not: null, gt: startAt }, startAt: { lt: endAt } },
      select: { id: true, startAt: true, endAt: true },
      orderBy: { startAt: "asc" },
    });
  },

  replaceAutomatic(employeeId: string, period: string, rows: CalculatedAutomaticBreakdown[], createdByUserId?: string | null) {
    return prisma.$transaction(async (tx) => {
      const deleted = await tx.hourConceptBreakdown.deleteMany({ where: { employeeId, period, source: "AUTOMATIC" } });
      if (rows.length) {
        await tx.hourConceptBreakdown.createMany({
          data: rows.map((row) => ({ ...row, employeeId, source: "AUTOMATIC", status: "BORRADOR", createdByUserId: createdByUserId || null })),
        });
      }
      return { deleted: deleted.count, created: rows.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  },
};
