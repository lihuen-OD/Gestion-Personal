import { createTtlCache } from "../../shared/cache/ttlCache";
import type { DashboardMetricsResult } from "./dashboard.service";

export const dashboardMetricsCache = createTtlCache<DashboardMetricsResult>(
  Number(process.env.DASHBOARD_METRICS_CACHE_MS || 30_000),
);

export function clearDashboardMetricsCache() {
  dashboardMetricsCache.clear();
}
