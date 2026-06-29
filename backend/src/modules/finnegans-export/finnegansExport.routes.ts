import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { roles } from "../../shared/security/roles";
import { validateQuery } from "../../shared/validation/validateQuery";
import { finnegansExportController } from "./finnegansExport.controller";
import { finnegansExportQuerySchema } from "./finnegansExport.schemas";

export const finnegansExportRouter = Router();

finnegansExportRouter.use(requireAuth);
finnegansExportRouter.use(requireAnyRole([roles.rrhh]));

finnegansExportRouter.get("/novelties", validateQuery(finnegansExportQuerySchema), asyncHandler(finnegansExportController.noveltiesJson));
finnegansExportRouter.get("/novelties.csv", validateQuery(finnegansExportQuerySchema), asyncHandler(finnegansExportController.noveltiesCsv));
