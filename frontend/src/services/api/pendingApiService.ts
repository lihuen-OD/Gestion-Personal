import { apiRequest } from "./apiClient";
import { cachePolicies, cachedData } from "../cache";
import type { TimeStatus } from "../../types";

type ApiApprovalStatus =
  | "BORRADOR"
  | "PENDIENTE"
  | "EN_REVISION"
  | "APROBADO"
  | "RECHAZADO"
  | "DEVUELTO"
  | "CERRADO";

export type PendingKind = "all" | "novelties" | "timeEntries";

type ApiPendingItem = {
  kind: "novelty" | "timeEntry";
  sourceId: string;
  status: ApiApprovalStatus;
  date: string;
  employeeLabel: string;
  title: string;
  subtitle?: string | null;
  quantity?: string | null;
  createdAt: string;
};

type ApiPendingResponse = {
  data: {
    summary: {
      total: number;
      novelties: number;
      timeEntries: number;
    };
    data: ApiPendingItem[];
  };
};

export type PendingItem = Omit<ApiPendingItem, "status"> & {
  status: TimeStatus;
};

export type PendingResult = {
  summary: ApiPendingResponse["data"]["summary"];
  data: PendingItem[];
};

const statusFromApi: Record<ApiApprovalStatus, TimeStatus> = {
  BORRADOR: "Borrador",
  PENDIENTE: "Pendiente",
  EN_REVISION: "En revisión",
  APROBADO: "Aprobado",
  RECHAZADO: "Rechazado",
  DEVUELTO: "Devuelto",
  CERRADO: "Cerrado",
};

function mapItem(item: ApiPendingItem): PendingItem {
  return {
    ...item,
    date: item.date.slice(0, 10),
    status: statusFromApi[item.status] || "Pendiente",
  };
}

function isPendingResult(value: PendingResult) {
  return Boolean(value && typeof value.summary?.total === "number" && Array.isArray(value.data));
}

export const pendingApiService = {
  async getAll(filters: { kind?: PendingKind; period?: string; take?: number } = {}): Promise<PendingResult> {
    const params = new URLSearchParams();
    params.set("kind", filters.kind || "all");
    params.set("take", String(filters.take || 200));
    if (filters.period) params.set("period", filters.period);

    const key = `/pending?${params.toString()}`;
    return cachedData({
      requestKey: `GET:${key}`,
      policy: cachePolicies.pendingQueue,
      fetcher: () => apiRequest<ApiPendingResponse>(key, { apiCache: false }).then((response) => ({
        summary: response.data.summary,
        data: response.data.data.map(mapItem),
      })),
      validate: isPendingResult,
    });
  },
};
