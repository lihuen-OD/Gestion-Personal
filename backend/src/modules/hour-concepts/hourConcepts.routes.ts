import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { adminRoles, roles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { hourConceptsController } from "./hourConcepts.controller";
import {
  createHourConceptSchema,
  enableHourConceptEmployeesSchema,
  listHourConceptEmployeesQuerySchema,
  listHourConceptsQuerySchema,
  removeHourConceptQuerySchema,
  updateHourConceptSchema,
} from "./hourConcepts.schemas";

export const hourConceptsRouter = Router();

hourConceptsRouter.use(requireAuth);

hourConceptsRouter.get("/", validateQuery(listHourConceptsQuerySchema), asyncHandler(hourConceptsController.list));
hourConceptsRouter.post("/", requireAnyRole(adminRoles), validateBody(createHourConceptSchema), asyncHandler(hourConceptsController.create));
hourConceptsRouter.patch("/:id", requireAnyRole(adminRoles), validateBody(updateHourConceptSchema), asyncHandler(hourConceptsController.update));
// Eliminación (Etapa 8O/8P) — sin uso: delete físico. Con uso y sin
// ?force=true: 409 (el frontend debe volver a confirmar). Con uso y
// force=true: baja lógica, ver hourConcepts.service.ts::remove.
hourConceptsRouter.delete("/:id", requireAnyRole(adminRoles), validateQuery(removeHourConceptQuerySchema), asyncHandler(hourConceptsController.remove));
// Empleados habilitados para el concepto (Etapa 8G) — mismo criterio de
// lectura cruzada que /employees: RRHH/supervisión/carga horaria.
hourConceptsRouter.get(
  "/:id/employees",
  requireAnyRole([roles.rrhh, roles.supervision, roles.cargaHoraria]),
  validateQuery(listHourConceptEmployeesQuerySchema),
  asyncHandler(hourConceptsController.listEmployees),
);
// Habilitar/quitar empleados desde el propio concepto (Etapa 8N) — mutación,
// mismo criterio de rol que crear/editar el concepto (solo RRHH).
hourConceptsRouter.post(
  "/:id/employees",
  requireAnyRole(adminRoles),
  validateBody(enableHourConceptEmployeesSchema),
  asyncHandler(hourConceptsController.enableEmployees),
);
hourConceptsRouter.delete(
  "/:id/employees/:employeeId",
  requireAnyRole(adminRoles),
  asyncHandler(hourConceptsController.disableEmployee),
);
