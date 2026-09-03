/**
 * Etapa 14B.3 — construcción del reporte del performance journey.
 *
 * Módulo intencionalmente puro (sin Playwright, sin fs, sin Date.now() propio
 * salvo lo que se le pase por parámetro) para poder testear la agregación y el
 * ranking con Vitest, igual que `backend/src/shared/observability/performanceLogger.ts`
 * en la Etapa 14B.2 se mantuvo separado de los efectos de I/O.
 */

import { sanitizeRequestPath } from "./sanitizePath";

export type CapturedRequest = {
  method: string;
  /** Ya sanitizado por sanitizeRequestPath: sin query string, IDs normalizados a :id. */
  path: string;
  statusCode: number;
  durationMs: number;
};

export type ScreenResult = {
  name: string;
  route: string;
  covered: boolean;
  reason?: string;
  /** Tiempo desde que arrancó la navegación hasta que el <h1> de la pantalla quedó visible. */
  headerVisibleMs?: number;
  /** Tiempo desde que arrancó la navegación hasta que la red quedó "idle" (proxy aproximado de "terminó de traer datos", no un dato exacto). */
  networkIdleMs?: number;
  requests: CapturedRequest[];
  consoleErrors: string[];
};

export type JourneyRun = {
  generatedAt: string;
  environment: string;
  baseUrl: string;
  apiBaseUrl: string;
  user: string;
  command: string;
  screens: ScreenResult[];
  extraActions: ScreenResult[];
  slowThresholdMs: number;
  verySlowThresholdMs: number;
};

export type EndpointStat = {
  key: string;
  method: string;
  path: string;
  count: number;
  avgDurationMs: number;
  maxDurationMs: number;
  statusCodes: number[];
  hasErrorStatus: boolean;
  hasServerErrorStatus: boolean;
};

export type RankLevel = "Crítico" | "Alto" | "Medio" | "Bajo";

function allRequests(run: JourneyRun): CapturedRequest[] {
  return [...run.screens, ...run.extraActions].flatMap((screen) => screen.requests);
}

/**
 * Etapa 14B.3.1 — el `route` de una pantalla puede traer un ID real (ej.
 * `/legajos/123e4567-e89b-12d3-a456-426614174000`, capturado del `href` real
 * de la tabla de Legajos para poder navegar ahí). La navegación en sí ya
 * ocurrió con ese valor real antes de llegar acá — lo que se sanitiza es
 * exclusivamente lo que termina escrito en el reporte, reusando el mismo
 * `sanitizeRequestPath` que ya sanitiza los paths de la API (misma política,
 * mismo helper: sin query string, IDs normalizados a `:id`).
 */
function sanitizeScreenRoute(screen: ScreenResult): ScreenResult {
  return { ...screen, route: sanitizeRequestPath(screen.route) };
}

/** Aplicado siempre dentro de buildMarkdownReport/buildJsonReport (ver abajo) — nunca hace falta que el caller se acuerde de llamarlo. */
export function sanitizeJourneyRunRoutes(run: JourneyRun): JourneyRun {
  return {
    ...run,
    screens: run.screens.map(sanitizeScreenRoute),
    extraActions: run.extraActions.map(sanitizeScreenRoute),
  };
}

export function aggregateEndpoints(requests: CapturedRequest[]): EndpointStat[] {
  const byKey = new Map<string, CapturedRequest[]>();
  for (const request of requests) {
    const key = `${request.method} ${request.path}`;
    const existing = byKey.get(key) ?? [];
    existing.push(request);
    byKey.set(key, existing);
  }

  return [...byKey.entries()].map(([key, items]) => {
    const durations = items.map((item) => item.durationMs);
    const statusCodes = items.map((item) => item.statusCode);
    return {
      key,
      method: items[0]!.method,
      path: items[0]!.path,
      count: items.length,
      avgDurationMs: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
      maxDurationMs: Math.max(...durations),
      statusCodes,
      hasErrorStatus: statusCodes.some((status) => status >= 400),
      hasServerErrorStatus: statusCodes.some((status) => status >= 500),
    };
  });
}

/**
 * Ranking simple y transparente, sin heurísticas ocultas — documentado tal
 * cual en docs/decisions/PERFORMANCE_JOURNEY_14B3.md:
 * - Crítico: algún 5xx, o algún request individual >= verySlowThresholdMs.
 * - Alto: algún 4xx (inesperado en un recorrido de solo lectura), o algún
 *   request individual >= slowThresholdMs.
 * - Medio: el promedio del endpoint ya es visible (>= la mitad del umbral
 *   slow) aunque ningún request individual haya cruzado el umbral.
 * - Bajo: todo lo demás.
 */
export function rankEndpoint(stat: EndpointStat, slowThresholdMs: number, verySlowThresholdMs: number): RankLevel {
  if (stat.hasServerErrorStatus) return "Crítico";
  if (stat.maxDurationMs >= verySlowThresholdMs) return "Crítico";
  if (stat.hasErrorStatus) return "Alto";
  if (stat.maxDurationMs >= slowThresholdMs) return "Alto";
  if (stat.avgDurationMs >= slowThresholdMs / 2) return "Medio";
  return "Bajo";
}

