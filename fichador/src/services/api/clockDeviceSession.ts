import { ApiError, apiRequest, type RequestOptions } from "./apiClient";
import type { StoredClockDeviceIdentity } from "../../features/device/clockDeviceStorage";

// Único lugar del fichador que arma la credencial individual (F5/F6):
//   Authorization: ClockDevice <deviceId>.<secret>
// La identidad vive en IndexedDB (clockDeviceStorage) y, mientras el equipo
// está ACTIVE, también en memoria acá. Ningún componente pasa id/secret a
// mano: ClockDeviceGate abre la sesión y los servicios la usan.
export const CLOCK_APP_VERSION = import.meta.env.VITE_APP_VERSION || "0.1.0";

export type ClockDeviceAuthFailure = "CLOCK_DEVICE_INVALID_CREDENTIAL" | "CLOCK_DEVICE_NOT_ACTIVE" | "CLOCK_DEVICE_REVOKED";

const AUTH_FAILURES = new Set<string>(["CLOCK_DEVICE_INVALID_CREDENTIAL", "CLOCK_DEVICE_NOT_ACTIVE", "CLOCK_DEVICE_REVOKED"]);

export function isClockDeviceAuthFailure(error: unknown): error is ApiError & { code: ClockDeviceAuthFailure } {
  return error instanceof ApiError && AUTH_FAILURES.has(error.code);
}

export function clockDeviceHeaders(identity: StoredClockDeviceIdentity): Record<string, string> {
  return { Authorization: `ClockDevice ${identity.id}.${identity.secret}`, "X-Clock-App-Version": CLOCK_APP_VERSION };
}

let activeIdentity: StoredClockDeviceIdentity | null = null;
const failureListeners = new Set<(failure: ClockDeviceAuthFailure) => void>();

export const clockDeviceSession = {
  /** Sólo ClockDeviceGate, cuando el backend confirmó ACTIVE. */
  start(identity: StoredClockDeviceIdentity) {
    activeIdentity = identity;
  },
  end() {
    activeIdentity = null;
  },
  isActive() {
    return activeIdentity !== null;
  },
  /** Avisa cuando el backend rechaza la credencial en medio de la operación. */
  onAuthFailure(listener: (failure: ClockDeviceAuthFailure) => void) {
    failureListeners.add(listener);
    return () => {
      failureListeners.delete(listener);
    };
  },
};

/**
 * Request operativo del fichador (/time-entries/clock/*). Sin sesión activa
 * no sale a la red. Ante un rechazo de credencial (401/403 de dispositivo)
 * cierra la sesión antes de avisar: ningún reintento posterior (verificación
 * de una fichada, búsqueda en curso) vuelve a mandar la credencial rechazada.
 * Errores de red y 5xx no tocan la sesión ni la identidad guardada.
 */
export async function clockDeviceRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const identity = activeIdentity;
  if (!identity) {
    throw new ApiError("Este dispositivo no está habilitado para fichar.", "CLOCK_DEVICE_SESSION_MISSING", 401);
  }
  try {
    const headers = new Headers(options.headers);
    for (const [name, value] of Object.entries(clockDeviceHeaders(identity))) headers.set(name, value);
    return await apiRequest<T>(path, { ...options, headers });
  } catch (error) {
    if (isClockDeviceAuthFailure(error) && activeIdentity === identity) {
      activeIdentity = null;
      failureListeners.forEach((listener) => listener(error.code));
    }
    throw error;
  }
}
