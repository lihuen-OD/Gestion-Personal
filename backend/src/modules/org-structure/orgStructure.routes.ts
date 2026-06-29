import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { adminRoles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { orgStructureController } from "./orgStructure.controller";
import {
  createAreaSchema,
  createBusinessUnitSchema,
  createCompanySchema,
  createCostCenterSchema,
  createEstablishmentSchema,
  createSectorSchema,
  updateAreaSchema,
  updateBusinessUnitSchema,
  updateCompanySchema,
  updateCostCenterSchema,
  updateEstablishmentSchema,
  updateSectorSchema,
} from "./orgStructure.schemas";

export const orgStructureRouter = Router();

orgStructureRouter.use(requireAuth);

orgStructureRouter.get("/", asyncHandler(orgStructureController.overview));

orgStructureRouter.post("/companies", requireAnyRole(adminRoles), validateBody(createCompanySchema), asyncHandler(orgStructureController.createCompany));
orgStructureRouter.patch("/companies/:id", requireAnyRole(adminRoles), validateBody(updateCompanySchema), asyncHandler(orgStructureController.updateCompany));

orgStructureRouter.post("/business-units", requireAnyRole(adminRoles), validateBody(createBusinessUnitSchema), asyncHandler(orgStructureController.createBusinessUnit));
orgStructureRouter.patch("/business-units/:id", requireAnyRole(adminRoles), validateBody(updateBusinessUnitSchema), asyncHandler(orgStructureController.updateBusinessUnit));

orgStructureRouter.post("/establishments", requireAnyRole(adminRoles), validateBody(createEstablishmentSchema), asyncHandler(orgStructureController.createEstablishment));
orgStructureRouter.patch("/establishments/:id", requireAnyRole(adminRoles), validateBody(updateEstablishmentSchema), asyncHandler(orgStructureController.updateEstablishment));

orgStructureRouter.post("/areas", requireAnyRole(adminRoles), validateBody(createAreaSchema), asyncHandler(orgStructureController.createArea));
orgStructureRouter.patch("/areas/:id", requireAnyRole(adminRoles), validateBody(updateAreaSchema), asyncHandler(orgStructureController.updateArea));

orgStructureRouter.post("/sectors", requireAnyRole(adminRoles), validateBody(createSectorSchema), asyncHandler(orgStructureController.createSector));
orgStructureRouter.patch("/sectors/:id", requireAnyRole(adminRoles), validateBody(updateSectorSchema), asyncHandler(orgStructureController.updateSector));

orgStructureRouter.post("/cost-centers", requireAnyRole(adminRoles), validateBody(createCostCenterSchema), asyncHandler(orgStructureController.createCostCenter));
orgStructureRouter.patch("/cost-centers/:id", requireAnyRole(adminRoles), validateBody(updateCostCenterSchema), asyncHandler(orgStructureController.updateCostCenter));
