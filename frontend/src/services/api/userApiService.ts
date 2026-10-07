import { apiRequest } from "./apiClient";
import { collectAllPages } from "./listQuery";
import { orgStructureApiService } from "./orgStructureApiService";
import type { Role, User } from "../../types";

type ApiRole = "NIVEL_1_RRHH" | "NIVEL_2_SUPERVISION" | "NIVEL_3_CARGA_HORARIA";
type ApiStatus = "ACTIVO" | "INACTIVO";

type ApiUser = {
  id: string;
  name: string;
  email: string;
  role: ApiRole;
  status: ApiStatus;
  companyId?: string | null;
  employeeId?: string | null;
  company?: { id: string; name: string; code: string } | null;
  employee?: { id: string; legajo: string; firstName: string; lastName: string } | null;
};

type ApiListResponse = { data: ApiUser[] };
type ApiItemResponse = { data: ApiUser };

const roleFromApi: Record<ApiRole, Role> = {
  NIVEL_1_RRHH: "Nivel 1 - RRHH",
  NIVEL_2_SUPERVISION: "Nivel 2 - Supervisión / Gestión",
  NIVEL_3_CARGA_HORARIA: "Nivel 3 - Administrativo de Carga Horaria",
};

const roleToApi: Record<Role, ApiRole> = {
  "Nivel 1 - RRHH": "NIVEL_1_RRHH",
  "Nivel 2 - Supervisión / Gestión": "NIVEL_2_SUPERVISION",
  "Nivel 3 - Administrativo de Carga Horaria": "NIVEL_3_CARGA_HORARIA",
};

function statusFromApi(status: ApiStatus): User["status"] {
  return status === "INACTIVO" ? "Inactivo" : "Activo";
}

function statusToApi(status: User["status"]): ApiStatus {
  return status === "Inactivo" ? "INACTIVO" : "ACTIVO";
}

function mapFromApi(item: ApiUser): User {
  return {
    id: item.id,
    name: item.name,
    email: item.email,
    password: "",
    role: roleFromApi[item.role],
    status: statusFromApi(item.status),
    company: item.company?.name || "",
    sector: "",
    employeeId: item.employeeId || item.employee?.id || "",
    employeeName: item.employee ? `${item.employee.firstName} ${item.employee.lastName}` : "",
  };
}

async function resolveScope(user: Omit<User, "id"> | User) {
  const catalog = await orgStructureApiService.getCatalog().catch(() => null);
  return {
    companyId: user.company ? catalog?.companies.find((item) => item.name === user.company)?.id || null : null,
  };
}

export const userApiService = {
  // Listado completo explícito: la pantalla de Usuarios y la resolución de
  // responsables por nombre (employeeApiService) necesitan todos los usuarios;
  // antes GET /users sin take cortaba en silencio en el default 100.
  async getAll() {
    const rows = await collectAllPages("/users?take=200", (path) => apiRequest<ApiListResponse>(path));
    return rows.map(mapFromApi);
  },

  async getById(id: string) {
    const response = await apiRequest<ApiItemResponse>(`/users/${id}`);
    return mapFromApi(response.data);
  },

  async create(user: Omit<User, "id">) {
    const scope = await resolveScope(user);
    const response = await apiRequest<ApiItemResponse>("/users", {
      method: "POST",
      body: {
        name: user.name,
        email: user.email,
        password: user.password,
        role: roleToApi[user.role],
        status: statusToApi(user.status),
        companyId: scope.companyId,
        employeeId: user.employeeId || null,
      },
    });
    return mapFromApi(response.data);
  },

  async update(user: User) {
    const scope = await resolveScope(user);
    const response = await apiRequest<ApiItemResponse>(`/users/${user.id}`, {
      method: "PATCH",
      body: {
        name: user.name,
        email: user.email,
        role: roleToApi[user.role],
        status: statusToApi(user.status),
        companyId: scope.companyId,
        employeeId: user.employeeId || null,
      },
    });
    return mapFromApi(response.data);
  },

  async resetPassword(id: string, password: string) {
    const response = await apiRequest<ApiItemResponse>(`/users/${id}/reset-password`, {
      method: "POST",
      body: { password },
    });
    return mapFromApi(response.data);
  },
};
