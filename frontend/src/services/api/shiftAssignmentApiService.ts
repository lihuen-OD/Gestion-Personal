import { apiRequest } from "./apiClient";
import { cachePolicies, cachedData, invalidateCacheFamily } from "../cache";

export type ShiftAssignmentStatus = "HABILITADO" | "DESHABILITADO";

export type ShiftAssignment = {
  id: string;
  employeeId: string;
  shiftTemplateId: string;
  status: ShiftAssignmentStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  weekdays: number[];
  assignedAt: string;
  assignedByUserId?: string | null;
  disabledAt?: string | null;
  disabledByUserId?: string | null;
  observation?: string | null;
  createdAt: string;
  updatedAt: string;
  employee: { id: string; legajo: string; firstName: string; lastName: string; status: string };
  shiftTemplate: { id: string; code: string; name: string; categoryName?: string | null; startTime: string; endTime: string; crossesMidnight: boolean; status: string };
};

export type ShiftAssignmentFilters = { employeeId?: string; shiftTemplateId?: string; status?: ShiftAssignmentStatus };
export type ShiftAssignmentSummary = { shiftTemplateId: string; total: number; enabled: number; disabled: number; other: number };

export type ShiftAssignmentVigencyInput = { effectiveFrom: string; effectiveTo?: string | null; weekdays?: number[] };

function toQuery(filters?: ShiftAssignmentFilters) {
  if (!filters) return "";
  const params = new URLSearchParams();
  if (filters.employeeId) params.set("employeeId", filters.employeeId);
  if (filters.shiftTemplateId) params.set("shiftTemplateId", filters.shiftTemplateId);
  if (filters.status) params.set("status", filters.status);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const shiftAssignmentApiService = {
  // Etapa 14H.3: envuelto con `cachedData` (dedupe in-flight, familia
  // "workforce-config" compartida con shiftTemplates/doubleHourRules -- ver
  // cachePolicy.ts) -- el journey 14H.1/14H.2 detectó 2 requests duplicadas
  // (StrictMode) al entrar a Turnos, cada una real (391-1134ms) porque este
  // endpoint tampoco tenía cache backend antes de esta etapa (ver
  // shiftAssignment.cache.ts, agregado en 14H.3).
  getSummary() {
    return cachedData({
      requestKey: "GET:/shifts/assignments/summary",
      policy: cachePolicies.shiftAssignmentSummary,
      fetcher: () => apiRequest<{ data: ShiftAssignmentSummary[] }>("/shifts/assignments/summary", { apiCache: false }).then((response) => response.data),
      validate: (value) => Array.isArray(value),
    });
  },
  getAll(filters?: ShiftAssignmentFilters) {
    return apiRequest<{ data: ShiftAssignment[] }>(`/shifts/assignments${toQuery(filters)}`, { apiCache: false }).then((response) => response.data);
  },
  async assign(input: { employeeIds: string[]; shiftTemplateId: string; observation?: string | null } & ShiftAssignmentVigencyInput) {
    const result = await apiRequest<{ data: ShiftAssignment[] }>("/shifts/assignments", { method: "POST", body: input }).then((response) => response.data);
    await invalidateCacheFamily("workforce-config", "shift assignment created");
    return result;
  },
  async update(id: string, input: { status?: ShiftAssignmentStatus; observation?: string | null } & Partial<ShiftAssignmentVigencyInput>) {
    const result = await apiRequest<{ data: ShiftAssignment }>(`/shifts/assignments/${id}`, { method: "PATCH", body: input }).then((response) => response.data);
    await invalidateCacheFamily("workforce-config", "shift assignment updated");
    return result;
  },
  async remove(id: string) {
    const result = await apiRequest<{ data: { id: string } }>(`/shifts/assignments/${id}`, { method: "DELETE" }).then((response) => response.data);
    await invalidateCacheFamily("workforce-config", "shift assignment removed");
    return result;
  },
};
