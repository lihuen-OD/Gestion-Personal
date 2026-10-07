import { apiRequest } from "./apiClient";
import { appendSortParams, collectAllPages, type ListMeta } from "./listQuery";
import type { SortState } from "../../utils/sort";
import { cachePolicies, cachedData, invalidateCacheFamily } from "../cache";
import type { Employee } from "../../types";
import type { Position, PositionFilters, PositionStatus } from "../../types/position.types";

type ApiSectorChain = {
  id: string;
  name: string;
  area?: {
    id: string;
    name: string;
    establishment?: {
      id: string;
      name: string;
      businessUnit?: { id: string; name: string } | null;
      company?: { id: string; name: string } | null;
    } | null;
  } | null;
};

type ApiPosition = {
  id: string;
  code: string;
  name: string;
  status: PositionStatus;
  mission?: string | null;
  description?: string | null;
  lastUpdatedAt?: string | null;
  responsibilities?: unknown;
  internalRelations?: unknown;
  externalRelations?: unknown;
  competencies?: unknown;
  workConditions?: unknown;
  performanceIndicators?: unknown;
  evaluationCriteria?: unknown;
  sectorId?: string | null;
  sector?: ApiSectorChain | null;
  orgScopes?: Array<{
    id: string;
    level: "COMPANY" | "BUSINESS_UNIT" | "SECTOR" | "AREA";
    companyId?: string | null; businessUnitId?: string | null; sectorId?: string | null; areaId?: string | null;
    company?: { id: string; code: string; name: string; status: PositionStatus } | null;
    businessUnit?: { id: string; code: string; name: string; status: PositionStatus } | null;
    sector?: { id: string; code: string; name: string; status: PositionStatus } | null;
    area?: { id: string; code: string; name: string; status: PositionStatus } | null;
  }>;
  salaryCategories?: Array<{ salaryCategory: { id: string; name: string; order: number } }>;
  createdAt: string;
  updatedAt: string;
  _count?: { employees?: number };
};

type ApiListResponse = { data: ApiPosition[] };
type ApiPaginatedListResponse = { data: ApiPosition[]; meta: { total: number; page: number; pageSize: number; hasMore: boolean } };
type ApiItemResponse = { data: ApiPosition | null };

type ApiAssignedEmployee = {
  id: string;
  legajo: string;
  legajoFinnegans?: string | null;
  cuil?: string | null;
  dni?: string | null;
  firstName: string;
  lastName: string;
  status: "ACTIVO" | "INACTIVO";
  receiptCategory?: string | null;
  internalCategory?: string | null;
  position?: { id: string; name: string; code?: string | null } | null;
  sector?: { id: string; name: string } | null;
  costCenter?: { id: string; name: string } | null;
  companies?: { isPrimary: boolean; company: { id: string; name: string } }[];
};

type ApiAssignedEmployeesResponse = { data: ApiAssignedEmployee[]; meta: ListMeta };
export type AssignedEmployeeSortKey = "legajo" | "employee";

const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

