import { apiRequest } from "./apiClient";
import { collectAllPages } from "./listQuery";
import { cachePolicies, cachedData, invalidateCacheFamily, NOVELTY_COVERAGE_DERIVED_CACHE_FAMILIES } from "../cache";

// Etapa 5 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §13.7): este cambio puede reinterpretar la cobertura de novedades.
function invalidateNoveltyCoverageDerivedCaches(reason: string) {
  return Promise.all(NOVELTY_COVERAGE_DERIVED_CACHE_FAMILIES.map((family) => invalidateCacheFamily(family, reason)));
}

// Etapa 12D: fechas de feriado — vienen siempre de Horas Especiales
// (DoubleHourRule.kind=FERIADO, Etapa 12B), nunca se calculan ni se
// duplican acá. `rules` es sólo informativo (nombre de la/las reglas que
// originaron la fecha); no trae multiplicador/prioridad/conflictos —eso es
// de liquidación, no de esta pantalla.
export type HolidayDate = { date: string; rules: Array<{ id: string; name: string }> };

export type HolidayWorkAssignmentStatus = "ACTIVA" | "CANCELADA";

// Turno REAL del feriado sin la convocatoria (§20): fijo vigente ese día,
// bloques de la rotación, descanso, día sin configurar, conflicto o ninguno.
export type HolidayWorkExpectedSchedule = {
  kind: "FIXED" | "ROTATION_SHIFTS" | "ROTATION_REST" | "ROTATION_MISSING" | "ROTATION_CONFLICT" | "NONE";
  blocks: Array<{ templateId: string; code: string; name: string | null; startTime: string; endTime: string }>;
  planReason: string | null;
};

export type HolidayWorkAssignmentCandidate = {
  id: string;
  legajo: string;
  firstName: string;
  lastName: string;
  status: string;
  // Con `date`: turno real del feriado. null sin fecha.
  expectedSchedule?: HolidayWorkExpectedSchedule | null;
  // Franco ACTIVO en el feriado pedido (`date`): no se puede convocar.
  dayOff?: boolean;
  // Período de `date` enviado/aprobado: sólo RRHH lo corrige, con motivo.
  periodLocked?: boolean;
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
  // §20: rotación con conflicto resuelta con la plantilla de la convocatoria.
  scheduleWarning?: string;
};

export type HolidayWorkAssignmentInput = {
  employeeId: string;
  status?: HolidayWorkAssignmentStatus;
  shiftTemplateId?: string | null;
  expectedStartTime?: string | null;
  expectedEndTime?: string | null;
  notes?: string | null;
};

// A7: `locationZoneId` + `locationDate` (día del feriado). M2 retiró el filtro por sector anterior.
export type HolidayWorkCandidatesFilters = { date?: string; locationZoneId?: string; locationDate?: string; shiftTemplateId?: string; withoutShift?: boolean; search?: string; page?: number; take?: number };
export type HolidayWorkCandidatesMeta = { total: number; page: number; pageSize: number; hasMore: boolean };

export const holidayWorkAssignmentApiService = {
  // Etapa 14H.4: envuelto con `cachedData` (dedupe in-flight, familia
  // "workforce-config" compartida con doubleHourRulesCalendarByMonth -- ver
  // cachePolicy.ts) -- el journey 14H.1/14H.3 detectó 2 requests duplicadas
  // (StrictMode) al entrar a esta pantalla. Se invalida sola cuando cambia
  // una regla de Horas Especiales (misma familia); saveAssignments no la
  // invalida porque las convocatorias no cambian qué fechas son feriado.
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
    if (filters.date) params.set("date", filters.date);
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
  // La convocatoria sólo define la obligación de asistir (docs/decisions/
  // WORKED_TIME_ACCOUNTING_MODEL.md §20): no reinterpreta horas, pero cambia la
  // cobertura de novedades de los convocados (obligación del día), así que se
  // invalidan las pantallas derivadas de esa cobertura.
  async saveAssignments(date: string, assignments: HolidayWorkAssignmentInput[], correctionReason?: string | null) {
    const body = { date, assignments, ...(correctionReason ? { correctionReason } : {}) };
    const result = await apiRequest<{ data: HolidayWorkAssignment[] }>("/shifts/holiday-work/assignments", { method: "PUT", body }).then((response) => response.data);
    await invalidateNoveltyCoverageDerivedCaches("holiday work assignments saved");
    return result;
  },
};
