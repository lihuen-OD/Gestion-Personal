import { apiRequest } from "./apiClient";
import type { HourConcept, HourConceptFilters, HourConceptKind, HourConceptStatus } from "../../types/hourConcept.types";

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

const listCache = new Map<string, Promise<HourConcept[]>>();

function mapFromApi(item: ApiHourConcept): HourConcept {
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
    createdBy: "Backend",
    updatedBy: "Backend",
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

export const hourConceptApiService = {
  async getAll(filters?: Partial<HourConceptFilters>) {
    const query = toQuery(filters);
    const key = `/hour-concepts${query}`;
    if (!listCache.has(key)) {
      listCache.set(key, apiRequest<ApiListResponse>(key).then((response) => response.data.map(mapFromApi)));
    }
    return listCache.get(key)!;
  },

  async create(item: HourConcept) {
    const response = await apiRequest<ApiItemResponse>("/hour-concepts", {
      method: "POST",
      body: mapToApi(item),
    });
    listCache.clear();
    return mapFromApi(response.data);
  },

  async update(id: string, item: HourConcept) {
    const response = await apiRequest<ApiItemResponse>(`/hour-concepts/${id}`, {
      method: "PATCH",
      body: mapToApi(item),
    });
    listCache.clear();
    return mapFromApi(response.data);
  },

  getNextCode: nextCode,
};
