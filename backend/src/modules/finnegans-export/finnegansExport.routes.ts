import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { roles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { finnegansExportController } from "./finnegansExport.controller";
import { finnegansExportHistoryQuerySchema, finnegansExportQuerySchema, finnegansExportRequestSchema } from "./finnegansExport.schemas";

export const finnegansExportRouter = Router();

finnegansExportRouter.use(requireAuth);
// Etapa 15L.4 §35: mismo permiso que ya tenía el módulo (RRHH) — historial
// incluido, sin ampliar acceso.
finnegansExportRouter.use(requireAnyRole([roles.rrhh]));

finnegansExportRouter.get("/novelties", validateQuery(finnegansExportQuerySchema), asyncHandler(finnegansExportController.noveltiesJson));
finnegansExportRouter.post("/novelties/export", validateBody(finnegansExportRequestSchema), asyncHandler(finnegansExportController.exportNovelties));
finnegansExportRouter.get("/history", validateQuery(finnegansExportHistoryQuerySchema), asyncHandler(finnegansExportController.history));
finnegansExportRouter.get("/history/:batchId", asyncHandler(finnegansExportController.historyDetail));
