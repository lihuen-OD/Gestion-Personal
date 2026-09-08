import { apiDownload, apiRequest } from "./apiClient";
import { cachePolicies, cachedData, invalidateCacheFamily } from "../cache";

export type AttendanceEmployee = {
  id: string;
  legajo: string;
  dni: string;
  firstName: string;
  lastName: string;
  status: string;
  sector?: { id: string; name: string; code: string } | null;
  position?: { id: string; name: string; code: string } | null;
};

// SUGERIDO/MANUAL/SIN_CONCEPTO_COMPATIBLE/CONCEPTO_NO_HABILITADO (ver
// SegmentConceptStatus en el backend). Solo viene poblado por
// /time-entries/attendance/observations hoy (bare include de Prisma) — el
// resumen de /time-entries/attendance todavía no lo selecciona (ver
// hourConceptRuleId/conceptStatus abajo). No hardcodeamos nada acá: el
// nombre real del concepto sigue viniendo de hourConceptName.
export type SegmentConceptStatus = "SUGERIDO" | "MANUAL" | "SIN_CONCEPTO_COMPATIBLE" | "CONCEPTO_NO_HABILITADO";

// Ahora sí llega desde /time-entries/attendance y /attendance/observations
// (Etapa 8F unificó el select) — doubleHourRule.name es la única forma de
// saber CUÁL regla especial se aplicó, no solo que isSpecial=true.
export type AttendanceSegmentSpecialRuleApplication = {
  id: string;
  multiplierApplied: number | string;
  doubleHourRule: { id: string; name: string };
};

export type AttendanceSegment = {
  id: string;
  date: string;
  fromDateTime: string;
  toDateTime: string;
  minutes: number;
  hourConceptName: string;
  isHoliday: boolean;
  isNight: boolean;
  isSpecial: boolean;
  observation?: string | null;
  // Opcionales a propósito: hoy solo llegan poblados cuando el shift viene
  // de attendanceApiService.getObservations() (el backend ahí no recorta el
  // select de TimeSegment). Si viene de getSummary(), quedan undefined —
  // WorkShiftSegmentsPanel debe mostrar "no disponible", nunca inventarlos.
  // (hourConceptId del segmento — el "ganador" del clasificador legacy — se
  // eliminó de este tipo en la Etapa 6R: nunca se leía en el frontend; el
  // total trabajado siempre sale de TimeEntry/Hora normal, no de acá.)
  hourConceptRuleId?: string | null;
  conceptStatus?: SegmentConceptStatus;
  specialHourRuleApplications?: AttendanceSegmentSpecialRuleApplication[];
};

export type AttendanceTimeEntry = {
  id: string;
  date: string;
  hours: string | number;
  totalMinutes: number;
  status: string;
  observation?: string | null;
  hourConcept: { id: string; name: string; kind: string };
  // Mismo caso que arriba: solo poblados para shifts de getObservations().
  appliedMultiplier?: string | number;
  actualMinutes?: number | null;
  timeSegmentId?: string | null;
};

export type OpenShiftRiskLevel = "NORMAL" | "MISSING_OUT" | "EXPIRED";

export type OpenShiftRisk = {
  level: OpenShiftRiskLevel;
  minutesOpen: number;
  missingOutThresholdMinutes: number | null;
  absoluteLimitMinutes: number;
  expectedExitAt: string | null;
};

export type AttendanceShift = {
  id: string;
  employeeId: string;
  source: string;
  status: string;
  startAt: string;
  endAt?: string | null;
  totalMinutes?: number | null;
  workedMinutes: number;
  workedHours: number;
  crossesMidnight: boolean;
  observation?: string | null;
  reviewStatus?: "PENDIENTE" | "RESUELTA" | "DESCARTADA";
  reviewNote?: string | null;
  reviewedAt?: string | null;
  employee: AttendanceEmployee;
  startPunch?: AttendancePunchEvidence | null;
  endPunch?: AttendancePunchEvidence | null;
  timeSegments: AttendanceSegment[];
  timeEntries: AttendanceTimeEntry[];
  shiftTemplateId?: string | null;
  shiftTemplate?: { id: string; code: string; name: string } | null;
  risk?: OpenShiftRisk;
};

export type AttendancePunchEvidence = {
  id: string;
  timestamp: string;
  source: string;
  status: string;
  observation?: string | null;
  photoStoragePath?: string | null;
  photoUrl?: string | null;
  photoFileId?: string | null;
  thumbnailFileId?: string | null;
  faceDetected: boolean;
  faceValidationStatus?: string | null;
  faceDetectionScore?: number | null;
};

export type AttendancePunch = {
  id: string;
  employeeId: string;
  type: "INGRESO" | "SALIDA";
  timestamp: string;
  source: string;
  status: string;
  observation?: string | null;
  reviewStatus?: "PENDIENTE" | "RESUELTA" | "DESCARTADA";
  reviewNote?: string | null;
  reviewedAt?: string | null;
  photoStoragePath?: string | null;
  photoUrl?: string | null;
  photoFileId?: string | null;
  thumbnailFileId?: string | null;
  faceDetected: boolean;
  faceValidationStatus?: string | null;
  faceDetectionScore?: number | null;
  employee: AttendanceEmployee;
};

export type AttendanceInactivityIncident = {
  id: string;
  employeeId: string;
  operationalDate: string;
  status: "PENDIENTE" | "RESUELTA" | "DESCARTADA";
  observation: string;
  detectedAt: string;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  employee: AttendanceEmployee;
};

