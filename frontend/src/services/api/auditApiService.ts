import { apiRequest } from "./apiClient";
import type { AuditEntry } from "../../types";

type ApiAuditLog = {
  id: string;
  action: string;
  entity: string;
  entityId?: string | null;
  description: string;
  before?: unknown;
  after?: unknown;
  createdAt: string;
  user?: {
    name: string;
    role: string;
  } | null;
};

type ApiAuditResponse = { data: ApiAuditLog[] };

function dateParts(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: value.slice(0, 10), time: "" };
  return {
    date: date.toLocaleDateString("es-AR"),
    time: date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }),
  };
}

function stringify(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value || "-";
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

function mapFromApi(item: ApiAuditLog): AuditEntry {
  const parts = dateParts(item.createdAt);
  return {
    id: item.id,
    date: parts.date,
    time: parts.time,
    user: item.user?.name || "Sistema",
    role: item.user?.role || "-",
    action: item.action,
    entity: item.entity,
    field: item.entityId || undefined,
    previous: stringify(item.before),
    next: stringify(item.after),
    reason: item.description,
  };
}

export const auditApiService = {
  async getAll(filters?: { entity?: string; entityId?: string; take?: number }) {
    const params = new URLSearchParams();
    params.set("take", String(filters?.take || 200));
    if (filters?.entity) params.set("entity", filters.entity);
    if (filters?.entityId) params.set("entityId", filters.entityId);
    const response = await apiRequest<ApiAuditResponse>(`/audit?${params.toString()}`);
    return response.data.map(mapFromApi);
  },
};
