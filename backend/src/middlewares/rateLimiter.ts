import type { Request } from "express";
import rateLimit from "express-rate-limit";

// Sin keyGenerator, la clave es la IP efectiva (req.ip, ver TRUST_PROXY_HOPS).
// Una clave propia sólo debe montarse después del middleware que la
// autentica, para que nadie pueda inventar buckets nuevos sin credencial.
export function createRateLimiter(options: { windowMs: number; max: number; keyGenerator?: (req: Request) => string }) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    ...(options.keyGenerator ? { keyGenerator: options.keyGenerator } : {}),
  });
}
