import { Router, type RequestHandler } from "express";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { CLOCK_PHOTO_PUNCH_BODY_LIMIT_BYTES, jsonBody } from "../../shared/http/bodyLimits";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { requireClockDevice } from "../clock-devices/clockDeviceAuthentication";
import { clockDevicePublicRouter } from "../clock-devices/clockDevices.routes";
import { clockByEmployeeSchema, clockEmployeeSearchQuerySchema, clockPhotoPunchSchema } from "../time-entries/timeEntries.schemas";
import { clockController } from "./clock.controller";
import { clockDeviceLimiters, clockPreAuthLimiters } from "./clockRateLimits";

// Guardas de las rutas operativas del fichador (sin sesión de usuario: en vez
// de requireAuth exigen un ClockDevice ACTIVE autenticado individualmente).
// Orden (§33, clockRateLimits.ts):
// 1. tope por IP y cupo de credenciales rechazadas, antes de autenticar: sin
//    tocar la base para un exceso, y sin que un equipo mal configurado
//    bloquee a los demás de la misma red;
// 2. requireClockDevice(): 401/403 antes de cualquier validación o lectura;
// 3. cupo PROPIO de cada operación por dispositivo, keyed por el id YA
//    autenticado: las búsquedas nunca agotan la jornada, la fichada ni la
//    recuperación de intentos, y un deviceId inventado nunca crea un bucket.
const authenticateOperationalDevice = requireClockDevice({ recordPresence: true });
const operationalGuards = (operation: RequestHandler[]): RequestHandler[] => [...clockPreAuthLimiters, authenticateOperationalDevice, ...operation];

function measureMiddleware(phase: "authMs" | "parseMs", middleware: RequestHandler): RequestHandler {
  return (req, res, next) => {
    const startedAt = performance.now();
    middleware(req, res, (error?: unknown) => {
      req.clockPunchTimings = { ...(req.clockPunchTimings || {}), [phase]: performance.now() - startedAt };
      next(error);
    });
  };
}

const clockPhotoPunchGuards: RequestHandler[] = [
  ...clockPreAuthLimiters,
  measureMiddleware("authMs", authenticateOperationalDevice),
  ...clockDeviceLimiters.punch,
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
clockRouter.get("/employees", ...operationalGuards(clockDeviceLimiters.search), validateQuery(clockEmployeeSearchQuerySchema), asyncHandler(clockController.searchEmployees));
clockRouter.post("/status", ...operationalGuards(clockDeviceLimiters.status), validateBody(clockByEmployeeSchema), asyncHandler(clockController.status));
// F11: la foto se parsea recién con el dispositivo autenticado y dentro de su
// cupo (el parser global de 1 MiB saltea esta ruta, ver shared/http/bodyLimits.ts).
clockRouter.post("/photo-punch", ...clockPhotoPunchGuards, measureMiddleware("parseMs", jsonBody(CLOCK_PHOTO_PUNCH_BODY_LIMIT_BYTES)), validateBody(clockPhotoPunchSchema), asyncHandler(clockController.photoPunch));
clockRouter.get("/attempts/:requestId", ...operationalGuards(clockDeviceLimiters.attempts), asyncHandler(clockController.attemptStatus));
