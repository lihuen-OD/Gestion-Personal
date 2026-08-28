import { apiRequest } from "./apiClient";
import { cachePolicies, cachedData, invalidateCacheFamily } from "../cache";
import { associatedEmployeesQuery, mapAssociatedEmployeeFromApi, type ApiAssociatedEmployee } from "./associatedEmployeeMapper";
import type {
  EmployeeWorkRegimeAssignment,
  OpenShiftOverflowAction,
  WorkRegime,
  WorkRegimeFilters,
  WorkRegimeKind,
  WorkRegimeStatus,
} from "../../types/workRegime.types";
import type { AssociatedEmployeeFilters, AssociatedEmployeesResult, WorkRegimeEmployeeAssociation, WorkRegimeEmployeesStatusFilter } from "../../types/associatedEmployee.types";

type ApiWorkRegime = {
  id: string;
  code: string;
  name: string;
  kind: WorkRegimeKind;
  alertOnOutOfShift: boolean;
  openShiftOverflowAction: OpenShiftOverflowAction;
  extendedShiftAlertMinutes?: number | null;
  description?: string | null;
  status: WorkRegimeStatus;
  createdAt: string;
  updatedAt: string;
};

type ApiEmployeeWorkRegimeAssignment = {
  id: string;
  employeeId: string;
  workRegimeId: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  assignedByUserId?: string | null;
  createdAt: string;
  workRegime: ApiWorkRegime;
};

type ApiListMeta = { total: number; page: number; pageSize: number; hasMore: boolean };
type ApiItemResponse = { data: ApiWorkRegime };
type ApiPaginatedResponse = { data: ApiWorkRegime[]; meta: ApiListMeta };
type ApiAssignmentItemResponse = { data: ApiEmployeeWorkRegimeAssignment };
type ApiAssignmentItemOrNullResponse = { data: ApiEmployeeWorkRegimeAssignment | null };
type ApiAssignmentListResponse = { data: ApiEmployeeWorkRegimeAssignment[] };

