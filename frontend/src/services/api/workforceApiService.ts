import { apiRequest } from "./apiClient";
import { cachePolicies, cachedData, invalidateCacheFamily, NOVELTY_COVERAGE_DERIVED_CACHE_FAMILIES } from "../cache";
import type { ShiftGroupSummary } from "./shiftGroupApiService";

// Etapa 5 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §13.7): este cambio puede reinterpretar la cobertura de novedades.
function invalidateNoveltyCoverageDerivedCaches(reason: string) {
  return Promise.all(NOVELTY_COVERAGE_DERIVED_CACHE_FAMILIES.map((family) => invalidateCacheFamily(family, reason)));
}

export type MonthlyClosure = {
  id: string;
  employeeId: string;
  period: string;
  status: "ABIERTO" | "CERRADO";
  closedAt?: string | null;
  reopenedAt?: string | null;
  reopenReason?: string | null;
  employee: { id: string; legajo: string; firstName: string; lastName: string };
  closedBy?: { name: string } | null;
  reopenedBy?: { name: string } | null;
  exportHistory?: { count: number; latestVersion: number; latestExportedAt: string } | null;
};

export type ClosureBlockerType = "OPEN_SHIFT" | "INCOMPLETE_SHIFT" | "MANUAL_CLOCK_CONFLICT" | "NOVELTY_REVIEW";

export type ClosureBlocker = {
  id: string;
  type: ClosureBlockerType;
  employee: MonthlyClosure["employee"];
  /** Fecha operativa `YYYY-MM-DD`. */
  date: string;
  title: string;
  reason: string;
  action: string;
  resolution: { module: "ATTENDANCE" | "HOURS" | "EMPLOYEE_HOURS"; label: string; path: string };
};

export type ClosureBlockerGroup = { employee: MonthlyClosure["employee"]; blockers: ClosureBlocker[] };

export type ClosureBlockersPreview = { period: string; employees: ClosureBlockerGroup[]; totals: { employees: number; blockers: number } };

function isClosureBlockersPreview(value: ClosureBlockersPreview) {
  return Boolean(value && Array.isArray(value.employees) && value.employees.every((group) => typeof group.employee?.id === "string" && Array.isArray(group.blockers)));
}

export type SystemNotification = {
  id: string;
  type: string;
  priority: string;
  title: string;
  message: string;
  link?: string | null;
  status: "NO_LEIDA" | "LEIDA";
  // Fecha efectiva del hecho de negocio (fijada al crear la notificación,
  // inmutable): la ÚNICA fecha que la pantalla muestra, y la misma con la que
  // el backend ordena y filtra. `createdAt` es sólo la creación técnica de la
  // fila — ver docs/decisions/NOTIFICATIONS_EVENT_ORDER.md.
  eventAt: string;
  createdAt: string;
  entityType?: string | null;
  employee?: { id: string; legajo: string; firstName: string; lastName: string };
};
export type SystemNotificationListParams = {
  status?: "NO_LEIDA" | "LEIDA";
  // Días calendario Argentina "AAAA-MM-DD", inclusive, sobre `eventAt`.
  dateFrom?: string;
  dateTo?: string;
  // Cursor opaco que devuelve el backend (`meta.nextCursor`): `after` pide lo
  // que sigue; `through` vuelve a pedir la ventana visible hasta esa fila.
  after?: string;
  through?: string;
  page?: number;
  take?: number;
};
export type SystemNotificationListMeta = { total: number; page: number; pageSize: number; hasMore: boolean; nextCursor: string | null };
// Tope del refresco de ventana — mismo máximo `take` que acepta el backend.
export const NOTIFICATIONS_REFRESH_WINDOW_MAX = 100;

// Etapa 15M.19C: único intervalo de polling de notificaciones, compartido
// entre la campana del topbar (AppShell.tsx) y NotificationsPage — antes de
// esta etapa sólo la campana tenía este número, hardcodeado inline. Evita
// dos constantes mágicas que puedan divergir con el tiempo.
export const NOTIFICATIONS_POLL_INTERVAL_MS = 60_000;
export type ShiftTemplate = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  categoryName?: string | null;
  // R3: grupo (lugar) de la plantilla. null/ausente = sin grupo, estado válido.
  shiftGroupId?: string | null;
  shiftGroup?: ShiftGroupSummary | null;
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
  // R3: null desasigna; ausente no cambia el grupo.
  shiftGroupId?: string | null;
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

