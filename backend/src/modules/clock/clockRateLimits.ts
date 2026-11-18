import type { Request, RequestHandler } from "express";
import { env } from "../../config/env";
import { createRateLimitLogGate, createRateLimiter, logRateLimited, sendRateLimited } from "../../middlewares/rateLimiter";
import { authenticatedClockDevice, clockCredentialFingerprint, clockCredentialWasRejected, hasRecentlyVerifiedClockCredential, wellFormedClockDeviceCredential } from "../clock-devices/clockDeviceAuthentication";

/**
 * Límites de solicitudes del fichador (§33 de
 * docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md). Único lugar donde se
 * definen; las rutas sólo los montan.
 *
 * Capas de cada ruta de dispositivo, en este orden:
 * 1. `clockNetworkLimiter`: tope por IP ANTES de autenticar, UNA instancia
 *    compartida por todas las rutas de dispositivo de /api/clock/*. Cuenta
 *    sólo las solicitudes sin una credencial ya verificada (cada credencial
 *    inventada cuesta un lookup por clave primaria): el tráfico legítimo de
 *    muchos kioscos detrás de la misma red nunca lo agota.
 * 2. `clockCredentialFailureLimiter`: credenciales RECHAZADAS (401) por IP y
 *    por credencial presentada. Un equipo mal configurado se bloquea sólo a
 *    sí mismo: los demás equipos de la misma IP presentan otra credencial.
 * 3. `requireClockDevice()`: 401/403 antes de cualquier validación o lectura.
 * 4. Cupo por dispositivo AUTENTICADO y por operación: una búsqueda nunca
 *    gasta el cupo de la jornada, la fichada o la recuperación de intentos.
 *
 * Dimensionamiento (ventana de 5 min, medido en §33): un equipo atiende como
 * máximo ~33-40 personas (~9 s cada una: buscar, cámara, envío y pantalla de
 * confirmación). Por persona: búsqueda ~2 en promedio y hasta ~13 en el peor
 * caso legítimo (tecleo lento, apellido frecuente que siempre devuelve 12,
 * nombre completo), jornada 1-2, fichada 1 (+3 reenvíos si la red falla) e
 * intentos 0 (14 en una recuperación completa). Valores por defecto en
 * config/env.ts: búsqueda 450 (≈ 33 × 13) y 1800 por hora, jornada 100,
 * fichada 60, intentos 120.
 *
 * Todo cupo vive en la memoria del proceso: con más de una instancia del
 * backend hace falta un store compartido (§30.10).
 */

export const CLOCK_RATE_LIMIT_CODES = {
  network: "CLOCK_NETWORK_RATE_LIMITED",
  credentialFailures: "CLOCK_AUTH_RATE_LIMITED",
  search: "CLOCK_SEARCH_RATE_LIMITED",
  status: "CLOCK_STATUS_RATE_LIMITED",
  punch: "CLOCK_PUNCH_RATE_LIMITED",
  attempts: "CLOCK_ATTEMPT_RATE_LIMITED",
  device: "CLOCK_DEVICE_RATE_LIMITED",
  enrollment: "CLOCK_ENROLLMENT_RATE_LIMITED",
} as const;

const CREDENTIAL_FAILURE_WINDOW_MS = 15 * 60_000;
const SEARCH_HOURLY_WINDOW_MS = 60 * 60_000;
// Heartbeat: la PWA manda 1 por minuto más 1 al volver a primer plano.
export const HEARTBEAT_WINDOW_MS = 5 * 60_000;
export const HEARTBEAT_MAX_PER_DEVICE = 10;
// Estado del enrolamiento: la PWA consulta cada 7,5 s mientras espera la
// aprobación (40 cada 5 min) y una vez al arrancar.
const DEVICE_STATUS_WINDOW_MS = 5 * 60_000;
const DEVICE_STATUS_MAX_PER_DEVICE = 60;
// Modo mantenimiento (docs/decisions/FICHADOR_MAINTENANCE_MODE.md): canjear un
// código tiene el cupo más chico; además el servicio anula el código a los 5
// intentos fallidos, con el contador en la base.
export const MAINTENANCE_CODE_WINDOW_MS = 15 * 60_000;
export const MAINTENANCE_CODE_MAX_PER_DEVICE = 10;
const MAINTENANCE_SESSION_WINDOW_MS = 5 * 60_000;
const MAINTENANCE_SESSION_MAX_PER_DEVICE = 30;

