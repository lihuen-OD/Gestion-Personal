import type { Request, Response } from "express";
import rateLimit, { type RateLimitInfo } from "express-rate-limit";

/**
 * Respuesta estructurada de un cupo agotado. Sin `code`, el limitador conserva
 * la respuesta por defecto de express-rate-limit (texto plano), que es la que
 * ya consumen el login, el refresh y el limitador global.
 */
export type RateLimitRejection = {
  /** Código estable del cupo agotado (p. ej. CLOCK_SEARCH_RATE_LIMITED). */
  code: string;
  /** Texto para quien usa el sistema; el cliente puede reemplazarlo por código. */
  message: string;
  /**
   * Agrega la IP al registro técnico del bloqueo. Sólo para cupos previos a la
   * autenticación, donde la IP es la clave y el dato que permite investigar.
   */
  logIp?: boolean;
};

type RateLimiterOptions = {
  windowMs: number;
  max: number;
  // Sin keyGenerator, la clave es la IP efectiva (req.ip, ver TRUST_PROXY_HOPS).
  // Una clave propia sólo debe montarse después del middleware que la
  // autentica, para que nadie pueda inventar buckets nuevos sin credencial.
  keyGenerator?: (req: Request) => string;
  rejection?: RateLimitRejection;
  /** No cuenta la request (p. ej. una credencial ya verificada). */
  skip?: (req: Request) => boolean;
};

/** Lo que express-rate-limit deja en la request del último limitador que la contó. */
function rateLimitInfo(req: Request): RateLimitInfo | undefined {
  return (req as Request & { rateLimit?: RateLimitInfo }).rateLimit;
}

/** Segundos que faltan para que el cupo se libere (mínimo 1). */
export function rateLimitRetryAfterSeconds(req: Request, windowMs: number) {
  const resetTime = rateLimitInfo(req)?.resetTime;
  const remainingMs = resetTime instanceof Date ? resetTime.getTime() - Date.now() : windowMs;
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

/** Registro técnico de un bloqueo: nunca la query string (búsquedas, DNI) ni el requestId. */
export function logRateLimited(req: Request, rejection: RateLimitRejection, limit: number | undefined, windowMs: number) {
  console.warn(JSON.stringify({
    level: "warn",
    event: "RATE_LIMITED",
    code: rejection.code,
    method: req.method,
    route: `${req.baseUrl}${typeof req.route?.path === "string" ? req.route.path : ""}`,
    limit,
    windowMs,
    ...(req.clockDevice ? { deviceId: req.clockDevice.id } : {}),
    ...(rejection.logIp ? { ip: req.ip } : {}),
  }));
}

/** 429 estructurado: el body repite la espera porque CORS no expone Retry-After al navegador. */
export function sendRateLimited(res: Response, rejection: RateLimitRejection, retryAfterSeconds: number) {
  res.setHeader("Retry-After", String(retryAfterSeconds));
  res.status(429).json({ error: { code: rejection.code, message: rejection.message, retryAfterSeconds } });
}

/**
 * Un solo registro por clave y ventana (el primer rechazo): un cliente que
 * insiste no puede inundar los logs.
 */
export function createRateLimitLogGate() {
  const loggedUntil = new Map<string, number>();
  return (key: string, until: number) => {
    const now = Date.now();
    if ((loggedUntil.get(key) ?? 0) > now) return false;
    if (loggedUntil.size >= 5_000) {
      for (const [storedKey, storedUntil] of loggedUntil) if (storedUntil <= now) loggedUntil.delete(storedKey);
    }
    loggedUntil.set(key, until);
    return true;
  };
}

function rejectionHandler(rejection: RateLimitRejection, windowMs: number, keyFor: (req: Request) => string) {
  const shouldLog = createRateLimitLogGate();
  return (req: Request, res: Response) => {
    const retryAfterSeconds = rateLimitRetryAfterSeconds(req, windowMs);
    if (shouldLog(keyFor(req), Date.now() + retryAfterSeconds * 1000)) logRateLimited(req, rejection, rateLimitInfo(req)?.limit, windowMs);
    sendRateLimited(res, rejection, retryAfterSeconds);
  };
}

export function createRateLimiter(options: RateLimiterOptions) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    ...(options.keyGenerator ? { keyGenerator: options.keyGenerator } : {}),
    ...(options.skip ? { skip: options.skip } : {}),
    ...(options.rejection ? { handler: rejectionHandler(options.rejection, options.windowMs, options.keyGenerator ?? ((req) => req.ip ?? "")) } : {}),
  });
}
