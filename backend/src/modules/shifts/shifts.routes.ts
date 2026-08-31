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
import { holidayWorkAssignmentController } from "./holidayWorkAssignment.controller";
import { holidayDatesQuerySchema, holidayWorkAssignmentsByDateQuerySchema, holidayWorkCandidatesQuerySchema, saveHolidayWorkAssignmentsSchema } from "./holidayWorkAssignment.schemas";

export const shiftsRouter = Router();
shiftsRouter.use(requireAuth);

const all = [roles.rrhh, roles.supervision, roles.cargaHoraria];

shiftsRouter.get("/assignments/summary", requireAnyRole(all), asyncHandler(c.summary));
shiftsRouter.get("/assignments", requireAnyRole(all), validateQuery(listShiftAssignmentsQuerySchema), asyncHandler(c.list));
shiftsRouter.post("/assignments", requireAnyRole([roles.rrhh]), validateBody(createShiftAssignmentSchema), asyncHandler(c.assign));
shiftsRouter.patch("/assignments/:id", requireAnyRole([roles.rrhh]), validateBody(updateShiftAssignmentSchema), asyncHandler(c.update));
shiftsRouter.delete("/assignments/:id", requireAnyRole([roles.rrhh]), asyncHandler(c.remove));

shiftsRouter.get("/alerts", requireAnyRole(all), validateQuery(listShiftAlertsQuerySchema), asyncHandler(shiftAlertController.list));
shiftsRouter.post("/alerts/:id/resolve", requireAnyRole([roles.rrhh, roles.supervision]), validateBody(resolveShiftAlertSchema), asyncHandler(shiftAlertController.resolve));

// Etapa 12D: asignaciones de trabajo en feriados. Lectura para los mismos 3
// roles operativos de siempre; escritura sólo RRHH — mismo criterio ya
// usado para /assignments (ShiftAssignment) arriba, sin abrir permisos
// nuevos sin justificar.
shiftsRouter.get("/holiday-work/dates", requireAnyRole(all), validateQuery(holidayDatesQuerySchema), asyncHandler(holidayWorkAssignmentController.dates));
shiftsRouter.get("/holiday-work/candidates", requireAnyRole(all), validateQuery(holidayWorkCandidatesQuerySchema), asyncHandler(holidayWorkAssignmentController.candidates));
shiftsRouter.get("/holiday-work/assignments", requireAnyRole(all), validateQuery(holidayWorkAssignmentsByDateQuerySchema), asyncHandler(holidayWorkAssignmentController.listByDate));
shiftsRouter.put("/holiday-work/assignments", requireAnyRole([roles.rrhh]), validateBody(saveHolidayWorkAssignmentsSchema), asyncHandler(holidayWorkAssignmentController.save));
