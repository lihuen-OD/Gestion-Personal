import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { adminRoles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { documentCategoriesController } from "./documentCategories.controller";
import {
  createDocumentCategorySchema,
  listDocumentCategoriesQuerySchema,
  updateDocumentCategorySchema,
} from "./documentCategories.schemas";

export const documentCategoriesRouter = Router();

documentCategoriesRouter.use(requireAuth);

documentCategoriesRouter.get(
  "/",
  validateQuery(listDocumentCategoriesQuerySchema),
  asyncHandler(documentCategoriesController.list),
);

documentCategoriesRouter.post(
  "/",
  requireAnyRole(adminRoles),
  validateBody(createDocumentCategorySchema),
  asyncHandler(documentCategoriesController.create),
);

documentCategoriesRouter.patch(
  "/:id",
  requireAnyRole(adminRoles),
  validateBody(updateDocumentCategorySchema),
  asyncHandler(documentCategoriesController.update),
);
