import { apiRequest } from "./apiClient";
import { cachePolicies, cachedData, invalidateCacheFamily } from "../cache";
import type { Employee } from "../../types";
import type { Position, PositionFilters, PositionStatus } from "../../types/position.types";

type ApiPosition = {
  id: string;
  code: string;
  name: string;
  status: PositionStatus;
  mission?: string | null;
  description?: string | null;
  areaDepartment?: string | null;
  sectorName?: string | null;
  businessUnitName?: string | null;
  establishmentName?: string | null;
  lastUpdatedAt?: string | null;
  businessUnitNames?: unknown;
  establishmentNames?: unknown;
  sectorNames?: unknown;
  salaryRangeCategories?: unknown;
  responsibilities?: unknown;
  internalRelations?: unknown;
  externalRelations?: unknown;
  competencies?: unknown;
  workConditions?: unknown;
  performanceIndicators?: unknown;
  evaluationCriteria?: unknown;
  createdAt: string;
  updatedAt: string;
  _count?: { employees?: number };
};

type ApiListResponse = { data: ApiPosition[] };
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

const asStringArray = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

function mapFromApi(item: ApiPosition): Position {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    assignedCount: item._count?.employees || 0,
    areaDepartment: item.areaDepartment || "",
    sector: item.sectorName || "",
    lastUpdatedAt: item.lastUpdatedAt ? item.lastUpdatedAt.slice(0, 10) : item.updatedAt.slice(0, 10),
    status: item.status,
    businessUnitName: item.businessUnitName || "",
    businessUnitNames: asStringArray(item.businessUnitNames),
    establishmentName: item.establishmentName || "",
    establishmentNames: asStringArray(item.establishmentNames),
    sectorNames: asStringArray(item.sectorNames),
    salaryRangeCategories: asStringArray(item.salaryRangeCategories),
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
    areaDepartment: position.areaDepartment || null,
    sector: position.sector || null,
    businessUnitName: position.businessUnitName || position.businessUnitNames?.[0] || null,
    establishmentName: position.establishmentName || position.establishmentNames?.[0] || null,
    lastUpdatedAt: position.lastUpdatedAt || null,
    businessUnitNames: position.businessUnitNames || [],
    establishmentNames: position.establishmentNames || [],
    sectorNames: position.sectorNames || [],
    salaryRangeCategories: position.salaryRangeCategories || [],
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
  if (filters?.businessUnitName) params.set("businessUnitName", filters.businessUnitName);
  if (filters?.establishmentName) params.set("establishmentName", filters.establishmentName);
  if (filters?.areaDepartment) params.set("areaDepartment", filters.areaDepartment);
  if (filters?.sector) params.set("sector", filters.sector);
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

export const positionApiService = {
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
