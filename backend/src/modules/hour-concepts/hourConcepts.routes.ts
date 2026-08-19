import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { adminRoles, roles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { hourConceptsController } from "./hourConcepts.controller";
import { createHourConceptSchema, listHourConceptEmployeesQuerySchema, listHourConceptsQuerySchema, updateHourConceptSchema } from "./hourConcepts.schemas";

export const hourConceptsRouter = Router();

hourConceptsRouter.use(requireAuth);

hourConceptsRouter.get("/", validateQuery(listHourConceptsQuerySchema), asyncHandler(hourConceptsController.list));
hourConceptsRouter.post("/", requireAnyRole(adminRoles), validateBody(createHourConceptSchema), asyncHandler(hourConceptsController.create));
hourConceptsRouter.patch("/:id", requireAnyRole(adminRoles), validateBody(updateHourConceptSchema), asyncHandler(hourConceptsController.update));
// Empleados habilitados para el concepto (Etapa 8G) — mismo criterio de
// lectura cruzada que /employees: RRHH/supervisión/carga horaria.
hourConceptsRouter.get(
  "/:id/employees",
  requireAnyRole([roles.rrhh, roles.supervision, roles.cargaHoraria]),
  validateQuery(listHourConceptEmployeesQuerySchema),
  asyncHandler(hourConceptsController.listEmployees),
);