const DEVICE_LIMIT_MESSAGE = "Este equipo alcanzó el límite de operaciones. Esperá unos minutos y volvé a intentar.";

const NETWORK_REJECTION = {
  code: CLOCK_RATE_LIMIT_CODES.network,
  message: "Hay demasiadas operaciones desde esta red. Esperá unos minutos y volvé a intentar.",
  logIp: true,
};

/**
 * Tope por IP de las solicitudes SIN una credencial ya verificada (ausente,
 * mal formada, inventada, o la primera de un equipo después de un reinicio
 * del backend). Las de un equipo que autenticó hace poco no cuentan: su
 * volumen lo acotan los cupos por dispositivo, así que ni muchos kioscos
 * detrás de la misma red ni alguien que la inunde sin credencial bloquean a
 * los equipos verificados.
 */
export const clockNetworkLimiter = createRateLimiter({
  windowMs: env.CLOCK_RATE_LIMIT_WINDOW_MS,
  max: env.CLOCK_IP_RATE_LIMIT_MAX,
  skip: (req) => hasRecentlyVerifiedClockCredential(req),
  rejection: NETWORK_REJECTION,
});

const CREDENTIAL_FAILURE_REJECTION = {
  code: CLOCK_RATE_LIMIT_CODES.credentialFailures,
  message: "Este dispositivo tuvo demasiados intentos de autorización rechazados. Esperá unos minutos y avisá a RRHH.",
  logIp: true,
};

/**
 * Credenciales RECHAZADAS por requireClockDevice, por IP y por huella de la
 * credencial presentada, en ventanas fijas de 15 minutos. Contador propio (no
 * express-rate-limit, que cuenta cada request EN CURSO hasta que termina y
 * llegó a bloquear a un equipo legítimo con varias requests simultáneas):
 * acá sólo suma un rechazo ya ocurrido y sólo bloquea esa misma credencial,
 * antes de volver a consultar la base. Un equipo mal configurado se bloquea a
 * sí mismo; los demás de la misma IP presentan otra credencial.
 */
function createCredentialFailureGuard(max: number, windowMs: number): RequestHandler {
  const failures = new Map<string, { count: number; resetAt: number }>();
  const shouldLog = createRateLimitLogGate();
  return (req, res, next) => {
    const credential = wellFormedClockDeviceCredential(req);
    if (!credential) return next();
    const key = `${req.ip}|${clockCredentialFingerprint(credential)}`;
    const now = Date.now();
    const entry = failures.get(key);
    if (entry && entry.resetAt > now && entry.count >= max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      if (shouldLog(key, entry.resetAt)) logRateLimited(req, CREDENTIAL_FAILURE_REJECTION, max, windowMs);
      return sendRateLimited(res, CREDENTIAL_FAILURE_REJECTION, retryAfterSeconds);
    }
    res.once("finish", () => {
      if (!clockCredentialWasRejected(req)) return;
      const at = Date.now();
      const current = failures.get(key);
      if (!current || current.resetAt <= at) {
        if (failures.size >= 10_000) {
          for (const [storedKey, stored] of failures) if (stored.resetAt <= at) failures.delete(storedKey);
        }
        failures.set(key, { count: 1, resetAt: at + windowMs });
      } else {
        current.count += 1;
      }
    });
    next();
  };
}

export const clockCredentialFailureLimiter = createCredentialFailureGuard(env.CLOCK_AUTH_FAILURE_RATE_LIMIT_MAX, CREDENTIAL_FAILURE_WINDOW_MS);

/** Cupo por dispositivo YA autenticado: un id inventado nunca crea un bucket. */
function perDevice(name: string, windowMs: number, max: number, code: string, message = DEVICE_LIMIT_MESSAGE): RequestHandler {
  return createRateLimiter({
    windowMs,
    max,
    keyGenerator: (req) => `clock-${name}:${authenticatedClockDevice(req).id}`,
    rejection: { code, message },
  });
}

