import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { roles } from "../../shared/security/roles";
import { shiftAssignmentController as c } from "./shiftAssignment.controller";
import { createShiftAssignmentSchema, listShiftAssignmentsQuerySchema, updateShiftAssignmentSchema } from "./shiftAssignment.schemas";
import { shiftAlertController } from "./shiftAlert.controller";
import { listShiftAlertsQuerySchema, resolveShiftAlertSchema } from "./shiftAlert.schemas";

export const shiftsRouter = Router();
shiftsRouter.use(requireAuth);

const all = [roles.rrhh, roles.supervision, roles.cargaHoraria];

shiftsRouter.get("/assignments", requireAnyRole(all), validateQuery(listShiftAssignmentsQuerySchema), asyncHandler(c.list));
shiftsRouter.post("/assignments", requireAnyRole([roles.rrhh]), validateBody(createShiftAssignmentSchema), asyncHandler(c.assign));
shiftsRouter.patch("/assignments/:id", requireAnyRole([roles.rrhh]), validateBody(updateShiftAssignmentSchema), asyncHandler(c.update));
shiftsRouter.delete("/assignments/:id", requireAnyRole([roles.rrhh]), asyncHandler(c.remove));

shiftsRouter.get("/alerts", requireAnyRole(all), validateQuery(listShiftAlertsQuerySchema), asyncHandler(shiftAlertController.list));
shiftsRouter.post("/alerts/:id/resolve", requireAnyRole([roles.rrhh, roles.supervision]), validateBody(resolveShiftAlertSchema), asyncHandler(shiftAlertController.resolve));
