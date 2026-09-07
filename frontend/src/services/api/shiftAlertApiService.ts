import { apiRequest } from "./apiClient";
import { cachePolicies, cachedData, invalidateCacheFamily } from "../cache";

export type ShiftAlertType =
  | "INGRESO_TARDE"
  | "INGRESO_ANTICIPADO"
  | "SALIDA_ANTICIPADA"
  | "SALIDA_TARDIA"
  | "TURNO_NO_IDENTIFICADO"
  | "SHIFT_NOT_ENABLED_FOR_EMPLOYEE"
  | "POSSIBLE_SHIFT_CONFIGURATION_MISSING"
  | "JORNADA_INSUFICIENTE"
  | "JORNADA_EXTENDIDA"
  | "DESCANSO_INSUFICIENTE"
  | "POSIBLE_OLVIDO_SALIDA"
  | "CONCEPTO_NO_HABILITADO"
  | "SEGMENTO_SIN_CLASIFICAR";

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

type ShiftAlertListResponse = { data: ShiftAlert[]; meta: { total: number; pageSize: number; hasMore: boolean; nextBefore: string | null } };

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

// Etapa 14G.5: mismo criterio que isEmployeePeriodRowsResponse/isTimeEntryListResponse
// (timeEntryApiService.ts) -- validación mínima para que un payload
// inesperado (p. ej. una respuesta de error cacheada) no quede servido desde
// `cachedData` como si fuera válido.
function isShiftAlertListResponse(value: ShiftAlertListResponse) {
  return Boolean(value && Array.isArray(value.data) && value.meta && typeof value.meta.total === "number");
}

export const shiftAlertApiService = {
  // Etapa 14G.5: `getAll` no tenía dedupe in-flight -- el doble-montaje de
  // StrictMode en dev disparaba 2 llamadas de red reales a GET /shifts/alerts
  // (mismo síntoma ya resuelto en el resto de las listas operativas del
  // proyecto). `cachedData` dedupea vía `pendingRevalidations` y agrega un
  // TTL corto (15s, `cachePolicies.shiftAlertsList`) -- no cambia el shape de
  // la respuesta ni los filtros que viajan en la URL.
  getAll(filters?: ShiftAlertFilters) {
    const key = `/shifts/alerts?${toQuery(filters)}`;
    return cachedData({
      requestKey: `GET:${key}`,
      policy: cachePolicies.shiftAlertsList,
      fetcher: () => apiRequest<ShiftAlertListResponse>(key, { apiCache: false }),
      validate: isShiftAlertListResponse,
    });
  },
  async resolve(id: string, resolution: "RESUELTA" | "DESCARTADA", reason: string) {
    const response = await apiRequest<{ data: ShiftAlert }>(`/shifts/alerts/${id}/resolve`, { method: "POST", body: { resolution, reason } });
    await invalidateCacheFamily("shift-alerts", "shift alert resolved");
    return response.data;
  },
};
