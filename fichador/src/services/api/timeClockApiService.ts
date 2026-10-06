import { clockDeviceRequest } from "./clockDeviceSession";

// Los cuatro endpoints operativos del fichador. El fichador no tiene sesión
// de usuario: cada request va autenticado como el ClockDevice ACTIVE de este
// equipo (F6, docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md). La credencial
// la agrega clockDeviceRequest; acá no se maneja ningún secreto.

// El backend nunca devuelve el DNI completo al kiosco: sólo sus últimos 3
// dígitos, para distinguir homónimos (F0 del fichador standalone).
export type ClockEmployee = {
  id: string;
  legajo: string;
  dniSuffix: string | null;
  firstName: string;
  lastName: string;
  name: string;
};

type ClockStatusResponse = {
  data: {
    employee: ClockEmployee;
    openShift: {
      id: string;
      startAt: string;
    } | null;
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
    const response = await clockDeviceRequest<ClockSearchResponse>(`/time-entries/clock/employees?${params.toString()}`);
    return response.data;
  },

  async status(employeeId: string) {
    const response = await clockDeviceRequest<ClockStatusResponse>("/time-entries/clock/status", {
      method: "POST",
      body: body(employeeId),
    });
    return response.data;
  },

  async photoPunch(input: ClockPhotoPunchInput) {
    const response = await clockDeviceRequest<ClockInResponse | ClockOutResponse>("/time-entries/clock/photo-punch", {
      method: "POST",
      body: input,
      signal: AbortSignal.timeout(20_000),
    });
    return response.data;
  },

  async attemptStatus(requestId: string, employeeId: string) {
    const params = new URLSearchParams({ employeeId });
    const response = await clockDeviceRequest<ClockAttemptStatusResponse>(`/time-entries/clock/attempts/${requestId}?${params.toString()}`);
    return response.data;
  },
};
