import { clockDeviceRequest } from "./clockDeviceSession";

// Los cuatro endpoints operativos del fichador. El fichador no tiene sesión
// de usuario: cada request va autenticado como el ClockDevice ACTIVE de este
// equipo (F6, docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md). La credencial
// la agrega clockDeviceRequest; acá no se maneja ningún secreto.
//
// F8: única fuente de rutas del fichador, en el namespace del dispositivo
// `/api/clock/*` (las fichadas quedan KIOSK). El alias legacy
// `/api/time-entries/clock/*` sigue vivo en el backend hasta F11, pero la
// PWA ya no lo usa ni cae en él como fallback.
export const clockEndpoints = {
  employees: "/clock/employees",
  status: "/clock/status",
  photoPunch: "/clock/photo-punch",
  attempt: (requestId: string) => `/clock/attempts/${encodeURIComponent(requestId)}`,
} as const;

/** Tope de espera del POST de fichada: el backend puede tardar ~10 s guardando la foto (F7, §26.10). */
export const PHOTO_PUNCH_TIMEOUT_MS = 20_000;

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

export type ClockPunchResult = ClockInResponse["data"] | ClockOutResponse["data"];
export type ClockAttemptState = {
  requestId: string;
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  response: ClockPunchResult | null;
  // F7.1: un FAILED por cooldown conserva el retryAfterSeconds original.
  error: { code: string; message: string; httpStatus: number; retryAfterSeconds?: number } | null;
};
type ClockAttemptStatusResponse = { data: ClockAttemptState };

function body(employeeId: string) {
  return { employeeId };
}

export const timeClockApiService = {
  async searchEmployees(search: string) {
    const params = new URLSearchParams({ search: search.trim() });
    const response = await clockDeviceRequest<ClockSearchResponse>(`${clockEndpoints.employees}?${params.toString()}`);
    return response.data;
  },

  async status(employeeId: string) {
    const response = await clockDeviceRequest<ClockStatusResponse>(clockEndpoints.status, {
      method: "POST",
      body: body(employeeId),
    });
    return response.data;
  },

  // El payload es exactamente el que armó la PWA: nunca `source` ni
  // `deviceId` (los decide el backend por la ruta y la credencial).
  async photoPunch(input: ClockPhotoPunchInput) {
    const response = await clockDeviceRequest<ClockInResponse | ClockOutResponse>(clockEndpoints.photoPunch, {
      method: "POST",
      body: input,
      signal: AbortSignal.timeout(PHOTO_PUNCH_TIMEOUT_MS),
    });
    return response.data;
  },

  async attemptStatus(requestId: string, employeeId: string) {
    const params = new URLSearchParams({ employeeId });
    const response = await clockDeviceRequest<ClockAttemptStatusResponse>(`${clockEndpoints.attempt(requestId)}?${params.toString()}`);
    return response.data;
  },
};
