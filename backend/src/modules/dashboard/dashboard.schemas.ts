import { z } from "zod";

export const dashboardMetricsQuerySchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export type DashboardMetricsQuery = z.infer<typeof dashboardMetricsQuerySchema>;
