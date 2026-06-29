import type { Role, User } from "../../types";
import { apiRequest } from "./apiClient";

type BackendRole = "NIVEL_1_RRHH" | "NIVEL_2_SUPERVISION" | "NIVEL_3_CARGA_HORARIA";
type BackendStatus = "ACTIVO" | "INACTIVO";

interface BackendUser {
  id: string;
  name: string;
  email: string;
  role: BackendRole;
  status: BackendStatus;
  companyId?: string | null;
  sectorId?: string | null;
}

interface LoginResponse {
  user: BackendUser;
  accessToken: string;
  refreshToken: string;
}

const roleMap: Record<BackendRole, Role> = {
  NIVEL_1_RRHH: "Nivel 1 - RRHH",
  NIVEL_2_SUPERVISION: "Nivel 2 - Supervisión / Gestión",
  NIVEL_3_CARGA_HORARIA: "Nivel 3 - Administrativo de Carga Horaria",
};

function mapUser(user: BackendUser): User {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    password: "",
    role: roleMap[user.role],
    status: user.status === "ACTIVO" ? "Activo" : "Inactivo",
    company: user.companyId || undefined,
    sector: user.sectorId || undefined,
  };
}

export const demoCredentialsByRole: Record<Role, { email: string; password: string }> = {
  "Nivel 1 - RRHH": { email: "admin@losod.local", password: "Admin1234!" },
  "Nivel 2 - Supervisión / Gestión": { email: "supervisor@losod.local", password: "Admin1234!" },
  "Nivel 3 - Administrativo de Carga Horaria": { email: "carga@losod.local", password: "Admin1234!" },
};

export const authApiService = {
  async login(email: string, password: string) {
    const response = await apiRequest<LoginResponse>("/auth/login", {
      method: "POST",
      auth: false,
      body: { email, password },
    });
    return {
      user: mapUser(response.user),
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
    };
  },

  async me() {
    const response = await apiRequest<{ data: BackendUser }>("/auth/me");
    return mapUser(response.data);
  },
};
