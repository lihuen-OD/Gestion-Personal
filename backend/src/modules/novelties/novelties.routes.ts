import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { roles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { noveltiesController } from "./novelties.controller";
import { bulkApproveNoveltiesSchema, createNoveltySchema, listNoveltiesQuerySchema, rejectNoveltySchema } from "./novelties.schemas";

export const noveltiesRouter = Router();

noveltiesRouter.use(requireAuth);

const operationalRoles = [roles.rrhh, roles.supervision, roles.cargaHoraria];

noveltiesRouter.get("/", requireAnyRole(operationalRoles), validateQuery(listNoveltiesQuerySchema), asyncHandler(noveltiesController.list));
noveltiesRouter.post("/", requireAnyRole(operationalRoles), validateBody(createNoveltySchema), asyncHandler(noveltiesController.create));
noveltiesRouter.post("/bulk-approve", requireAnyRole([roles.rrhh]), validateBody(bulkApproveNoveltiesSchema), asyncHandler(noveltiesController.approveMany));
noveltiesRouter.post("/:id/approve", requireAnyRole(operationalRoles), asyncHandler(noveltiesController.approve));
noveltiesRouter.post("/:id/reject", requireAnyRole(operationalRoles), validateBody(rejectNoveltySchema), asyncHandler(noveltiesController.reject));
