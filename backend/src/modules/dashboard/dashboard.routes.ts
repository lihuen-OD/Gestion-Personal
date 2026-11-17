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
// 2026-11-17: Dashboard y Reportes de Gestión son sólo de Nivel 1; ningún
// otro módulo consume estas métricas.
dashboardRouter.get(
  "/metrics",
  requireAnyRole([roles.rrhh]),
  validateQuery(dashboardMetricsQuerySchema),
  asyncHandler(dashboardController.metrics),
);
