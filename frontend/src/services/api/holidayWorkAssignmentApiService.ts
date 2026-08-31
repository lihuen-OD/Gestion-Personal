import { apiRequest } from "./apiClient";

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

export type HolidayWorkCandidatesFilters = { sectorId?: string; shiftTemplateId?: string; withoutShift?: boolean; search?: string; page?: number; take?: number };
export type HolidayWorkCandidatesMeta = { total: number; page: number; pageSize: number; hasMore: boolean };

export const holidayWorkAssignmentApiService = {
  getHolidayDates(from: string, to: string) {
    return apiRequest<{ data: HolidayDate[] }>(`/shifts/holiday-work/dates?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { apiCache: false }).then((response) => response.data);
  },
  getCandidates(filters: HolidayWorkCandidatesFilters = {}) {
    const params = new URLSearchParams();
    params.set("page", String(filters.page || 1));
    // Etapa 12D (límite V1 documentado): sin "cargar más"/paginación real en
    // la UI todavía — take alto (300) alcanza para un solo establecimiento
    // operando hoy; si el headcount activo supera ese número, esta pantalla
    // no lo mostraría completo sin filtrar por sector/turno/búsqueda. Ver
    // docs/decisions/HOLIDAY_WORK_ASSIGNMENTS_12D.md §10 (Performance).
    params.set("take", String(filters.take || 300));
    if (filters.sectorId) params.set("sectorId", filters.sectorId);
    if (filters.shiftTemplateId) params.set("shiftTemplateId", filters.shiftTemplateId);
    if (filters.withoutShift) params.set("withoutShift", "true");
    if (filters.search?.trim()) params.set("search", filters.search.trim());
    return apiRequest<{ data: HolidayWorkAssignmentCandidate[]; meta: HolidayWorkCandidatesMeta }>(`/shifts/holiday-work/candidates?${params.toString()}`, { apiCache: false }).then((response) => ({ items: response.data, meta: response.meta }));
  },
  getAssignmentsByDate(date: string) {
    return apiRequest<{ data: { date: string; assignments: HolidayWorkAssignment[] } }>(`/shifts/holiday-work/assignments?date=${encodeURIComponent(date)}`, { apiCache: false }).then((response) => response.data);
  },
  saveAssignments(date: string, assignments: HolidayWorkAssignmentInput[]) {
    return apiRequest<{ data: HolidayWorkAssignment[] }>("/shifts/holiday-work/assignments", { method: "PUT", body: { date, assignments } }).then((response) => response.data);
  },
};
