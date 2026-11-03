import { apiRequest } from "./apiClient";
import type { ListMeta } from "./listQuery";
import { invalidateCacheFamily, WORKED_TIME_DERIVED_CACHE_FAMILIES, type CacheFamily } from "../cache";

// Francos por empleado y fecha (docs/decisions/EMPLOYEE_DAY_OFF.md). Un franco
// significa que esa persona no tiene obligación de trabajar esa fecha: las
// horas que registre el fichador no computan hasta que alguien las reconozca.

export type EmployeeDayOffStatus = "ACTIVO" | "CANCELADO";

// Actividad registrada por el fichador en las jornadas de esa fecha operativa
// (evidencia). Lo que computa lo dice la contabilidad del backend.
export type DayOffActivity = {
  notes: string | null;
  activityShifts: number;
  activityMinutes: number;
};

export type TimeGridDayOff = DayOffActivity & { status: "ACTIVO" };

export type DayOffCandidate = {
  employee: { id: string; legajo: string; firstName: string; lastName: string };
  dayOff: { id: string; status: EmployeeDayOffStatus; notes: string | null; updatedAt: string } | null;
  // Convocado a trabajar el feriado de esa fecha: el backend bloquea el franco.
  holidayWork: boolean;
  // Período enviado/aprobado: sólo RRHH, con motivo.
  periodLocked: boolean;
};

export type SaveDayOffsInput = {
  date: string;
  correctionReason?: string | null;
  employees: Array<{ employeeId: string; status: EmployeeDayOffStatus; notes?: string | null }>;
};

export type SaveDayOffsResult = {
  date: string;
  summary: { changed: number; unchanged: number; activityAlerts: number; resolvedActivityAlerts: number; resolvedInactivityIncidents: number };
};

// Un franco reinterpreta horas (grilla, resumen, dashboard, cierres) y puede
// crear o resolver alertas con su notificación — mismo alcance que el backend
// (EMPLOYEE_DAY_OFF.md §14).
const DAY_OFF_DEPENDENT_CACHE_FAMILIES: readonly CacheFamily[] = [...WORKED_TIME_DERIVED_CACHE_FAMILIES, "shift-alerts", "notifications"];

export const employeeDayOffApiService = {
  // Sin caché: el modal decide a quién se le asigna franco con el estado vigente.
  async getByDate(filters: { date: string; search?: string; page?: number; take?: number }) {
    const params = new URLSearchParams({ date: filters.date, page: String(filters.page || 1), take: String(filters.take || 50) });
    if (filters.search?.trim()) params.set("search", filters.search.trim());
    const response = await apiRequest<{ data: { date: string; items: DayOffCandidate[] }; meta: ListMeta }>(`/employee-day-offs/by-date?${params.toString()}`, { apiCache: false });
    return { items: response.data.items, meta: response.meta };
  },

  async save(input: SaveDayOffsInput): Promise<SaveDayOffsResult> {
    const response = await apiRequest<{ data: SaveDayOffsResult }>("/employee-day-offs", { method: "PUT", body: input });
    await Promise.all(DAY_OFF_DEPENDENT_CACHE_FAMILIES.map((family) => invalidateCacheFamily(family, "employee day offs saved")));
    return response.data;
  },
};
