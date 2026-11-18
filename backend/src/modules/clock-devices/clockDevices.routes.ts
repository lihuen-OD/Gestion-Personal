import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { createRateLimiter } from "../../middlewares/rateLimiter";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { adminRoles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { clockDeviceLimiters, clockEnrollmentLimiter, clockPreAuthLimiters } from "../clock/clockRateLimits";
import { ALL_CLOCK_DEVICE_STATUSES, requireClockDevice } from "./clockDeviceAuthentication";
import { clockDevicesController } from "./clockDevices.controller";
import { activateClockDeviceSchema, listClockDevicesQuerySchema, openMaintenanceSessionSchema, refreshPairingCodeSchema, registerClockDeviceSchema, resolvePairingSchema, updateClockDeviceSchema } from "./clockDevices.schemas";

export const clockDevicePublicRouter = Router();
export const clockDevicesAdminRouter = Router();

// §33 (modules/clock/clockRateLimits.ts): toda ruta que autentica un
// dispositivo pasa primero por el tope por IP compartido y el cupo de
// credenciales rechazadas, y después de autenticar por un cupo propio del
// dispositivo. El registro todavía no tiene credencial: cupo por IP propio.
clockDevicePublicRouter.post("/device/register", clockEnrollmentLimiter(10 * 60_000, 5), validateBody(registerClockDeviceSchema), asyncHandler(clockDevicesController.register));
// El enrolamiento acepta cualquier estado autenticado: PENDING espera la
// aprobación y REVOKED necesita poder enterarse de que fue revocado. Las
// rutas operativas del fichador usan requireClockDevice() (sólo ACTIVE).
const anyEnrolledDevice = requireClockDevice({ allow: ALL_CLOCK_DEVICE_STATUSES });

// Consultado cada 7,5 s mientras el equipo espera la aprobación: cupo por
// dispositivo autenticado (varias tablets enrolándose detrás de la misma red
// no comparten un cupo por IP chico).
clockDevicePublicRouter.get("/device/status", ...clockPreAuthLimiters, anyEnrolledDevice, ...clockDeviceLimiters.deviceStatus, asyncHandler(clockDevicesController.status));
clockDevicePublicRouter.post("/device/pairing-code/refresh", clockEnrollmentLimiter(10 * 60_000, 10), anyEnrolledDevice, validateBody(refreshPairingCodeSchema), asyncHandler(clockDevicesController.refreshPairing));

// F9: heartbeat del fichador, POST /api/clock/heartbeat. Sólo ACTIVE. Su cupo
// por dispositivo es propio y no gasta el de las fichadas.
clockDevicePublicRouter.post(
  "/heartbeat",
  ...clockPreAuthLimiters,
  requireClockDevice(),
  ...clockDeviceLimiters.heartbeat,
  asyncHandler(clockDevicesController.heartbeat),
);

// Modo mantenimiento (docs/decisions/FICHADOR_MAINTENANCE_MODE.md), sólo
// ACTIVE. Mismo esquema de capas, con cupos propios por dispositivo: canjear
// un código tiene el más chico (10 cada 15 min).
const maintenanceSessionGuards = [...clockPreAuthLimiters, requireClockDevice(), ...clockDeviceLimiters.maintenanceSession];
clockDevicePublicRouter.post(
  "/maintenance/session",
  ...clockPreAuthLimiters,
  requireClockDevice(),
  ...clockDeviceLimiters.maintenanceCode,
  validateBody(openMaintenanceSessionSchema),
  asyncHandler(clockDevicesController.openMaintenanceSession),
);
clockDevicePublicRouter.get("/maintenance/session", ...maintenanceSessionGuards, asyncHandler(clockDevicesController.maintenanceSession));
clockDevicePublicRouter.delete("/maintenance/session", ...maintenanceSessionGuards, asyncHandler(clockDevicesController.endMaintenanceSession));

clockDevicesAdminRouter.use(requireAuth, requireAnyRole(adminRoles));
clockDevicesAdminRouter.get("/", validateQuery(listClockDevicesQuerySchema), asyncHandler(clockDevicesController.list));
clockDevicesAdminRouter.post("/resolve-pairing", createRateLimiter({ windowMs: 5 * 60_000, max: 10 }), validateBody(resolvePairingSchema), asyncHandler(clockDevicesController.resolvePairing));
clockDevicesAdminRouter.get("/:id", asyncHandler(clockDevicesController.getById));
clockDevicesAdminRouter.post("/:id/activate", validateBody(activateClockDeviceSchema), asyncHandler(clockDevicesController.activate));
clockDevicesAdminRouter.patch("/:id", validateBody(updateClockDeviceSchema), asyncHandler(clockDevicesController.update));
clockDevicesAdminRouter.post("/:id/revoke", asyncHandler(clockDevicesController.revoke));
// Cupo por usuario RRHH ya autenticado (no por IP compartida de la oficina).
clockDevicesAdminRouter.post("/:id/maintenance-code", createRateLimiter({ windowMs: 5 * 60_000, max: 10, keyGenerator: (req) => `clock-maintenance-issue:${req.user!.id}` }), asyncHandler(clockDevicesController.issueMaintenanceCode));
clockDevicesAdminRouter.delete("/:id", asyncHandler(clockDevicesController.deletePending));
