import { apiRequest } from "./apiClient";
import { collectAllPages } from "./listQuery";
import { cachePolicies, cachedData, invalidateCacheFamily, WORKED_TIME_DERIVED_CACHE_FAMILIES, type CacheFamily } from "../cache";
import { associatedEmployeesQuery, mapAssociatedEmployeeFromApi, type ApiAssociatedEmployee } from "./associatedEmployeeMapper";
import type { HourConcept, HourConceptDeletionSummary, HourConceptFilters, HourConceptKind, HourConceptLoadMode, HourConceptStatus, HourConceptSystemRole, HourConceptWorkTreatment } from "../../types/hourConcept.types";
import type { AssociatedEmployeeFilters, AssociatedEmployeeStatus, AssociatedEmployeesResult, HourConceptEmployeeAssociation } from "../../types/associatedEmployee.types";

type ApiHourConcept = {
  id: string;
  code: string;
  name: string;
  kind: HourConceptKind;
  status: HourConceptStatus;
  loadMode: HourConceptLoadMode | null;
  systemRole: HourConceptSystemRole | null;
  workTreatment?: HourConceptWorkTreatment | null;
  countsAsWorked?: boolean;
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
    loadMode: item.loadMode,
    systemRole: item.systemRole,
    workTreatment: item.workTreatment ?? null,
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
    loadMode: item.loadMode,
    // Obligatorio para todo concepto adicional. RRHH puede corregirlo aunque
    // el concepto tenga horas: el backend reinterpreta la historia completa.
    ...(item.workTreatment ? { workTreatment: item.workTreatment } : {}),
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

// Etapa 8N/8O: extraídas como funciones puras (mismo criterio que
// buildRulesByConceptPath en hourConceptRuleApiService.ts) para poder
// confirmar el endpoint real sin mockear la red.
export function buildHourConceptPath(hourConceptId: string) {
  return `/hour-concepts/${hourConceptId}`;
}

export function buildHourConceptEmployeesPath(hourConceptId: string) {
  return `/hour-concepts/${hourConceptId}/employees`;
}

export function buildHourConceptEmployeePath(hourConceptId: string, employeeId: string) {
  return `/hour-concepts/${hourConceptId}/employees/${employeeId}`;
}

// Editar o eliminar un concepto cambia lo que muestran todas las pantallas
// que lo unen con sus horas — sobre todo workTreatment, que reinterpreta la
// historia completa (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §12):
// Legajo y grilla por legajo ("employees"), Carga de horas y Por persona
// ("time-entries"), Bandeja ("pending"), dashboard, cierres y novedades
// (al eliminar se desvincula su concepto destino). Mismo alcance que
// hourConcepts.controller.ts::clearHourConceptDependentReadCaches.
export const HOUR_CONCEPT_DEPENDENT_CACHE_FAMILIES: readonly CacheFamily[] = [
  "hour-concepts",
  ...WORKED_TIME_DERIVED_CACHE_FAMILIES,
  "novelties",
];

async function invalidateHourConceptDependentCaches(reason: string) {
  await Promise.all(HOUR_CONCEPT_DEPENDENT_CACHE_FAMILIES.map((family) => invalidateCacheFamily(family, reason)));
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
      fetcher: () => collectAllPages(key, (path) => apiRequest<ApiListResponse>(path, { apiCache: false })).then((rows) => rows.map(mapHourConceptFromApi)),
      validate: isHourConceptList,
    });
  },

  async getNextCode() {
    const response = await apiRequest<{ data: { code: string } }>("/hour-concepts/next-code", { apiCache: false });
    return response.data.code;
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
    await invalidateHourConceptDependentCaches("hour concept updated");
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
    await invalidateHourConceptDependentCaches("hour concept status updated");
    return mapHourConceptFromApi(response.data);
  },

  // Eliminación definitiva: un solo DELETE borra el concepto y su historial
  // específico (desgloses, reglas, habilitaciones) y conserva fichadas y
  // jornadas. Para conservar la historia se deshabilita (updateStatus).
  async remove(id: string) {
    const response = await apiRequest<{ data: HourConceptDeletionSummary }>(buildHourConceptPath(id), { method: "DELETE" });
    await invalidateHourConceptDependentCaches("hour concept deleted");
    return response.data;
  },

  // Empleados habilitados para el concepto, vistos desde el concepto (Etapa
  // 8G; dedupe/cache agregado en 14H.5) — envuelto con `cachedData` (misma
  // familia "hour-concepts" que hourConceptsCatalog) para colapsar el
  // doble-montaje de StrictMode que dispara AssociatedEmployeesPanel
  // (embedded) al abrir "Editar" en un concepto existente.
  async getHourConceptEmployees(
    hourConceptId: string,
    filters?: AssociatedEmployeeFilters & { status?: AssociatedEmployeeStatus },
  ): Promise<AssociatedEmployeesResult<HourConceptEmployeeAssociation>> {
    const query = associatedEmployeesQuery(filters, { status: filters?.status });
    const path = `/hour-concepts/${hourConceptId}/employees${query}`;
    return cachedData({
      requestKey: `GET:${path}`,
      policy: cachePolicies.hourConceptEmployeesList,
      fetcher: () =>
        apiRequest<ApiHourConceptEmployeesResponse>(path, { apiCache: false }).then((response) => ({
          items: response.data.map(mapHourConceptEmployeeAssociationFromApi),
          meta: response.meta,
        })),
      validate: (value) => Array.isArray(value.items),
    });
  },

  // Habilitar/quitar empleados desde el propio concepto (Etapa 8N) —
  // POST/DELETE /hour-concepts/:id/employees[/:employeeId], mismo criterio
  // de escritura que shiftAssignmentApiService.assign/remove. Invalidación
  // agregada en 14H.5 junto con el cache de getHourConceptEmployees de arriba.
  async enableEmployees(hourConceptId: string, employeeIds: string[]) {
    await apiRequest<{ data: unknown }>(buildHourConceptEmployeesPath(hourConceptId), { method: "POST", body: { employeeIds } });
    await invalidateCacheFamily("hour-concepts", "hour concept employees enabled");
  },

  async disableEmployee(hourConceptId: string, employeeId: string) {
    await apiRequest<{ data: unknown }>(buildHourConceptEmployeePath(hourConceptId, employeeId), { method: "DELETE" });
    await invalidateCacheFamily("hour-concepts", "hour concept employee disabled");
  },
};
