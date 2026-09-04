import { describe, expect, it } from "vitest";
import {
  aggregateEndpoints,
  buildJsonReport,
  buildMarkdownReport,
  buildSummary,
  rankDuration,
  sanitizeJourneyRunRoutes,
  EMPLOYEES_MODULE_MATRIX,
  type ActionResult,
  type CapturedRequest,
  type EmployeesJourneyRun,
} from "./performanceEmployeesJourney";

function req(overrides: Partial<CapturedRequest> = {}): CapturedRequest {
  return { method: "GET", path: "/api/employees/:id/block-history", statusCode: 200, durationMs: 100, ...overrides };
}

function action(overrides: Partial<ActionResult> = {}): ActionResult {
  return {
    name: "Abrir historial de transporte",
    zone: "G. Transporte",
    route: "/legajos/123e4567-e89b-12d3-a456-426614174000",
    covered: true,
    skippedReason: null,
    visibleMs: 100,
    networkIdleMs: 150,
    requests: [],
    consoleErrors: [],
    notes: [],
    isWrite: false,
    hadRefetch: null,
    emptyScreen: null,
    ...overrides,
  };
}

function run(overrides: Partial<EmployeesJourneyRun> = {}): EmployeesJourneyRun {
  return {
    generatedAt: "2026-09-05T00:00:00.000Z",
    environment: "test",
    baseUrl: "http://localhost:5174",
    apiBaseUrl: "http://localhost:4002/api",
    user: "Nivel 1 - RRHH",
    command: "npm run perf:journey:employees",
    mode: "read-only",
    actions: [action()],
    okThresholdMs: 1000,
    mediumThresholdMs: 2000,
    slowThresholdMs: 3000,
    ...overrides,
  };
}

describe("rankDuration", () => {
  it("clasifica los 4 rangos de la Parte 7 del pedido", () => {
    expect(rankDuration(500, 1000, 2000, 3000)).toBe("OK");
    expect(rankDuration(1500, 1000, 2000, 3000)).toBe("Medio");
    expect(rankDuration(2500, 1000, 2000, 3000)).toBe("Lento");
    expect(rankDuration(3500, 1000, 2000, 3000)).toBe("Crítico");
  });

  it("los bordes exactos caen en el rango inferior (estrictamente mayor al umbral para subir de rango)", () => {
    expect(rankDuration(1000, 1000, 2000, 3000)).toBe("OK");
    expect(rankDuration(2000, 1000, 2000, 3000)).toBe("Medio");
    expect(rankDuration(3000, 1000, 2000, 3000)).toBe("Lento");
  });
});

describe("aggregateEndpoints", () => {
  it("agrupa por method+path y calcula count/avg/max", () => {
    const [stat] = aggregateEndpoints([req({ durationMs: 100 }), req({ durationMs: 300 })]);
    expect(stat!.count).toBe(2);
    expect(stat!.avgDurationMs).toBe(200);
    expect(stat!.maxDurationMs).toBe(300);
  });
});

describe("sanitizeJourneyRunRoutes", () => {
  it("normaliza IDs reales de la ruta frontend a :id, sin tocar el resto", () => {
    const sanitized = sanitizeJourneyRunRoutes(run());
    expect(sanitized.actions[0]!.route).toBe("/legajos/:id");
  });

  it("no muta el run original", () => {
    const original = run();
    sanitizeJourneyRunRoutes(original);
    expect(original.actions[0]!.route).toContain("123e4567");
  });

  // Regresión real: la primera corrida en vivo de este journey filtró un
  // UUID real de empleado 47 veces entre el .md y el .json porque
  // `sanitizeAction` sólo sanitizaba `action.route`, no el `path` de cada
  // request individual dentro de `action.requests` — exactamente lo que
  // la Parte 2 del pedido prohíbe ("no guardar UUID reales en reportes").
  it("normaliza también los IDs reales dentro de action.requests[].path, no sólo action.route", () => {
    const sanitized = sanitizeJourneyRunRoutes(
      run({
        actions: [
          action({
            requests: [req({ path: "/api/employees/cd362028-38b3-4b46-bd28-bb82b94bcc36/field-history" })],
          }),
        ],
      }),
    );
    expect(sanitized.actions[0]!.requests[0]!.path).toBe("/api/employees/:id/field-history");
  });
});

