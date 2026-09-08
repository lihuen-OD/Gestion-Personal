import { apiRequest } from "./apiClient";
import { cachePolicies, cachedData, invalidateCacheFamily } from "../cache";

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
export type SystemNotificationListParams = { page?: number; take?: number; status?: "NO_LEIDA" | "LEIDA" };
export type SystemNotificationListMeta = { total: number; page: number; pageSize: number; hasMore: boolean };
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
// Etapa 12B: clasificación estructurada — independiente del nombre libre de
// la regla (`name` sigue siendo sólo texto visible). Sólo FERIADO alimentaría
// a futuro el filtro de asignaciones de feriado de Turnos.
export type DoubleHourRuleKind = "FERIADO" | "DOMINGO" | "JORNADA_ESPECIAL" | "OTRO";
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
  kind: DoubleHourRuleKind;
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
  kind?: DoubleHourRuleKind;
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
  rules: Array<{ id: string; name: string; priority: number; multiplier: number; kind: DoubleHourRuleKind }>;
  hasOverlap: boolean;
  hasConflict: boolean;
};

export const workforceApiService = {
  // Etapa 14G.8: envuelto con `cachedData` (dedupe in-flight, familia
  // "monthly-closures" compartida con `corrections` -- ver cachePolicy.ts).
  closures(period: string) {
    const key = `/workforce/closures?period=${encodeURIComponent(period)}`;
    return cachedData({
      requestKey: `GET:${key}`,
      policy: cachePolicies.monthlyClosuresList,
      fetcher: () => apiRequest<{ data: MonthlyClosure[] }>(key, { apiCache: false }).then((response) => response.data),
      validate: (value: MonthlyClosure[]) => Array.isArray(value),
    });
  },
  async submitClosures(period: string, employeeIds: string[]) {
    const result = await apiRequest<{ data: MonthlyClosure[] }>("/workforce/closures/submit", { method: "POST", body: { period, employeeIds } }).then((response) => response.data);
    await invalidateCacheFamily("monthly-closures", "closures submitted");
    return result;
  },
  async approveClosures(ids: string[], note?: string) {
    const result = await apiRequest<{ data: { count: number } }>("/workforce/closures/approve", { method: "POST", body: { ids, note } }).then((response) => response.data);
    await invalidateCacheFamily("monthly-closures", "closures approved");
    return result;
  },
  async returnClosure(id: string, reason: string) {
    const result = await apiRequest<{ data: MonthlyClosure }>(`/workforce/closures/${id}/return`, { method: "POST", body: { reason } }).then((response) => response.data);
    await invalidateCacheFamily("monthly-closures", "closure returned");
    return result;
  },
  // Etapa 14G.8: envuelto con `cachedData` -- misma familia "monthly-closures"
  // que `closures` a propósito: `corrections` no depende del período, así que
  // cambiar de período no lo vuelve a pedir mientras el TTL siga vigente.
  corrections() {
    return cachedData({
      requestKey: "GET:/workforce/corrections",
      policy: cachePolicies.timeCorrectionsList,
      fetcher: () => apiRequest<{ data: TimeCorrection[] }>("/workforce/corrections", { apiCache: false }).then((response) => response.data),
      validate: (value: TimeCorrection[]) => Array.isArray(value),
    });
  },
  async createCorrection(input: { timeEntryId: string; proposedHours: number; reason: string }) {
    const result = await apiRequest<{ data: TimeCorrection }>("/workforce/corrections", { method: "POST", body: input }).then((response) => response.data);
    await invalidateCacheFamily("monthly-closures", "correction created");
    return result;
  },
  // Etapa 9G: aprobar una corrección post-cierre reescribe TimeEntry.hours
  // (workforce.service.ts:approveCorrection) — afecta directo la métrica
  // "Horas cargadas" del dashboard. El backend ya invalida su propio cache
  // (auditService.register limpia dashboardMetricsCache siempre), pero el
  // cache del lado del frontend (dashboardMetricsApiService, TTL propio de
  // 30s) es una capa aparte que nada invalidaba — quedaba sirviendo el valor
  // viejo hasta que ese TTL expirara solo. rejectCorrection no toca
  // TimeEntry, así que no hace falta invalidar el dashboard en ese caso.
  // Etapa 14G.8: ambas ramas invalidan "monthly-closures" -- aprobar además
  // puede cambiar MonthlyTimeClosure.status (workforce.service.ts,
  // approveCorrection), no sólo TimeCorrectionRequest.
  async reviewCorrection(id: string, decision: "approve" | "reject", note?: string) {
    const result = await apiRequest<{ data: TimeCorrection }>(`/workforce/corrections/${id}/${decision}`, { method: "POST", body: { note } }).then((response) => response.data);
    if (decision === "approve") await invalidateCacheFamily("dashboard", "time correction approved");
    await invalidateCacheFamily("monthly-closures", decision === "approve" ? "time correction approved" : "time correction rejected");
    return result;
  },
  // Etapa 9I: antes pedía las 200 últimas notificaciones de una sola vez.
  // Ahora pagina real (page/take) y filtra por status server-side.
  // Etapa 14G.6: envuelto con `cachedData` (dedupe in-flight, misma familia
  // "notifications" que `unreadNotificationCount` -- `readNotification()`
  // invalida ambas con la misma llamada, ver cachePolicy.ts).
  notifications(params: SystemNotificationListParams = {}) {
    const query = new URLSearchParams();
    query.set("page", String(params.page || 1));
    query.set("take", String(params.take || 20));
    if (params.status) query.set("status", params.status);
    const key = `/workforce/notifications?${query.toString()}`;
    return cachedData({
      requestKey: `GET:${key}`,
      policy: cachePolicies.notificationsList,
      fetcher: () => apiRequest<{ data: SystemNotification[]; meta: SystemNotificationListMeta }>(key, { apiCache: false }).then((response) => ({ items: response.data, meta: response.meta })),
      validate: (value: { items: SystemNotification[]; meta: SystemNotificationListMeta }) => Boolean(value && Array.isArray(value.items) && value.meta && typeof value.meta.total === "number"),
    });
  },
  // Etapa 14F.2: `cachedData` agrega dedupe in-flight (AppShell monta el
  // effect dos veces en StrictMode, disparando 2 requests idénticos) + TTL
  // corto (20s) — sólo para sobrevivir ese doble-montaje/remounts rápidos,
  // no para esconder un conteo desactualizado (el propio intervalo de 60s de
  // AppShell y la invalidación de `readNotification` de abajo se encargan de
  // eso). No persiste en storage: es un badge, no hace falta.
  unreadNotificationCount() {
    return cachedData({
      requestKey: "GET:/workforce/notifications-unread-count",
      policy: cachePolicies.notificationsUnreadCount,
      fetcher: () => apiRequest<{ data: { count: number } }>("/workforce/notifications-unread-count").then((response) => response.data.count),
      validate: (value: number) => typeof value === "number" && Number.isFinite(value),
    });
  },
  readNotification(id: string) {
    // Invalida el cache del badge para que, apenas se marca una notificación
    // como leída, el próximo `unreadNotificationCount()` (disparado por el
    // evento "app:notifications-changed" que ya dispara NotificationsPage)
    // pida el número real en vez de servir el conteo cacheado, ahora viejo.
    return apiRequest(`/workforce/notifications/${id}/read`, { method: "POST" }).then(async (result) => {
      await invalidateCacheFamily("notifications", "notification marked as read");
      return result;
    });
  },
  // Etapa 14H.3: envuelto con `cachedData` (dedupe in-flight, familia
  // "workforce-config") -- el journey 14H.1/14H.2 detectó requests
  // duplicadas por StrictMode al entrar a Turnos, incluso con cache backend
  // ya activo (shiftTemplatesCache, Etapa 9C) porque sin dedupe del lado del
  // cliente dos llamadas casi simultáneas llegan al backend antes de que la
  // primera termine de escribir su propia cache.
  shiftTemplates() {
    return cachedData({
      requestKey: "GET:/workforce/shift-templates",
      policy: cachePolicies.shiftTemplatesCatalog,
      fetcher: () => apiRequest<{ data: ShiftTemplate[] }>("/workforce/shift-templates", { apiCache: false }).then((response) => response.data),
      validate: (value) => Array.isArray(value),
    });
  },
  async createShiftTemplate(input: ShiftTemplateInput) {
    const result = await apiRequest<{ data: ShiftTemplate }>("/workforce/shift-templates", { method: "POST", body: input }).then((response) => response.data);
    await invalidateCacheFamily("workforce-config", "shift template created");
    return result;
  },
  async updateShiftTemplate(id: string, input: Partial<ShiftTemplateInput>) {
    const result = await apiRequest<{ data: ShiftTemplate }>(`/workforce/shift-templates/${id}`, { method: "PATCH", body: input }).then((response) => response.data);
    await invalidateCacheFamily("workforce-config", "shift template updated");
    return result;
  },
  async removeShiftTemplate(id: string) {
    const result = await apiRequest<{ data: { mode: "DELETED" | "INACTIVATED"; id?: string; item?: ShiftTemplate; relatedWorkShifts: number } }>(`/workforce/shift-templates/${id}`, { method: "DELETE" }).then((response) => response.data);
    await invalidateCacheFamily("workforce-config", "shift template removed");
    return result;
  },
  // Etapa 14H.3: mismo criterio que shiftTemplates() arriba.
  doubleHourRules() {
    return cachedData({
      requestKey: "GET:/workforce/double-hour-rules",
      policy: cachePolicies.doubleHourRulesCatalog,
      fetcher: () => apiRequest<{ data: DoubleHourRule[] }>("/workforce/double-hour-rules", { apiCache: false }).then((response) => response.data),
      validate: (value) => Array.isArray(value),
    });
  },
  async createDoubleHourRule(input: DoubleHourRuleInput) {
    const result = await apiRequest<{ data: DoubleHourRule }>("/workforce/double-hour-rules", { method: "POST", body: input }).then((response) => response.data);
    await invalidateCacheFamily("workforce-config", "double hour rule created");
    return result;
  },
  async updateDoubleHourRule(id: string, input: Partial<DoubleHourRuleInput>) {
    const result = await apiRequest<{ data: DoubleHourRule }>(`/workforce/double-hour-rules/${id}`, { method: "PATCH", body: input }).then((response) => response.data);
    await invalidateCacheFamily("workforce-config", "double hour rule updated");
    return result;
  },
  async removeDoubleHourRule(id: string) {
    const result = await apiRequest<{ data: { mode: "DELETED" | "INACTIVATED"; id?: string; item?: DoubleHourRule } }>(`/workforce/double-hour-rules/${id}`, { method: "DELETE" }).then((response) => response.data);
    await invalidateCacheFamily("workforce-config", "double hour rule removed");
    return result;
  },
  // Etapa 12B: `kind` opcional — sin pasarlo, comportamiento idéntico al de
  // antes de esta etapa (sin filtro). Pensado para el futuro filtro de
  // asignaciones de feriado de Turnos (kind="FERIADO"), no usado todavía por
  // ninguna pantalla.
  // Etapa 14H.3: envuelto con `cachedData` (misma familia "workforce-config"
  // que doubleHourRules — invalidar una regla también refresca el calendario,
  // que muestra la misma entidad recortada por mes). `SpecialHourRulesCalendarMonth`
  // ya implementa su propio "silent refresh" (nunca blanquea la grilla en un
  // refetch por refreshToken/kindFilter) — cachedData no interfiere con eso,
  // sólo evita el request duplicado que StrictMode dispara en cada montaje.
  doubleHourRulesCalendar(from: string, to: string, kind?: DoubleHourRuleKind) {
    const query = new URLSearchParams({ from, to });
    if (kind) query.set("kind", kind);
    const path = `/workforce/double-hour-rules/calendar?${query.toString()}`;
    return cachedData({
      requestKey: `GET:${path}`,
      policy: cachePolicies.doubleHourRulesCalendarByMonth,
      fetcher: () => apiRequest<{ data: DoubleHourRuleCalendarDay[] }>(path, { apiCache: false }).then((response) => response.data),
      validate: (value) => Array.isArray(value),
    });
  },
};
