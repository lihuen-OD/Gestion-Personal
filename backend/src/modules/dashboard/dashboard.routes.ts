import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { roles } from "../../shared/security/roles";
import { validateQuery } from "../../shared/validation/validateQuery";
import { dashboardController } from "./dashboard.controller";
import { dashboardMetricsQuerySchema } from "./dashboard.schemas";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);
dashboardRouter.get(
  "/metrics",
  requireAnyRole([roles.rrhh, roles.supervision, roles.cargaHoraria]),
  validateQuery(dashboardMetricsQuerySchema),
  asyncHandler(dashboardController.metrics),
);
