import { Router } from "express";
import { env } from "../../config/env";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { createRateLimiter } from "../../middlewares/rateLimiter";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { adminRoles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { ALL_CLOCK_DEVICE_STATUSES, authenticatedClockDevice, requireClockDevice } from "./clockDeviceAuthentication";
import { clockDevicesController } from "./clockDevices.controller";
import { activateClockDeviceSchema, listClockDevicesQuerySchema, refreshPairingCodeSchema, registerClockDeviceSchema, resolvePairingSchema, updateClockDeviceSchema } from "./clockDevices.schemas";

export const clockDevicePublicRouter = Router();
export const clockDevicesAdminRouter = Router();

clockDevicePublicRouter.post("/device/register", createRateLimiter({ windowMs: 10 * 60_000, max: 5 }), validateBody(registerClockDeviceSchema), asyncHandler(clockDevicesController.register));
// El enrolamiento acepta cualquier estado autenticado: PENDING espera la
// aprobación y REVOKED necesita poder enterarse de que fue revocado. Las
// rutas operativas del fichador usan requireClockDevice() (sólo ACTIVE).
const anyEnrolledDevice = requireClockDevice({ allow: ALL_CLOCK_DEVICE_STATUSES });

clockDevicePublicRouter.get("/device/status", createRateLimiter({ windowMs: 5 * 60_000, max: 120 }), anyEnrolledDevice, asyncHandler(clockDevicesController.status));
clockDevicePublicRouter.post("/device/pairing-code/refresh", createRateLimiter({ windowMs: 10 * 60_000, max: 10 }), anyEnrolledDevice, validateBody(refreshPairingCodeSchema), asyncHandler(clockDevicesController.refreshPairing));

// F9: heartbeat del fichador, POST /api/clock/heartbeat (no existe en el alias
// legacy). Sólo ACTIVE. Limitadores PROPIOS, para no gastar el cupo operativo
// de las fichadas: por IP antes de autenticar (mismo máximo que las rutas
// operativas, pensado para varios kioscos detrás de una IP) y por dispositivo
// ya autenticado (un deviceId inventado nunca crea un bucket). La PWA manda 1
// por minuto más 1 al volver a primer plano: 10 cada 5 minutos deja margen sin
// habilitar un loop.
const HEARTBEAT_WINDOW_MS = 5 * 60_000;
const HEARTBEAT_MAX_PER_DEVICE = 10;
clockDevicePublicRouter.post(
  "/heartbeat",
  createRateLimiter({ windowMs: env.CLOCK_RATE_LIMIT_WINDOW_MS, max: env.CLOCK_IP_RATE_LIMIT_MAX }),
  requireClockDevice(),
  createRateLimiter({ windowMs: HEARTBEAT_WINDOW_MS, max: HEARTBEAT_MAX_PER_DEVICE, keyGenerator: (req) => `clock-heartbeat:${authenticatedClockDevice(req).id}` }),
  asyncHandler(clockDevicesController.heartbeat),
);

clockDevicesAdminRouter.use(requireAuth, requireAnyRole(adminRoles));
clockDevicesAdminRouter.get("/", validateQuery(listClockDevicesQuerySchema), asyncHandler(clockDevicesController.list));
clockDevicesAdminRouter.post("/resolve-pairing", createRateLimiter({ windowMs: 5 * 60_000, max: 10 }), validateBody(resolvePairingSchema), asyncHandler(clockDevicesController.resolvePairing));
clockDevicesAdminRouter.get("/:id", asyncHandler(clockDevicesController.getById));
clockDevicesAdminRouter.post("/:id/activate", validateBody(activateClockDeviceSchema), asyncHandler(clockDevicesController.activate));
clockDevicesAdminRouter.patch("/:id", validateBody(updateClockDeviceSchema), asyncHandler(clockDevicesController.update));
clockDevicesAdminRouter.post("/:id/revoke", asyncHandler(clockDevicesController.revoke));
clockDevicesAdminRouter.delete("/:id", asyncHandler(clockDevicesController.deletePending));
