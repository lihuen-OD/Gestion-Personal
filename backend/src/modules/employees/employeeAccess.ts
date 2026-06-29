import type { Prisma } from "@prisma/client";
import type { Express } from "express";
import { roles } from "../../shared/security/roles";

export function employeeAccessWhere(user: Express.AuthUser): Prisma.EmployeeWhereInput {
  if (user.role === roles.rrhh) return {};

  if (user.role === roles.supervision) {
    return user.sectorId ? { sectorId: user.sectorId } : { id: "__NO_ACCESS__" };
  }

  if (user.role === roles.cargaHoraria) {
    return {
      assignments: {
        some: {
          type: "TIME_RESPONSIBLE",
          userId: user.id,
        },
      },
    };
  }

  return { id: "__NO_ACCESS__" };
}
