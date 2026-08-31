import type { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { HolidayWorkAssignmentItemInput, HolidayWorkCandidatesQuery } from "./holidayWorkAssignment.schemas";

const employeeSelect = { id: true, legajo: true, firstName: true, lastName: true, status: true } as const;
const shiftTemplateSelect = { id: true, code: true, name: true } as const;

// Mismo criterio de búsqueda ya usado (duplicado a propósito, no
// compartido) en employees.repository.ts (buildOptionsWhere) y
// timeEntries.repository.ts (employeeSearchWhere) — no existe un helper
// compartido para esto hoy en el repo.
function candidatesWhere(query: HolidayWorkCandidatesQuery): Prisma.EmployeeWhereInput {
  const search = query.search?.trim();
  return {
    status: "ACTIVO",
    ...(query.sectorId ? { sectorId: query.sectorId } : {}),
    ...(query.shiftTemplateId ? { shiftAssignments: { some: { shiftTemplateId: query.shiftTemplateId, status: "HABILITADO" } } } : {}),
    ...(query.withoutShift ? { shiftAssignments: { none: { status: "HABILITADO" } } } : {}),
    ...(search
      ? {
          OR: [
            { legajo: { contains: search, mode: "insensitive" } },
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export const holidayWorkAssignmentRepository = {
  findCandidates(query: HolidayWorkCandidatesQuery, accessWhere: Prisma.EmployeeWhereInput) {
    const where: Prisma.EmployeeWhereInput = { AND: [candidatesWhere(query), accessWhere] };
    const skip = (query.page - 1) * query.take;
    return prisma.$transaction([
      prisma.employee.findMany({
        where,
        select: {
          ...employeeSelect,
          sector: { select: { id: true, name: true } },
          shiftAssignments: { where: { status: "HABILITADO" }, select: { shiftTemplate: { select: shiftTemplateSelect } } },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        skip,
        take: query.take,
      }),
      prisma.employee.count({ where }),
    ]);
  },

  findByDate(date: Date, accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.holidayWorkAssignment.findMany({
      where: { date, status: "ACTIVA", employee: accessWhere },
      include: { employee: { select: employeeSelect }, shiftTemplate: { select: shiftTemplateSelect } },
      orderBy: [{ employee: { lastName: "asc" } }],
    });
  },

  findExisting(date: Date, employeeId: string) {
    return prisma.holidayWorkAssignment.findUnique({ where: { date_employeeId: { date, employeeId } } });
  },

  create(date: Date, employeeId: string, data: HolidayWorkAssignmentItemInput, userId: string | null) {
    return prisma.holidayWorkAssignment.create({
      data: {
        date,
        employeeId,
        status: data.status,
        shiftTemplateId: data.shiftTemplateId ?? null,
        expectedStartTime: data.expectedStartTime ?? null,
        expectedEndTime: data.expectedEndTime ?? null,
        notes: data.notes ?? null,
        createdByUserId: userId,
        updatedByUserId: userId,
      },
      include: { employee: { select: employeeSelect }, shiftTemplate: { select: shiftTemplateSelect } },
    });
  },

  update(id: string, data: HolidayWorkAssignmentItemInput, userId: string | null) {
    return prisma.holidayWorkAssignment.update({
      where: { id },
      data: {
        status: data.status,
        shiftTemplateId: data.shiftTemplateId ?? null,
        expectedStartTime: data.expectedStartTime ?? null,
        expectedEndTime: data.expectedEndTime ?? null,
        notes: data.notes ?? null,
        updatedByUserId: userId,
      },
      include: { employee: { select: employeeSelect }, shiftTemplate: { select: shiftTemplateSelect } },
    });
  },
};
