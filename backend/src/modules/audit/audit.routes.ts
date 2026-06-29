import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { adminRoles } from "../../shared/security/roles";
import { validateQuery } from "../../shared/validation/validateQuery";
import { auditController } from "./audit.controller";
import { listAuditQuerySchema } from "./audit.schemas";

export const auditRouter = Router();

auditRouter.use(requireAuth, requireAnyRole(adminRoles));

auditRouter.get("/", validateQuery(listAuditQuerySchema), asyncHandler(auditController.list));
