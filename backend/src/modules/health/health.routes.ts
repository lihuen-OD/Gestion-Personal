import { Router } from "express";
import { env, isProduction } from "../../config/env";
import { createRateLimiter } from "../../middlewares/rateLimiter";
import { getSlowEndpointStats } from "../../middlewares/requestLogger";
import { describeClientIp } from "../../shared/http/clientIp";
import { notFoundHandler } from "../../shared/errors/notFoundHandler";
import { prisma } from "../../shared/prisma/client";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      appEnv: env.APP_ENV,
      nodeEnv: env.NODE_ENV,
      database: "ok",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

healthRouter.get("/performance", (_req, res) => {
  if (isProduction) {
    res.status(404).json({ code: "NOT_FOUND", message: "Not found" });
    return;
  }
  res.json({
    status: "ok",
    slowEndpoints: getSlowEndpointStats(),
    timestamp: new Date().toISOString(),
  });
});

// F0 del fichador standalone (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md
// §F0 / trust proxy): sonda para medir cuántos proxies hay delante de Express
// en un entorno real y fijar TRUST_PROXY_HOPS. Pública (hay que llamarla
// desde un navegador/curl externo para ver la cadena real), así que no existe
// salvo con CLIENT_IP_DIAGNOSTICS_ENABLED=true y tiene su propio límite. Sólo
// devuelve la IP del propio llamador y la cadena de proxies.
const clientIpDiagnosticsLimiter = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 20 });

healthRouter.get(
  "/client-ip",
  (req, res, next) => (env.CLIENT_IP_DIAGNOSTICS_ENABLED ? next() : notFoundHandler(req, res, next)),
  clientIpDiagnosticsLimiter,
  (req, res) => {
    res.json({ data: describeClientIp(req) });
  },
);