// Una regla de Hora Especial reinterpreta horas ya cargadas (equivalencia,
// grillas, cierres): además de la configuración, se invalidan todas las
// familias que muestran contabilidad de horas (WORKED_TIME_ACCOUNTING_MODEL.md §15).
async function invalidateDoubleHourRuleDependentCaches(reason: string) {
  await Promise.all([invalidateCacheFamily("workforce-config", reason), invalidateNoveltyCoverageDerivedCaches(reason)]);
}

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
  /**
   * Bloqueantes del período (mismo criterio que el cierre definitivo). Sin
   * cache: tiene que reflejar cada incidencia resuelta en cuanto se vuelve.
   */
  async closureBlockers(period: string): Promise<ClosureBlockersPreview> {
    const data = await apiRequest<{ data: ClosureBlockersPreview }>(`/workforce/closures/blockers?period=${encodeURIComponent(period)}`, { apiCache: false }).then((response) => response.data);
    if (!isClosureBlockersPreview(data)) throw new Error("Respuesta inválida de bloqueantes del cierre.");
    return data;
  },

  async closeClosures(period: string, employeeIds: string[]) {
    const result = await apiRequest<{ data: MonthlyClosure[] }>("/workforce/closures/close", { method: "POST", body: { period, employeeIds } }).then((response) => response.data);
    await invalidateCacheFamily("monthly-closures", "closures closed");
    return result;
  },
  async reopenClosure(id: string, reason: string, acknowledgeExportedHistory = false) {
    const result = await apiRequest<{ data: MonthlyClosure }>(`/workforce/closures/${id}/reopen`, { method: "POST", body: { reason, acknowledgeExportedHistory } }).then((response) => response.data);
    await invalidateCacheFamily("monthly-closures", "closure reopened");
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
    if (params.dateFrom) query.set("dateFrom", params.dateFrom);
    if (params.dateTo) query.set("dateTo", params.dateTo);
    if (params.after) query.set("after", params.after);
    if (params.through) query.set("through", params.through);
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
    await Promise.all([invalidateCacheFamily("workforce-config", "shift template updated"), invalidateNoveltyCoverageDerivedCaches("shift template updated")]);
    return result;
  },
  async removeShiftTemplate(id: string) {
    const result = await apiRequest<{ data: { mode: "DELETED" | "INACTIVATED"; id?: string; item?: ShiftTemplate; relatedWorkShifts: number } }>(`/workforce/shift-templates/${id}`, { method: "DELETE" }).then((response) => response.data);
    await Promise.all([invalidateCacheFamily("workforce-config", "shift template removed"), invalidateNoveltyCoverageDerivedCaches("shift template removed")]);
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
    await invalidateDoubleHourRuleDependentCaches("double hour rule created");
    return result;
  },
  async updateDoubleHourRule(id: string, input: Partial<DoubleHourRuleInput>) {
    const result = await apiRequest<{ data: DoubleHourRule }>(`/workforce/double-hour-rules/${id}`, { method: "PATCH", body: input }).then((response) => response.data);
    await invalidateDoubleHourRuleDependentCaches("double hour rule updated");
    return result;
  },
  async removeDoubleHourRule(id: string) {
    // Siempre borrado físico (nunca inactiva): Inactivar es updateDoubleHourRule({ status }).
    const result = await apiRequest<{ data: { mode: "DELETED"; id: string } }>(`/workforce/double-hour-rules/${id}`, { method: "DELETE" }).then((response) => response.data);
    await invalidateDoubleHourRuleDependentCaches("double hour rule removed");
    return result;
  },
  async afterDoubleHourRuleDeletion() {
    await invalidateDoubleHourRuleDependentCaches("double hour rule deleted");
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
