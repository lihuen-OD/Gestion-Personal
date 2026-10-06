// Cliente HTTP propio del fichador standalone (F1,
// docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md). A propósito NO reutiliza
// frontend/src/services/api/apiClient.ts: ese cliente trae el JWT y el
// refresh token del admin (sessionStorage), el mapa de errores de los
// módulos administrativos y el evento global de errores. El fichador no
// tiene sesión de usuario: sólo llama a /time-entries/clock/* con el header
// del token compartido temporal (ver timeClockApiService.ts).
const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4002/api").replace(/\/$/, "");

/** Error de una respuesta HTTP del backend (status != 2xx). */
export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

/**
 * No hubo respuesta HTTP (backend apagado, sin Internet, DNS, CORS). A
 * propósito NO es un ApiError: el flujo de verificación de una fichada
 * (TimeClockPage.verifyAttempt) sólo corta ante un ApiError real y sigue
 * consultando ante fallas de red, porque el intento pudo haber llegado.
 */
export class NetworkError extends Error {
  constructor() {
    super("No hay conexión con el servidor. Revisá la conexión a Internet e intentá nuevamente.");
    this.name = "NetworkError";
  }
}

type ApiErrorPayload = { error?: { code?: string; message?: string } };

// Los mensajes CLOCK_* del backend ya están escritos para la persona que
// ficha; el resto se traduce a un texto de negocio sin detalle técnico.
const messagesByCode: Record<string, string> = {
  CLOCK_DEVICE_UNAUTHORIZED: "Este dispositivo no está autorizado para fichar. Avisá a RRHH.",
  CLOCK_DEVICE_NOT_CONFIGURED: "El fichador no está disponible en este momento. Avisá a RRHH.",
  VALIDATION_ERROR: "No pudimos procesar la fichada. Intentá nuevamente.",
  ROUTE_NOT_FOUND: "La operación solicitada no está disponible.",
};

export function formatClockErrorMessage(status: number, payload: ApiErrorPayload) {
  const code = payload.error?.code;
  if (code && messagesByCode[code]) return messagesByCode[code];
  if (status === 429) return "Hay demasiados intentos seguidos desde este dispositivo. Esperá unos minutos y volvé a intentar.";
  if (code?.startsWith("CLOCK_") && payload.error?.message) return payload.error.message;
  if (status >= 500) return "El servicio no está disponible en este momento. Intentá nuevamente en unos minutos.";
  return "No pudimos completar la operación. Intentá nuevamente.";
}

/** Mensaje para la persona que ficha: nunca un stack trace ni un error técnico. */
export function getUserErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError || error instanceof NetworkError) return error.message;
  return fallback;
}

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown };

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const hasBody = options.body !== undefined;
  if (hasBody && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      method: (options.method || "GET").toUpperCase(),
      headers,
      body: hasBody ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    // Un timeout/abort (AbortSignal.timeout de photoPunch) se propaga tal
    // cual, igual que en el fichador del admin.
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) throw error;
    throw new NetworkError();
  }

  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  const payload: unknown = isJson ? await response.json().catch(() => null) : await response.text().catch(() => "");
  if (!response.ok) {
    const parsed = typeof payload === "object" && payload ? (payload as ApiErrorPayload) : {};
    throw new ApiError(formatClockErrorMessage(response.status, parsed), parsed.error?.code || "API_ERROR", response.status);
  }
  return payload as T;
}
