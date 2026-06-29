import type { RequestHandler } from "express";
import { dashboardService } from "./dashboard.service";
import type { DashboardMetricsQuery } from "./dashboard.schemas";

export const dashboardController = {
  metrics: (async (req, res) => {
    const result = await dashboardService.metrics(req.query as unknown as DashboardMetricsQuery, req.user!);
    res.json({ data: result });
  }) satisfies RequestHandler,
};
