import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { adminRoles, roles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { salaryCategoriesController } from "./salaryCategories.controller";
import {
  createSalaryCategorySchema,
  listSalaryCategoriesQuerySchema,
  updateSalaryCategorySchema,
} from "./salaryCategories.schemas";

export const salaryCategoriesRouter = Router();

salaryCategoriesRouter.use(requireAuth);

salaryCategoriesRouter.get(
  "/",
  requireAnyRole([roles.rrhh, roles.supervision, roles.cargaHoraria]),
  validateQuery(listSalaryCategoriesQuerySchema),
  asyncHandler(salaryCategoriesController.list),
);

salaryCategoriesRouter.post(
  "/",
  requireAnyRole(adminRoles),
  validateBody(createSalaryCategorySchema),
  asyncHandler(salaryCategoriesController.create),
);

salaryCategoriesRouter.patch(
  "/:id",
  requireAnyRole(adminRoles),
  validateBody(updateSalaryCategorySchema),
  asyncHandler(salaryCategoriesController.update),
);
