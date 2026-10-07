import { apiRequest } from "./apiClient";
import { collectAllPages } from "./listQuery";
import { cachePolicies, cachedData, invalidateCacheFamily, WORKED_TIME_DERIVED_CACHE_FAMILIES } from "../cache";

// Etapa 12D: fechas de feriado — vienen siempre de Horas Especiales
// (DoubleHourRule.kind=FERIADO, Etapa 12B), nunca se calculan ni se
// duplican acá. `rules` es sólo informativo (nombre de la/las reglas que
// originaron la fecha); no trae multiplicador/prioridad/conflictos —eso es
// de liquidación, no de esta pantalla.
export type HolidayDate = { date: string; rules: Array<{ id: string; name: string }> };

export type HolidayWorkAssignmentStatus = "ACTIVA" | "CANCELADA";

export type HolidayWorkAssignmentCandidate = {
  id: string;
  legajo: string;
  firstName: string;
  lastName: string;
  status: string;
  sector?: { id: string; name: string } | null;
  shiftAssignments: Array<{ shiftTemplate: { id: string; code: string; name: string } }>;
};

export type HolidayWorkAssignment = {
  id: string;
  date: string;
  employeeId: string;
  shiftTemplateId?: string | null;
  expectedStartTime?: string | null;
  expectedEndTime?: string | null;
  notes?: string | null;
  status: HolidayWorkAssignmentStatus;
  createdAt: string;
  updatedAt: string;
  employee: { id: string; legajo: string; firstName: string; lastName: string; status: string };
  shiftTemplate?: { id: string; code: string; name: string } | null;
};

export type HolidayWorkAssignmentInput = {
  employeeId: string;
  status?: HolidayWorkAssignmentStatus;
  shiftTemplateId?: string | null;
  expectedStartTime?: string | null;
  expectedEndTime?: string | null;
  notes?: string | null;
};

// A7: `sectorId` = sector ANTERIOR; `locationZoneId` + `locationDate` (día del feriado).
export type HolidayWorkCandidatesFilters = { sectorId?: string; locationZoneId?: string; locationDate?: string; shiftTemplateId?: string; withoutShift?: boolean; search?: string; page?: number; take?: number };
export type HolidayWorkCandidatesMeta = { total: number; page: number; pageSize: number; hasMore: boolean };

export const holidayWorkAssignmentApiService = {
  // Etapa 14H.4: envuelto con `cachedData` (dedupe in-flight, familia
  // "workforce-config" compartida con doubleHourRulesCalendarByMonth -- ver
  // cachePolicy.ts) -- el journey 14H.1/14H.3 detectó 2 requests duplicadas
  // (StrictMode) al entrar a esta pantalla. Se invalida sola cuando cambia
  // una regla de Horas Especiales (misma familia); saveAssignments no la
  // invalida porque las convocatorias no cambian qué fechas son feriado (sí
  // cambian quién cobra el feriado: ver saveAssignments).
  getHolidayDates(from: string, to: string) {
    const path = `/shifts/holiday-work/dates?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    return cachedData({
      requestKey: `GET:${path}`,
      policy: cachePolicies.holidayDatesByMonth,
      fetcher: () => apiRequest<{ data: HolidayDate[] }>(path, { apiCache: false }).then((response) => response.data),
      validate: (value) => Array.isArray(value),
    });
  },
  // Planilla de asignación de un feriado: la pantalla necesita todos los
  // candidatos que cumplen los filtros (se marcan en bloque), así que se
  // recorren todas las páginas — antes page=1&take=300 ignoraba `meta` y el
  // candidato 301 no aparecía (límite V1 de la Etapa 12D, HOLIDAY_WORK_
  // ASSIGNMENTS_12D.md §10). Búsqueda y filtros siguen resolviéndose en el
  // backend antes de paginar.
  async getCandidates(filters: HolidayWorkCandidatesFilters = {}) {
    const params = new URLSearchParams();
    params.set("take", String(filters.take || 300));
    if (filters.sectorId) params.set("sectorId", filters.sectorId);
    if (filters.locationZoneId) {
      params.set("locationZoneId", filters.locationZoneId);
      if (filters.locationDate) params.set("locationDate", filters.locationDate);
    }
    if (filters.shiftTemplateId) params.set("shiftTemplateId", filters.shiftTemplateId);
    if (filters.withoutShift) params.set("withoutShift", "true");
    if (filters.search?.trim()) params.set("search", filters.search.trim());
    const items = await collectAllPages(`/shifts/holiday-work/candidates?${params.toString()}`, (path) => apiRequest<{ data: HolidayWorkAssignmentCandidate[]; meta: HolidayWorkCandidatesMeta }>(path, { apiCache: false }));
    const meta: HolidayWorkCandidatesMeta = { total: items.length, page: 1, pageSize: items.length, hasMore: false };
    return { items, meta };
  },
  getAssignmentsByDate(date: string) {
    return apiRequest<{ data: { date: string; assignments: HolidayWorkAssignment[] } }>(`/shifts/holiday-work/assignments?date=${encodeURIComponent(date)}`, { apiCache: false }).then((response) => response.data);
  },
  // La convocatoria define quién cobra un FERIADO (docs/decisions/
  // WORKED_TIME_ACCOUNTING_MODEL.md §16): el backend reinterpreta las horas
  // ya cargadas de la fecha, así que se invalidan todas las pantallas que
  // muestran contabilidad de horas (no las fechas de feriado, que no cambian).
  async saveAssignments(date: string, assignments: HolidayWorkAssignmentInput[]) {
    const result = await apiRequest<{ data: HolidayWorkAssignment[] }>("/shifts/holiday-work/assignments", { method: "PUT", body: { date, assignments } }).then((response) => response.data);
    await Promise.all(WORKED_TIME_DERIVED_CACHE_FAMILIES.map((family) => invalidateCacheFamily(family, "holiday work assignments saved")));
    return result;
  },
};