const RANK_ORDER: RankLevel[] = ["Crítico", "Alto", "Medio", "Bajo"];

function formatMs(value: number | undefined): string {
  return typeof value === "number" ? `${value}ms` : "—";
}

function escapeForTable(value: string): string {
  return value.replace(/\|/g, "\\|");
}

export function buildJsonReport(run: JourneyRun) {
  const sanitizedRun = sanitizeJourneyRunRoutes(run);
  const requests = allRequests(sanitizedRun);
  const endpoints = aggregateEndpoints(requests).map((stat) => ({
    ...stat,
    rank: rankEndpoint(stat, sanitizedRun.slowThresholdMs, sanitizedRun.verySlowThresholdMs),
  }));

  return {
    generatedAt: sanitizedRun.generatedAt,
    environment: sanitizedRun.environment,
    baseUrl: sanitizedRun.baseUrl,
    apiBaseUrl: sanitizedRun.apiBaseUrl,
    user: sanitizedRun.user,
    command: sanitizedRun.command,
    thresholds: { slowThresholdMs: sanitizedRun.slowThresholdMs, verySlowThresholdMs: sanitizedRun.verySlowThresholdMs },
    screens: sanitizedRun.screens,
    extraActions: sanitizedRun.extraActions,
    endpoints,
  };
}

