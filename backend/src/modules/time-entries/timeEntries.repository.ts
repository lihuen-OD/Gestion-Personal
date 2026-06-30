import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { CreateTimeEntryInput, ListTimeEntriesQuery, TimeEntriesExportQuery, UpdateTimeEntryInput } from "./timeEntries.schemas";

const timeEntryInclude = {
  employee: { select: { id: true, legajo: true, cuil: true, firstName: true, lastName: true, status: true } },
  hourConcept: true,
} satisfies Prisma.TimeEntryInclude;

function periodFromDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function dayFromDate(date: Date) {
  return date.getUTCDate();
}

function minutesFromHours(hours: number) {
  return Math.round(hours * 60);
}

function buildWhere(query: ListTimeEntriesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput): Prisma.TimeEntryWhereInput {
  return {
    employee: employeeAccessWhere,
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(query.hourConceptId ? { hourConceptId: query.hourConceptId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.period ? { period: query.period } : {}),
    ...(query.from || query.to
      ? {
          date: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };
}

export const timeEntriesRepository = {
  findMany(query: ListTimeEntriesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    const where = buildWhere(query, employeeAccessWhere);
    const skip = (query.page - 1) * query.take;
    return prisma.$transaction([
      prisma.timeEntry.findMany({
        where,
        include: timeEntryInclude,
        orderBy: [{ date: "desc" }, { employee: { lastName: "asc" } }],
        skip,
        take: query.take,
      }),
      prisma.timeEntry.count({ where }),
    ]);
  },

  findForExport(query: TimeEntriesExportQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.timeEntry.findMany({
      where: {
        employee: employeeAccessWhere,
        period: query.period,
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        status: query.includeInReview ? { in: ["APROBADO", "EN_REVISION"] } : "APROBADO",
      },
      include: {
        employee: {
          include: {
            costCenter: true,
            companies: { include: { company: true }, orderBy: { isPrimary: "desc" } },
          },
        },
        hourConcept: true,
      },
      orderBy: [{ employee: { lastName: "asc" } }, { employee: { firstName: "asc" } }, { date: "asc" }],
      take: 5000,
    });
  },

  findById(id: string, employeeAccessWhere: Prisma.EmployeeWhereInput = {}) {
    return prisma.timeEntry.findFirst({
      where: { id, employee: employeeAccessWhere },
      include: timeEntryInclude,
    });
  },

  countEmployeeInScope(employeeId: string, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.count({ where: { AND: [{ id: employeeId }, employeeAccessWhere] } });
  },

  findEnabledHourConcept(employeeId: string, hourConceptId: string) {
    return prisma.employeeHourConcept.findUnique({
      where: { employeeId_hourConceptId: { employeeId, hourConceptId } },
      include: { hourConcept: true },
    });
  },

  findDuplicate(employeeId: string, hourConceptId: string, date: Date, exceptId?: string) {
    return prisma.timeEntry.findFirst({
      where: {
        employeeId,
        hourConceptId,
        date,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
  },

  findBlockingNovelty(employeeId: string, date: Date) {
    return prisma.novelty.findFirst({
      where: {
        employeeId,
        status: { not: "RECHAZADO" },
        fromDate: { lte: date },
        OR: [{ toDate: null }, { toDate: { gte: date } }],
        noveltyType: {
          OR: [
            { blocksTimeEntry: true },
            { setsWorkedHoursToZero: true },
            { timeImpact: "BLOQUEA_CARGA_DIA" },
          ],
        },
      },
      include: { noveltyType: { select: { code: true, name: true } } },
    });
  },

  create(input: CreateTimeEntryInput, createdByUserId?: string | null) {
    return prisma.timeEntry.create({
      data: {
        employeeId: input.employeeId,
        hourConceptId: input.hourConceptId,
        date: input.date,
        period: periodFromDate(input.date),
        day: dayFromDate(input.date),
        hours: input.hours,
        totalMinutes: minutesFromHours(input.hours),
        status: "BORRADOR",
        observation: input.observation || null,
        createdByUserId: createdByUserId || null,
      },
      include: timeEntryInclude,
    });
  },

  update(id: string, before: { employeeId: string; hourConceptId: string; date: Date }, input: UpdateTimeEntryInput) {
    const date = input.date || before.date;
    const hours = input.hours;
    return prisma.timeEntry.update({
      where: { id },
      data: {
        ...(input.hourConceptId !== undefined ? { hourConceptId: input.hourConceptId } : {}),
        ...(input.date !== undefined ? { date, period: periodFromDate(date), day: dayFromDate(date) } : {}),
        ...(hours !== undefined ? { hours, totalMinutes: minutesFromHours(hours) } : {}),
        ...(input.observation !== undefined ? { observation: input.observation || null } : {}),
      },
      include: timeEntryInclude,
    });
  },

  submit(id: string) {
    return prisma.timeEntry.update({
      where: { id },
      data: { status: "EN_REVISION" },
      include: timeEntryInclude,
    });
  },

  approve(id: string, approvedByUserId: string) {
    return prisma.timeEntry.update({
      where: { id },
      data: { status: "APROBADO", approvedByUserId, approvedAt: new Date(), rejectedAt: null },
      include: timeEntryInclude,
    });
  },

  reject(id: string) {
    return prisma.timeEntry.update({
      where: { id },
      data: { status: "RECHAZADO", approvedByUserId: null, approvedAt: null, rejectedAt: new Date() },
      include: timeEntryInclude,
    });
  },

  returnForCorrection(id: string) {
    return prisma.timeEntry.update({
      where: { id },
      data: { status: "DEVUELTO", approvedByUserId: null, approvedAt: null, rejectedAt: null },
      include: timeEntryInclude,
    });
  },
};
