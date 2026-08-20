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
//
// mergeParams: true es obligatorio acá. routes.ts monta primero
// apiRouter.use("/hour-concepts", hourConceptsRouter) y recién después
// apiRouter.use("/hour-concepts/:hourConceptId/rules", hourConceptRulesByConceptRouter).
// Como hourConceptsRouter no tiene ninguna ruta que matchee "/:id/rules",
// Express cae al segundo mount — pero sin mergeParams, el router hijo
// resetea req.params y pierde :hourConceptId (confirmado corriendo el mount
// real de Express: req.params llega {} adentro del router hijo). Sin este
// flag, requireParam(req, "hourConceptId") siempre tira 400
// MISSING_ROUTE_PARAM, y el frontend lo muestra como "no pudimos cargar las
// reglas horarias" incluso cuando el concepto sí tiene reglas.
export const hourConceptRulesByConceptRouter = Router({ mergeParams: true });

hourConceptRulesByConceptRouter.use(requireAuth);

hourConceptRulesByConceptRouter.get("/", asyncHandler(hourConceptRulesController.getByConcept));
