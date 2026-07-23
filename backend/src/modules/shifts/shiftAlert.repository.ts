import type { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { ListShiftAlertsQuery } from "./shiftAlert.schemas";

const employeeSelect = { id: true, legajo: true, dni: true, firstName: true, lastName: true, status: true } as const;
const workShiftSelect = { id: true, startAt: true, endAt: true, status: true, shiftTemplate: { select: { id: true, code: true, name: true } } } as const;

function buildWhere(query: ListShiftAlertsQuery, employeeAccessWhere: Prisma.EmployeeWhereInput): Prisma.ShiftAlertWhereInput {
  const search = query.search?.trim();
  return {
    employee: {
      AND: [
        employeeAccessWhere,
        ...(search
          ? [{
              OR: [
                { firstName: { contains: search, mode: "insensitive" as const } },
                { lastName: { contains: search, mode: "insensitive" as const } },
                { legajo: { contains: search, mode: "insensitive" as const } },
                { dni: { contains: search, mode: "insensitive" as const } },
              ],
            }]
          : []),
      ],
    },
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(query.workShiftId ? { workShiftId: query.workShiftId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.severity ? { severity: query.severity } : {}),
    ...(query.status !== "ALL" ? { status: query.status } : {}),
  };
}

export const shiftAlertRepository = {
  async findMany(query: ListShiftAlertsQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    const where = buildWhere(query, employeeAccessWhere);
    const [items, total] = await prisma.$transaction([
      prisma.shiftAlert.findMany({
        where: { ...where, ...(query.before ? { createdAt: { lt: query.before } } : {}) },
        include: { employee: { select: employeeSelect }, workShift: { select: workShiftSelect } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.take + 1,
      }),
      prisma.shiftAlert.count({ where }),
    ]);
    return { items, total };
  },

  findById(id: string, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.shiftAlert.findFirst({
      where: { id, employee: employeeAccessWhere },
      include: { employee: { select: employeeSelect }, workShift: { select: workShiftSelect } },
    });
  },

  resolve(id: string, resolution: "RESUELTA" | "DESCARTADA", reason: string, userId: string) {
    return prisma.shiftAlert.update({
      where: { id },
      data: { status: resolution, resolutionNote: reason, resolvedAt: new Date(), resolvedByUserId: userId },
      include: { employee: { select: employeeSelect }, workShift: { select: workShiftSelect } },
    });
  },
};
