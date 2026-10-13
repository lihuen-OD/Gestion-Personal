import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { notFoundHandler } from "../../shared/errors/notFoundHandler";
import { roles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { markLegacyClockRoute, mountClockOperationalRoutes } from "../clock/clock.routes";
import { timeEntriesController } from "./timeEntries.controller";
import {
  attendanceSummaryQuerySchema,
  attendanceObservationsQuerySchema,
  resolveAttendanceObservationSchema,
  adminCloseWorkShiftSchema,
  adminWorkShiftReasonSchema,
  createTimeEntrySchema,
  createWorkShiftSchema,
  listTimeEntriesQuerySchema,
  previewWorkShiftSchema,
  rejectTimeEntrySchema,
  timeEntriesExportQuerySchema,
  timeEntriesPeriodEmployeesQuerySchema,
  timeEntriesSummaryQuerySchema,
  updateTimeEntrySchema,
} from "./timeEntries.schemas";

export const timeEntriesRouter = Router();

// LEGACY (F7, docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §26): las rutas
// del fichador se movieron a /api/clock/* (módulo clock). Éstas son un alias
// del MISMO montaje (guardas y cupos compartidos, mismo controller y
// servicio) que conserva el comportamiento de F6 —fichadas con source
// PUBLIC_CLOCK_PHOTO— mientras la PWA sigue llamándolas. F8 migra la PWA y
// F11 las retira. No agregar features acá.
//
// F0: estas cuatro rutas son TODO lo que el fichador necesita. El namespace
// se cierra con un 404 explícito: cualquier otro /clock/* -- incluidas las
// rutas sin foto retiradas en F0 -- responde 404 con o sin credencial, y
// nunca cae en el requireAuth ni en las rutas paramétricas (/:id) de abajo.
mountClockOperationalRoutes(timeEntriesRouter, { prefix: "/clock", source: "PUBLIC_CLOCK_PHOTO", before: [markLegacyClockRoute] });
timeEntriesRouter.all(["/clock", "/clock/*"], notFoundHandler);

timeEntriesRouter.use(requireAuth);

const operationalRoles = [roles.rrhh, roles.supervision, roles.cargaHoraria];

timeEntriesRouter.get("/home-summary", requireAnyRole(operationalRoles), asyncHandler(timeEntriesController.homeSummary));
timeEntriesRouter.get("/attendance", requireAnyRole(operationalRoles), validateQuery(attendanceSummaryQuerySchema), asyncHandler(timeEntriesController.attendanceSummary));
timeEntriesRouter.get("/attendance/observations", requireAnyRole(operationalRoles), validateQuery(attendanceObservationsQuerySchema), asyncHandler(timeEntriesController.attendanceObservations));
timeEntriesRouter.post("/attendance/observations/:kind/:id/resolve", requireAnyRole([roles.rrhh, roles.supervision]), validateBody(resolveAttendanceObservationSchema), asyncHandler(timeEntriesController.resolveAttendanceObservation));
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
timeEntriesRouter.get("/export", requireAnyRole([roles.rrhh, roles.supervision]), validateQuery(timeEntriesExportQuerySchema), asyncHandler(timeEntriesController.exportJson));
timeEntriesRouter.get("/export.csv", requireAnyRole([roles.rrhh, roles.supervision]), validateQuery(timeEntriesExportQuerySchema), asyncHandler(timeEntriesController.exportCsv));
timeEntriesRouter.patch("/:id", requireAnyRole(operationalRoles), validateBody(updateTimeEntrySchema), asyncHandler(timeEntriesController.update));
timeEntriesRouter.post("/:id/submit", requireAnyRole(operationalRoles), asyncHandler(timeEntriesController.submit));
// Etapa 6L.3 (ajuste): la aprobación final es exclusiva de RRHH — Supervisión
// ya no integra este guard (antes sí, ver timeEntriesService.assertCanApprove).
timeEntriesRouter.post("/:id/approve", requireAnyRole([roles.rrhh]), asyncHandler(timeEntriesController.approve));
timeEntriesRouter.post("/:id/reject", requireAnyRole([roles.rrhh]), validateBody(rejectTimeEntrySchema), asyncHandler(timeEntriesController.reject));
timeEntriesRouter.post("/:id/return", requireAnyRole([roles.rrhh]), validateBody(rejectTimeEntrySchema), asyncHandler(timeEntriesController.returnForCorrection));
