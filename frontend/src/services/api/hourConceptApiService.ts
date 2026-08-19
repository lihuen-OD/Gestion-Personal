import { apiRequest } from "./apiClient";
import { cachePolicies, cachedData, invalidateCacheFamily } from "../cache";
import { associatedEmployeesQuery, mapAssociatedEmployeeFromApi, type ApiAssociatedEmployee } from "./associatedEmployeeMapper";
import type { HourConcept, HourConceptFilters, HourConceptKind, HourConceptStatus } from "../../types/hourConcept.types";
import type { AssociatedEmployeeFilters, AssociatedEmployeeStatus, AssociatedEmployeesResult, HourConceptEmployeeAssociation } from "../../types/associatedEmployee.types";

type ApiHourConcept = {
  id: string;
  code: string;
  name: string;
  kind: HourConceptKind;
  status: HourConceptStatus;
  countsAsWorked: boolean;
  createdAt: string;
  updatedAt: string;
};

type ApiListResponse = { data: ApiHourConcept[] };
type ApiItemResponse = { data: ApiHourConcept };
type ApiListMeta = { total: number; page: number; pageSize: number; hasMore: boolean };

type ApiHourConceptEmployeeAssociation = { employeeId: string; employee: ApiAssociatedEmployee };
type ApiHourConceptEmployeesResponse = { data: ApiHourConceptEmployeeAssociation[]; meta: ApiListMeta };

export function mapHourConceptEmployeeAssociationFromApi(item: ApiHourConceptEmployeeAssociation): HourConceptEmployeeAssociation {
  return {
    employeeId: item.employeeId,
    employee: mapAssociatedEmployeeFromApi(item.employee),
  };
}

export function mapHourConceptFromApi(item: ApiHourConcept): HourConcept {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    kind: item.kind,
    description: item.name,
    status: item.status,
    rules: { defaultUnit: "HORAS" },
    allowedLoadRoles: ["Nivel 1 - RRHH", "Nivel 3 - Administrativo de Carga Horaria"],
    approvalRoles: ["Nivel 1 - RRHH"],
    finnegansLinks: [],
    notes: "",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    createdBy: "Sistema",
    updatedBy: "Sistema",
    history: [],
  };
}

function mapToApi(item: HourConcept) {
  return {
    code: item.code,
    name: item.name,
    kind: item.kind,
    status: item.status,
    countsAsWorked: true,
  };
}

function toQuery(filters?: Partial<HourConceptFilters>) {
  const params = new URLSearchParams();
  params.set("take", "200");
  if (filters?.search?.trim()) params.set("search", filters.search.trim());
  if (filters?.kind) params.set("kind", filters.kind);
  if (filters?.status) params.set("status", filters.status);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function nextCode(items: HourConcept[]) {
  const max = items.reduce((value, item) => Math.max(value, Number(item.code.replace(/\D/g, "")) || 0), 0);
  return `HOR-${String(max + 1).padStart(3, "0")}`;
}

function isHourConceptList(value: HourConcept[]) {
  return Array.isArray(value) && value.every((item) => typeof item.id === "string" && typeof item.code === "string" && typeof item.name === "string");
}

export const hourConceptApiService = {
  async getAll(filters?: Partial<HourConceptFilters>) {
    const query = toQuery(filters);
    const key = `/hour-concepts${query}`;
    return cachedData({
      requestKey: `GET:${key}`,
      policy: cachePolicies.hourConceptsCatalog,
      fetcher: () => apiRequest<ApiListResponse>(key, { apiCache: false }).then((response) => response.data.map(mapHourConceptFromApi)),
      validate: isHourConceptList,
    });
  },

  async create(item: HourConcept) {
    const response = await apiRequest<ApiItemResponse>("/hour-concepts", {
      method: "POST",
      body: mapToApi(item),
    });
    await invalidateCacheFamily("hour-concepts", "hour concept created");
    return mapHourConceptFromApi(response.data);
  },

  async update(id: string, item: HourConcept) {
    const response = await apiRequest<ApiItemResponse>(`/hour-concepts/${id}`, {
      method: "PATCH",
      body: mapToApi(item),
    });
    await invalidateCacheFamily("hour-concepts", "hour concept updated");
    return mapHourConceptFromApi(response.data);
  },

  getNextCode: nextCode,

  // Empleados habilitados para el concepto, vistos desde el concepto (Etapa
  // 8G) — sin cachedData, mismo criterio que el resto de los métodos de
  // relación de estos servicios (ver workRegimeApiService.getWorkRegimeEmployees).
  async getHourConceptEmployees(
    hourConceptId: string,
    filters?: AssociatedEmployeeFilters & { status?: AssociatedEmployeeStatus },
  ): Promise<AssociatedEmployeesResult<HourConceptEmployeeAssociation>> {
    const query = associatedEmployeesQuery(filters, { status: filters?.status });
    const response = await apiRequest<ApiHourConceptEmployeesResponse>(`/hour-concepts/${hourConceptId}/employees${query}`, { apiCache: false });
    return { items: response.data.map(mapHourConceptEmployeeAssociationFromApi), meta: response.meta };
  },
};
