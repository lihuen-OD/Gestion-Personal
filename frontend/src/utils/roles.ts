import type { Role } from "../types";

export function roleLevel(role: Role | string) {
  return role.startsWith("Nivel 1") ? 1 : role.startsWith("Nivel 2") ? 2 : 3;
}

export const roleOptions: Role[] = [
  "Nivel 1 - RRHH",
  "Nivel 2 - Supervisión / Gestión",
  "Nivel 3 - Administrativo de Carga Horaria",
];
