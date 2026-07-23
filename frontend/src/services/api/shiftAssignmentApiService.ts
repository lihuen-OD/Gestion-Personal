import { apiRequest } from "./apiClient";

export type ShiftAssignmentStatus = "HABILITADO" | "DESHABILITADO";

export type ShiftAssignment = {
  id: string;
  employeeId: string;
  shiftTemplateId: string;
  status: ShiftAssignmentStatus;
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
  getAll(filters?: ShiftAssignmentFilters) {
    return apiRequest<{ data: ShiftAssignment[] }>(`/shifts/assignments${toQuery(filters)}`, { apiCache: false }).then((response) => response.data);
  },
  assign(input: { employeeIds: string[]; shiftTemplateId: string; observation?: string | null }) {
    return apiRequest<{ data: ShiftAssignment[] }>("/shifts/assignments", { method: "POST", body: input }).then((response) => response.data);
  },
  update(id: string, input: { status?: ShiftAssignmentStatus; observation?: string | null }) {
    return apiRequest<{ data: ShiftAssignment }>(`/shifts/assignments/${id}`, { method: "PATCH", body: input }).then((response) => response.data);
  },
  remove(id: string) {
    return apiRequest<{ data: { id: string } }>(`/shifts/assignments/${id}`, { method: "DELETE" }).then((response) => response.data);
  },
};
