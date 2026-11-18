import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { deletionConfirmationSchema } from "../../shared/deletion/deletionPlan";
import { adminRoles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { positionsController } from "./positions.controller";
import { createPositionSchema, listPositionEmployeesQuerySchema, listPositionOptionsQuerySchema, listPositionsQuerySchema, updatePositionSchema } from "./positions.schemas";

export const positionsRouter = Router();

positionsRouter.use(requireAuth);

// 2026-11-17: el listado, el detalle y las personas asignadas sólo los
// consumen el módulo Puestos y Horario laboral (ambos de Nivel 1). Nivel 2 y
// Nivel 3 sólo necesitan el catálogo liviano /options (selects de Legajos),
// que sigue abierto a cualquier autenticado.
positionsRouter.get("/", requireAnyRole(adminRoles), validateQuery(listPositionsQuerySchema), asyncHandler(positionsController.list));
// Etapa 14D.4: catálogo liviano para selects (Legajos) — DEBE registrarse
// antes de "/:id" (Express matchea rutas en orden; si quedara después,
// "/options" se interpretaría como un :id literal "options").
positionsRouter.get("/options", validateQuery(listPositionOptionsQuerySchema), asyncHandler(positionsController.listOptions));
// Lectura cruzada de empleados por puesto (PII: legajo/DNI/CUIL): nunca
// abierto a "cualquier autenticado" (hallazgo critico de la auditoria
// 2026-08-24). Desde 2026-11-17 sólo Nivel 1, único nivel con acceso al
// módulo Puestos.
positionsRouter.get(
  "/:id/employees",
  requireAnyRole(adminRoles),
  validateQuery(listPositionEmployeesQuerySchema),
  asyncHandler(positionsController.assignedEmployees),
);
positionsRouter.get("/:id", requireAnyRole(adminRoles), asyncHandler(positionsController.getById));
positionsRouter.post("/", requireAnyRole(adminRoles), validateBody(createPositionSchema), asyncHandler(positionsController.create));
positionsRouter.patch("/:id", requireAnyRole(adminRoles), validateBody(updatePositionSchema), asyncHandler(positionsController.update));
positionsRouter.delete("/:id", requireAnyRole(adminRoles), asyncHandler(positionsController.remove));
// Eliminación controlada con dependencias: vista previa y confirmación con la huella del plan.
positionsRouter.get("/:id/deletion-preview", requireAnyRole(adminRoles), asyncHandler(positionsController.deletionPreview));
positionsRouter.post("/:id/deletion", requireAnyRole(adminRoles), validateBody(deletionConfirmationSchema), asyncHandler(positionsController.executeDeletion));
