import { Router, type RequestHandler } from "express";
import { env } from "../../config/env";
import { createRateLimiter } from "../../middlewares/rateLimiter";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { authenticatedClockDevice, requireClockDevice } from "../clock-devices/clockDeviceAuthentication";
import { clockDevicePublicRouter } from "../clock-devices/clockDevices.routes";
import { clockByEmployeeSchema, clockEmployeeSearchQuerySchema, clockPhotoPunchSchema } from "../time-entries/timeEntries.schemas";
import type { ClockPunchSource } from "../time-entries/timeEntries.service";
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
// F7: una única instancia montada en los dos namespaces, así los buckets (en
// memoria) son los mismos: usar /api/clock y el legacy a la vez no duplica el
// cupo de un dispositivo ni el de una IP.
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
 * Monta las cuatro rutas operativas sobre `router` bajo `prefix`. Las dos
 * llamadas (nuevo namespace y legacy) comparten guardas, validación,
 * controller y servicio: lo único que cambia es el `source` de la fichada,
 * que decide la ruta y nunca el body.
 */
export function mountClockOperationalRoutes(router: Router, options: { prefix: string; source: ClockPunchSource; before?: RequestHandler[] }) {
  const { prefix, source, before = [] } = options;
  router.get(`${prefix}/employees`, ...before, ...clockOperationalGuards, validateQuery(clockEmployeeSearchQuerySchema), asyncHandler(clockController.searchEmployees));
  router.post(`${prefix}/status`, ...before, ...clockOperationalGuards, validateBody(clockByEmployeeSchema), asyncHandler(clockController.status));
  router.post(`${prefix}/photo-punch`, ...before, ...clockOperationalGuards, validateBody(clockPhotoPunchSchema), asyncHandler(clockController.photoPunch(source)));
  router.get(`${prefix}/attempts/:requestId`, ...before, ...clockOperationalGuards, asyncHandler(clockController.attemptStatus));
}

// RFC 9745: `Deprecation: @<epoch>` = desde cuándo está deprecada (F7,
// 2026-10-13). La PWA no lo lee (no es un header expuesto por CORS); es una
// señal para logs y clientes no-browser. F8 migra la PWA a /api/clock y F11
// retira estas rutas.
const LEGACY_CLOCK_DEPRECATION = `@${Date.UTC(2026, 9, 13) / 1000}`;
export const markLegacyClockRoute: RequestHandler = (_req, res, next) => {
  res.setHeader("Deprecation", LEGACY_CLOCK_DEPRECATION);
  next();
};

/**
 * Namespace del dispositivo, `/api/clock/*`: enrolamiento (F5, cualquier
 * estado autenticado, ver clockDevices.routes.ts) y las rutas operativas
 * (sólo ACTIVE). Las fichadas que entran por acá se guardan como KIOSK.
 */
export const clockRouter = Router();
clockRouter.use(clockDevicePublicRouter);
mountClockOperationalRoutes(clockRouter, { prefix: "", source: "KIOSK" });
