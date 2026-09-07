/**
 * Etapa 14F.1 — Performance Journey chico, específico del aterrizaje inicial
 * (login → primer contenido en `/`). Complementa a `perf:journey:employees`
 * (14D.1), que ya mide la acción "Login" dentro de un recorrido de 56
 * acciones de Legajos — este journey existe para poder iterar rápido sobre
 * el aterrizaje en sí (unos segundos, no ~40-50s) y para capturar timing
 * relativo de cada request (cuándo arrancó/terminó respecto del inicio de la
 * corrida), algo que el journey de Legajos no expone hoy en su reporte final
 * (ver docs/decisions/INITIAL_APP_LANDING_PERFORMANCE_14F1.md §6 para el
 * porqué de esta diferencia).
 *
 * Módulo intencionalmente puro (sin Playwright, sin fs) — mismo criterio que
 * `performanceEmployeesJourney.ts`/`reportBuilder.ts`, para poder testear
 * agregación/reporte con Vitest sin un navegador real.
 */

import { sanitizeRequestPath } from "./sanitizePath";

export type LandingCapturedRequest = {
  method: string;
  /** Ya sanitizado por sanitizeRequestPath: sin query string, IDs normalizados a :id. */
  path: string;
  statusCode: number;
  durationMs: number;
  /** Milisegundos desde el inicio de la corrida hasta que el request arrancó. */
  startOffsetMs: number;
  /** Milisegundos desde el inicio de la corrida hasta que el request terminó. */
  endOffsetMs: number;
};

export type LandingRunResult = {
  /** "fría" | "con cache (misma sesión)" | "después de limpiar cache". */
  label: string;
  loginVisibleMs?: number;
  loginNetworkIdleMs?: number;
  requests: LandingCapturedRequest[];
  consoleErrors: string[];
};

export type LandingJourneyRun = {
  generatedAt: string;
  environment: string;
  baseUrl: string;
  apiBaseUrl: string;
  command: string;
  runs: LandingRunResult[];
};

export type DuplicateRequestGroup = {
  method: string;
  path: string;
  count: number;
  durationsMs: number[];
};

/** Sanitiza una URL cruda de Playwright a un `LandingCapturedRequest` — usar siempre esto, nunca guardar la URL cruda. */
export function toSanitizedRequest(input: {
  method: string;
  rawUrl: string;
  statusCode: number;
  durationMs: number;
  startOffsetMs: number;
  endOffsetMs: number;
}): LandingCapturedRequest {
  return {
    method: input.method,
    path: sanitizeRequestPath(input.rawUrl),
    statusCode: input.statusCode,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    startOffsetMs: Math.max(0, Math.round(input.startOffsetMs)),
    endOffsetMs: Math.max(0, Math.round(input.endOffsetMs)),
  };
}

/** Agrupa por método+path — cualquier grupo con más de 1 request es un duplicado real (misma info pedida más de una vez). */
export function findDuplicateRequests(requests: LandingCapturedRequest[]): DuplicateRequestGroup[] {
  const byKey = new Map<string, LandingCapturedRequest[]>();
  for (const request of requests) {
    const key = `${request.method} ${request.path}`;
    const list = byKey.get(key) || [];
    list.push(request);
    byKey.set(key, list);
  }
  return Array.from(byKey.entries())
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => {
      const [method, path] = key.split(" ", 2);
      return { method: method!, path: path!, count: list.length, durationsMs: list.map((r) => r.durationMs) };
    })
    .sort((a, b) => b.count - a.count);
}

export function topSlowestRequests(requests: LandingCapturedRequest[], take = 10): LandingCapturedRequest[] {
  return [...requests].sort((a, b) => b.durationMs - a.durationMs).slice(0, take);
}

export function countHttpErrors(requests: LandingCapturedRequest[]): number {
  return requests.filter((request) => request.statusCode >= 400).length;
}

function formatRunTable(runs: LandingRunResult[]): string {
  const header = "| Corrida | Login visible | Login network idle | Requests totales | HTTP errors | Console errors | Endpoint más lento | Observación |\n|---|---|---|---|---|---|---|---|";
  const rows = runs.map((run) => {
    const slowest = topSlowestRequests(run.requests, 1)[0];
    const slowestLabel = slowest ? `${slowest.method} ${slowest.path} (${slowest.durationMs}ms)` : "—";
    const duplicates = findDuplicateRequests(run.requests);
    const observation = duplicates.length
      ? `${duplicates.length} endpoint(s) duplicados: ${duplicates.map((d) => `${d.method} ${d.path} x${d.count}`).join(", ")}`
      : "sin duplicados";
    return `| ${run.label} | ${run.loginVisibleMs ?? "—"}ms | ${run.loginNetworkIdleMs ?? "—"}ms | ${run.requests.length} | ${countHttpErrors(run.requests)} | ${run.consoleErrors.length} | ${slowestLabel} | ${observation} |`;
  });
  return [header, ...rows].join("\n");
}

export function buildLandingMarkdownReport(run: LandingJourneyRun): string {
  const lines: string[] = [];
  lines.push("# Landing Performance Journey — Login → primer contenido (Etapa 14F.1)");
  lines.push("");
  lines.push("Reporte generado automáticamente por `npm run perf:journey:landing`. No editar a mano — se sobreescribe en cada corrida.");
  lines.push("");
  lines.push(`Generado: ${run.generatedAt} · Comando: \`${run.command}\` · Frontend: ${run.baseUrl} · Backend: ${run.apiBaseUrl}`);
  lines.push("");
  lines.push(run.environment);
  lines.push("");
  lines.push("## 1. Corridas");
  lines.push("");
  lines.push(formatRunTable(run.runs));
  lines.push("");

  for (const singleRun of run.runs) {
    lines.push(`## 2. Detalle — corrida "${singleRun.label}"`);
    lines.push("");
    lines.push("### Requests (orden de inicio)");
    lines.push("");
    lines.push("| Método | Path | Status | Duración | Inicio (offset) | Fin (offset) |");
    lines.push("|---|---|---|---|---|---|");
    for (const request of [...singleRun.requests].sort((a, b) => a.startOffsetMs - b.startOffsetMs)) {
      lines.push(`| ${request.method} | \`${request.path}\` | ${request.statusCode} | ${request.durationMs}ms | ${request.startOffsetMs}ms | ${request.endOffsetMs}ms |`);
    }
    lines.push("");
    const duplicates = findDuplicateRequests(singleRun.requests);
    lines.push("### Duplicados");
    lines.push("");
    if (duplicates.length) {
      for (const dup of duplicates) {
        lines.push(`- **${dup.method} ${dup.path}** — ${dup.count} llamadas (${dup.durationsMs.join("ms, ")}ms)`);
      }
    } else {
      lines.push("Sin duplicados en esta corrida.");
    }
    lines.push("");
    if (singleRun.consoleErrors.length) {
      lines.push("### Errores de consola");
      lines.push("");
      for (const error of singleRun.consoleErrors) lines.push(`- ${error}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}
