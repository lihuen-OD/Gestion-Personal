import { apiRequest } from "./apiClient";
import { cachePolicies, cachedData, invalidateCacheFamily } from "../cache";
import type {
  CreateHourConceptRulePayload,
  HourConceptRule,
  HourConceptRuleFilters,
  HourConceptRuleStatus,
  UpdateHourConceptRulePayload,
} from "../../types/hourConceptRule.types";

type ApiHourConceptRule = {
  id: string;
  hourConceptId: string;
  hourConcept: { id: string; code: string; name: string };
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  status: HourConceptRuleStatus;
  createdAt: string;
  updatedAt: string;
};

type ApiListMeta = { total: number; page: number; pageSize: number; hasMore: boolean };
type ApiItemResponse = { data: ApiHourConceptRule };
type ApiListResponse = { data: ApiHourConceptRule[] };
type ApiPaginatedResponse = { data: ApiHourConceptRule[]; meta: ApiListMeta };

export function mapHourConceptRuleFromApi(item: ApiHourConceptRule): HourConceptRule {
  return {
    id: item.id,
    hourConceptId: item.hourConceptId,
    hourConcept: item.hourConcept,
    startTime: item.startTime,
    endTime: item.endTime,
    crossesMidnight: item.crossesMidnight,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

// Etapa 8M: el bug real de "no pudimos cargar las reglas horarias" estaba en
// el backend (mergeParams, ver hourConceptRules.routes.ts) — este endpoint
// ya estaba bien armado del lado del frontend. Se extrae igual como función
// pura para poder confirmarlo con un test directo, sin mockear la red.
export function buildRulesByConceptPath(hourConceptId: string) {
  return `/hour-concepts/${hourConceptId}/rules`;
}

function toQuery(filters?: Partial<HourConceptRuleFilters> & { page?: number; take?: number }) {
  const params = new URLSearchParams();
  params.set("page", String(filters?.page || 1));
  params.set("take", String(filters?.take || 200));
  if (filters?.hourConceptId) params.set("hourConceptId", filters.hourConceptId);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.crossesMidnight) params.set("crossesMidnight", filters.crossesMidnight);
  return `?${params.toString()}`;
}

export const hourConceptRuleApiService = {
  async list(filters?: Partial<HourConceptRuleFilters> & { page?: number; take?: number }) {
    const response = await apiRequest<ApiPaginatedResponse>(`/hour-concept-rules${toQuery(filters)}`, { apiCache: false });
    return { items: response.data.map(mapHourConceptRuleFromApi), meta: response.meta };
  },

  async getById(id: string) {
    const response = await apiRequest<ApiItemResponse>(`/hour-concept-rules/${id}`, { apiCache: false });
    return mapHourConceptRuleFromApi(response.data);
  },

  // Etapa 14H.5: envuelto con `cachedData` (familia "hour-concepts",
  // compartida con hourConceptsCatalog/getHourConceptEmployees) -- este
  // endpoint monta recién al abrir "Editar" en un concepto AUTOMATIC/BOTH
  // existente (HourConceptRulesPanel), un montaje fresco cada vez, así que
  // StrictMode lo duplica igual que cualquier otro efecto de montaje ya
  // corregido en esta serie.
  async listByConcept(hourConceptId: string) {
    const path = buildRulesByConceptPath(hourConceptId);
    return cachedData({
      requestKey: `GET:${path}`,
      policy: cachePolicies.hourConceptRulesByConceptId,
      // response.data vacío es un catálogo real sin reglas todavía, no un error
      // — .map sobre [] simplemente devuelve [], nunca lanza. El panel decide
      // "empty state" vs. "error" según si esta promesa resuelve o rechaza,
      // no según el largo del array (ver HourConceptRulesPanel.tsx).
      fetcher: () => apiRequest<ApiListResponse>(path, { apiCache: false }).then((response) => response.data.map(mapHourConceptRuleFromApi)),
      validate: (value) => Array.isArray(value),
    });
  },

  async create(payload: CreateHourConceptRulePayload) {
    const response = await apiRequest<ApiItemResponse>("/hour-concept-rules", { method: "POST", body: payload });
    await invalidateCacheFamily("hour-concepts", "hour concept rule created");
    return mapHourConceptRuleFromApi(response.data);
  },

  async update(id: string, payload: UpdateHourConceptRulePayload) {
    const response = await apiRequest<ApiItemResponse>(`/hour-concept-rules/${id}`, { method: "PATCH", body: payload });
    await invalidateCacheFamily("hour-concepts", "hour concept rule updated");
    return mapHourConceptRuleFromApi(response.data);
  },

  async updateStatus(id: string, status: HourConceptRuleStatus) {
    const response = await apiRequest<ApiItemResponse>(`/hour-concept-rules/${id}/status`, { method: "PATCH", body: { status } });
    await invalidateCacheFamily("hour-concepts", "hour concept rule status updated");
    return mapHourConceptRuleFromApi(response.data);
  },
};
