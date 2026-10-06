import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { createRateLimiter } from "../../middlewares/rateLimiter";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { notFoundHandler } from "../../shared/errors/notFoundHandler";
import { env } from "../../config/env";
import { roles } from "../../shared/security/roles";
import { authenticatedClockDevice, requireClockDevice } from "../clock-devices/clockDeviceAuthentication";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { timeEntriesController } from "./timeEntries.controller";
import {
  attendanceSummaryQuerySchema,
  attendanceObservationsQuerySchema,
  resolveAttendanceObservationSchema,
  adminCloseWorkShiftSchema,
  adminWorkShiftReasonSchema,
  createTimeEntrySchema,
  createWorkShiftSchema,
  clockByEmployeeSchema,
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

// Los endpoints /clock/* no tienen sesion de usuario (kiosco), asi que en vez
// de requireAuth exigen un ClockDevice ACTIVE autenticado individualmente
// (F6 de docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md). Orden de guardas:
// 1. limite por IP, antes de autenticar: frena fuerza bruta de credenciales
//    sin tocar la base; generoso para que varios kioscos detras de la misma
//    red no compartan un cupo chico;
// 2. requireClockDevice(): 401/403 antes de cualquier validacion o lectura;
// 3. limite por dispositivo, keyed por el id YA autenticado: un deviceId
//    inventado nunca crea un bucket.
//
// F0: estas cuatro rutas son TODO lo que el fichador necesita. Las guardas
// van por ruta (no con un use("/clock") global) y el namespace se cierra con
// un 404 explicito: cualquier otro /clock/* -- incluidas las rutas sin foto
// retiradas en F0 -- responde 404 con o sin credencial, y nunca cae en el
// requireAuth ni en las rutas parametricas (/:id) de abajo.
const clockGuards = [
  createRateLimiter({ windowMs: env.CLOCK_RATE_LIMIT_WINDOW_MS, max: env.CLOCK_IP_RATE_LIMIT_MAX }),
  requireClockDevice({ recordPresence: true }),
  createRateLimiter({
    windowMs: env.CLOCK_RATE_LIMIT_WINDOW_MS,
    max: env.CLOCK_RATE_LIMIT_MAX,
    keyGenerator: (req) => `clock-device:${authenticatedClockDevice(req).id}`,
  }),
];

timeEntriesRouter.get("/clock/employees", ...clockGuards, validateQuery(clockEmployeeSearchQuerySchema), asyncHandler(timeEntriesController.clockSearch));
timeEntriesRouter.post("/clock/status", ...clockGuards, validateBody(clockByEmployeeSchema), asyncHandler(timeEntriesController.clockStatusByEmployee));
timeEntriesRouter.post("/clock/photo-punch", ...clockGuards, validateBody(clockPhotoPunchSchema), asyncHandler(timeEntriesController.clockPhotoPunch));
timeEntriesRouter.get("/clock/attempts/:requestId", ...clockGuards, asyncHandler(timeEntriesController.clockPunchAttemptStatus));
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
