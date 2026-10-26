import { clockDeviceRequest } from "./clockDeviceSession";
import { clockEndpoints } from "./timeClockApiService";

// Modo mantenimiento (docs/decisions/FICHADOR_MAINTENANCE_MODE.md). Cada
// request va con la credencial del dispositivo (clockDeviceRequest): un equipo
// revocado recibe 403 y el Gate lo bloquea como en cualquier otra operación.
// El token de mantenimiento viaja APARTE, en su propio header, y sólo vive en
// memoria del modo mantenimiento: nunca en IndexedDB ni en localStorage.
export const MAINTENANCE_SESSION_HEADER = "X-Clock-Maintenance-Session";
const MAINTENANCE_TIMEOUT_MS = 15_000;
const MAINTENANCE_END_TIMEOUT_MS = 5_000;

export type ClockMaintenanceDevice = {
  name: string | null;
  status: "ACTIVE";
  activatedAt: string | null;
  lastSeenAt: string | null;
  lastAppVersion: string | null;
  connectivity: "ONLINE" | "OFFLINE" | "NEVER_SEEN" | null;
  establishment: { name: string; zone: { name: string } | null } | null;
};

type OpenedSession = { token: string; expiresAt: string; expiresInSeconds: number; device: ClockMaintenanceDevice };
type CurrentSession = { expiresAt: string; expiresInSeconds: number; device: ClockMaintenanceDevice; serverTime: string };

export const clockMaintenanceApiService = {
  /** Canjea el código que dictó RRHH por una sesión corta de este dispositivo. */
  async open(code: string) {
    const response = await clockDeviceRequest<{ data: OpenedSession }>(clockEndpoints.maintenanceSession, {
      method: "POST",
      body: { code },
      signal: AbortSignal.timeout(MAINTENANCE_TIMEOUT_MS),
    });
    return response.data;
  },

  /** La sesión sigue vigente: diagnóstico actualizado y segundos restantes según el servidor. */
  async current(token: string) {
    const response = await clockDeviceRequest<{ data: CurrentSession }>(clockEndpoints.maintenanceSession, {
      headers: { [MAINTENANCE_SESSION_HEADER]: token },
      signal: AbortSignal.timeout(MAINTENANCE_TIMEOUT_MS),
    });
    return response.data;
  },

  /** Cierre en el servidor (best-effort: si no llega, la sesión vence sola). Sobrevive a una recarga. */
  async end(token: string) {
    await clockDeviceRequest<unknown>(clockEndpoints.maintenanceSession, {
      method: "DELETE",
      headers: { [MAINTENANCE_SESSION_HEADER]: token },
      keepalive: true,
      signal: AbortSignal.timeout(MAINTENANCE_END_TIMEOUT_MS),
    });
  },
};
