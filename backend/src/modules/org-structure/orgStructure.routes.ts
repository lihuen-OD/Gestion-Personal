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
  createZoneSchema,
  updateAreaSchema,
  updateBusinessUnitSchema,
  updateCompanySchema,
  updateCostCenterSchema,
  updateEstablishmentSchema,
  updateSectorSchema,
  updateZoneSchema,
} from "./orgStructure.schemas";

export const orgStructureRouter = Router();

orgStructureRouter.use(requireAuth);

orgStructureRouter.get("/", asyncHandler(orgStructureController.overview));

orgStructureRouter.post("/companies", requireAnyRole(adminRoles), validateBody(createCompanySchema), asyncHandler(orgStructureController.createCompany));
orgStructureRouter.patch("/companies/:id", requireAnyRole(adminRoles), validateBody(updateCompanySchema), asyncHandler(orgStructureController.updateCompany));
orgStructureRouter.delete("/companies/:id", requireAnyRole(adminRoles), asyncHandler(orgStructureController.deleteCompany));

orgStructureRouter.post("/business-units", requireAnyRole(adminRoles), validateBody(createBusinessUnitSchema), asyncHandler(orgStructureController.createBusinessUnit));
orgStructureRouter.patch("/business-units/:id", requireAnyRole(adminRoles), validateBody(updateBusinessUnitSchema), asyncHandler(orgStructureController.updateBusinessUnit));
orgStructureRouter.delete("/business-units/:id", requireAnyRole(adminRoles), asyncHandler(orgStructureController.deleteBusinessUnit));

orgStructureRouter.post("/establishments", requireAnyRole(adminRoles), validateBody(createEstablishmentSchema), asyncHandler(orgStructureController.createEstablishment));
orgStructureRouter.patch("/establishments/:id", requireAnyRole(adminRoles), validateBody(updateEstablishmentSchema), asyncHandler(orgStructureController.updateEstablishment));
orgStructureRouter.delete("/establishments/:id", requireAnyRole(adminRoles), asyncHandler(orgStructureController.deleteEstablishment));

orgStructureRouter.post("/areas", requireAnyRole(adminRoles), validateBody(createAreaSchema), asyncHandler(orgStructureController.createArea));
orgStructureRouter.patch("/areas/:id", requireAnyRole(adminRoles), validateBody(updateAreaSchema), asyncHandler(orgStructureController.updateArea));
orgStructureRouter.delete("/areas/:id", requireAnyRole(adminRoles), asyncHandler(orgStructureController.deleteArea));

orgStructureRouter.post("/sectors", requireAnyRole(adminRoles), validateBody(createSectorSchema), asyncHandler(orgStructureController.createSector));
orgStructureRouter.patch("/sectors/:id", requireAnyRole(adminRoles), validateBody(updateSectorSchema), asyncHandler(orgStructureController.updateSector));
orgStructureRouter.delete("/sectors/:id", requireAnyRole(adminRoles), asyncHandler(orgStructureController.deleteSector));

// Árbol de Ubicaciones (modelo objetivo): Zona → Establecimiento.
orgStructureRouter.post("/zones", requireAnyRole(adminRoles), validateBody(createZoneSchema), asyncHandler(orgStructureController.createZone));
orgStructureRouter.patch("/zones/:id", requireAnyRole(adminRoles), validateBody(updateZoneSchema), asyncHandler(orgStructureController.updateZone));
orgStructureRouter.delete("/zones/:id", requireAnyRole(adminRoles), asyncHandler(orgStructureController.deleteZone));

orgStructureRouter.post("/cost-centers", requireAnyRole(adminRoles), validateBody(createCostCenterSchema), asyncHandler(orgStructureController.createCostCenter));
orgStructureRouter.patch("/cost-centers/:id", requireAnyRole(adminRoles), validateBody(updateCostCenterSchema), asyncHandler(orgStructureController.updateCostCenter));
orgStructureRouter.delete("/cost-centers/:id", requireAnyRole(adminRoles), asyncHandler(orgStructureController.deleteCostCenter));
