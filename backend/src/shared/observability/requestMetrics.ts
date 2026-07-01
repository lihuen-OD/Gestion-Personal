import { AsyncLocalStorage } from "node:async_hooks";

type SlowQuery = {
  durationMs: number;
  query: string;
};

type RequestMetrics = {
  method: string;
  path: string;
  queryCount: number;
  queryDurationMs: number;
  slowQueries: SlowQuery[];
};

const storage = new AsyncLocalStorage<RequestMetrics>();
const slowQueryThresholdMs = Number(process.env.SLOW_QUERY_THRESHOLD_MS || 250);

function normalizeQuery(query: string) {
  return query.replace(/\s+/g, " ").trim().slice(0, 220);
}

export function runWithRequestMetrics<T>(metrics: RequestMetrics, callback: () => T) {
  return storage.run(metrics, callback);
}

export function getRequestMetrics() {
  return storage.getStore();
}

export function recordPrismaQuery(query: string, durationMs: number) {
  const metrics = storage.getStore();
  if (!metrics) return;

  metrics.queryCount += 1;
  metrics.queryDurationMs += durationMs;

  if (durationMs >= slowQueryThresholdMs) {
    metrics.slowQueries.push({
      durationMs,
      query: normalizeQuery(query),
    });
  }
}

export function createRequestMetrics(method: string, path: string): RequestMetrics {
  return {
    method,
    path,
    queryCount: 0,
    queryDurationMs: 0,
    slowQueries: [],
  };
}
