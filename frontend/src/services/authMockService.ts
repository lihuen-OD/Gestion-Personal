import type { Role, User } from "../types";
import { readStore } from "./storage";

const roleEmail: Record<Role, string> = {
  "Nivel 1 - RRHH": "rrhh@demo.com", "Nivel 2 - Supervisión / Gestión": "supervision@demo.com", "Nivel 3 - Administrativo de Carga Horaria": "carga@demo.com",
};
export const authMockService = {
  login: (email: string, password: string) => readStore<User>("users").find((u) => u.email === email && u.password === password && u.status === "Activo"),
  loginAsRole: (role: Role) => readStore<User>("users").find((u) => u.email === roleEmail[role])!,
};
