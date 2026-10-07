import { apiRequest } from "./apiClient";

export type ClockDeviceStatus = "PENDING" | "ACTIVE" | "REVOKED";

export type ClockDevice = {
  id: string;
  name: string | null;
  status: ClockDeviceStatus;
  establishmentId: string | null;
  establishment: { id: string; name: string; zone: { id: string; name: string } } | null;
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
  revoke: (id: string) => apiRequest<{ data: ClockDevice }>(`/clock-devices/${id}/revoke`, { method: "POST" }).then((response) => response.data),
  deletePending: (id: string) => apiRequest<void>(`/clock-devices/${id}`, { method: "DELETE" }),
};
