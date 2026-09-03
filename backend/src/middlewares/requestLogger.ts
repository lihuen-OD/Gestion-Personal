import type { RequestHandler } from "express";
import { env, isPerformanceLoggingEnabled } from "../config/env";
import { createRequestMetrics, getRequestMetrics, runWithRequestMetrics } from "../shared/observability/requestMetrics";
import {
  buildPerformanceLogEntry,
  generateRequestId,
  logPerformanceEntry,
  logSlowQuery,
  shouldLogEntry,
} from "../shared/observability/performanceLogger";

/**
 * Etapa 14B.2 — ver docs/decisions/PERFORMANCE_LOGGING_14B2.md para el
 * diagnóstico completo y el diseño. Resumen: antes de esta etapa, este
 * middleware cortaba incondicionalmente en producción (`if (isProduction)
 * return next()`), así que no había ninguna telemetría real de duración por
 * endpoint en el ambiente que importa. Ahora está controlado por
 * `PERFORMANCE_LOGGING_ENABLED` (activo por defecto fuera de production,
 * apagado por defecto en production — requiere opt-in explícito ahí), y el
 * formato de log pasó a JSON estructurado y sanitizado
 * (`shared/observability/performanceLogger.ts`/`logSanitizer.ts`).
 */

type SlowEndpointStat = {
  count: number;
  maxDurationMs: number;
  totalDurationMs: number;
};

const slowEndpointStats = new Map<string, SlowEndpointStat>();

function recordSlowEndpoint(method: string, sanitizedPath: string, durationMs: number) {
  const key = `${method} ${sanitizedPath}`;
  const current = slowEndpointStats.get(key) || { count: 0, maxDurationMs: 0, totalDurationMs: 0 };
  current.count += 1;
  current.maxDurationMs = Math.max(current.maxDurationMs, durationMs);
  current.totalDurationMs += durationMs;
  slowEndpointStats.set(key, current);
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

export function _resetSlowEndpointStatsForTests() {
  slowEndpointStats.clear();
}

export const requestLogger: RequestHandler = (req, res, next) => {
  if (!isPerformanceLoggingEnabled()) return next();

  const startedAt = Date.now();
  const requestId = generateRequestId();
  const metrics = createRequestMetrics(req.method, req.originalUrl);
  const includeQueryMetrics = env.PERFORMANCE_LOG_INCLUDE_QUERY_METRICS;

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const requestMetrics = getRequestMetrics() ?? metrics;

    const entry = buildPerformanceLogEntry({
      requestId,
      method: requestMetrics.method,
      rawPath: requestMetrics.path,
      statusCode: res.statusCode,
      durationMs,
      environment: env.APP_ENV,
      slowThresholdMs: env.PERFORMANCE_SLOW_REQUEST_MS,
      verySlowThresholdMs: env.PERFORMANCE_VERY_SLOW_REQUEST_MS,
      role: requestMetrics.role,
      userId: requestMetrics.userId,
      includeQueryMetrics,
      queryCount: requestMetrics.queryCount,
      queryTimeMs: requestMetrics.queryDurationMs,
    });

    if (shouldLogEntry(entry, env.PERFORMANCE_LOGGING_SAMPLE_RATE)) {
      logPerformanceEntry(entry);
    }

    if (entry.slow) {
      recordSlowEndpoint(entry.method, entry.path, durationMs);
    }

    if (includeQueryMetrics) {
      requestMetrics.slowQueries.slice(0, 5).forEach((query) => {
        logSlowQuery({
          requestId,
          method: entry.method,
          path: entry.path,
          durationMs: query.durationMs,
          query: query.query,
        });
      });
    }
  });

  runWithRequestMetrics(metrics, next);
};
