import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { roles } from "../../shared/security/roles";
import { validateQuery } from "../../shared/validation/validateQuery";
import { documentsController } from "./documents.controller";
import { listDocumentsQuerySchema } from "./documents.schemas";

export const documentsRouter = Router();

documentsRouter.use(requireAuth);
documentsRouter.get(
  "/",
  requireAnyRole([roles.rrhh, roles.supervision, roles.cargaHoraria]),
  validateQuery(listDocumentsQuerySchema),
  asyncHandler(documentsController.list),
);

documentsRouter.get(
  "/:id/download",
  requireAnyRole([roles.rrhh, roles.supervision, roles.cargaHoraria]),
  asyncHandler(documentsController.download),
);
