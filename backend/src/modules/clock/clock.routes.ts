import { Router, type RequestHandler } from "express";
import { env } from "../../config/env";
import { createRateLimiter } from "../../middlewares/rateLimiter";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { authenticatedClockDevice, requireClockDevice } from "../clock-devices/clockDeviceAuthentication";
import { clockDevicePublicRouter } from "../clock-devices/clockDevices.routes";
import { clockByEmployeeSchema, clockEmployeeSearchQuerySchema, clockPhotoPunchSchema } from "../time-entries/timeEntries.schemas";
import { clockController } from "./clock.controller";

// Guardas de las rutas operativas del fichador (sin sesión de usuario: en vez
// de requireAuth exigen un ClockDevice ACTIVE autenticado individualmente).
// Orden:
// 1. límite por IP, antes de autenticar: frena fuerza bruta de credenciales
//    sin tocar la base; generoso para que varios kioscos detrás de la misma
//    red no compartan un cupo chico;
// 2. requireClockDevice(): 401/403 antes de cualquier validación o lectura;
// 3. límite por dispositivo, keyed por el id YA autenticado: un deviceId
//    inventado nunca crea un bucket.
// Una única instancia de cada limitador para las cuatro rutas: el cupo es por
// IP y por dispositivo, no por ruta.
const clockOperationalGuards: RequestHandler[] = [
  createRateLimiter({ windowMs: env.CLOCK_RATE_LIMIT_WINDOW_MS, max: env.CLOCK_IP_RATE_LIMIT_MAX }),
  requireClockDevice({ recordPresence: true }),
  createRateLimiter({
    windowMs: env.CLOCK_RATE_LIMIT_WINDOW_MS,
    max: env.CLOCK_RATE_LIMIT_MAX,
    keyGenerator: (req) => `clock-device:${authenticatedClockDevice(req).id}`,
  }),
];

/**
 * Namespace del dispositivo, `/api/clock/*`: enrolamiento (F5, cualquier
 * estado autenticado, ver clockDevices.routes.ts) y las cuatro rutas
 * operativas (sólo ACTIVE). Las fichadas que entran por acá se guardan como
 * KIOSK. Es el único namespace del fichador desde F11 (el alias
 * `/time-entries/clock/*` se retiró; ver timeEntries.routes.ts).
 */
export const clockRouter = Router();
clockRouter.use(clockDevicePublicRouter);
clockRouter.get("/employees", ...clockOperationalGuards, validateQuery(clockEmployeeSearchQuerySchema), asyncHandler(clockController.searchEmployees));
clockRouter.post("/status", ...clockOperationalGuards, validateBody(clockByEmployeeSchema), asyncHandler(clockController.status));
clockRouter.post("/photo-punch", ...clockOperationalGuards, validateBody(clockPhotoPunchSchema), asyncHandler(clockController.photoPunch));
clockRouter.get("/attempts/:requestId", ...clockOperationalGuards, asyncHandler(clockController.attemptStatus));
