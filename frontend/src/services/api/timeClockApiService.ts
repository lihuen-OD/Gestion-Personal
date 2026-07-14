import { apiRequest } from "./apiClient";

type ClockEmployee = {
  id: string;
  legajo: string;
  dni: string;
  firstName: string;
  lastName: string;
  name: string;
};

export type ClockHourConcept = {
  id: string;
  code: string;
  name: string;
  kind: "NORMAL" | "ESPECIAL" | "FERIADO" | "LICENCIA" | "AUSENCIA" | "OTRO";
};

type ClockStatusResponse = {
  data: {
    employee: ClockEmployee;
    openShift: {
      id: string;
      startAt: string;
      hourConcept: ClockHourConcept | null;
    } | null;
    hourConcepts: ClockHourConcept[];
  };
};

type ClockInResponse = {
  data: {
    employee: ClockEmployee;
    previousOpenShift?: {
      id: string;
      startAt: string;
      status: "FALTA_SALIDA";
    };
    workShift: {
      id: string;
      startAt: string;
    };
  };
};

type ClockOutResponse = {
  data: {
    employee: ClockEmployee;
    workShift: {
      id: string;
      startAt: string;
      endAt: string;
      totalMinutes: number;
      totalHours: number;
    };
    segments: Array<{
      date: string;
      startAt: string;
      endAt: string;
      minutes: number;
      hours: number;
      label: string;
    }>;
  };
};

type ClockSearchResponse = { data: ClockEmployee[] };

export type ClockPhotoPunchInput = {
  requestId: string;
  employeeId: string;
  punchType: "IN" | "OUT";
  hourConceptId?: string;
  photo: string;
  thumbnail?: string;
  faceValidationStatus: "VALID" | "NO_FACE" | "MULTIPLE_FACES" | "LOW_LIGHT" | "FACE_TOO_SMALL" | "CAMERA_ERROR";
  faceDetectionScore?: number;
  device?: {
    userAgent?: string;
    platform?: string;
    language?: string;
    cameraLabel?: string;
  };
};

type ClockPunchResult = ClockInResponse["data"] | ClockOutResponse["data"];
type ClockAttemptStatusResponse = {
  data: {
    requestId: string;
    status: "PROCESSING" | "COMPLETED" | "FAILED";
    response: ClockPunchResult | null;
    error: { code: string; message: string; httpStatus: number } | null;
  };
};

function body(employeeId: string) {
  return { employeeId };
}

export const timeClockApiService = {
  async searchEmployees(search: string) {
    const params = new URLSearchParams({ search: search.trim() });
    const response = await apiRequest<ClockSearchResponse>(`/time-entries/clock/employees?${params.toString()}`, {
      auth: false,
      apiCache: false,
    });
    return response.data;
  },

  async status(employeeId: string) {
    const response = await apiRequest<ClockStatusResponse>("/time-entries/clock/status", {
      method: "POST",
      auth: false,
      body: body(employeeId),
    });
    return response.data;
  },

  async clockIn(employeeId: string) {
    const response = await apiRequest<ClockInResponse>("/time-entries/clock/in", {
      method: "POST",
      auth: false,
      body: body(employeeId),
    });
    return response.data;
  },

  async clockOut(employeeId: string) {
    const response = await apiRequest<ClockOutResponse>("/time-entries/clock/out", {
      method: "POST",
      auth: false,
      body: body(employeeId),
    });
    return response.data;
  },

  async photoPunch(input: ClockPhotoPunchInput) {
    const response = await apiRequest<ClockInResponse | ClockOutResponse>("/time-entries/clock/photo-punch", {
      method: "POST",
      auth: false,
      body: input,
      signal: AbortSignal.timeout(20_000),
    });
    return response.data;
  },

  async attemptStatus(requestId: string, employeeId: string) {
    const params = new URLSearchParams({ employeeId });
    const response = await apiRequest<ClockAttemptStatusResponse>(`/time-entries/clock/attempts/${requestId}?${params.toString()}`, {
      auth: false,
      apiCache: false,
    });
    return response.data;
  },
};
