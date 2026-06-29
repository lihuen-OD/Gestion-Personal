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
pendingRouter.get("/", requireAnyRole([roles.rrhh, roles.supervision, roles.cargaHoraria]), validateQuery(pendingQuerySchema), asyncHandler(pendingController.list));
