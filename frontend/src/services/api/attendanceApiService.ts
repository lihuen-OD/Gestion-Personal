import { apiDownload, apiRequest } from "./apiClient";

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
};

export type AttendanceTimeEntry = {
  id: string;
  date: string;
  hours: string | number;
  totalMinutes: number;
  status: string;
  observation?: string | null;
  hourConcept: { id: string; name: string; kind: string };
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

export const attendanceApiService = {
  async getSummary(date?: string) {
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    const query = params.toString();
    const response = await apiRequest<AttendanceSummaryResponse>(`/time-entries/attendance${query ? `?${query}` : ""}`, {
      apiCache: false,
    });
    return response.data;
  },

  async getObservations(filters: { date?: string; search?: string; type?: "ALL" | "SHIFT" | "PUNCH" | "INACTIVITY"; reviewStatus?: "PENDIENTE" | "RESUELTA" | "DESCARTADA" | "ALL"; before?: string; take?: number } = {}) {
    const params = new URLSearchParams();
    if (filters.date) params.set("date", filters.date);
    if (filters.search?.trim()) params.set("search", filters.search.trim());
    if (filters.type) params.set("type", filters.type);
    if (filters.reviewStatus) params.set("reviewStatus", filters.reviewStatus);
    if (filters.before) params.set("before", filters.before);
    params.set("take", String(filters.take || 10));
    return apiRequest<{ data: AttendanceObservation[]; meta: { total: number; pageSize: number; hasMore: boolean; nextBefore: string | null } }>(`/time-entries/attendance/observations?${params.toString()}`, { apiCache: false });
  },

  resolveObservation(kind: "SHIFT" | "PUNCH" | "INACTIVITY", id: string, resolution: "RESUELTA" | "DESCARTADA", reason: string) {
    return apiRequest<{ data: unknown }>(`/time-entries/attendance/observations/${kind}/${id}/resolve`, {
      method: "POST",
      body: { resolution, reason },
    });
  },

  closeWorkShiftManually(id: string, input: { endAt: string; reason: string }) {
    return apiRequest<{ data: unknown }>(`/time-entries/work-shifts/${id}/close-manual`, {
      method: "POST",
      body: input,
    });
  },

  markMissingOut(id: string, reason: string) {
    return apiRequest<{ data: unknown }>(`/time-entries/work-shifts/${id}/missing-out`, {
      method: "POST",
      body: { reason },
    });
  },

  observeWorkShift(id: string, reason: string) {
    return apiRequest<{ data: unknown }>(`/time-entries/work-shifts/${id}/observe`, {
      method: "POST",
      body: { reason },
    });
  },

  downloadPunchPhoto(id: string) {
    return apiDownload(`/time-entries/attendance/punches/${id}/photo`);
  },
};
