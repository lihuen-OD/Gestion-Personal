import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { roles } from "../../shared/security/roles";
import { validateQuery } from "../../shared/validation/validateQuery";
import { documentsController } from "./documents.controller";
import { listDocumentsQuerySchema } from "./documents.schemas";

export const documentsRouter = Router();

// Etapa 15D.4 (docs/decisions/DOCUMENT_CATEGORY_AUTHORIZATION_15D4.md):
// Nivel 3 (Carga Horaria) se agrega acá — antes quedaba bloqueado por
// completo. La autorización real y granular (scope + category.viewRoles)
// pasa a resolverse en documentsService, no en este guard de rol general.
const documentRoles = [roles.rrhh, roles.supervision, roles.cargaHoraria];

documentsRouter.use(requireAuth);
documentsRouter.get(
  "/",
  requireAnyRole(documentRoles),
  validateQuery(listDocumentsQuerySchema),
  asyncHandler(documentsController.list),
);

documentsRouter.get(
  "/:id/download",
  requireAnyRole(documentRoles),
  asyncHandler(documentsController.download),
);