function mapFromApi(item: ApiPosition): Position {
  const salaryCategories = [...(item.salaryCategories || [])]
    .map((link) => link.salaryCategory)
    .sort((a, b) => a.order - b.order);
  const orgScopes = (item.orgScopes || []).map((scope) => {
    const node = scope.company || scope.businessUnit || scope.sector || scope.area;
    return { id: scope.id, level: scope.level, nodeId: node?.id || scope.companyId || scope.businessUnitId || scope.sectorId || scope.areaId || "", code: node?.code, name: node?.name || "Nodo no disponible", status: node?.status };
  });
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    assignedCount: item._count?.employees || 0,
    lastUpdatedAt: item.lastUpdatedAt ? item.lastUpdatedAt.slice(0, 10) : item.updatedAt.slice(0, 10),
    status: item.status,
    sectorId: item.sectorId || undefined,
    orgScopes,
    pendingScopeReload: orgScopes.length === 0 && Boolean(item.sectorId),
    derivedSectorName: item.sector?.name || "",
    derivedAreaId: item.sector?.area?.id || undefined,
    derivedAreaName: item.sector?.area?.name || "",
    derivedEstablishmentId: item.sector?.area?.establishment?.id || undefined,
    derivedEstablishmentName: item.sector?.area?.establishment?.name || "",
    derivedBusinessUnitId: item.sector?.area?.establishment?.businessUnit?.id || undefined,
    derivedBusinessUnitName: item.sector?.area?.establishment?.businessUnit?.name || "",
    derivedCompanyId: item.sector?.area?.establishment?.company?.id || undefined,
    derivedCompanyName: item.sector?.area?.establishment?.company?.name || "",
    salaryCategoryIds: salaryCategories.map((category) => category.id),
    salaryCategoryNames: salaryCategories.map((category) => category.name),
    mission: item.mission || "",
    responsibilities: asArray(item.responsibilities),
    internalRelations: asArray(item.internalRelations),
    externalRelations: asArray(item.externalRelations),
    competencies: asArray(item.competencies),
    workConditions: (item.workConditions && typeof item.workConditions === "object" ? item.workConditions : { modality: "PRESENCIAL", workload: "", workplace: "", relationType: "", observations: "" }) as Position["workConditions"],
    performanceIndicators: asArray(item.performanceIndicators),
    evaluationCriteria: asArray(item.evaluationCriteria),
    history: [],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    createdBy: "Sistema",
    updatedBy: "Sistema",
  };
}

function mapAssignedEmployee(item: ApiAssignedEmployee): Employee {
  const companyNames = item.companies?.map((companyLink) => companyLink.company.name).filter(Boolean) || [];
  const primaryCompany = item.companies?.find((companyLink) => companyLink.isPrimary)?.company.name || companyNames[0] || "";
  return {
    id: item.id,
    legajo: item.legajo,
    legajoInterno: item.legajo,
    legajoFinnegans: item.legajoFinnegans || "",
    cuil: item.cuil || "",
    dni: item.dni || "",
    firstName: item.firstName,
    lastName: item.lastName,
    company: primaryCompany,
    companies: companyNames,
    costCenter: item.costCenter?.name || "",
    sector: item.sector?.name || "",
    internalCategory: item.internalCategory || "",
    receiptCategory: item.receiptCategory || "",
    position: item.position?.name || "",
    positionId: item.position?.id || "",
    puestoId: item.position?.id || "",
    puestoNombre: item.position?.name || "",
    status: item.status === "INACTIVO" ? "Inactivo" : "Activo",
  } as Employee;
}

function mapToApi(position: Position) {
  return {
    code: position.code || "",
    name: position.name,
    status: position.status,
    mission: position.mission || null,
    lastUpdatedAt: position.lastUpdatedAt || null,
    // Los puestos anteriores sin alcances se pueden editar sin convertirlos:
    // omitir evita escribir [] y preserva sectorId hasta su recarga manual.
    ...(!position.orgScopes?.length && position.pendingScopeReload ? {} : { orgScopes: (position.orgScopes || []).map(({ level, nodeId }) => ({ level, nodeId })) }),
    // Fuente oficial de categoria salarial: relacion real PositionSalaryCategory.
    salaryCategoryIds: position.salaryCategoryIds || [],
    responsibilities: position.responsibilities || [],
    internalRelations: position.internalRelations || [],
    externalRelations: position.externalRelations || [],
    competencies: position.competencies || [],
    workConditions: position.workConditions,
    performanceIndicators: position.performanceIndicators || [],
    evaluationCriteria: position.evaluationCriteria || [],
  };
}

