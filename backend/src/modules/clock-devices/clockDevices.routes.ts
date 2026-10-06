import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { createRateLimiter } from "../../middlewares/rateLimiter";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { adminRoles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { ALL_CLOCK_DEVICE_STATUSES, requireClockDevice } from "./clockDeviceAuthentication";
import { clockDevicesController } from "./clockDevices.controller";
import { activateClockDeviceSchema, listClockDevicesQuerySchema, refreshPairingCodeSchema, registerClockDeviceSchema, resolvePairingSchema } from "./clockDevices.schemas";

export const clockDevicePublicRouter = Router();
export const clockDevicesAdminRouter = Router();

clockDevicePublicRouter.post("/device/register", createRateLimiter({ windowMs: 10 * 60_000, max: 5 }), validateBody(registerClockDeviceSchema), asyncHandler(clockDevicesController.register));
// El enrolamiento acepta cualquier estado autenticado: PENDING espera la
// aprobación y REVOKED necesita poder enterarse de que fue revocado. Las
// rutas operativas del fichador usan requireClockDevice() (sólo ACTIVE).
const anyEnrolledDevice = requireClockDevice({ allow: ALL_CLOCK_DEVICE_STATUSES });

clockDevicePublicRouter.get("/device/status", createRateLimiter({ windowMs: 5 * 60_000, max: 120 }), anyEnrolledDevice, asyncHandler(clockDevicesController.status));
clockDevicePublicRouter.post("/device/pairing-code/refresh", createRateLimiter({ windowMs: 10 * 60_000, max: 10 }), anyEnrolledDevice, validateBody(refreshPairingCodeSchema), asyncHandler(clockDevicesController.refreshPairing));

clockDevicesAdminRouter.use(requireAuth, requireAnyRole(adminRoles));
clockDevicesAdminRouter.get("/", validateQuery(listClockDevicesQuerySchema), asyncHandler(clockDevicesController.list));
clockDevicesAdminRouter.post("/resolve-pairing", createRateLimiter({ windowMs: 5 * 60_000, max: 10 }), validateBody(resolvePairingSchema), asyncHandler(clockDevicesController.resolvePairing));
clockDevicesAdminRouter.get("/:id", asyncHandler(clockDevicesController.getById));
clockDevicesAdminRouter.post("/:id/activate", validateBody(activateClockDeviceSchema), asyncHandler(clockDevicesController.activate));
clockDevicesAdminRouter.post("/:id/revoke", asyncHandler(clockDevicesController.revoke));
clockDevicesAdminRouter.delete("/:id", asyncHandler(clockDevicesController.deletePending));
