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
  deletedAt: string | null;
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
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

// countsAsWorked deliberadamente ausente (Etapa 8N): no se envía en absoluto
// desde el frontend, ni hardcodeado a true ni tomado de item (ya no existe
// en HourConcept). Si se enviara siempre true, cada edición pisaría en
// silencio cualquier valor real que tuviera el concepto en la base. Al
// omitir la clave, el backend usa su propio default en create (ver
// createHourConceptSchema) y no toca el valor existente en update
// (updateHourConceptSchema es un .partial()).
export function mapToApi(item: HourConcept) {
  return {
    code: item.code,
    name: item.name,
    kind: item.kind,
    status: item.status,
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

// Etapa 8N/8O: extraídas como funciones puras (mismo criterio que
// buildRulesByConceptPath en hourConceptRuleApiService.ts) para poder
// confirmar el endpoint real sin mockear la red.
export function buildHourConceptPath(hourConceptId: string) {
  return `/hour-concepts/${hourConceptId}`;
}

// Etapa 8P: force=true es la eliminación forzada (con uso histórico) — la
// pantalla solo lo pasa después de una segunda confirmación explícita, tras
// que el primer intento (sin force) respondió 409 HOUR_CONCEPT_IN_USE.
export function buildHourConceptRemovePath(hourConceptId: string, force?: boolean) {
  return force ? `${buildHourConceptPath(hourConceptId)}?force=true` : buildHourConceptPath(hourConceptId);
}

export function buildHourConceptEmployeesPath(hourConceptId: string) {
  return `/hour-concepts/${hourConceptId}/employees`;
}

export function buildHourConceptEmployeePath(hourConceptId: string, employeeId: string) {
  return `/hour-concepts/${hourConceptId}/employees/${employeeId}`;
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
    const response = await apiRequest<ApiItemResponse>(buildHourConceptPath(id), {
      method: "PATCH",
      body: mapToApi(item),
    });
    await invalidateCacheFamily("hour-concepts", "hour concept updated");
    return mapHourConceptFromApi(response.data);
  },

  // Etapa 8O: PATCH minimo (solo status) — a diferencia de update (que
  // reenvia mapToApi(item) completo), esto evita pisar name/kind/code con un
  // valor de item potencialmente desactualizado en el cliente al solo
  // habilitar/deshabilitar desde la tabla.
  async updateStatus(id: string, status: HourConcept["status"]) {
    const response = await apiRequest<ApiItemResponse>(buildHourConceptPath(id), {
      method: "PATCH",
      body: { status },
    });
    await invalidateCacheFamily("hour-concepts", "hour concept status updated");
    return mapHourConceptFromApi(response.data);
  },

  // Eliminación (Etapa 8O/8P): sin uso histórico, delete físico directo. Con
  // uso y force ausente/false, el backend responde 409 HOUR_CONCEPT_IN_USE —
  // este método no lo atrapa, lo deja propagarse (la pantalla lo usa para
  // decidir si debe volver a confirmar con force:true). Con force:true y uso
  // real, el backend hace baja lógica (nunca delete físico ahí).
  async remove(id: string, options?: { force?: boolean }) {
    await apiRequest<{ data: unknown }>(buildHourConceptRemovePath(id, options?.force), { method: "DELETE" });
    await invalidateCacheFamily("hour-concepts", "hour concept deleted");
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

  // Habilitar/quitar empleados desde el propio concepto (Etapa 8N) —
  // POST/DELETE /hour-concepts/:id/employees[/:employeeId], mismo criterio
  // de escritura que shiftAssignmentApiService.assign/remove.
  async enableEmployees(hourConceptId: string, employeeIds: string[]) {
    await apiRequest<{ data: unknown }>(buildHourConceptEmployeesPath(hourConceptId), { method: "POST", body: { employeeIds } });
  },

  async disableEmployee(hourConceptId: string, employeeId: string) {
    await apiRequest<{ data: unknown }>(buildHourConceptEmployeePath(hourConceptId, employeeId), { method: "DELETE" });
  },
};
