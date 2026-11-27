import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { EMPLOYEE_DOCUMENT_BODY_LIMIT_BYTES, jsonBody } from "../../shared/http/bodyLimits";
import { roles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { noveltiesController } from "./novelties.controller";
import {
  createNoveltySchema,
  createNoveltyWithDocumentSchema,
  listNoveltiesQuerySchema,
  noveltyCoveragePreviewSchema,
  noveltyCoverageResolutionSchema,
  updateNoveltySchema,
} from "./novelties.schemas";

export const noveltiesRouter = Router();

noveltiesRouter.use(requireAuth);

const operationalRoles = [roles.rrhh, roles.supervision, roles.cargaHoraria];

noveltiesRouter.get("/", requireAnyRole(operationalRoles), validateQuery(listNoveltiesQuerySchema), asyncHandler(noveltiesController.list));
noveltiesRouter.post("/", requireAnyRole(operationalRoles), validateBody(createNoveltySchema), asyncHandler(noveltiesController.create));
// Etapa 8 (NOVELTY_COVERAGE_ENGINE.md §15.1): alta con su documento. El body
// grande (base64) se parsea recién después de autenticar y del rol, con el
// mismo límite que un documento de legajo (shared/http/bodyLimits.ts).
noveltiesRouter.post("/with-document", requireAnyRole(operationalRoles), jsonBody(EMPLOYEE_DOCUMENT_BODY_LIMIT_BYTES), validateBody(createNoveltyWithDocumentSchema), asyncHandler(noveltiesController.createWithDocument));
// Etapa 3: antes de "/:id" para que no se lea "coverage-preview" como un id.
noveltiesRouter.post("/coverage-preview", requireAnyRole(operationalRoles), validateBody(noveltyCoveragePreviewSchema), asyncHandler(noveltiesController.previewCoverage));
noveltiesRouter.patch("/:id", requireAnyRole(operationalRoles), validateBody(updateNoveltySchema), asyncHandler(noveltiesController.update));
noveltiesRouter.delete("/:id", requireAnyRole(operationalRoles), asyncHandler(noveltiesController.remove));
noveltiesRouter.get("/:id/coverage", requireAnyRole(operationalRoles), asyncHandler(noveltiesController.getCoverage));
noveltiesRouter.post("/:id/coverage-days/:date/resolution", requireAnyRole(operationalRoles), validateBody(noveltyCoverageResolutionSchema), asyncHandler(noveltiesController.resolveCoverageDay));