describe("buildSummary", () => {
  it("cuenta cubiertas/salteadas/errores correctamente", () => {
    const summary = buildSummary(
      run({
        actions: [
          action({ covered: true }),
          action({ covered: false, skippedReason: "sin segunda página en este entorno", requests: [] }),
          action({ covered: true, requests: [req({ statusCode: 500 })], consoleErrors: ["boom"] }),
        ],
      }),
    );
    expect(summary.totalActions).toBe(3);
    expect(summary.coveredActions).toBe(2);
    expect(summary.skippedActions).toBe(1);
    expect(summary.httpErrors).toBe(1);
    expect(summary.consoleErrors).toBe(1);
  });

  it("clasifica slowActions (Lento) y verySlowActions (Crítico) según el mayor de visibleMs/networkIdleMs", () => {
    const summary = buildSummary(
      run({
        okThresholdMs: 1000,
        mediumThresholdMs: 2000,
        slowThresholdMs: 3000,
        actions: [
          action({ visibleMs: 100, networkIdleMs: 2500 }), // Lento
          action({ visibleMs: 4000, networkIdleMs: 200 }), // Crítico (visibleMs manda)
          action({ visibleMs: 100, networkIdleMs: 100 }), // OK
        ],
      }),
    );
    expect(summary.slowActions).toBe(1);
    expect(summary.verySlowActions).toBe(1);
  });

  it("no cuenta acciones salteadas (covered=false) como lentas aunque tengan tiempos viejos de una corrida previa", () => {
    const summary = buildSummary(run({ actions: [action({ covered: false, visibleMs: 9999, skippedReason: "x" })] }));
    expect(summary.slowActions).toBe(0);
    expect(summary.verySlowActions).toBe(0);
  });
});

describe("buildJsonReport", () => {
  it("sanitiza rutas, agrega thresholds/summary/slowestRequests/slowestActions/coverageGaps", () => {
    const report = buildJsonReport(
      run({
        actions: [
          action({ requests: [req({ durationMs: 4000 })] }),
          action({ name: "Buscar empleado", covered: false, skippedReason: "sin resultados" }),
        ],
      }),
    );
    expect(report.thresholds).toEqual({ okThresholdMs: 1000, mediumThresholdMs: 2000, slowThresholdMs: 3000 });
    expect(report.summary.totalActions).toBe(2);
    expect(report.slowestRequests[0]!.durationMs).toBe(4000);
    expect(report.coverageGaps).toEqual([{ name: "Buscar empleado", zone: "G. Transporte", reason: "sin resultados" }]);
    expect(report.actions[0]!.route).toBe("/legajos/:id");
  });

  it("nunca incluye un UUID crudo en ninguna ruta ni request reportado", () => {
    const report = buildJsonReport(
      run({
        actions: [
          action({
            route: "/legajos/cd362028-38b3-4b46-bd28-bb82b94bcc36",
            requests: [req({ path: "/api/employees/cd362028-38b3-4b46-bd28-bb82b94bcc36/block-history" })],
          }),
        ],
      }),
    );
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});

describe("buildMarkdownReport", () => {
  it("incluye las 18 secciones pedidas y la matriz completa del módulo", () => {
    const markdown = buildMarkdownReport(run());
    for (const heading of [
      "## 1. Resumen ejecutivo",
      "## 2. Alcance",
      "## 3. Modo usado",
      "## 4. Matriz completa del módulo",
      "## 5. Acciones cubiertas",
      "## 6. Acciones no cubiertas y motivo",
      "## 7. Top 10 acciones más lentas",
      "## 8. Top 10 requests más lentas",
      "## 9. Endpoints repetidos",
      "## 10. Dónde se blanquea pantalla",
      "## 11. Dónde hay loading global",
      "## 12. Dónde hay loading localizado",
      "## 13. Qué historiales se midieron",
      "## 14. Qué guardados se pudieron medir",
      "## 15. Qué guardados quedaron pendientes",
      "## 16. Recomendaciones para próxima etapa",
      "## 17. Riesgos",
      "## 18. Validaciones ejecutadas",
    ]) {
      expect(markdown).toContain(heading);
    }
    expect(markdown).toContain("A. Listado");
    expect(markdown).toContain("J. Guardados");
  });

  it("la matriz embebida tiene una fila por cada zona A-J del pedido", () => {
    const zones = new Set(EMPLOYEES_MODULE_MATRIX.map((row) => row.zone[0]));
    expect(zones).toEqual(new Set(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]));
  });

  it("nunca escribe un UUID crudo en el markdown final, ni en rutas ni en requests", () => {
    const markdown = buildMarkdownReport(
      run({
        actions: [
          action({
            route: "/legajos/cd362028-38b3-4b46-bd28-bb82b94bcc36",
            requests: [req({ path: "/api/employees/cd362028-38b3-4b46-bd28-bb82b94bcc36/block-history" })],
          }),
        ],
      }),
    );
    expect(markdown).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});
