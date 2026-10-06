import { apiRequest } from "./apiClient";
import { CLOCK_APP_VERSION, clockDeviceHeaders } from "./clockDeviceSession";
import type { StoredClockDeviceIdentity } from "../../features/device/clockDeviceStorage";

export type ClockDeviceStatus = "PENDING" | "ACTIVE" | "REVOKED";
export type ClockDeviceState = { id: string; name: string | null; status: ClockDeviceStatus; pairingCode?: string; pairingExpiresAt?: string; sector?: { id: string; name: string } | null };

// Enrolamiento: el Gate todavía no tiene sesión operativa (el equipo puede
// estar PENDING o REVOKED), así que pasa la identidad leída de IndexedDB.

export const clockDeviceApiService = {
  register: () => apiRequest<{ data: { device: ClockDeviceState; secret: string } }>("/clock/device/register", { method: "POST", body: { appVersion: CLOCK_APP_VERSION } }).then(({ data }) => ({ identity: { id: data.device.id, secret: data.secret }, device: data.device })),
  status: (identity: StoredClockDeviceIdentity) => apiRequest<{ data: ClockDeviceState }>("/clock/device/status", { headers: clockDeviceHeaders(identity) }).then(({ data }) => data),
  refreshPairing: (identity: StoredClockDeviceIdentity) => apiRequest<{ data: { pairingCode: string; pairingExpiresAt: string } }>("/clock/device/pairing-code/refresh", { method: "POST", headers: clockDeviceHeaders(identity), body: {} }).then(({ data }) => data),
};
