import { apiRequest } from "./apiClient";
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
  priority: number;
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
    priority: item.priority,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
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

  async listByConcept(hourConceptId: string) {
    const response = await apiRequest<ApiListResponse>(`/hour-concepts/${hourConceptId}/rules`, { apiCache: false });
    return response.data.map(mapHourConceptRuleFromApi);
  },

  async create(payload: CreateHourConceptRulePayload) {
    const response = await apiRequest<ApiItemResponse>("/hour-concept-rules", { method: "POST", body: payload });
    return mapHourConceptRuleFromApi(response.data);
  },

  async update(id: string, payload: UpdateHourConceptRulePayload) {
    const response = await apiRequest<ApiItemResponse>(`/hour-concept-rules/${id}`, { method: "PATCH", body: payload });
    return mapHourConceptRuleFromApi(response.data);
  },

  async updateStatus(id: string, status: HourConceptRuleStatus) {
    const response = await apiRequest<ApiItemResponse>(`/hour-concept-rules/${id}/status`, { method: "PATCH", body: { status } });
    return mapHourConceptRuleFromApi(response.data);
  },
};
