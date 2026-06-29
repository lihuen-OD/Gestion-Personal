import { apiRequest } from "./apiClient";
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

export const auditParameterApiService = {
  async getAll(filters?: AuditParameterFilters) {
    const response = await apiRequest<ApiListResponse>(`/audit-parameters?${query(filters)}`);
    return response.data;
  },

  async create(parameter: AuditParameter) {
    const response = await apiRequest<ApiItemResponse>("/audit-parameters", {
      method: "POST",
      body: parameter,
    });
    return response.data;
  },

  async update(parameter: AuditParameter) {
    const response = await apiRequest<ApiItemResponse>(`/audit-parameters/${parameter.id}`, {
      method: "PATCH",
      body: parameter,
    });
    return response.data;
  },
};
