import { apiRequest } from "./apiClient";
import { invalidateCacheFamily } from "../cache";
import type { Novelty, Role, User } from "../../types";

type ApiNoveltyStatus = "BORRADOR" | "PENDIENTE" | "EN_REVISION" | "APROBADO" | "RECHAZADO" | "DEVUELTO" | "CERRADO";

type ApiNovelty = {
  id: string;
  employeeId: string;
  noveltyTypeId: string;
  status: ApiNoveltyStatus;
  fromDate: string;
  toDate?: string | null;
  quantityHours?: string | number | null;
  quantityDays?: string | number | null;
  observation?: string | null;
  targetHourConceptId?: string | null;
  employee?: {
    id: string;
    legajo: string;
    firstName: string;
    lastName: string;
  };
  noveltyType: {
    id: string;
    code: string;
    name: string;
    origin: "INTERNA" | "FINNEGANS" | "MIXTA";
    exportsToFinnegans: boolean;
    allowsHours: boolean;
    allowsDateTo: boolean;
    hasValidity: boolean;
    blocksTimeEntry: boolean;
    setsWorkedHoursToZero: boolean;
    timeImpact: string;
    approvalRoles?: Role[];
    finnegansLinks?: Array<{
      code: string;
      name: string;
      hasValidity?: boolean | null;
      status: "ACTIVO" | "INACTIVO";
    }>;
  };
  targetHourConcept?: {
    id: string;
    name: string;
  } | null;
  documents?: Array<{ fileName: string }>;
};

type ApiListResponse = { data: ApiNovelty[] };
type ApiListMeta = { total: number; page: number; pageSize: number; hasMore: boolean };
type ApiPaginatedListResponse = ApiListResponse & { meta: ApiListMeta };
type ApiCreateResponse = { data: ApiNovelty[] };
type ApiItemResponse = { data: ApiNovelty };

async function invalidateNoveltyDependentCaches(reason: string) {
  await Promise.all([
    invalidateCacheFamily("dashboard", reason),
    invalidateCacheFamily("novelties", reason),
    invalidateCacheFamily("time-entries", reason),
  ]);
}

const fallbackApprovalRoles: Role[] = ["Nivel 1 - RRHH"];
const validRoles: Role[] = ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"];

function normalizeRoles(value: unknown): Role[] {
  if (!Array.isArray(value)) return fallbackApprovalRoles;
  const roles = value.filter((item): item is Role => validRoles.includes(item as Role));
  return roles.length ? roles : fallbackApprovalRoles;
}

type CreateNoveltyApiInput = {
  employeeIds: string[];
  noveltyTypeId: string;
  fromDate: string;
  toDate?: string | null;
  quantityHours?: number | null;
  quantityDays?: number | null;
  observation?: string | null;
  targetHourConceptId?: string | null;
};

function dateOnly(value?: string | null) {
  return value ? value.slice(0, 10) : "";
}

function asNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toFrontendStatus(status: ApiNoveltyStatus) {
  const map: Record<ApiNoveltyStatus, string> = {
    BORRADOR: "Borrador",
    PENDIENTE: "Pendiente",
    EN_REVISION: "En revisión",
    APROBADO: "Aprobado",
    RECHAZADO: "Rechazado",
    DEVUELTO: "Devuelto",
    CERRADO: "Cerrado",
  };
  return map[status] || status;
}

function quantityLabel(item: ApiNovelty) {
  const hours = asNumber(item.quantityHours);
  if (hours !== undefined) return `${hours} h`;
  const days = asNumber(item.quantityDays);
  if (days !== undefined) return `${days} días`;
  return "1 día";
}

