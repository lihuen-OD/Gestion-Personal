import type { RequestHandler } from "express";
import { isProduction } from "../config/env";
import { createRequestMetrics, getRequestMetrics, runWithRequestMetrics } from "../shared/observability/requestMetrics";

export const requestLogger: RequestHandler = (req, res, next) => {
  if (isProduction) return next();

  const startedAt = Date.now();
  const metrics = createRequestMetrics(req.method, req.originalUrl);
  let responseBytes = 0;
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  res.write = ((chunk: unknown, ...args: unknown[]) => {
    if (chunk) responseBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    return originalWrite(chunk as Parameters<typeof originalWrite>[0], ...(args as Parameters<typeof originalWrite> extends [unknown, ...infer Rest] ? Rest : never));
  }) as typeof res.write;

  res.end = ((chunk: unknown, ...args: unknown[]) => {
    if (chunk) responseBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    return originalEnd(chunk as Parameters<typeof originalEnd>[0], ...(args as Parameters<typeof originalEnd> extends [unknown, ...infer Rest] ? Rest : never));
  }) as typeof res.end;

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const requestMetrics = getRequestMetrics() ?? metrics;
    const level = durationMs >= 3000 ? "SLOW" : durationMs >= 1000 ? "WARN" : "INFO";
    const sizeKb = responseBytes ? `${(responseBytes / 1024).toFixed(1)}KB` : "0KB";
    console.info(
      `${level} ${requestMetrics.method} ${requestMetrics.path} ${res.statusCode} ${durationMs}ms queries=${requestMetrics.queryCount} queryTime=${Math.round(requestMetrics.queryDurationMs)}ms size=${sizeKb}`,
    );

    requestMetrics.slowQueries.slice(0, 5).forEach((query) => {
      console.warn(`SLOW_QUERY ${query.durationMs}ms ${requestMetrics.method} ${requestMetrics.path} ${query.query}`);
    });
  });

  runWithRequestMetrics(metrics, next);
};
