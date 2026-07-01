import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { roles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { timeEntriesController } from "./timeEntries.controller";
import {
  createTimeEntrySchema,
  listTimeEntriesQuerySchema,
  rejectTimeEntrySchema,
  timeEntriesExportQuerySchema,
  timeEntriesPeriodEmployeesQuerySchema,
  timeEntriesSummaryQuerySchema,
  updateTimeEntrySchema,
} from "./timeEntries.schemas";

export const timeEntriesRouter = Router();

timeEntriesRouter.use(requireAuth);

const operationalRoles = [roles.rrhh, roles.supervision, roles.cargaHoraria];

timeEntriesRouter.get("/", requireAnyRole(operationalRoles), validateQuery(listTimeEntriesQuerySchema), asyncHandler(timeEntriesController.list));
timeEntriesRouter.get("/summary", requireAnyRole(operationalRoles), validateQuery(timeEntriesSummaryQuerySchema), asyncHandler(timeEntriesController.summary));
timeEntriesRouter.get("/period-employees", requireAnyRole(operationalRoles), validateQuery(timeEntriesPeriodEmployeesQuerySchema), asyncHandler(timeEntriesController.periodEmployees));
timeEntriesRouter.post("/", requireAnyRole(operationalRoles), validateBody(createTimeEntrySchema), asyncHandler(timeEntriesController.create));
timeEntriesRouter.get("/export", requireAnyRole(operationalRoles), validateQuery(timeEntriesExportQuerySchema), asyncHandler(timeEntriesController.exportJson));
timeEntriesRouter.get("/export.csv", requireAnyRole(operationalRoles), validateQuery(timeEntriesExportQuerySchema), asyncHandler(timeEntriesController.exportCsv));
timeEntriesRouter.patch("/:id", requireAnyRole(operationalRoles), validateBody(updateTimeEntrySchema), asyncHandler(timeEntriesController.update));
timeEntriesRouter.post("/:id/submit", requireAnyRole(operationalRoles), asyncHandler(timeEntriesController.submit));
timeEntriesRouter.post("/:id/approve", requireAnyRole([roles.rrhh, roles.supervision]), asyncHandler(timeEntriesController.approve));
timeEntriesRouter.post("/:id/reject", requireAnyRole([roles.rrhh, roles.supervision]), validateBody(rejectTimeEntrySchema), asyncHandler(timeEntriesController.reject));
timeEntriesRouter.post("/:id/return", requireAnyRole([roles.rrhh, roles.supervision]), validateBody(rejectTimeEntrySchema), asyncHandler(timeEntriesController.returnForCorrection));
