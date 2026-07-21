import { apiRequest } from "./apiClient";

export type MonthlyClosure = {
  id: string;
  employeeId: string;
  period: string;
  status: "ABIERTO" | "ENVIADO" | "APROBADO" | "DEVUELTO" | "CORRECCION_PENDIENTE";
  submittedAt?: string | null;
  reviewNote?: string | null;
  employee: { id: string; legajo: string; firstName: string; lastName: string };
  submittedBy?: { name: string } | null;
  reviewedBy?: { name: string } | null;
};

export type TimeCorrection = {
  id: string;
  status: "PENDIENTE" | "APROBADA" | "RECHAZADA";
  previousHours: number | string;
  proposedHours: number | string;
  reason: string;
  reviewNote?: string | null;
  createdAt: string;
  employee: { legajo: string; firstName: string; lastName: string };
  timeEntry: { date: string; hourConcept: { name: string } };
  createdBy: { name: string };
};

export type SystemNotification = {
  id: string;
  type: string;
  priority: string;
  title: string;
  message: string;
  link?: string | null;
  status: "NO_LEIDA" | "LEIDA";
  createdAt: string;
};
export type ShiftTemplate = { id: string; code: string; name: string; startTime: string; endTime: string; entryToleranceMinutes: number; exitToleranceMinutes: number; detectionWindowMinutes: number; status: string };
export type DoubleHourRule = { id: string; name: string; recurrenceType: "FECHA" | "RANGO" | "SEMANAL"; fromDate: string; toDate?: string | null; weekdays: number[]; multiplier: number | string; reason: string; status: string; employees: Array<{ employee: { id: string; legajo: string; firstName: string; lastName: string } }> };
export type DoubleHourRuleInput = { name: string; recurrenceType: "FECHA" | "RANGO" | "SEMANAL"; fromDate: string; toDate?: string | null; weekdays: number[]; multiplier: number; employeeIds: string[]; reason: string; status?: "ACTIVO" | "INACTIVO" };

export const workforceApiService = {
  closures(period: string) {
    return apiRequest<{ data: MonthlyClosure[] }>(`/workforce/closures?period=${encodeURIComponent(period)}`, { apiCache: false }).then((response) => response.data);
  },
  submitClosures(period: string, employeeIds: string[]) {
    return apiRequest<{ data: MonthlyClosure[] }>("/workforce/closures/submit", { method: "POST", body: { period, employeeIds } }).then((response) => response.data);
  },
  approveClosures(ids: string[], note?: string) {
    return apiRequest<{ data: { count: number } }>("/workforce/closures/approve", { method: "POST", body: { ids, note } }).then((response) => response.data);
  },
  returnClosure(id: string, reason: string) {
    return apiRequest<{ data: MonthlyClosure }>(`/workforce/closures/${id}/return`, { method: "POST", body: { reason } }).then((response) => response.data);
  },
  corrections() {
    return apiRequest<{ data: TimeCorrection[] }>("/workforce/corrections", { apiCache: false }).then((response) => response.data);
  },
  createCorrection(input: { timeEntryId: string; proposedHours: number; reason: string }) {
    return apiRequest<{ data: TimeCorrection }>("/workforce/corrections", { method: "POST", body: input }).then((response) => response.data);
  },
  reviewCorrection(id: string, decision: "approve" | "reject", note?: string) {
    return apiRequest<{ data: TimeCorrection }>(`/workforce/corrections/${id}/${decision}`, { method: "POST", body: { note } }).then((response) => response.data);
  },
  notifications() {
    return apiRequest<{ data: SystemNotification[] }>("/workforce/notifications", { apiCache: false }).then((response) => response.data);
  },
  unreadNotificationCount() {
    return apiRequest<{ data: { count: number } }>("/workforce/notifications-unread-count", { apiCache: false }).then((response) => response.data.count);
  },
  readNotification(id: string) {
    return apiRequest(`/workforce/notifications/${id}/read`, { method: "POST" });
  },
  shiftTemplates() { return apiRequest<{ data: ShiftTemplate[] }>("/workforce/shift-templates", { apiCache: false }).then((response) => response.data); },
  createShiftTemplate(input: Omit<ShiftTemplate, "id">) { return apiRequest<{ data: ShiftTemplate }>("/workforce/shift-templates", { method: "POST", body: input }).then((response) => response.data); },
  updateShiftTemplate(id: string, input: Partial<Omit<ShiftTemplate, "id">>) { return apiRequest<{ data: ShiftTemplate }>(`/workforce/shift-templates/${id}`, { method: "PATCH", body: input }).then((response) => response.data); },
  removeShiftTemplate(id: string) { return apiRequest<{ data: { mode: "DELETED" | "INACTIVATED"; id?: string; item?: ShiftTemplate; relatedWorkShifts: number } }>(`/workforce/shift-templates/${id}`, { method: "DELETE" }).then((response) => response.data); },
  doubleHourRules() { return apiRequest<{ data: DoubleHourRule[] }>("/workforce/double-hour-rules", { apiCache: false }).then((response) => response.data); },
  createDoubleHourRule(input: DoubleHourRuleInput) { return apiRequest<{ data: DoubleHourRule }>("/workforce/double-hour-rules", { method: "POST", body: input }).then((response) => response.data); },
  updateDoubleHourRule(id: string, input: Partial<DoubleHourRuleInput>) { return apiRequest<{ data: DoubleHourRule }>(`/workforce/double-hour-rules/${id}`, { method: "PATCH", body: input }).then((response) => response.data); },
  removeDoubleHourRule(id: string) { return apiRequest<{ data: { mode: "DELETED" | "INACTIVATED"; id?: string; item?: DoubleHourRule } }>(`/workforce/double-hour-rules/${id}`, { method: "DELETE" }).then((response) => response.data); },
};
