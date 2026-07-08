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
  photoStoragePath?: string | null;
  photoUrl?: string | null;
  faceDetected: boolean;
  faceValidationStatus?: string | null;
  faceDetectionScore?: number | null;
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
