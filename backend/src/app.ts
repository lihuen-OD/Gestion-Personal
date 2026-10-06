import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { parseCorsOrigins } from "./config/corsOrigins";
import { env } from "./config/env";
import { trustProxySetting } from "./shared/http/clientIp";
import { requestLogger } from "./middlewares/requestLogger";
import { apiRouter } from "./routes";
import { errorHandler } from "./shared/errors/errorHandler";
import { notFoundHandler } from "./shared/errors/notFoundHandler";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  // Antes que cualquier middleware que lea req.ip (rate limiting, auditoría,
  // AttendancePunch.ipAddress). Ver shared/http/clientIp.ts y
  // TRUST_PROXY_HOPS en config/env.ts.
  app.set("trust proxy", trustProxySetting(env.TRUST_PROXY_HOPS));
  if (env.NODE_ENV === "production" && env.TRUST_PROXY_HOPS === 0) {
    console.warn(
      "[trustProxy] TRUST_PROXY_HOPS=0 en production: req.ip es la IP del proxy, asi que el rate limiting y la IP auditada agrupan a todos los clientes. Medir y configurar TRUST_PROXY_HOPS.",
    );
  }
  app.use(helmet());
  app.use(
    cors({
      origin: parseCorsOrigins(env.CORS_ORIGIN),
      credentials: true,
    }),
  );
  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));
  app.use(requestLogger);
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(env.API_PREFIX, apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