function toQuery(filters?: Partial<PositionFilters>) {
  const params = new URLSearchParams();
  params.set("take", "300");
  if (filters?.search?.trim()) params.set("search", filters.search.trim());
  if (filters?.status) params.set("status", filters.status);
  // A5: filtro organizacional explícito; ubicaciones no forman parte del puesto.
  if (filters?.scopeNodeId && filters.scopeLevel) {
    params.set("scopeLevel", filters.scopeLevel);
    params.set("scopeNodeId", filters.scopeNodeId);
    params.set("scopeMode", filters.scopeMode || "WITHIN");
  }
  if (filters?.salaryRangeCategory) params.set("salaryRangeCategory", filters.salaryRangeCategory);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function nextCode(items: Position[]) {
  const max = items.reduce((value, item) => {
    const match = String(item.code || "").match(/(\d+)$/);
    return Math.max(value, match ? Number(match[1]) : 0);
  }, 0);
  return `PUE-${String(max + 1).padStart(3, "0")}`;
}

function isPosition(value: Position | undefined): value is Position {
  return Boolean(value && typeof value.id === "string" && typeof value.code === "string" && typeof value.name === "string");
}

function isPositionDetail(value: Position | undefined) {
  return value === undefined || isPosition(value);
}

function isPositionList(value: Position[]) {
  return Array.isArray(value) && value.every(isPosition);
}

function isPositionListResponse(value: { items: Position[]; meta?: unknown }) {
  return Boolean(value && Array.isArray(value.items) && value.items.every(isPosition));
}

// Query paginada del listado. El backend resuelve el modo de alcance sobre
// PositionOrgScope para que meta.total y la página sean correctos.
// Whitelist server-side de GET /positions (positions.schemas.ts::positionListSortKeys).
export type PositionListSortKey = "name" | "status";

function toListQuery(filters?: Partial<PositionFilters> & { page?: number; take?: number; sort?: SortState<PositionListSortKey> }) {
  const params = new URLSearchParams();
  params.set("page", String(filters?.page || 1));
  params.set("take", String(filters?.take || 25));
  if (filters?.search?.trim()) params.set("search", filters.search.trim());
  if (filters?.status) params.set("status", filters.status);
  if (filters?.scopeNodeId && filters.scopeLevel) {
    params.set("scopeLevel", filters.scopeLevel);
    params.set("scopeNodeId", filters.scopeNodeId);
    params.set("scopeMode", filters.scopeMode || "WITHIN");
  }
  if (filters?.salaryRangeCategory) params.set("salaryRangeCategory", filters.salaryRangeCategory);
  appendSortParams(params, filters?.sort);
  return `?${params.toString()}`;
}

export const positionApiService = {
  // Etapa 9E: paginación real para PuestosPage.tsx (page/take/meta, mismo
  // contrato que employeeApiService.list()/Pagination.tsx). getAll() abajo
  // sigue igual, sin tocar — lo siguen usando los selects/catálogos que
  // necesitan "todos los puestos activos" de una sola vez.
  async list(filters?: Partial<PositionFilters> & { page?: number; take?: number; sort?: SortState<PositionListSortKey> }) {
    const query = toListQuery(filters);
    const key = `/positions${query}`;
    return cachedData({
      requestKey: `GET:${key}`,
      policy: cachePolicies.positionsList,
      fetcher: () => apiRequest<ApiPaginatedListResponse>(key, { apiCache: false }).then((response) => ({
        items: response.data.map(mapFromApi),
        meta: response.meta,
      })),
      validate: isPositionListResponse,
    });
  },
  async getAll(filters?: Partial<PositionFilters>) {
    const query = toQuery(filters);
    const key = `/positions${query}`;
    return cachedData({
      requestKey: `GET:${key}`,
      policy: cachePolicies.positionsCatalog,
      // Catálogo completo (select de puestos activos de Horario laboral): se
      // recorren las páginas en vez de confiar en un único take de 300.
      fetcher: () => collectAllPages(key, (path) => apiRequest<ApiListResponse>(path, { apiCache: false })).then((rows) => rows.map(mapFromApi)),
      validate: isPositionList,
    });
  },
  // Etapa 14D.4: catálogo liviano para selects/catálogos de Legajos
  // (usePositions/useActivePositions en EmployeeLaborFields.tsx/
  // LaborTrackedFields.tsx, resolveRelations en employeeApiService.ts) —
  // mismo mapper (`mapFromApi`) y mismo `Position` de salida que `getAll()`,
  // sólo que el backend devuelve un select liviano (sin mission/
  // description/responsibilities/internalRelations/externalRelations/
  // competencies/workConditions/performanceIndicators/evaluationCriteria/
  // company/_count — ninguno de esos campos lo usa Legajos, ver
  // docs/decisions/POSITIONS_PERFORMANCE_FOR_EMPLOYEES_14D4.md).
  // Etapa 14H.7: `includeAssignedCount` (opt-in, default false) agrega
  // `_count.employees` al select — usado por PuestosPage.tsx (tarjetas de
  // resumen + opciones de rango salarial) y PuestoCreatePage.tsx (próximo
  // código), que antes llamaban `getAll()` (positionInclude completo) para
  // leer sólo `status`/`assignedCount`/`salaryCategoryNames`/`code`. Misma
  // policy/familia que `getAll()` — invalidación ya cubierta por
  // `invalidateCacheFamily("positions", ...)` en create/update/removeOrHide,
  // sin código nuevo. Ver docs/decisions/POSITIONS_MODULE_PERFORMANCE_14H7.md.
  async getOptions(params?: { includeAssignedCount?: boolean }) {
    const key = params?.includeAssignedCount ? "/positions/options?includeAssignedCount=true" : "/positions/options";
    return cachedData({
      requestKey: `GET:${key}`,
      policy: cachePolicies.positionsCatalog,
      fetcher: () => apiRequest<ApiListResponse>(key, { apiCache: false }).then((response) => response.data.map(mapFromApi)),
      validate: isPositionList,
    });
  },
  async getById(id: string) {
    return cachedData({
      requestKey: `GET:/positions/${id}`,
      policy: cachePolicies.positionsCatalog,
      fetcher: () => apiRequest<ApiItemResponse>(`/positions/${id}`, { apiCache: false }).then((response) => response.data ? mapFromApi(response.data) : undefined),
      validate: isPositionDetail,
    });
  },
  // Etapa 14H.7: envuelto en cachedData (antes era un apiRequest crudo sin
  // dedupe) — al pasar a depender sólo del `id` de la ruta (ver
  // PuestoDetailPage.tsx), esta llamada quedó expuesta al doble-montaje de
  // StrictMode (2 requests reales por apertura de detalle, confirmado en el
  // journey) — mismo hallazgo/mismo fix que workRegimeEmployeesList (14H.2).
  // Paginado server-side (antes: take 500 fijo sin meta). `meta.total` es la
  // cantidad real de personas asignadas — la usan el encabezado del puesto y
  // la confirmación de baja.
  async getAssignedEmployees(id: string, filters: { page?: number; take?: number; sort?: SortState<AssignedEmployeeSortKey> } = {}) {
    const params = new URLSearchParams();
    params.set("page", String(filters.page || 1));
    params.set("take", String(filters.take || 25));
    appendSortParams(params, filters.sort);
    const key = `/positions/${id}/employees?${params.toString()}`;
    return cachedData({
      requestKey: `GET:${key}`,
      policy: cachePolicies.positionsAssignedEmployees,
      fetcher: () => apiRequest<ApiAssignedEmployeesResponse>(key).then((response) => ({ items: response.data.map(mapAssignedEmployee), meta: response.meta })),
      validate: (value: { items: unknown }) => Array.isArray(value.items),
    });
  },
  async create(position: Position) {
    const response = await apiRequest<ApiItemResponse>("/positions", { method: "POST", body: mapToApi(position) });
    await invalidateCacheFamily("positions", "position created");
    return response.data ? mapFromApi(response.data) : undefined;
  },
  async update(position: Position) {
    const response = await apiRequest<ApiItemResponse>(`/positions/${position.id}`, { method: "PATCH", body: mapToApi(position) });
    await invalidateCacheFamily("positions", "position updated");
    return response.data ? mapFromApi(response.data) : undefined;
  },
  async removeOrHide(id: string) {
    const response = await apiRequest<ApiItemResponse>(`/positions/${id}`, { method: "DELETE" });
    await invalidateCacheFamily("positions", "position removed");
    return response.data ? mapFromApi(response.data) : undefined;
  },
  getNextCode: nextCode,
};