export const clockDeviceLimiters = {
  search: [
    perDevice("search", env.CLOCK_RATE_LIMIT_WINDOW_MS, env.CLOCK_SEARCH_RATE_LIMIT_MAX, CLOCK_RATE_LIMIT_CODES.search, "Se hicieron muchas búsquedas seguidas en este equipo. Esperá un momento y volvé a buscar."),
    perDevice("search-hourly", SEARCH_HOURLY_WINDOW_MS, env.CLOCK_SEARCH_HOURLY_RATE_LIMIT_MAX, CLOCK_RATE_LIMIT_CODES.search, "Se hicieron muchas búsquedas seguidas en este equipo. Esperá un momento y volvé a buscar."),
  ],
  status: [perDevice("status", env.CLOCK_RATE_LIMIT_WINDOW_MS, env.CLOCK_STATUS_RATE_LIMIT_MAX, CLOCK_RATE_LIMIT_CODES.status)],
  punch: [perDevice("punch", env.CLOCK_RATE_LIMIT_WINDOW_MS, env.CLOCK_PUNCH_RATE_LIMIT_MAX, CLOCK_RATE_LIMIT_CODES.punch)],
  attempts: [perDevice("attempts", env.CLOCK_RATE_LIMIT_WINDOW_MS, env.CLOCK_ATTEMPT_RATE_LIMIT_MAX, CLOCK_RATE_LIMIT_CODES.attempts)],
  heartbeat: [perDevice("heartbeat", HEARTBEAT_WINDOW_MS, HEARTBEAT_MAX_PER_DEVICE, CLOCK_RATE_LIMIT_CODES.device)],
  deviceStatus: [perDevice("device-status", DEVICE_STATUS_WINDOW_MS, DEVICE_STATUS_MAX_PER_DEVICE, CLOCK_RATE_LIMIT_CODES.device)],
  maintenanceCode: [perDevice("maintenance-code", MAINTENANCE_CODE_WINDOW_MS, MAINTENANCE_CODE_MAX_PER_DEVICE, CLOCK_RATE_LIMIT_CODES.device)],
  maintenanceSession: [perDevice("maintenance-session", MAINTENANCE_SESSION_WINDOW_MS, MAINTENANCE_SESSION_MAX_PER_DEVICE, CLOCK_RATE_LIMIT_CODES.device)],
} satisfies Record<string, RequestHandler[]>;

/** Las dos capas previas a autenticar, comunes a toda ruta de dispositivo. */
export const clockPreAuthLimiters: RequestHandler[] = [clockNetworkLimiter, clockCredentialFailureLimiter];

/** Cupos del enrolamiento (sin credencial todavía): por IP, propios. */
export function clockEnrollmentLimiter(windowMs: number, max: number) {
  return createRateLimiter({
    windowMs,
    max,
    rejection: { code: CLOCK_RATE_LIMIT_CODES.enrollment, message: "Hay demasiados intentos seguidos. Esperá unos minutos y volvé a intentar.", logIp: true },
  });
}

/**
 * Rutas EXACTAS (método + path, sin variantes de mayúsculas ni barra final)
 * que el limitador global de la API no cuenta: cada una ya tiene el tope por
 * IP, el cupo de credenciales rechazadas, la autenticación y su cupo por
 * dispositivo (lo verifica clockRateLimits.test.ts). Toda otra ruta, incluidas
 * las desconocidas bajo /api/clock/*, el enrolamiento y el mantenimiento,
 * sigue contando en el global.
 */
const GLOBAL_LIMIT_EXEMPT_ROUTES: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: "GET", pattern: /^\/clock\/employees$/ },
  { method: "POST", pattern: /^\/clock\/status$/ },
  { method: "POST", pattern: /^\/clock\/photo-punch$/ },
  { method: "GET", pattern: /^\/clock\/attempts\/[^/]+$/ },
  { method: "POST", pattern: /^\/clock\/heartbeat$/ },
  { method: "GET", pattern: /^\/clock\/device\/status$/ },
];

export function isExemptFromGlobalRateLimit(req: Pick<Request, "method" | "path">, apiPrefix: string) {
  if (!req.path.startsWith(`${apiPrefix}/clock/`)) return false;
  const path = req.path.slice(apiPrefix.length);
  return GLOBAL_LIMIT_EXEMPT_ROUTES.some((route) => route.method === req.method && route.pattern.test(path));
}
