import crypto from "node:crypto";
import { sanitizeRequestPath } from "./logSanitizer";

/**
 * Etapa 14B.2 — logging seguro de performance por request.
 * Ver docs/decisions/PERFORMANCE_LOGGING_14B2.md para el diseño completo.
 *
 * Este módulo es intencionalmente puro (sin `console.*` salvo en
 * `logPerformanceEntry`/`logSlowQuery`, que son los únicos puntos de I/O) para
 * que `buildPerformanceLogEntry`/`shouldLogEntry` se puedan testear sin
 * mockear la consola.
 */

export type PerformanceLogEntry = {
  level: "info" | "warn";
  event: "http_request" | "slow_http_request";
  timestamp: string;
  environment: string;
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  slow: boolean;
  verySlow: boolean;
  error: boolean;
  role?: string;
  userId?: string;
  queryCount?: number;
  queryTimeMs?: number;
};

export function generateRequestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export type BuildPerformanceLogEntryInput = {
  requestId: string;
  method: string;
  rawPath: string;
  statusCode: number;
  durationMs: number;
  environment: string;
  slowThresholdMs: number;
  verySlowThresholdMs: number;
  role?: string | null;
  userId?: string | null;
  includeQueryMetrics?: boolean;
  queryCount?: number;
  queryTimeMs?: number;
};

/**
 * No incluye nunca: body, headers (incluido Authorization), cookies, tokens,
 * query params. El campo `path` ya sale sanitizado de `sanitizeRequestPath`.
 * `userId`/`role` son el ID interno y el rol ya usados por el resto del
 * sistema (mismos valores que `auditService`), nunca email/DNI/nombre.
 */
export function buildPerformanceLogEntry(input: BuildPerformanceLogEntryInput): PerformanceLogEntry {
  const durationMs = Math.max(0, Math.round(input.durationMs));
  const slow = durationMs >= input.slowThresholdMs;
  const verySlow = durationMs >= input.verySlowThresholdMs;
  const isError = input.statusCode >= 500;

  const entry: PerformanceLogEntry = {
    level: slow || isError ? "warn" : "info",
    event: slow ? "slow_http_request" : "http_request",
    timestamp: new Date().toISOString(),
    environment: input.environment,
    requestId: input.requestId,
    method: input.method,
    path: sanitizeRequestPath(input.rawPath),
    statusCode: input.statusCode,
    durationMs,
    slow,
    verySlow,
    error: isError,
  };

  if (input.role) entry.role = input.role;
  if (input.userId) entry.userId = input.userId;
  if (input.includeQueryMetrics && typeof input.queryCount === "number") {
    entry.queryCount = input.queryCount;
    entry.queryTimeMs = Math.round(input.queryTimeMs ?? 0);
  }

  return entry;
}

/**
 * Una request lenta, muy lenta o con error nunca se descarta por muestreo —
 * `sampleRate` sólo reduce el volumen de requests "normales". Esconder una
 * request problemática detrás del sample rate contradice el objetivo mismo
 * de esta etapa (medir antes de optimizar).
 */
export function shouldLogEntry(
  entry: Pick<PerformanceLogEntry, "slow" | "verySlow" | "error">,
  sampleRate: number,
  random: () => number = Math.random,
): boolean {
  if (entry.slow || entry.verySlow || entry.error) return true;
  if (sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;
  return random() < sampleRate;
}

export function logPerformanceEntry(entry: PerformanceLogEntry): void {
  const line = JSON.stringify(entry);
  if (entry.level === "warn") console.warn(line);
  else console.info(line);
}

export type SlowQueryLogInput = {
  requestId: string;
  method: string;
  path: string;
  durationMs: number;
  /** Ya viene como "Model.operation" (ej. "Employee.findMany") desde
   *  requestMetrics.ts — nunca SQL crudo ni parámetros de la query. */
  query: string;
};

export function logSlowQuery(input: SlowQueryLogInput): void {
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "slow_query",
      requestId: input.requestId,
      method: input.method,
      path: input.path,
      durationMs: Math.round(input.durationMs),
      query: input.query,
    }),
  );
}