export function mapWorkRegimeFromApi(item: ApiWorkRegime): WorkRegime {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    kind: item.kind,
    alertOnOutOfShift: item.alertOnOutOfShift,
    openShiftOverflowAction: item.openShiftOverflowAction,
    extendedShiftAlertMinutes: item.extendedShiftAlertMinutes ?? null,
    description: item.description ?? null,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

// Etapa 10D: el backend guarda/valida extendedShiftAlertMinutes en minutos
// (consistencia con ShiftTemplate y con totalMinutes, que es lo que compara
// la lógica de negocio) — la UI lo edita en horas enteras, más natural para
// RRHH que pensar en minutos. La conversión vive acá para no duplicarla si
// otro componente además de WorkRegimesPage necesita mostrarla/editarla.
export function extendedShiftAlertMinutesToHours(minutes: number | null): number | "" {
  return minutes === null ? "" : Math.round(minutes / 60);
}

export function extendedShiftAlertHoursToMinutes(hours: number | ""): number | null {
  return hours === "" ? null : Math.round(hours * 60);
}

type ApiWorkRegimeEmployeeAssociation = {
  id: string;
  employeeId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  vigencyStatus: "current" | "historical" | "future";
  employee: ApiAssociatedEmployee;
};
type ApiWorkRegimeEmployeesResponse = { data: ApiWorkRegimeEmployeeAssociation[]; meta: ApiListMeta };

export function mapWorkRegimeEmployeeAssociationFromApi(item: ApiWorkRegimeEmployeeAssociation): WorkRegimeEmployeeAssociation {
  return {
    id: item.id,
    employeeId: item.employeeId,
    effectiveFrom: item.effectiveFrom,
    effectiveTo: item.effectiveTo ?? null,
    vigencyStatus: item.vigencyStatus,
    employee: mapAssociatedEmployeeFromApi(item.employee),
  };
}

export function mapAssignmentFromApi(item: ApiEmployeeWorkRegimeAssignment): EmployeeWorkRegimeAssignment {
  return {
    id: item.id,
    employeeId: item.employeeId,
    workRegimeId: item.workRegimeId,
    effectiveFrom: item.effectiveFrom,
    effectiveTo: item.effectiveTo ?? null,
    assignedByUserId: item.assignedByUserId ?? null,
    createdAt: item.createdAt,
    workRegime: mapWorkRegimeFromApi(item.workRegime),
  };
}

export type WorkRegimeInput = Pick<WorkRegime, "code" | "name" | "kind" | "alertOnOutOfShift" | "openShiftOverflowAction" | "extendedShiftAlertMinutes" | "description" | "status">;

function mapToApi(item: WorkRegimeInput) {
  return {
    code: item.code,
    name: item.name,
    kind: item.kind,
    alertOnOutOfShift: item.alertOnOutOfShift,
    openShiftOverflowAction: item.openShiftOverflowAction,
    extendedShiftAlertMinutes: item.extendedShiftAlertMinutes,
    description: item.description || null,
    status: item.status,
  };
}

function toQuery(filters?: Partial<WorkRegimeFilters> & { page?: number; take?: number }) {
  const params = new URLSearchParams();
  params.set("page", String(filters?.page || 1));
  params.set("take", String(filters?.take || 200));
  if (filters?.search?.trim()) params.set("search", filters.search.trim());
  if (filters?.kind) params.set("kind", filters.kind);
  if (filters?.status) params.set("status", filters.status);
  return `?${params.toString()}`;
}

function isWorkRegimeList(value: WorkRegime[]) {
  return Array.isArray(value) && value.every((item) => typeof item.id === "string" && typeof item.code === "string" && typeof item.name === "string");
}

export const workRegimeApiService = {
  async getAll(filters?: Partial<WorkRegimeFilters> & { page?: number; take?: number }) {
    const path = `/work-regimes${toQuery(filters)}`;
    return cachedData({
      requestKey: `GET:${path}`,
      policy: cachePolicies.workRegimesCatalog,
      fetcher: () => apiRequest<ApiPaginatedResponse>(path, { apiCache: false }).then((response) => ({
        items: response.data.map(mapWorkRegimeFromApi),
        meta: response.meta,
      })),
      validate: (value) => isWorkRegimeList(value.items),
    });
  },

  async getById(id: string) {
    const response = await apiRequest<ApiItemResponse>(`/work-regimes/${id}`);
    return mapWorkRegimeFromApi(response.data);
  },

  async create(item: WorkRegimeInput) {
    const response = await apiRequest<ApiItemResponse>("/work-regimes", { method: "POST", body: mapToApi(item) });
    await invalidateCacheFamily("work-regimes", "work regime created");
    return mapWorkRegimeFromApi(response.data);
  },

  async update(id: string, item: WorkRegimeInput) {
    const response = await apiRequest<ApiItemResponse>(`/work-regimes/${id}`, { method: "PATCH", body: mapToApi(item) });
    await invalidateCacheFamily("work-regimes", "work regime updated");
    return mapWorkRegimeFromApi(response.data);
  },

  async updateStatus(id: string, status: WorkRegimeStatus) {
    const response = await apiRequest<ApiItemResponse>(`/work-regimes/${id}/status`, { method: "PATCH", body: { status } });
    await invalidateCacheFamily("work-regimes", "work regime status updated");
    return mapWorkRegimeFromApi(response.data);
  },

  async getAssignmentHistory(employeeId: string) {
    const response = await apiRequest<ApiAssignmentListResponse>(`/employees/${employeeId}/work-regimes`, { apiCache: false });
    return response.data.map(mapAssignmentFromApi);
  },

  async getCurrentAssignment(employeeId: string, date?: string) {
    const query = date ? `?date=${encodeURIComponent(date)}` : "";
    const response = await apiRequest<ApiAssignmentItemOrNullResponse>(`/employees/${employeeId}/work-regimes/current${query}`, { apiCache: false });
    return response.data ? mapAssignmentFromApi(response.data) : null;
  },

  async assign(employeeId: string, input: { workRegimeId: string; effectiveFrom: string; effectiveTo?: string | null }) {
    const response = await apiRequest<ApiAssignmentItemResponse>(`/employees/${employeeId}/work-regimes`, { method: "POST", body: input });
    return mapAssignmentFromApi(response.data);
  },

  async updateAssignment(employeeId: string, assignmentId: string, input: { workRegimeId?: string; effectiveFrom?: string; effectiveTo?: string | null }) {
    const response = await apiRequest<ApiAssignmentItemResponse>(`/employees/${employeeId}/work-regimes/${assignmentId}`, { method: "PATCH", body: input });
    return mapAssignmentFromApi(response.data);
  },

  async closeAssignment(employeeId: string, assignmentId: string, effectiveTo: string) {
    const response = await apiRequest<ApiAssignmentItemResponse>(`/employees/${employeeId}/work-regimes/${assignmentId}/close`, { method: "PATCH", body: { effectiveTo } });
    return mapAssignmentFromApi(response.data);
  },

  // Empleados asociados al régimen, vistos desde el régimen (Etapa 8G) — sin
  // cachedData, mismo criterio que el resto de los métodos de relación de
  // este servicio (getAssignmentHistory/getCurrentAssignment), que tampoco
  // cachean.
  async getWorkRegimeEmployees(
    workRegimeId: string,
    filters?: AssociatedEmployeeFilters & { status?: WorkRegimeEmployeesStatusFilter; date?: string },
  ): Promise<AssociatedEmployeesResult<WorkRegimeEmployeeAssociation>> {
    const query = associatedEmployeesQuery(filters, { status: filters?.status, date: filters?.date });
    const response = await apiRequest<ApiWorkRegimeEmployeesResponse>(`/work-regimes/${workRegimeId}/employees${query}`, { apiCache: false });
    return { items: response.data.map(mapWorkRegimeEmployeeAssociationFromApi), meta: response.meta };
  },
};
