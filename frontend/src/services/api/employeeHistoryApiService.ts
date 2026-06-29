import type { EmployeeBlockHistoryRecord, EmployeeFieldHistoryRecord, FieldHistorySection } from "../../types";
import { apiRequest } from "./apiClient";

type ApiUserRef = { id: string; name: string } | null;

type ApiFieldHistory = Omit<EmployeeFieldHistoryRecord, "effectiveFrom" | "createdByUserId" | "createdByUserName"> & {
  effectiveFrom: string;
  createdByUserId?: string | null;
  createdBy?: ApiUserRef;
};

type ApiBlockHistory = Omit<EmployeeBlockHistoryRecord, "effectiveFrom" | "createdByUserId" | "createdByUserName"> & {
  effectiveFrom: string;
  createdByUserId?: string | null;
  createdBy?: ApiUserRef;
};

type ApiFieldListResponse = { data: ApiFieldHistory[] };
type ApiBlockListResponse = { data: ApiBlockHistory[] };
type ApiFieldItemResponse = { data: ApiFieldHistory };
type ApiBlockItemResponse = { data: ApiBlockHistory };

function dateOnly(value: string) {
  return value ? value.slice(0, 10) : "";
}

function mapField(item: ApiFieldHistory): EmployeeFieldHistoryRecord {
  return {
    ...item,
    effectiveFrom: dateOnly(item.effectiveFrom),
    createdByUserId: item.createdByUserId || item.createdBy?.id || "",
    createdByUserName: item.createdBy?.name || "Backend",
  };
}

function mapBlock(item: ApiBlockHistory): EmployeeBlockHistoryRecord {
  return {
    ...item,
    effectiveFrom: dateOnly(item.effectiveFrom),
    createdByUserId: item.createdByUserId || item.createdBy?.id || "",
    createdByUserName: item.createdBy?.name || "Backend",
  };
}

function toQuery(filters: { section?: FieldHistorySection; field?: string; block?: string; take?: number }) {
  const params = new URLSearchParams();
  if (filters.section) params.set("section", filters.section);
  if (filters.field) params.set("field", filters.field);
  if (filters.block) params.set("block", filters.block);
  if (filters.take) params.set("take", String(filters.take));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const employeeHistoryApiService = {
  async getFieldHistory(employeeId: string, filters: { section?: FieldHistorySection; field?: string; take?: number } = {}) {
    const response = await apiRequest<ApiFieldListResponse>(`/employees/${employeeId}/field-history${toQuery(filters)}`);
    return response.data.map(mapField);
  },

  async createFieldHistory(record: Omit<EmployeeFieldHistoryRecord, "id" | "createdAt" | "createdByUserId" | "createdByUserName">) {
    const response = await apiRequest<ApiFieldItemResponse>(`/employees/${record.employeeId}/field-history`, {
      method: "POST",
      body: record,
    });
    return mapField(response.data);
  },

  async getBlockHistory(employeeId: string, filters: { section?: FieldHistorySection; block?: string; take?: number } = {}) {
    const response = await apiRequest<ApiBlockListResponse>(`/employees/${employeeId}/block-history${toQuery(filters)}`);
    return response.data.map(mapBlock);
  },

  async createBlockHistory(record: Omit<EmployeeBlockHistoryRecord, "id" | "createdAt" | "createdByUserId" | "createdByUserName">) {
    const response = await apiRequest<ApiBlockItemResponse>(`/employees/${record.employeeId}/block-history`, {
      method: "POST",
      body: record,
    });
    return mapBlock(response.data);
  },
};
