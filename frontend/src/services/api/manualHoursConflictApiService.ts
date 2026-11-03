import { apiRequest } from "./apiClient";
import { invalidateCacheFamily, WORKED_TIME_DERIVED_CACHE_FAMILIES, type CacheFamily } from "../cache";

// Fichada sobre horas cargadas a mano (docs/decisions/MANUAL_HOURS_VS_CLOCK_PUNCH.md).
// Mientras la revisión está pendiente computan las horas manuales y la fichada
// queda como evidencia; un responsable decide cuáles conservar.

export type ManualHoursDecision = "KEEP_MANUAL" | "USE_CLOCK";

export type ManualHoursConflictDay = {
  date: string;
  // Horas fijadas por una persona en esa fecha (null: no hay carga manual).
  manualMinutes: number | null;
  manualStatus: string | null;
  // Minutos de ESTA jornada fichada en esa fecha.
  clockMinutes: number;
  // Lo que computa hoy esa fecha.
  countedMinutes: number;
};

export type ManualHoursConflict = {
  id: string;
  employee: { id: string; legajo: string; firstName: string; lastName: string };
  operationalDate: string;
  status: "PENDIENTE" | "RESUELTA";
  decision: ManualHoursDecision | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  shift: { id: string; startAt: string; endAt: string | null; totalMinutes: number | null };
  days: ManualHoursConflictDay[];
  manualMinutes: number;
  clockMinutes: number;
  differenceMinutes: number;
};

// Usar las horas fichadas cambia horas (grilla, resumen, dashboard, cierres)
// y cualquiera de las dos decisiones resuelve una alerta de turno.
const RESOLUTION_DEPENDENT_CACHE_FAMILIES: readonly CacheFamily[] = [...WORKED_TIME_DERIVED_CACHE_FAMILIES, "shift-alerts", "notifications"];

export const manualHoursConflictApiService = {
  // Sin caché: tiene que mostrar la decisión recién tomada (por esta u otra persona).
  async list(period: string, employeeId?: string): Promise<ManualHoursConflict[]> {
    const params = new URLSearchParams({ period });
    if (employeeId) params.set("employeeId", employeeId);
    const response = await apiRequest<{ data: ManualHoursConflict[] }>(`/time-entries/manual-hours-conflicts?${params.toString()}`, { apiCache: false });
    return response.data;
  },

  async resolve(id: string, decision: ManualHoursDecision, correctionReason?: string): Promise<ManualHoursConflict> {
    const response = await apiRequest<{ data: ManualHoursConflict }>(`/time-entries/manual-hours-conflicts/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      body: { decision, ...(correctionReason?.trim() ? { correctionReason: correctionReason.trim() } : {}) },
    });
    await Promise.all(RESOLUTION_DEPENDENT_CACHE_FAMILIES.map((family) => invalidateCacheFamily(family, "manual hours conflict resolved")));
    return response.data;
  },
};