export type AttendanceSummary = {
  date: string;
  totals: {
    open: number;
    closed: number;
    observed: number;
    workedHours: number;
  };
  openShifts: AttendanceShift[];
  closedShifts: AttendanceShift[];
  observedShifts: AttendanceShift[];
  observedPunches: AttendancePunch[];
};

type AttendanceSummaryResponse = { data: AttendanceSummary };
export type AttendanceObservation =
  | { kind: "SHIFT"; occurredAt: string; shift: AttendanceShift }
  | { kind: "PUNCH"; occurredAt: string; punch: AttendancePunch }
  | { kind: "INACTIVITY"; occurredAt: string; incident: AttendanceInactivityIncident };

// Etapa 14G.9: `getSummary`/`getObservations` no tenían dedupe in-flight —
// el doble-montaje de React StrictMode disparaba 2 llamadas de red reales a
// cada uno, confirmado en el journey de 14G.8 ("Entrar a Asistencia":
// `GET /time-entries/attendance` x2, `GET /time-entries/attendance/
// observations` x2) — mismo síntoma ya resuelto en el resto de las listas
// operativas del proyecto, documentado como pendiente desde 14G.3 §12
// ("Duplicado por StrictMode aún sin dedupe frontend"). Misma familia
// "time-entries" que `timeEntryApiService` a propósito: el backend ya
// agrupa estos 2 endpoints junto con el resto de time-entries bajo
// `clearTimeEntriesReadCaches()` (ver timeEntries.cache.ts) — reusar la
// misma familia en el frontend refleja esa misma agrupación, sin cache
// nueva (`cachePolicies.timeEntriesAggregates`, ya usada por
// `getSummary`/`getPeriodEmployees`/`list`/`listByEmployee` de
// timeEntryApiService).
export const attendanceApiService = {
  async getSummary(date?: string) {
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    const query = params.toString();
    const key = `/time-entries/attendance${query ? `?${query}` : ""}`;
    return cachedData({
      requestKey: `GET:${key}`,
      policy: cachePolicies.timeEntriesAggregates,
      fetcher: () => apiRequest<AttendanceSummaryResponse>(key, { apiCache: false }).then((response) => response.data),
      validate: (value: AttendanceSummary) => Boolean(value && value.totals && typeof value.totals.open === "number"),
    });
  },

  async getObservations(filters: { date?: string; search?: string; type?: "ALL" | "SHIFT" | "PUNCH" | "INACTIVITY"; reviewStatus?: "PENDIENTE" | "RESUELTA" | "DESCARTADA" | "ALL"; before?: string; take?: number } = {}) {
    const params = new URLSearchParams();
    if (filters.date) params.set("date", filters.date);
    if (filters.search?.trim()) params.set("search", filters.search.trim());
    if (filters.type) params.set("type", filters.type);
    if (filters.reviewStatus) params.set("reviewStatus", filters.reviewStatus);
    if (filters.before) params.set("before", filters.before);
    params.set("take", String(filters.take || 10));
    const key = `/time-entries/attendance/observations?${params.toString()}`;
    return cachedData({
      requestKey: `GET:${key}`,
      policy: cachePolicies.timeEntriesAggregates,
      fetcher: () => apiRequest<{ data: AttendanceObservation[]; meta: { total: number; pageSize: number; hasMore: boolean; nextBefore: string | null } }>(key, { apiCache: false }),
      validate: (value: { data: AttendanceObservation[]; meta: unknown }) => Boolean(value && Array.isArray(value.data)),
    });
  },

  // Etapa 14G.9: las 4 escrituras de abajo ahora invalidan la familia
  // "time-entries" -- necesario recién ahora que getSummary/getObservations
  // pasan por `cachedData` (antes no había nada que invalidar del lado del
  // frontend; el backend ya se invalidaba solo vía clearTimeEntriesReadCaches()).
  async resolveObservation(kind: "SHIFT" | "PUNCH" | "INACTIVITY", id: string, resolution: "RESUELTA" | "DESCARTADA", reason: string) {
    const result = await apiRequest<{ data: unknown }>(`/time-entries/attendance/observations/${kind}/${id}/resolve`, {
      method: "POST",
      body: { resolution, reason },
    });
    await invalidateCacheFamily("time-entries", "attendance observation resolved");
    return result;
  },

  async closeWorkShiftManually(id: string, input: { endAt: string; reason: string }) {
    const result = await apiRequest<{ data: unknown }>(`/time-entries/work-shifts/${id}/close-manual`, {
      method: "POST",
      body: input,
    });
    await invalidateCacheFamily("time-entries", "work shift closed manually");
    return result;
  },

  async markMissingOut(id: string, reason: string) {
    const result = await apiRequest<{ data: unknown }>(`/time-entries/work-shifts/${id}/missing-out`, {
      method: "POST",
      body: { reason },
    });
    await invalidateCacheFamily("time-entries", "work shift missing out marked");
    return result;
  },

  async observeWorkShift(id: string, reason: string) {
    const result = await apiRequest<{ data: unknown }>(`/time-entries/work-shifts/${id}/observe`, {
      method: "POST",
      body: { reason },
    });
    await invalidateCacheFamily("time-entries", "work shift observed");
    return result;
  },

  downloadPunchPhoto(id: string) {
    return apiDownload(`/time-entries/attendance/punches/${id}/photo`);
  },
};
