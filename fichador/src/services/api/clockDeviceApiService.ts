import { apiRequest } from "./apiClient";
import type { StoredClockDeviceIdentity } from "../../features/device/clockDeviceStorage";

const APP_VERSION = import.meta.env.VITE_APP_VERSION || "0.1.0";

export type ClockDeviceStatus = "PENDING" | "ACTIVE" | "REVOKED";
export type ClockDeviceState = { id: string; name: string | null; status: ClockDeviceStatus; pairingCode?: string; pairingExpiresAt?: string; sector?: { id: string; name: string } | null };

function authorization(identity: StoredClockDeviceIdentity) {
  return { Authorization: `ClockDevice ${identity.id}.${identity.secret}`, "X-Clock-App-Version": APP_VERSION };
}

export const clockDeviceApiService = {
  register: () => apiRequest<{ data: { device: ClockDeviceState; secret: string } }>("/clock/device/register", { method: "POST", body: { appVersion: APP_VERSION } }).then(({ data }) => ({ identity: { id: data.device.id, secret: data.secret }, device: data.device })),
  status: (identity: StoredClockDeviceIdentity) => apiRequest<{ data: ClockDeviceState }>("/clock/device/status", { headers: authorization(identity) }).then(({ data }) => data),
  refreshPairing: (identity: StoredClockDeviceIdentity) => apiRequest<{ data: { pairingCode: string; pairingExpiresAt: string } }>("/clock/device/pairing-code/refresh", { method: "POST", headers: authorization(identity), body: {} }).then(({ data }) => data),
};
