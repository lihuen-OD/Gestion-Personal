import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { roles } from "../../shared/security/roles";
import { deletionConfirmationSchema } from "../../shared/deletion/deletionPlan";
import { workforceController as c } from "./workforce.controller";
import { calendarRangeQuerySchema, closureSubmitSchema, doubleRuleSchema, listNotificationsQuerySchema, periodQuerySchema, reopenClosureSchema, replaceShiftTemplateSchedulePreviewSchema, replaceShiftTemplateScheduleSchema, shiftTemplateSchema, updateDoubleRuleSchema, updateShiftTemplateSchema } from "./workforce.schemas";

export const workforceRouter=Router();
workforceRouter.use(requireAuth);
const all=[roles.rrhh,roles.supervision,roles.cargaHoraria];
workforceRouter.get("/closures",requireAnyRole(all),validateQuery(periodQuerySchema),asyncHandler(c.closures));
// Vista previa estructurada de bloqueantes (sin cache: refleja cada resolución al instante).
workforceRouter.get("/closures/blockers",requireAnyRole(all),validateQuery(periodQuerySchema),asyncHandler(c.closureBlockers));
workforceRouter.post("/closures/close",requireAnyRole(all),validateBody(closureSubmitSchema),asyncHandler(c.close));
workforceRouter.post("/closures/:id/reopen",requireAnyRole(all),validateBody(reopenClosureSchema),asyncHandler(c.reopen));
workforceRouter.get("/notifications",requireAnyRole(all),validateQuery(listNotificationsQuerySchema),asyncHandler(c.notifications));
workforceRouter.post("/notifications/:id/read",requireAnyRole(all),asyncHandler(c.readNotification));
workforceRouter.get("/notifications-unread-count",requireAnyRole(all),asyncHandler(c.unreadNotificationCount));
workforceRouter.get("/shift-templates",requireAnyRole(all),asyncHandler(c.shiftTemplates));
// R8.3 (§26): plantillas abiertas a Nivel 2/3; el grupo y los legajos los
// verifican workforce.service.ts y shiftTemplateSchedule.service.ts.
workforceRouter.post("/shift-templates",requireAnyRole(all),validateBody(shiftTemplateSchema),asyncHandler(c.createShiftTemplate));
workforceRouter.patch("/shift-templates/:id",requireAnyRole(all),validateBody(updateShiftTemplateSchema),asyncHandler(c.updateShiftTemplate));
workforceRouter.delete("/shift-templates/:id",requireAnyRole(all),asyncHandler(c.removeShiftTemplate));
workforceRouter.post("/shift-templates/:id/replace-schedule/preview",requireAnyRole(all),validateBody(replaceShiftTemplateSchedulePreviewSchema),asyncHandler(c.previewShiftTemplateScheduleReplacement));
workforceRouter.post("/shift-templates/:id/replace-schedule",requireAnyRole(all),validateBody(replaceShiftTemplateScheduleSchema),asyncHandler(c.replaceShiftTemplateSchedule));
workforceRouter.get("/double-hour-rules",requireAnyRole(all),asyncHandler(c.doubleRules));
workforceRouter.get("/double-hour-rules/calendar",requireAnyRole(all),validateQuery(calendarRangeQuerySchema),asyncHandler(c.doubleRulesCalendar));
workforceRouter.post("/double-hour-rules",requireAnyRole([roles.rrhh]),validateBody(doubleRuleSchema),asyncHandler(c.createDoubleRule));
workforceRouter.patch("/double-hour-rules/:id",requireAnyRole([roles.rrhh]),validateBody(updateDoubleRuleSchema),asyncHandler(c.updateDoubleRule));
workforceRouter.delete("/double-hour-rules/:id",requireAnyRole([roles.rrhh]),asyncHandler(c.removeDoubleRule));
// Eliminación controlada: vista previa (reinterpretación revertida) y confirmación con la huella del plan.
workforceRouter.get("/double-hour-rules/:id/deletion-preview",requireAnyRole([roles.rrhh]),asyncHandler(c.doubleRuleDeletionPreview));
workforceRouter.post("/double-hour-rules/:id/deletion",requireAnyRole([roles.rrhh]),validateBody(deletionConfirmationSchema),asyncHandler(c.executeDoubleRuleDeletion));
