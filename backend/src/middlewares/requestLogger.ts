import type { RequestHandler } from "express";
import { isProduction } from "../config/env";
import { createRequestMetrics, getRequestMetrics, runWithRequestMetrics } from "../shared/observability/requestMetrics";

type SlowEndpointStat = {
  count: number;
  maxDurationMs: number;
  totalDurationMs: number;
};

const slowEndpointStats = new Map<string, SlowEndpointStat>();

function recordSlowEndpoint(method: string, path: string, durationMs: number) {
  const normalizedPath = path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");
  const key = `${method} ${normalizedPath.split("?")[0]}`;
  const current = slowEndpointStats.get(key) || { count: 0, maxDurationMs: 0, totalDurationMs: 0 };
  current.count += 1;
  current.maxDurationMs = Math.max(current.maxDurationMs, durationMs);
  current.totalDurationMs += durationMs;
  slowEndpointStats.set(key, current);

  const top = [...slowEndpointStats.entries()]
    .map(([endpoint, stat]) => ({
      endpoint,
      count: stat.count,
      avg: Math.round(stat.totalDurationMs / stat.count),
      max: stat.maxDurationMs,
    }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 10);

  console.info(`SLOW_ENDPOINT_TOP ${JSON.stringify(top)}`);
}

export function getSlowEndpointStats() {
  return [...slowEndpointStats.entries()]
    .map(([endpoint, stat]) => ({
      endpoint,
      count: stat.count,
      avgDurationMs: Math.round(stat.totalDurationMs / stat.count),
      maxDurationMs: stat.maxDurationMs,
    }))
    .sort((a, b) => b.avgDurationMs - a.avgDurationMs)
    .slice(0, 25);
}

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
    const actor = requestMetrics.userId ? ` user=${requestMetrics.userId} role=${requestMetrics.role || "none"}` : "";
    console.info(
      `${level} ${requestMetrics.method} ${requestMetrics.path} ${res.statusCode} ${durationMs}ms queries=${requestMetrics.queryCount} queryTime=${Math.round(requestMetrics.queryDurationMs)}ms size=${sizeKb}${actor}`,
    );

    if (durationMs >= 1000) recordSlowEndpoint(requestMetrics.method, requestMetrics.path, durationMs);

    requestMetrics.slowQueries.slice(0, 5).forEach((query) => {
      console.warn(`SLOW_QUERY ${query.durationMs}ms ${requestMetrics.method} ${requestMetrics.path} ${query.query}`);
    });
  });

  runWithRequestMetrics(metrics, next);
};
