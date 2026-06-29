import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { adminRoles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { noveltyTypesController } from "./noveltyTypes.controller";
import { createNoveltyTypeSchema, listNoveltyTypesQuerySchema, updateNoveltyTypeSchema } from "./noveltyTypes.schemas";

export const noveltyTypesRouter = Router();

noveltyTypesRouter.use(requireAuth);

noveltyTypesRouter.get("/", validateQuery(listNoveltyTypesQuerySchema), asyncHandler(noveltyTypesController.list));
noveltyTypesRouter.get("/:id", asyncHandler(noveltyTypesController.getById));
noveltyTypesRouter.post("/", requireAnyRole(adminRoles), validateBody(createNoveltyTypeSchema), asyncHandler(noveltyTypesController.create));
noveltyTypesRouter.patch("/:id", requireAnyRole(adminRoles), validateBody(updateNoveltyTypeSchema), asyncHandler(noveltyTypesController.update));
