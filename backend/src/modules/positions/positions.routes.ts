import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { adminRoles, roles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { positionsController } from "./positions.controller";
import { createPositionSchema, listPositionOptionsQuerySchema, listPositionsQuerySchema, updatePositionSchema } from "./positions.schemas";

export const positionsRouter = Router();

positionsRouter.use(requireAuth);

positionsRouter.get("/", validateQuery(listPositionsQuerySchema), asyncHandler(positionsController.list));
// Etapa 14D.4: catálogo liviano para selects (Legajos) — DEBE registrarse
// antes de "/:id" (Express matchea rutas en orden; si quedara después,
// "/options" se interpretaría como un :id literal "options").
positionsRouter.get("/options", validateQuery(listPositionOptionsQuerySchema), asyncHandler(positionsController.listOptions));
// Lectura cruzada de empleados por puesto (PII: legajo/DNI/CUIL) — mismo
// criterio de rol que los endpoints equivalentes /hour-concepts/:id/employees
// y /work-regimes/:id/employees: solo los 3 roles operativos, nunca abierto
// a "cualquier autenticado" (hallazgo critico de la auditoria 2026-08-24).
positionsRouter.get(
  "/:id/employees",
  requireAnyRole([roles.rrhh, roles.supervision, roles.cargaHoraria]),
  asyncHandler(positionsController.assignedEmployees),
);
positionsRouter.get("/:id", asyncHandler(positionsController.getById));
positionsRouter.post("/", requireAnyRole(adminRoles), validateBody(createPositionSchema), asyncHandler(positionsController.create));
positionsRouter.patch("/:id", requireAnyRole(adminRoles), validateBody(updatePositionSchema), asyncHandler(positionsController.update));
positionsRouter.delete("/:id", requireAnyRole(adminRoles), asyncHandler(positionsController.remove));
