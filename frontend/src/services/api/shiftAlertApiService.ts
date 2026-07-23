import { apiRequest } from "./apiClient";

export type ShiftAlertType =
  | "INGRESO_TARDE"
  | "SALIDA_ANTICIPADA"
  | "SALIDA_TARDIA"
  | "TURNO_NO_IDENTIFICADO"
  | "SHIFT_NOT_ENABLED_FOR_EMPLOYEE"
  | "POSSIBLE_SHIFT_CONFIGURATION_MISSING"
  | "JORNADA_INSUFICIENTE"
  | "JORNADA_EXTENDIDA"
  | "DESCANSO_INSUFICIENTE"
  | "POSIBLE_OLVIDO_SALIDA";

export type ShiftAlertSeverity = "INFO" | "ADVERTENCIA" | "CRITICA";
export type ShiftAlertStatus = "PENDIENTE" | "RESUELTA" | "DESCARTADA";

export type ShiftAlert = {
  id: string;
  employeeId: string;
  workShiftId: string;
  type: ShiftAlertType;
  status: ShiftAlertStatus;
  severity: ShiftAlertSeverity;
  scheduledAt?: string | null;
  actualAt: string;
  differenceMinutes?: number | null;
  resolvedAt?: string | null;
  resolvedByUserId?: string | null;
  resolutionNote?: string | null;
  createdAt: string;
  employee: { id: string; legajo: string; dni: string; firstName: string; lastName: string; status: string };
  workShift: { id: string; startAt: string; endAt?: string | null; status: string; shiftTemplate: { id: string; code: string; name: string } | null };
};

export type ShiftAlertFilters = {
  employeeId?: string;
  workShiftId?: string;
  type?: ShiftAlertType;
  severity?: ShiftAlertSeverity;
  status?: ShiftAlertStatus | "ALL";
  search?: string;
  before?: string;
  take?: number;
};

function toQuery(filters?: ShiftAlertFilters) {
  const params = new URLSearchParams();
  if (filters?.employeeId) params.set("employeeId", filters.employeeId);
  if (filters?.workShiftId) params.set("workShiftId", filters.workShiftId);
  if (filters?.type) params.set("type", filters.type);
  if (filters?.severity) params.set("severity", filters.severity);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.search?.trim()) params.set("search", filters.search.trim());
  if (filters?.before) params.set("before", filters.before);
  params.set("take", String(filters?.take || 20));
  return params.toString();
}

export const shiftAlertApiService = {
  getAll(filters?: ShiftAlertFilters) {
    return apiRequest<{ data: ShiftAlert[]; meta: { total: number; pageSize: number; hasMore: boolean; nextBefore: string | null } }>(
      `/shifts/alerts?${toQuery(filters)}`,
      { apiCache: false },
    );
  },
  resolve(id: string, resolution: "RESUELTA" | "DESCARTADA", reason: string) {
    return apiRequest<{ data: ShiftAlert }>(`/shifts/alerts/${id}/resolve`, { method: "POST", body: { resolution, reason } }).then((response) => response.data);
  },
};
