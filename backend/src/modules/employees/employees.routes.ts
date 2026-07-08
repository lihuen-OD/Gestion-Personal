import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { roles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { employeesController } from "./employees.controller";
import {
  createEmployeeDocumentSchema,
  createEmployeeBlockHistorySchema,
  createEmployeeFieldHistorySchema,
  createEmployeeSchema,
  createLaborMovementSchema,
  employeeTimeGridQuerySchema,
  listEmployeeOptionsQuerySchema,
  listEmployeeOrgChartQuerySchema,
  listEmployeeHistoryQuerySchema,
  listEmployeesQuerySchema,
  replaceEmployeeAssignmentsSchema,
  replaceEmployeeHourConceptsSchema,
  updateEmployeeContactSchema,
  updateEmployeeSchema,
  upsertEmployeeAddressSchema,
  upsertEmployeeTransportSchema,
} from "./employees.schemas";

export const employeesRouter = Router();

employeesRouter.use(requireAuth);

employeesRouter.get(
  "/",
  requireAnyRole([roles.rrhh, roles.supervision, roles.cargaHoraria]),
  validateQuery(listEmployeesQuerySchema),
  asyncHandler(employeesController.list),
);

employeesRouter.get(
  "/org-chart",
  requireAnyRole([roles.rrhh, roles.supervision]),
  validateQuery(listEmployeeOrgChartQuerySchema),
  asyncHandler(employeesController.listOrgChart),
);

employeesRouter.get(
  "/summary",
  requireAnyRole([roles.rrhh, roles.supervision, roles.cargaHoraria]),
  asyncHandler(employeesController.summary),
);

employeesRouter.get(
  "/options",
  requireAnyRole([roles.rrhh, roles.supervision, roles.cargaHoraria]),
  validateQuery(listEmployeeOptionsQuerySchema),
  asyncHandler(employeesController.listOptions),
);

employeesRouter.get(
  "/:id/position-validation",
  requireAnyRole([roles.rrhh, roles.supervision, roles.cargaHoraria]),
  asyncHandler(employeesController.getPositionValidation),
);

employeesRouter.get(
  "/:id/overview",
  requireAnyRole([roles.rrhh, roles.supervision, roles.cargaHoraria]),
  asyncHandler(employeesController.getOverviewById),
);

employeesRouter.get(
  "/:id/time-grid",
  requireAnyRole([roles.rrhh, roles.supervision, roles.cargaHoraria]),
  validateQuery(employeeTimeGridQuerySchema),
  asyncHandler(employeesController.getTimeGrid),
);

employeesRouter.get(
  "/:id",
  requireAnyRole([roles.rrhh, roles.supervision, roles.cargaHoraria]),
  asyncHandler(employeesController.getById),
);

employeesRouter.post(
  "/",
  requireAnyRole([roles.rrhh]),
  validateBody(createEmployeeSchema),
  asyncHandler(employeesController.create),
);

employeesRouter.post(
  "/sync-labor-statuses",
  requireAnyRole([roles.rrhh]),
  asyncHandler(employeesController.syncLaborStatuses),
);

employeesRouter.patch(
  "/:id",
  requireAnyRole([roles.rrhh]),
  validateBody(updateEmployeeSchema),
  asyncHandler(employeesController.update),
);

employeesRouter.put(
  "/:id/contact",
  requireAnyRole([roles.rrhh]),
  validateBody(updateEmployeeContactSchema),
  asyncHandler(employeesController.updateContact),
);

employeesRouter.put(
  "/:id/address",
  requireAnyRole([roles.rrhh]),
  validateBody(upsertEmployeeAddressSchema),
  asyncHandler(employeesController.upsertAddress),
);

employeesRouter.put(
  "/:id/transport",
  requireAnyRole([roles.rrhh]),
  validateBody(upsertEmployeeTransportSchema),
  asyncHandler(employeesController.upsertTransport),
);

employeesRouter.put(
  "/:id/assignments",
  requireAnyRole([roles.rrhh]),
  validateBody(replaceEmployeeAssignmentsSchema),
  asyncHandler(employeesController.replaceAssignments),
);

employeesRouter.put(
  "/:id/hour-concepts",
  requireAnyRole([roles.rrhh]),
  validateBody(replaceEmployeeHourConceptsSchema),
  asyncHandler(employeesController.replaceHourConcepts),
);

employeesRouter.post(
  "/:id/labor-movements",
  requireAnyRole([roles.rrhh]),
  validateBody(createLaborMovementSchema),
  asyncHandler(employeesController.createLaborMovement),
);

employeesRouter.post(
  "/:id/documents",
  requireAnyRole([roles.rrhh]),
  validateBody(createEmployeeDocumentSchema),
  asyncHandler(employeesController.createDocument),
);

employeesRouter.get(
  "/:id/field-history",
  requireAnyRole([roles.rrhh, roles.supervision, roles.cargaHoraria]),
  validateQuery(listEmployeeHistoryQuerySchema),
  asyncHandler(employeesController.listFieldHistory),
);

employeesRouter.post(
  "/:id/field-history",
  requireAnyRole([roles.rrhh]),
  validateBody(createEmployeeFieldHistorySchema),
  asyncHandler(employeesController.createFieldHistory),
);

employeesRouter.get(
  "/:id/block-history",
  requireAnyRole([roles.rrhh, roles.supervision, roles.cargaHoraria]),
  validateQuery(listEmployeeHistoryQuerySchema),
  asyncHandler(employeesController.listBlockHistory),
);

employeesRouter.post(
  "/:id/block-history",
  requireAnyRole([roles.rrhh]),
  validateBody(createEmployeeBlockHistorySchema),
  asyncHandler(employeesController.createBlockHistory),
);
