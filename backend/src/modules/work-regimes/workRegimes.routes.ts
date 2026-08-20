import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { adminRoles, roles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { workRegimesController } from "./workRegimes.controller";
import {
  assignWorkRegimeSchema,
  closeWorkRegimeAssignmentSchema,
  createWorkRegimeSchema,
  currentWorkRegimeQuerySchema,
  listWorkRegimeEmployeesQuerySchema,
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
// Empleados asociados al régimen (Etapa 8G) — mismo criterio de lectura
// cruzada que /employees: RRHH/supervisión/carga horaria, no cualquier rol.
workRegimesRouter.get(
  "/:id/employees",
  requireAnyRole([roles.rrhh, roles.supervision, roles.cargaHoraria]),
  validateQuery(listWorkRegimeEmployeesQuerySchema),
  asyncHandler(workRegimesController.listEmployees),
);
workRegimesRouter.post("/", requireAnyRole(adminRoles), validateBody(createWorkRegimeSchema), asyncHandler(workRegimesController.create));
workRegimesRouter.patch("/:id", requireAnyRole(adminRoles), validateBody(updateWorkRegimeSchema), asyncHandler(workRegimesController.update));
workRegimesRouter.patch("/:id/status", requireAnyRole(adminRoles), validateBody(updateWorkRegimeStatusSchema), asyncHandler(workRegimesController.updateStatus));

// B. Asignación de régimen a empleado — /employees/:employeeId/work-regimes
// (router aparte para no mezclar el path param del catálogo con el del
// empleado; se monta bajo /employees/:employeeId/work-regimes en routes.ts).
//
// mergeParams: true es obligatorio (mismo bug confirmado y corregido en
// hourConceptRules.routes.ts, Etapa 8M): routes.ts monta primero
// apiRouter.use("/employees", employeesRouter), que no tiene ninguna ruta que
// matchee "/:id/work-regimes", así que Express cae al segundo mount
// (apiRouter.use("/employees/:employeeId/work-regimes", employeeWorkRegimesRouter))
// — pero sin mergeParams ese router hijo pierde :employeeId por completo.
// Sin este flag, requireParam(req, "employeeId") siempre tira 400
// MISSING_ROUTE_PARAM (confirmado corriendo el mount real de Express).
export const employeeWorkRegimesRouter = Router({ mergeParams: true });

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
