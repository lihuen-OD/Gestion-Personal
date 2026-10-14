import { apiRequest } from "./apiClient";
import { invalidateCacheFamily } from "../cache";

export type ClockDeviceStatus = "PENDING" | "ACTIVE" | "REVOKED";
/**
 * F9: la deriva el backend del último contacto válido (heartbeat u operación)
 * al leer; null para PENDING y REVOKED. El frontend sólo la traduce: el umbral
 * vive en un único lugar (backend, clockDeviceConnectivity.ts).
 */
export type ClockDeviceConnectivity = "ONLINE" | "OFFLINE" | "NEVER_SEEN";

export type ClockDevice = {
  id: string;
  name: string | null;
  status: ClockDeviceStatus;
  connectivity: ClockDeviceConnectivity | null;
  establishmentId: string | null;
  establishment: { id: string; name: string; zone: { id: string; name: string } | null } | null;
  activatedAt: string | null;
  revokedAt: string | null;
  lastSeenAt: string | null;
  lastIp: string | null;
  lastUserAgent: string | null;
  lastAppVersion: string | null;
  createdAt: string;
  updatedAt: string;
};

type ListResponse = { data: ClockDevice[]; meta: { total: number; page: number; pageSize: number; hasMore: boolean } };

export const clockDeviceApiService = {
  list: (query: { status?: ClockDeviceStatus; search?: string; page?: number; take?: number } = {}) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => { if (value !== undefined && value !== "") params.set(key, String(value)); });
    return apiRequest<ListResponse>(`/clock-devices?${params}`).then((response) => response);
  },
  resolvePairing: (pairingCode: string) => apiRequest<{ data: ClockDevice }>("/clock-devices/resolve-pairing", { method: "POST", body: { pairingCode } }).then((response) => response.data),
  activate: (id: string, input: { pairingCode: string; name: string; establishmentId: string | null }) => apiRequest<{ data: ClockDevice }>(`/clock-devices/${id}/activate`, { method: "POST", body: input }).then((response) => response.data),
  // F9: sólo nombre y establecimiento (null = sin establecimiento). PENDING o
  // ACTIVE. Asistencia muestra el nombre del dispositivo ("Kiosco · <nombre>"),
  // así que se invalida su caché, igual que hace el backend con la suya.
  update: async (id: string, input: { name?: string; establishmentId?: string | null }) => {
    const response = await apiRequest<{ data: ClockDevice }>(`/clock-devices/${id}`, { method: "PATCH", body: input });
    await invalidateCacheFamily("time-entries", "clock device updated");
    return response.data;
  },
  revoke: (id: string) => apiRequest<{ data: ClockDevice }>(`/clock-devices/${id}/revoke`, { method: "POST" }).then((response) => response.data),
  deletePending: (id: string) => apiRequest<void>(`/clock-devices/${id}`, { method: "DELETE" }),
};
