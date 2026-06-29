import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { adminRoles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { positionsController } from "./positions.controller";
import { createPositionSchema, listPositionsQuerySchema, updatePositionSchema } from "./positions.schemas";

export const positionsRouter = Router();

positionsRouter.use(requireAuth);

positionsRouter.get("/", validateQuery(listPositionsQuerySchema), asyncHandler(positionsController.list));
positionsRouter.get("/:id/employees", asyncHandler(positionsController.assignedEmployees));
positionsRouter.get("/:id", asyncHandler(positionsController.getById));
positionsRouter.post("/", requireAnyRole(adminRoles), validateBody(createPositionSchema), asyncHandler(positionsController.create));
positionsRouter.patch("/:id", requireAnyRole(adminRoles), validateBody(updatePositionSchema), asyncHandler(positionsController.update));
positionsRouter.delete("/:id", requireAnyRole(adminRoles), asyncHandler(positionsController.remove));
