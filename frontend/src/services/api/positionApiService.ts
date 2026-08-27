import { apiRequest } from "./apiClient";
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

type ApiAssignedEmployeesResponse = { data: ApiAssignedEmployee[] };

const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

function mapFromApi(item: ApiPosition): Position {
  const salaryCategories = [...(item.salaryCategories || [])]
    .map((link) => link.salaryCategory)
    .sort((a, b) => a.order - b.order);
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    assignedCount: item._count?.employees || 0,
    lastUpdatedAt: item.lastUpdatedAt ? item.lastUpdatedAt.slice(0, 10) : item.updatedAt.slice(0, 10),
    status: item.status,
    sectorId: item.sectorId || undefined,
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
    // Fuente oficial de ubicacion: sectorId (limpieza final de Position, 2026-08-18).
    sectorId: position.sectorId || null,
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
  // businessUnitId/establishmentId/areaId todavia no tienen filtro server-side
  // real (el backend solo resuelve sectorId); el filtrado de esos 3 niveles
  // se hace client-side en PuestosPage contra los derivados del catalogo.
  if (filters?.sectorId) params.set("sectorId", filters.sectorId);
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

// Etapa 9E: query separada de toQuery() (que sigue siendo la de getAll(),
// take:300 fijo, usada por selects/catálogos) — acá page/take vienen del
// caller (Pagination.tsx) y se agregan los 3 filtros de jerarquía
// organizacional que el backend ahora sí resuelve server-side.
function toListQuery(filters?: Partial<PositionFilters> & { page?: number; take?: number }) {
  const params = new URLSearchParams();
  params.set("page", String(filters?.page || 1));
  params.set("take", String(filters?.take || 25));
  if (filters?.search?.trim()) params.set("search", filters.search.trim());
  if (filters?.status) params.set("status", filters.status);
  if (filters?.sectorId) params.set("sectorId", filters.sectorId);
  if (filters?.areaId) params.set("areaId", filters.areaId);
  if (filters?.establishmentId) params.set("establishmentId", filters.establishmentId);
  if (filters?.businessUnitId) params.set("businessUnitId", filters.businessUnitId);
  if (filters?.salaryRangeCategory) params.set("salaryRangeCategory", filters.salaryRangeCategory);
  return `?${params.toString()}`;
}

export const positionApiService = {
  // Etapa 9E: paginación real para PuestosPage.tsx (page/take/meta, mismo
  // contrato que employeeApiService.list()/Pagination.tsx). getAll() abajo
  // sigue igual, sin tocar — lo siguen usando los selects/catálogos que
  // necesitan "todos los puestos activos" de una sola vez.
  async list(filters?: Partial<PositionFilters> & { page?: number; take?: number }) {
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
  async getAssignedEmployees(id: string) {
    const response = await apiRequest<ApiAssignedEmployeesResponse>(`/positions/${id}/employees`);
    return response.data.map(mapAssignedEmployee);
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
