import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { adminRoles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { hourConceptsController } from "./hourConcepts.controller";
import { createHourConceptSchema, listHourConceptsQuerySchema, updateHourConceptSchema } from "./hourConcepts.schemas";

export const hourConceptsRouter = Router();

hourConceptsRouter.use(requireAuth);

hourConceptsRouter.get("/", validateQuery(listHourConceptsQuerySchema), asyncHandler(hourConceptsController.list));
hourConceptsRouter.post("/", requireAnyRole(adminRoles), validateBody(createHourConceptSchema), asyncHandler(hourConceptsController.create));
hourConceptsRouter.patch("/:id", requireAnyRole(adminRoles), validateBody(updateHourConceptSchema), asyncHandler(hourConceptsController.update));
