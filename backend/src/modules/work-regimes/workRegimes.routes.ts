import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { adminRoles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { workRegimesController } from "./workRegimes.controller";
import {
  assignWorkRegimeSchema,
  closeWorkRegimeAssignmentSchema,
  createWorkRegimeSchema,
  currentWorkRegimeQuerySchema,
  listWorkRegimesQuerySchema,
  updateWorkRegimeAssignmentSchema,
  updateWorkRegimeSchema,
  updateWorkRegimeStatusSchema,
} from "./workRegimes.schemas";

// A. Catálogo de WorkRegime — /work-regimes
export const workRegimesRouter = Router();

workRegimesRouter.use(requireAuth);

workRegimesRouter.get("/", validateQuery(listWorkRegimesQuerySchema), asyncHandler(workRegimesController.list));
workRegimesRouter.get("/:id", asyncHandler(workRegimesController.getById));
workRegimesRouter.post("/", requireAnyRole(adminRoles), validateBody(createWorkRegimeSchema), asyncHandler(workRegimesController.create));
workRegimesRouter.patch("/:id", requireAnyRole(adminRoles), validateBody(updateWorkRegimeSchema), asyncHandler(workRegimesController.update));
workRegimesRouter.patch("/:id/status", requireAnyRole(adminRoles), validateBody(updateWorkRegimeStatusSchema), asyncHandler(workRegimesController.updateStatus));

// B. Asignación de régimen a empleado — /employees/:employeeId/work-regimes
// (router aparte para no mezclar el path param del catálogo con el del
// empleado; se monta bajo /employees/:employeeId/work-regimes en routes.ts).
export const employeeWorkRegimesRouter = Router();

employeeWorkRegimesRouter.use(requireAuth);

employeeWorkRegimesRouter.get("/", asyncHandler(workRegimesController.getHistory));
employeeWorkRegimesRouter.get("/current", validateQuery(currentWorkRegimeQuerySchema), asyncHandler(workRegimesController.getCurrent));
employeeWorkRegimesRouter.post("/", requireAnyRole(adminRoles), validateBody(assignWorkRegimeSchema), asyncHandler(workRegimesController.assign));
employeeWorkRegimesRouter.patch(
  "/:assignmentId",
  requireAnyRole(adminRoles),
  validateBody(updateWorkRegimeAssignmentSchema),
  asyncHandler(workRegimesController.updateAssignment),
);
employeeWorkRegimesRouter.patch(
  "/:assignmentId/close",
  requireAnyRole(adminRoles),
  validateBody(closeWorkRegimeAssignmentSchema),
  asyncHandler(workRegimesController.closeAssignment),
);
