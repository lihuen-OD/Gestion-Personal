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
import { shiftGroupController } from "./shiftGroup.controller";
import { createShiftGroupSchema, listShiftGroupsQuerySchema, updateShiftGroupSchema } from "./shiftGroup.schemas";
import { shiftRotationController as rc } from "./shiftRotation.controller";
import {
  addMembersSchema,
  closeMemberSchema,
  createCrewSchema,
  createRotationSchema,
  createVersionSchema,
  finalizePreviewSchema,
  finalizeSchema,
  listMembersQuerySchema,
  listRotationsQuerySchema,
  moveMemberSchema,
  updateCrewSchema,
  updateRotationSchema,
  updateVersionSchema,
} from "./shiftRotation.schemas";
import { shiftExpectedPreviewController } from "./shiftExpectedPreview.controller";
import { expectedShiftPreviewQuerySchema } from "./shiftExpectedPreview.schemas";

export const shiftsRouter = Router();
shiftsRouter.use(requireAuth);

const all = [roles.rrhh, roles.supervision, roles.cargaHoraria];

// R4.7: vista previa de sólo lectura. Una rotación INACTIVA se simula
// exclusivamente dentro del request; nunca cambia obligaciones reales.
shiftsRouter.get("/expected", requireAnyRole(all), validateQuery(expectedShiftPreviewQuerySchema), asyncHandler(shiftExpectedPreviewController.preview));

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

// R3.1 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §23): grupos de turnos
// (lugar / ámbito operativo). Lectura para los 3 roles operativos, escritura
// sólo RRHH — mismo criterio que las plantillas (/workforce/shift-templates).
// El alcance por grupo para Nivel 2/3 (UserShiftGroupScope) es R8.
shiftsRouter.get("/groups", requireAnyRole(all), validateQuery(listShiftGroupsQuerySchema), asyncHandler(shiftGroupController.list));
shiftsRouter.post("/groups", requireAnyRole([roles.rrhh]), validateBody(createShiftGroupSchema), asyncHandler(shiftGroupController.create));
shiftsRouter.patch("/groups/:id", requireAnyRole([roles.rrhh]), validateBody(updateShiftGroupSchema), asyncHandler(shiftGroupController.update));
shiftsRouter.delete("/groups/:id", requireAnyRole([roles.rrhh]), asyncHandler(shiftGroupController.remove));

// R4.6 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.9): administración de
// rotaciones. Lectura para los 3 roles operativos; escritura sólo RRHH (mismo
// criterio que grupos, plantillas y asignaciones). Alcance por grupo: R8.
const rrhh = requireAnyRole([roles.rrhh]);
shiftsRouter.get("/rotations", requireAnyRole(all), validateQuery(listRotationsQuerySchema), asyncHandler(rc.list));
shiftsRouter.post("/rotations", rrhh, validateBody(createRotationSchema), asyncHandler(rc.create));
shiftsRouter.get("/rotations/:id", requireAnyRole(all), asyncHandler(rc.detail));
shiftsRouter.patch("/rotations/:id", rrhh, validateBody(updateRotationSchema), asyncHandler(rc.update));
shiftsRouter.delete("/rotations/:id", rrhh, asyncHandler(rc.remove));
shiftsRouter.post("/rotations/:id/activate", rrhh, asyncHandler(rc.activate));
shiftsRouter.post("/rotations/:id/deactivate", rrhh, asyncHandler(rc.deactivate));
shiftsRouter.post("/rotations/:id/finalize/preview", rrhh, validateBody(finalizePreviewSchema), asyncHandler(rc.finalizePreview));
shiftsRouter.post("/rotations/:id/finalize", rrhh, validateBody(finalizeSchema), asyncHandler(rc.finalize));
shiftsRouter.post("/rotations/:id/crews", rrhh, validateBody(createCrewSchema), asyncHandler(rc.createCrew));
shiftsRouter.patch("/rotations/:id/crews/:crewId", rrhh, validateBody(updateCrewSchema), asyncHandler(rc.updateCrew));
shiftsRouter.post("/rotations/:id/versions", rrhh, validateBody(createVersionSchema), asyncHandler(rc.createVersion));
shiftsRouter.get("/rotations/:id/versions/:versionId", requireAnyRole(all), asyncHandler(rc.getVersion));
shiftsRouter.patch("/rotations/:id/versions/:versionId", rrhh, validateBody(updateVersionSchema), asyncHandler(rc.updateVersion));
shiftsRouter.delete("/rotations/:id/versions/:versionId", rrhh, asyncHandler(rc.removeVersion));
shiftsRouter.get("/rotations/:id/members", requireAnyRole(all), validateQuery(listMembersQuerySchema), asyncHandler(rc.listMembers));
shiftsRouter.post("/rotations/:id/crews/:crewId/members", rrhh, validateBody(addMembersSchema), asyncHandler(rc.addMembers));
shiftsRouter.post("/rotations/:id/members/:memberId/close", rrhh, validateBody(closeMemberSchema), asyncHandler(rc.closeMember));
shiftsRouter.post("/rotations/:id/members/:memberId/move", rrhh, validateBody(moveMemberSchema), asyncHandler(rc.moveMember));
shiftsRouter.delete("/rotations/:id/members/:memberId", rrhh, asyncHandler(rc.cancelMember));