export function buildMarkdownReport(rawRun: JourneyRun): string {
  const run = sanitizeJourneyRunRoutes(rawRun);
  const requests = allRequests(run);
  const endpoints = aggregateEndpoints(requests).map((stat) => ({
    ...stat,
    rank: rankEndpoint(stat, run.slowThresholdMs, run.verySlowThresholdMs),
  }));

  const notCovered = run.screens.filter((screen) => !screen.covered);
  const covered = run.screens.filter((screen) => screen.covered);
  const allConsoleErrors = [...run.screens, ...run.extraActions].flatMap((screen) =>
    screen.consoleErrors.map((error) => ({ screen: screen.name, error })),
  );
  const slowestEndpoints = [...endpoints].sort((a, b) => b.maxDurationMs - a.maxDurationMs).slice(0, 10);
  const mostCalledEndpoints = [...endpoints].sort((a, b) => b.count - a.count).slice(0, 10);
  const errorEndpoints = endpoints.filter((endpoint) => endpoint.hasErrorStatus);

  const lines: string[] = [];

  lines.push("# Performance Journey — Etapa 14B.3");
  lines.push("");
  lines.push("Reporte generado automáticamente. No editar a mano — se sobreescribe en cada corrida de `npm run perf:journey`.");
  lines.push("");
  lines.push("## 1. Fecha/hora");
  lines.push("");
  lines.push(run.generatedAt);
  lines.push("");
  lines.push("## 2. Ambiente");
  lines.push("");
  lines.push(`- Frontend: ${run.baseUrl}`);
  lines.push(`- Backend: ${run.apiBaseUrl}`);
  lines.push(`- ${run.environment}`);
  lines.push("");
  lines.push("## 3. Usuario usado");
  lines.push("");
  lines.push(run.user);
  lines.push("");
  lines.push("## 4. Comando ejecutado");
  lines.push("");
  lines.push("```bash");
  lines.push(run.command);
  lines.push("```");
  lines.push("");

  lines.push("## 5. Pantallas recorridas");
  lines.push("");
  lines.push("| Pantalla | Ruta | Header visible | Network idle | Requests | Errores consola |");
  lines.push("|---|---|---|---|---|---|");
  for (const screen of [...covered, ...run.extraActions.filter((action) => action.covered)]) {
    lines.push(
      `| ${escapeForTable(screen.name)} | \`${screen.route}\` | ${formatMs(screen.headerVisibleMs)} | ${formatMs(screen.networkIdleMs)} | ${screen.requests.length} | ${screen.consoleErrors.length} |`,
    );
  }
  lines.push("");

  lines.push("## 6. Pantallas no cubiertas y motivo");
  lines.push("");
  if (notCovered.length === 0) {
    lines.push("Ninguna — las 14 pantallas mínimas pedidas se recorrieron.");
  } else {
    for (const screen of notCovered) {
      lines.push(`- **${screen.name}** (\`${screen.route}\`): ${screen.reason ?? "sin motivo registrado"}.`);
    }
  }
  lines.push("");

  lines.push("## 7. Errores frontend encontrados");
  lines.push("");
  if (allConsoleErrors.length === 0) {
    lines.push("Ninguno — sin errores de consola ni `pageerror` durante todo el recorrido.");
  } else {
    for (const { screen, error } of allConsoleErrors) {
      lines.push(`- **${escapeForTable(screen)}**: ${escapeForTable(error)}`);
    }
  }
  lines.push("");

  lines.push("## 8. Requests backend detectadas por pantalla");
  lines.push("");
  for (const screen of [...covered, ...run.extraActions.filter((action) => action.covered)]) {
    lines.push(`### ${screen.name}`);
    lines.push("");
    if (screen.requests.length === 0) {
      lines.push("Sin requests a la API capturadas en esta pantalla.");
      lines.push("");
      continue;
    }
    lines.push("| Método | Path | Status | Duración |");
    lines.push("|---|---|---|---|");
    for (const request of screen.requests) {
      lines.push(`| ${request.method} | \`${request.path}\` | ${request.statusCode} | ${request.durationMs}ms |`);
    }
    lines.push("");
  }

  lines.push("## 9. Endpoints más lentos");
  lines.push("");
  if (slowestEndpoints.length === 0) {
    lines.push("Sin datos — no se capturó ningún request a la API durante el recorrido.");
  } else {
    lines.push("| Endpoint | Máx. | Promedio | Llamadas |");
    lines.push("|---|---|---|---|");
    for (const endpoint of slowestEndpoints) {
      lines.push(`| \`${endpoint.key}\` | ${endpoint.maxDurationMs}ms | ${endpoint.avgDurationMs}ms | ${endpoint.count} |`);
    }
  }
  lines.push("");

  lines.push("## 10. Endpoints llamados más veces");
  lines.push("");
  if (mostCalledEndpoints.length === 0) {
    lines.push("Sin datos.");
  } else {
    lines.push("| Endpoint | Llamadas | Promedio | Máx. |");
    lines.push("|---|---|---|---|");
    for (const endpoint of mostCalledEndpoints) {
      lines.push(`| \`${endpoint.key}\` | ${endpoint.count} | ${endpoint.avgDurationMs}ms | ${endpoint.maxDurationMs}ms |`);
    }
  }
  lines.push("");

  lines.push("## 11. Endpoints con status >= 400");
  lines.push("");
  if (errorEndpoints.length === 0) {
    lines.push("Ninguno — todas las respuestas capturadas fueron < 400.");
  } else {
    lines.push("| Endpoint | Status observados | Llamadas |");
    lines.push("|---|---|---|");
    for (const endpoint of errorEndpoints) {
      lines.push(`| \`${endpoint.key}\` | ${[...new Set(endpoint.statusCodes)].join(", ")} | ${endpoint.count} |`);
    }
  }
  lines.push("");

  lines.push("## 12. Ranking preliminar de optimización");
  lines.push("");
  lines.push(
    `Umbrales usados (mismos defaults que \`PERFORMANCE_SLOW_REQUEST_MS\`/\`PERFORMANCE_VERY_SLOW_REQUEST_MS\` de la Etapa 14B.2): slow=${run.slowThresholdMs}ms, verySlow=${run.verySlowThresholdMs}ms.`,
  );
  lines.push("");
  for (const level of RANK_ORDER) {
    const inLevel = endpoints.filter((endpoint) => endpoint.rank === level);
    lines.push(`### ${level}`);
    lines.push("");
    if (inLevel.length === 0) {
      lines.push("Ninguno.");
    } else {
      for (const endpoint of inLevel) {
        lines.push(
          `- \`${endpoint.key}\` — máx ${endpoint.maxDurationMs}ms, promedio ${endpoint.avgDurationMs}ms, ${endpoint.count} llamada(s)${endpoint.hasErrorStatus ? `, status ${[...new Set(endpoint.statusCodes)].join("/")}` : ""}`,
        );
      }
    }
    lines.push("");
  }

  lines.push("## 13. Recomendación de próxima etapa");
  lines.push("");
  const critical = endpoints.filter((endpoint) => endpoint.rank === "Crítico");
  const high = endpoints.filter((endpoint) => endpoint.rank === "Alto");
  if (critical.length > 0) {
    lines.push(
      `Priorizar los ${critical.length} endpoint(s) marcados Crítico arriba antes de cualquier otra optimización — confirmar contra los logs JSON de 14B.2 en el backend real (buscar el mismo \`path\` con \`slow:true\`/\`error:true\`) antes de decidir la causa.`,
    );
  } else if (high.length > 0) {
    lines.push(
      `No se detectó ningún Crítico en este recorrido puntual. Revisar los ${high.length} endpoint(s) Alto contra volumen real de uso (este journey corre con datos de un solo usuario, sin concurrencia) antes de priorizar una etapa de optimización.`,
    );
  } else {
    lines.push(
      "No se detectó ningún endpoint Crítico ni Alto en este recorrido puntual. Repetir el journey periódicamente (o bajo carga simulada) antes de asumir que no hay nada para optimizar — un solo recorrido de un usuario no reemplaza la medición bajo uso real.",
    );
  }
  lines.push("");
  lines.push(
    "Este reporte mide un recorrido puntual con un solo usuario, sin concurrencia — es un complemento del logging real de producción/staging (Etapa 14B.2), no un reemplazo. Antes de decidir una etapa de optimización (14C+), cruzar estos hallazgos con logs reales acumulados en el tiempo.",
  );
  lines.push("");

  return lines.join("\n");
}
