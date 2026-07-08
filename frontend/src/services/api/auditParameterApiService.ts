import { apiRequest } from "./apiClient";
import { cachePolicies, cachedData, invalidateCacheFamily } from "../cache";
import type { AuditParameter, AuditParameterFilters } from "../../types/auditParameter.types";

type ApiAuditParameter = AuditParameter;
type ApiListResponse = { data: ApiAuditParameter[]; meta?: { total: number; page: number; pageSize: number; hasMore: boolean } };
type ApiItemResponse = { data: ApiAuditParameter };

function query(filters?: AuditParameterFilters) {
  const params = new URLSearchParams();
  params.set("take", "300");
  if (filters?.search) params.set("search", filters.search);
  if (filters?.scope) params.set("scope", filters.scope);
  if (filters?.severity) params.set("severity", filters.severity);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.requiresReason) params.set("requiresReason", filters.requiresReason);
  return params.toString();
}

function isAuditParameterList(value: AuditParameter[]) {
  return Array.isArray(value) && value.every((item) => typeof item.id === "string" && typeof item.code === "string" && typeof item.name === "string");
}

export const auditParameterApiService = {
  async getAll(filters?: AuditParameterFilters) {
    const key = `/audit-parameters?${query(filters)}`;
    return cachedData({
      requestKey: `GET:${key}`,
      policy: cachePolicies.auditParametersCatalog,
      fetcher: () => apiRequest<ApiListResponse>(key, { apiCache: false }).then((response) => response.data),
      validate: isAuditParameterList,
    });
  },

  async create(parameter: AuditParameter) {
    const response = await apiRequest<ApiItemResponse>("/audit-parameters", {
      method: "POST",
      body: parameter,
    });
    await invalidateCacheFamily("audit-parameters", "audit parameter created");
    return response.data;
  },

  async update(parameter: AuditParameter) {
    const response = await apiRequest<ApiItemResponse>(`/audit-parameters/${parameter.id}`, {
      method: "PATCH",
      body: parameter,
    });
    await invalidateCacheFamily("audit-parameters", "audit parameter updated");
    return response.data;
  },
};
