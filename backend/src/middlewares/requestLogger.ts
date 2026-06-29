import type { RequestHandler } from "express";
import { isProduction } from "../config/env";

export const requestLogger: RequestHandler = (req, res, next) => {
  if (isProduction) return next();

  const startedAt = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    console.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`);
  });

  next();
};
