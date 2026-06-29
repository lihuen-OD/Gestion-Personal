import type { RoleName } from "@prisma/client";

export const roles = {
  rrhh: "NIVEL_1_RRHH",
  supervision: "NIVEL_2_SUPERVISION",
  cargaHoraria: "NIVEL_3_CARGA_HORARIA",
} as const satisfies Record<string, RoleName>;

export const adminRoles: RoleName[] = [roles.rrhh];
