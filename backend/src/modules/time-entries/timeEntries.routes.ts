import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { roles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { timeEntriesController } from "./timeEntries.controller";
import {
  attendanceSummaryQuerySchema,
  adminCloseWorkShiftSchema,
  adminWorkShiftReasonSchema,
  createTimeEntrySchema,
  createWorkShiftSchema,
  clockByEmployeeSchema,
  clockByDniSchema,
  clockEmployeeSearchQuerySchema,
  clockPhotoPunchSchema,
  listTimeEntriesQuerySchema,
  previewWorkShiftSchema,
  rejectTimeEntrySchema,
  timeEntriesExportQuerySchema,
  timeEntriesPeriodEmployeesQuerySchema,
  timeEntriesSummaryQuerySchema,
  updateTimeEntrySchema,
} from "./timeEntries.schemas";

export const timeEntriesRouter = Router();

timeEntriesRouter.get("/clock/employees", validateQuery(clockEmployeeSearchQuerySchema), asyncHandler(timeEntriesController.clockSearch));
timeEntriesRouter.post("/clock/status", validateBody(clockByEmployeeSchema), asyncHandler(timeEntriesController.clockStatusByEmployee));
timeEntriesRouter.post("/clock/in", validateBody(clockByEmployeeSchema), asyncHandler(timeEntriesController.clockInByEmployee));
timeEntriesRouter.post("/clock/out", validateBody(clockByEmployeeSchema), asyncHandler(timeEntriesController.clockOutByEmployee));
timeEntriesRouter.post("/clock/photo-punch", validateBody(clockPhotoPunchSchema), asyncHandler(timeEntriesController.clockPhotoPunch));
timeEntriesRouter.get("/clock/attempts/:requestId", asyncHandler(timeEntriesController.clockPunchAttemptStatus));
timeEntriesRouter.post("/clock/status-by-dni", validateBody(clockByDniSchema), asyncHandler(timeEntriesController.clockStatus));
timeEntriesRouter.post("/clock/in-by-dni", validateBody(clockByDniSchema), asyncHandler(timeEntriesController.clockIn));
timeEntriesRouter.post("/clock/out-by-dni", validateBody(clockByDniSchema), asyncHandler(timeEntriesController.clockOut));

timeEntriesRouter.use(requireAuth);

const operationalRoles = [roles.rrhh, roles.supervision, roles.cargaHoraria];

timeEntriesRouter.get("/home-summary", requireAnyRole(operationalRoles), asyncHandler(timeEntriesController.homeSummary));
timeEntriesRouter.get("/attendance", requireAnyRole(operationalRoles), validateQuery(attendanceSummaryQuerySchema), asyncHandler(timeEntriesController.attendanceSummary));
timeEntriesRouter.get("/attendance/punches/:id/photo", requireAnyRole(operationalRoles), asyncHandler(timeEntriesController.attendancePunchPhoto));
timeEntriesRouter.get("/", requireAnyRole(operationalRoles), validateQuery(listTimeEntriesQuerySchema), asyncHandler(timeEntriesController.list));
timeEntriesRouter.get("/summary", requireAnyRole(operationalRoles), validateQuery(timeEntriesSummaryQuerySchema), asyncHandler(timeEntriesController.summary));
timeEntriesRouter.get("/period-employees", requireAnyRole(operationalRoles), validateQuery(timeEntriesPeriodEmployeesQuerySchema), asyncHandler(timeEntriesController.periodEmployees));
timeEntriesRouter.post("/work-shifts/preview", requireAnyRole(operationalRoles), validateBody(previewWorkShiftSchema), asyncHandler(timeEntriesController.previewWorkShift));
timeEntriesRouter.post("/work-shifts", requireAnyRole(operationalRoles), validateBody(createWorkShiftSchema), asyncHandler(timeEntriesController.createWorkShift));
timeEntriesRouter.post("/work-shifts/:id/close-manual", requireAnyRole([roles.rrhh, roles.supervision]), validateBody(adminCloseWorkShiftSchema), asyncHandler(timeEntriesController.closeWorkShiftManually));
timeEntriesRouter.post("/work-shifts/:id/missing-out", requireAnyRole([roles.rrhh, roles.supervision]), validateBody(adminWorkShiftReasonSchema), asyncHandler(timeEntriesController.markMissingOut));
timeEntriesRouter.post("/work-shifts/:id/observe", requireAnyRole([roles.rrhh, roles.supervision]), validateBody(adminWorkShiftReasonSchema), asyncHandler(timeEntriesController.observeWorkShift));
timeEntriesRouter.post("/", requireAnyRole(operationalRoles), validateBody(createTimeEntrySchema), asyncHandler(timeEntriesController.create));
timeEntriesRouter.get("/export", requireAnyRole(operationalRoles), validateQuery(timeEntriesExportQuerySchema), asyncHandler(timeEntriesController.exportJson));
timeEntriesRouter.get("/export.csv", requireAnyRole(operationalRoles), validateQuery(timeEntriesExportQuerySchema), asyncHandler(timeEntriesController.exportCsv));
timeEntriesRouter.patch("/:id", requireAnyRole(operationalRoles), validateBody(updateTimeEntrySchema), asyncHandler(timeEntriesController.update));
timeEntriesRouter.post("/:id/submit", requireAnyRole(operationalRoles), asyncHandler(timeEntriesController.submit));
timeEntriesRouter.post("/:id/approve", requireAnyRole([roles.rrhh, roles.supervision]), asyncHandler(timeEntriesController.approve));
timeEntriesRouter.post("/:id/reject", requireAnyRole([roles.rrhh, roles.supervision]), validateBody(rejectTimeEntrySchema), asyncHandler(timeEntriesController.reject));
timeEntriesRouter.post("/:id/return", requireAnyRole([roles.rrhh, roles.supervision]), validateBody(rejectTimeEntrySchema), asyncHandler(timeEntriesController.returnForCorrection));
