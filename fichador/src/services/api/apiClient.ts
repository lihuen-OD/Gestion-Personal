// Cliente HTTP propio del fichador standalone (F1,
// docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md). A propósito NO reutiliza
// frontend/src/services/api/apiClient.ts: ese cliente trae el JWT y el
// refresh token del admin (sessionStorage), el mapa de errores de los
// módulos administrativos y el evento global de errores. El fichador no
// tiene sesión de usuario: se autentica como dispositivo, con un
// ClockDevice individual (ver clockDeviceSession.ts).
import { publicClockGuidance, type ClockGuidance } from "./clockGuidance";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4002/api").replace(/\/$/, "");

/** Error de una respuesta HTTP del backend (status != 2xx). */
export class ApiError extends Error {
  code: string;
  status: number;
  /** F8: segundos públicos de espera que manda el backend (p. ej. CLOCK_PUNCH_COOLDOWN). */
  retryAfterSeconds?: number;
  /** R4.4: guía pública de una salida dudosa (confirmación previa o límite superado). */
  clockGuidance?: ClockGuidance;

  constructor(message: string, code: string, status: number, retryAfterSeconds?: number, clockGuidance?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = publicRetryAfterSeconds(retryAfterSeconds);
    this.clockGuidance = publicClockGuidance(clockGuidance);
  }
}

/** Mismo criterio que el backend: entero finito >= 0; cualquier otra cosa se ignora. */
export function publicRetryAfterSeconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * No hubo respuesta HTTP (backend apagado, sin Internet, DNS, CORS). A
 * propósito NO es un ApiError: la recuperación de una fichada
 * (features/punch/punchSubmission.ts) lo trata como resultado incierto y
 * consulta el intento, porque el request pudo haber llegado.
 */
export class NetworkError extends Error {
  constructor() {
    super("No hay conexión con el servidor. Revisá la conexión a Internet e intentá nuevamente.");
    this.name = "NetworkError";
  }
}

type ApiErrorPayload = { error?: { code?: string; message?: string; retryAfterSeconds?: unknown; clockGuidance?: unknown } };

// Los mensajes CLOCK_* del backend ya están escritos para la persona que
// ficha; el resto se traduce a un texto de negocio sin detalle técnico.
const messagesByCode: Record<string, string> = {
  CLOCK_DEVICE_INVALID_CREDENTIAL: "Este dispositivo perdió su autorización. Volvé a configurarlo.",
  CLOCK_DEVICE_NOT_ACTIVE: "Este dispositivo todavía no fue aprobado por RRHH.",
  CLOCK_DEVICE_REVOKED: "Este dispositivo fue deshabilitado por RRHH.",
  CLOCK_DEVICE_NOT_PENDING: "Este dispositivo ya no tiene una aprobación pendiente.",
  CLOCK_DEVICE_PENDING_LIMIT: "Hay demasiadas solicitudes pendientes. Pedile a RRHH que elimine las que no se usan.",
  CLOCK_DEVICE_PAIRING_UNAVAILABLE: "No pudimos generar el código. Esperá un momento e intentá nuevamente.",
  // F8: un requestId que el backend no reconoce como propio no se "arregla"
  // regenerándolo: el intento se abandona y la persona empieza de nuevo.
  CLOCK_IDEMPOTENCY_KEY_REUSED: "No pudimos recuperar esta fichada. Volvé a iniciar el proceso.",
  CLOCK_ATTEMPT_PROCESSING: "Estamos confirmando tu fichada…",
  // Modo mantenimiento: el mismo texto para código inexistente, vencido, usado o de otro equipo.
  CLOCK_MAINTENANCE_CODE_INVALID: "El código no es válido o ya venció.",
  CLOCK_MAINTENANCE_SESSION_INVALID: "El acceso de mantenimiento venció.",
  VALIDATION_ERROR: "No pudimos procesar la fichada. Intentá nuevamente.",
  ROUTE_NOT_FOUND: "La operación solicitada no está disponible.",
};

// §33: cupos de solicitudes del backend (modules/clock/clockRateLimits.ts).
// Distinguen un límite de búsquedas (la jornada y la fichada siguen
// funcionando) de un límite del equipo o de la red. Nunca se reintenta solo:
// la persona vuelve a intentar cuando termina la espera.
const SEARCH_RATE_LIMIT = "CLOCK_SEARCH_RATE_LIMITED";
const DEVICE_RATE_LIMITS = new Set(["CLOCK_STATUS_RATE_LIMITED", "CLOCK_PUNCH_RATE_LIMITED", "CLOCK_ATTEMPT_RATE_LIMITED", "CLOCK_DEVICE_RATE_LIMITED"]);

/** "45 segundos", "1 minuto", "4 minutos": la espera redondeada hacia arriba. */
export function formatWait(seconds: number) {
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "segundo" : "segundos"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
}

function rateLimitMessage(code: string | undefined, retryAfterSeconds: number | undefined): string | undefined {
  const wait = retryAfterSeconds && retryAfterSeconds > 0 ? formatWait(retryAfterSeconds) : "unos minutos";
  if (code === SEARCH_RATE_LIMIT) return `Se hicieron muchas búsquedas seguidas en este equipo. Esperá ${wait} y volvé a buscar.`;
  if (code && DEVICE_RATE_LIMITS.has(code)) return `Este equipo alcanzó el límite de operaciones. Esperá ${wait} y volvé a intentar. Si se repite, avisá a RRHH.`;
  if (code === "CLOCK_NETWORK_RATE_LIMITED") return `Hay demasiadas operaciones desde esta red. Esperá ${wait} y volvé a intentar. Si se repite, avisá a RRHH.`;
  if (code === "CLOCK_AUTH_RATE_LIMITED") return `Este dispositivo tuvo demasiados intentos de autorización rechazados. Esperá ${wait} y avisá a RRHH.`;
  return undefined;
}

export function formatClockErrorMessage(status: number, payload: ApiErrorPayload) {
  const code = payload.error?.code;
  if (code && messagesByCode[code]) return messagesByCode[code];
  if (status === 429) {
    const message = rateLimitMessage(code, publicRetryAfterSeconds(payload.error?.retryAfterSeconds));
    if (message) return message;
  }
  if (status === 429) return "Hay demasiados intentos seguidos desde este dispositivo. Esperá unos minutos y volvé a intentar.";
  if (code?.startsWith("CLOCK_") && payload.error?.message) return payload.error.message;
  if (status >= 500) return "El servicio no está disponible en este momento. Intentá nuevamente en unos minutos.";
  return "No pudimos completar la operación. Intentá nuevamente.";
}

/** Rearma un ApiError a partir del error público guardado en un intento (GET attempts). */
export function apiErrorFromStored(error: { code: string; message: string; httpStatus: number; retryAfterSeconds?: unknown; clockGuidance?: unknown }) {
  const payload = { error: { code: error.code, message: error.message } };
  return new ApiError(formatClockErrorMessage(error.httpStatus, payload), error.code, error.httpStatus, publicRetryAfterSeconds(error.retryAfterSeconds), error.clockGuidance);
}

/** Mensaje para la persona que ficha: nunca un stack trace ni un error técnico. */
export function getUserErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError || error instanceof NetworkError) return error.message;
  return fallback;
}

export type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown };

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
    throw new ApiError(formatClockErrorMessage(response.status, parsed), parsed.error?.code || "API_ERROR", response.status, publicRetryAfterSeconds(parsed.error?.retryAfterSeconds), parsed.error?.clockGuidance);
  }
  return payload as T;
}
