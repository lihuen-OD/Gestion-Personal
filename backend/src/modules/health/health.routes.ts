import { Router } from "express";
import { env, isProduction } from "../../config/env";
import { getSlowEndpointStats } from "../../middlewares/requestLogger";
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
