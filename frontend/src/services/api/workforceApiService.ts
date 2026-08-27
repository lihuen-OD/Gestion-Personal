import { apiRequest } from "./apiClient";
import { invalidateCacheFamily } from "../cache";

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
  employee?: { id: string; legajo: string; firstName: string; lastName: string };
};
export type ShiftTemplate = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  categoryName?: string | null;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  expectedMinutes?: number | null;
  entryToleranceBeforeMinutes: number;
  entryToleranceAfterMinutes: number;
  exitToleranceBeforeMinutes: number;
  exitToleranceAfterMinutes: number;
  minimumMinutesForCompliance?: number | null;
  maximumInformativeMinutes?: number | null;
  missingOutAlertAfterMinutes?: number | null;
  absoluteOpenShiftLimitMinutes: number;
  status: string;
  createdAt?: string;
  updatedAt?: string;
};
export type ShiftTemplateInput = {
  code: string;
  name: string;
  description?: string | null;
  categoryName?: string | null;
  startTime: string;
  endTime: string;
  entryToleranceBeforeMinutes: number;
  entryToleranceAfterMinutes: number;
  exitToleranceBeforeMinutes: number;
  exitToleranceAfterMinutes: number;
  minimumMinutesForCompliance?: number | null;
  maximumInformativeMinutes?: number | null;
  missingOutAlertAfterMinutes?: number | null;
  absoluteOpenShiftLimitMinutes: number;
  status?: "ACTIVO" | "INACTIVO";
};
// Etapa 8B: companyId/sectorId/costCenterId/positionId son alcance opcional
// (null = sin restricción en esa dimensión, combina con AND con el resto y
// con employeeIds). priority desempata superposición (mayor gana). dates
// sólo aplica cuando recurrenceType es FECHA (feriados/fechas manuales).
export type DoubleHourRuleDate = { id?: string; date: string; isActive: boolean };
export type DoubleHourRule = {
  id: string;
  name: string;
  recurrenceType: "FECHA" | "RANGO" | "SEMANAL";
  fromDate: string;
  toDate?: string | null;
  weekdays: number[];
  multiplier: number | string;
  priority: number;
  companyId?: string | null;
  sectorId?: string | null;
  costCenterId?: string | null;
  positionId?: string | null;
  company?: { id: string; name: string } | null;
  sector?: { id: string; name: string } | null;
  costCenter?: { id: string; name: string } | null;
  position?: { id: string; name: string } | null;
  dates: DoubleHourRuleDate[];
  reason: string;
  status: string;
  employees: Array<{ employee: { id: string; legajo: string; firstName: string; lastName: string } }>;
};
export type DoubleHourRuleInput = {
  name: string;
  recurrenceType: "FECHA" | "RANGO" | "SEMANAL";
  fromDate: string;
  toDate?: string | null;
  weekdays: number[];
  multiplier: number;
  priority: number;
  companyId?: string | null;
  sectorId?: string | null;
  costCenterId?: string | null;
  positionId?: string | null;
  dates?: Array<{ date: string; isActive: boolean }>;
  employeeIds: string[];
  reason: string;
  status?: "ACTIVO" | "INACTIVO";
};
export type DoubleHourRuleCalendarDay = {
  date: string;
  rules: Array<{ id: string; name: string; priority: number; multiplier: number }>;
  hasOverlap: boolean;
  hasConflict: boolean;
};

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
  // Etapa 9G: aprobar una corrección post-cierre reescribe TimeEntry.hours
  // (workforce.service.ts:approveCorrection) — afecta directo la métrica
  // "Horas cargadas" del dashboard. El backend ya invalida su propio cache
  // (auditService.register limpia dashboardMetricsCache siempre), pero el
  // cache del lado del frontend (dashboardMetricsApiService, TTL propio de
  // 30s) es una capa aparte que nada invalidaba — quedaba sirviendo el valor
  // viejo hasta que ese TTL expirara solo. rejectCorrection no toca
  // TimeEntry, así que no hace falta invalidar nada en ese caso.
  async reviewCorrection(id: string, decision: "approve" | "reject", note?: string) {
    const result = await apiRequest<{ data: TimeCorrection }>(`/workforce/corrections/${id}/${decision}`, { method: "POST", body: { note } }).then((response) => response.data);
    if (decision === "approve") await invalidateCacheFamily("dashboard", "time correction approved");
    return result;
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
  createShiftTemplate(input: ShiftTemplateInput) { return apiRequest<{ data: ShiftTemplate }>("/workforce/shift-templates", { method: "POST", body: input }).then((response) => response.data); },
  updateShiftTemplate(id: string, input: Partial<ShiftTemplateInput>) { return apiRequest<{ data: ShiftTemplate }>(`/workforce/shift-templates/${id}`, { method: "PATCH", body: input }).then((response) => response.data); },
  removeShiftTemplate(id: string) { return apiRequest<{ data: { mode: "DELETED" | "INACTIVATED"; id?: string; item?: ShiftTemplate; relatedWorkShifts: number } }>(`/workforce/shift-templates/${id}`, { method: "DELETE" }).then((response) => response.data); },
  doubleHourRules() { return apiRequest<{ data: DoubleHourRule[] }>("/workforce/double-hour-rules", { apiCache: false }).then((response) => response.data); },
  createDoubleHourRule(input: DoubleHourRuleInput) { return apiRequest<{ data: DoubleHourRule }>("/workforce/double-hour-rules", { method: "POST", body: input }).then((response) => response.data); },
  updateDoubleHourRule(id: string, input: Partial<DoubleHourRuleInput>) { return apiRequest<{ data: DoubleHourRule }>(`/workforce/double-hour-rules/${id}`, { method: "PATCH", body: input }).then((response) => response.data); },
  removeDoubleHourRule(id: string) { return apiRequest<{ data: { mode: "DELETED" | "INACTIVATED"; id?: string; item?: DoubleHourRule } }>(`/workforce/double-hour-rules/${id}`, { method: "DELETE" }).then((response) => response.data); },
  doubleHourRulesCalendar(from: string, to: string) {
    return apiRequest<{ data: DoubleHourRuleCalendarDay[] }>(`/workforce/double-hour-rules/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { apiCache: false }).then((response) => response.data);
  },
};
