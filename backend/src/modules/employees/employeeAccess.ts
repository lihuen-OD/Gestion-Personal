import type { Prisma } from "@prisma/client";
import type { Express } from "express";
import { roles } from "../../shared/security/roles";
import { argentinaCalendarDate, todayArgentinaDateKey } from "../../shared/datetime/argentinaTime";

export function employeeAccessWhere(user: Express.AuthUser, reference: Date = new Date()): Prisma.EmployeeWhereInput {
  if (user.role === roles.rrhh) return {};

  if (user.role === roles.supervision || user.role === roles.cargaHoraria) {
    const today = argentinaCalendarDate(todayArgentinaDateKey(reference));
    return {
      assignments: {
        some: {
          type: "TIME_RESPONSIBLE",
          userId: user.id,
          AND: [
            { OR: [{ status: null }, { status: "ACTIVO" }, { status: "Activo" }] },
            { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: today } }] },
            { OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] },
          ],
        },
      },
    };
  }

  return { id: "__NO_ACCESS__" };
}