export function mapNoveltyFromApi(item: ApiNovelty): Novelty {
  const activeLink = item.noveltyType.finnegansLinks?.find((link) => link.status === "ACTIVO");
  const hours = asNumber(item.quantityHours) || 0;
  const days = asNumber(item.quantityDays) || 1;

  return {
    id: item.id,
    employeeId: item.employeeId,
    type: item.noveltyType.name,
    noveltyTypeId: item.noveltyTypeId,
    from: dateOnly(item.fromDate),
    to: item.toDate ? dateOnly(item.toDate) : dateOnly(item.fromDate),
    quantity: quantityLabel(item),
    affectsSettlement: item.noveltyType.exportsToFinnegans,
    status: toFrontendStatus(item.status),
    createdBy: "Sistema",
    employeeLegajo: item.employee?.legajo,
    employeeName: item.employee ? `${item.employee.lastName}, ${item.employee.firstName}` : undefined,
    documentationFileName: item.documents?.[0]?.fileName,
    documentationNotes: item.observation || undefined,
    origin: item.noveltyType.origin,
    timeImpact: item.noveltyType.timeImpact,
    hoursImpact: hours,
    targetHourConceptId: item.targetHourConceptId || undefined,
    targetHourConceptName: item.targetHourConcept?.name,
    blocksTimeEntry: item.noveltyType.blocksTimeEntry,
    setsWorkedHoursToZero: item.noveltyType.setsWorkedHoursToZero,
    approvalRoles: normalizeRoles(item.noveltyType.approvalRoles),
    exportsToFinnegans: item.noveltyType.exportsToFinnegans,
    finnegansCode: activeLink?.code,
    finnegansName: activeLink?.name,
    valor1: item.noveltyType.allowsHours ? String(hours) : String(days),
    fechaAplicacion: dateOnly(item.fromDate),
    hasValidity: item.noveltyType.hasValidity || Boolean(activeLink?.hasValidity),
  };
}

export type NoveltyListFilters = {
  employeeId?: string;
  search?: string;
  exportable?: boolean;
  page?: number;
  take?: number;
};

function toQuery(filters?: NoveltyListFilters) {
  const params = new URLSearchParams();
  params.set("page", String(filters?.page || 1));
  params.set("take", String(filters?.take || 25));
  if (filters?.employeeId) params.set("employeeId", filters.employeeId);
  if (filters?.search?.trim()) params.set("search", filters.search.trim());
  if (filters?.exportable !== undefined) params.set("exportable", String(filters.exportable));
  return `?${params.toString()}`;
}

export const noveltyApiService = {
  async list(filters?: NoveltyListFilters) {
    const response = await apiRequest<ApiPaginatedListResponse>(`/novelties${toQuery(filters)}`);
    return {
      items: response.data.map(mapNoveltyFromApi),
      meta: response.meta,
    };
  },

  async getAll(filters?: NoveltyListFilters) {
    const response = await this.list({ ...filters, take: filters?.take || 100 });
    return response.items;
  },

  async create(input: CreateNoveltyApiInput) {
    const response = await apiRequest<ApiCreateResponse>("/novelties", {
      method: "POST",
      body: input,
    });
    await invalidateNoveltyDependentCaches("novelty created");
    return response.data.map(mapNoveltyFromApi);
  },

  async approve(id: string) {
    const response = await apiRequest<ApiItemResponse>(`/novelties/${id}/approve`, { method: "POST" });
    await invalidateNoveltyDependentCaches("novelty approved");
    return mapNoveltyFromApi(response.data);
  },
  async approveMany(ids: string[]) {
    const response = await apiRequest<{ data: ApiNovelty[] }>("/novelties/bulk-approve", { method: "POST", body: { ids } });
    await invalidateNoveltyDependentCaches("novelties approved in bulk");
    return response.data.map(mapNoveltyFromApi);
  },

  async reject(id: string, reason = "Rechazo operativo") {
    const response = await apiRequest<ApiItemResponse>(`/novelties/${id}/reject`, {
      method: "POST",
      body: { reason },
    });
    await invalidateNoveltyDependentCaches("novelty rejected");
    return mapNoveltyFromApi(response.data);
  },

  canApprove(novelty: Novelty, user: User) {
    return user.role === "Nivel 1 - RRHH" || Boolean(novelty.approvalRoles?.includes(user.role));
  },
};
