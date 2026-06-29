import { apiRequest } from "./apiClient";
import { auditApiService } from "./auditApiService";

export type DashboardMetricRow = { label: string; value: number };
export type DashboardBirthday = {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  sector: string;
};

export type DashboardMetrics = {
  period?: string;
  total: number;
  active: number;
  inactive: number;
  absenceDays: number;
  absenceRate: string;
  turnoverRate: string;
  exits: number;
  upcomingBirthdays: DashboardBirthday[];
  averageAge: string;
  averageTenure: string;
  transported: number;
  transportByCity: DashboardMetricRow[];
  transportRoutes: DashboardMetricRow[];
  loadedHours: number;
  loadCoverage: number;
  pendingLoads: number;
  reviewLoads: number;
  expiredDocuments: number;
  expiringDocuments: number;
  missingResponsible: number;
  pendingNovelties: number;
  headcountByCompany: DashboardMetricRow[];
  headcountBySector: DashboardMetricRow[];
};

type ApiMetricsResponse = { data: DashboardMetrics };

export const dashboardMetricsApiService = {
  async getMetrics(_scope?: unknown, period?: string) {
    const params = new URLSearchParams();
    if (period) params.set("period", period);
    const query = params.toString();
    const response = await apiRequest<ApiMetricsResponse>(`/dashboard/metrics${query ? `?${query}` : ""}`);
    return response.data;
  },

  getAudit: (take = 5) => auditApiService.getAll({ take }),
};
