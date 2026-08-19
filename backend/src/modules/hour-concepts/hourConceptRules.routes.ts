import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { adminRoles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { hourConceptRulesController } from "./hourConceptRules.controller";
import {
  createHourConceptRuleSchema,
  listHourConceptRulesQuerySchema,
  updateHourConceptRuleSchema,
  updateHourConceptRuleStatusSchema,
} from "./hourConceptRules.schemas";

// A. Reglas globales — /hour-concept-rules
export const hourConceptRulesRouter = Router();

hourConceptRulesRouter.use(requireAuth);

hourConceptRulesRouter.get("/", validateQuery(listHourConceptRulesQuerySchema), asyncHandler(hourConceptRulesController.list));
hourConceptRulesRouter.get("/:id", asyncHandler(hourConceptRulesController.getById));
hourConceptRulesRouter.post("/", requireAnyRole(adminRoles), validateBody(createHourConceptRuleSchema), asyncHandler(hourConceptRulesController.create));
hourConceptRulesRouter.patch("/:id", requireAnyRole(adminRoles), validateBody(updateHourConceptRuleSchema), asyncHandler(hourConceptRulesController.update));
hourConceptRulesRouter.patch(
  "/:id/status",
  requireAnyRole(adminRoles),
  validateBody(updateHourConceptRuleStatusSchema),
  asyncHandler(hourConceptRulesController.updateStatus),
);

// B. Reglas por concepto — /hour-concepts/:hourConceptId/rules (montado
// aparte en routes.ts, mismo patrón que /employees/:employeeId/work-regimes).
export const hourConceptRulesByConceptRouter = Router();

hourConceptRulesByConceptRouter.use(requireAuth);

hourConceptRulesByConceptRouter.get("/", asyncHandler(hourConceptRulesController.getByConcept));
