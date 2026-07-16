import type { Prisma } from "@prisma/client";
import type { Express } from "express";
import { roles } from "../../shared/security/roles";

export function employeeAccessWhere(user: Express.AuthUser): Prisma.EmployeeWhereInput {
  if (user.role === roles.rrhh) return {};

  if (user.role === roles.supervision || user.role === roles.cargaHoraria) {
    const now = new Date();
    return {
      assignments: {
        some: {
          type: "TIME_RESPONSIBLE",
          userId: user.id,
          AND: [
            { OR: [{ status: null }, { status: "ACTIVO" }, { status: "Activo" }] },
            { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
            { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
          ],
        },
      },
    };
  }

  return { id: "__NO_ACCESS__" };
}
