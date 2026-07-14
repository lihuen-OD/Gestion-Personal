import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { roles } from "../../shared/security/roles";
import { storageController } from "./storage.controller";

export const storageRouter = Router();
const storageRoles = [roles.rrhh, roles.supervision, roles.cargaHoraria];

storageRouter.use(requireAuth);
storageRouter.get("/files/:id", requireAnyRole(storageRoles), asyncHandler(storageController.metadata));
storageRouter.get("/files/:id/preview", requireAnyRole(storageRoles), asyncHandler(storageController.download));
storageRouter.get("/files/:id/download", requireAnyRole(storageRoles), asyncHandler(storageController.download));
storageRouter.delete("/files/:id", requireAnyRole([roles.rrhh]), asyncHandler(storageController.archive));
