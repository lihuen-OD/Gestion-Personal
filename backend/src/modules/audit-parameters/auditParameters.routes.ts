import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { adminRoles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { auditParametersController } from "./auditParameters.controller";
import {
  createAuditParameterSchema,
  listAuditParametersQuerySchema,
  updateAuditParameterSchema,
} from "./auditParameters.schemas";

export const auditParametersRouter = Router();

auditParametersRouter.use(requireAuth, requireAnyRole(adminRoles));

auditParametersRouter.get(
  "/",
  validateQuery(listAuditParametersQuerySchema),
  asyncHandler(auditParametersController.list),
);

auditParametersRouter.post(
  "/",
  validateBody(createAuditParameterSchema),
  asyncHandler(auditParametersController.create),
);

auditParametersRouter.patch(
  "/:id",
  validateBody(updateAuditParameterSchema),
  asyncHandler(auditParametersController.update),
);
