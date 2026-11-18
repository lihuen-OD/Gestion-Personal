import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { roles } from "../../shared/security/roles";
import { validateQuery } from "../../shared/validation/validateQuery";
import { pendingController } from "./pending.controller";
import { pendingQuerySchema } from "./pending.schemas";

export const pendingRouter = Router();

pendingRouter.use(requireAuth);
// 2026-11-17: el único consumidor es la Bandeja de revisión (/pendientes),
// que no existe para Nivel 3. Carga de horas usa /time-entries, no este endpoint.
pendingRouter.get("/", requireAnyRole([roles.rrhh, roles.supervision]), validateQuery(pendingQuerySchema), asyncHandler(pendingController.list));
