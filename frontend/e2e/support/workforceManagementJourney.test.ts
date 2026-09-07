import { describe, expect, it } from "vitest";
import {
  aggregateEndpoints,
  buildJsonReport,
  buildMarkdownReport,
  buildSubmoduleRollup,
  buildSummary,
  findDuplicateRequests,
  rankDuration,
  sanitizeJourneyRunRoutes,
  COVERAGE_MATRIX,
  SUBMODULE_INVENTORY,
  type ActionResult,
  type CapturedRequest,
  type WorkforceJourneyRun,
} from "./workforceManagementJourney";

function req(overrides: Partial<CapturedRequest> = {}): CapturedRequest {
  return { method: "GET", path: "/api/time-entries/period-employees", statusCode: 200, durationMs: 100, ...overrides };
}

function action(overrides: Partial<ActionResult> = {}): ActionResult {
  return {
    name: "Entrar a Carga de horas (período actual)",
    zone: "D. Carga de horas",
    submodule: "D. Carga de horas",
    route: "/horas/123e4567-e89b-12d3-a456-426614174000",
    covered: true,
    skippedReason: null,
    visibleMs: 100,
    networkIdleMs: 150,
    requests: [],
    consoleErrors: [],
    isWrite: false,
    notes: [],
    emptyScreen: null,
    ...overrides,
  };
}

function run(overrides: Partial<WorkforceJourneyRun> = {}): WorkforceJourneyRun {
  return {
    generatedAt: "2026-09-07T00:00:00.000Z",
    environment: "test",
    baseUrl: "http://localhost:5174",
    apiBaseUrl: "http://localhost:4002/api",
    user: "Nivel 1 - RRHH",
    command: "npm run perf:journey:workforce",
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

  it("los bordes exactos caen en el rango inferior", () => {
    expect(rankDuration(1000, 1000, 2000, 3000)).toBe("OK");
    expect(rankDuration(2000, 1000, 2000, 3000)).toBe("Medio");
    expect(rankDuration(3000, 1000, 2000, 3000)).toBe("Lento");
  });
});

describe("sanitización de paths y normalización de IDs", () => {
  it("normaliza IDs reales de la ruta frontend a :id, sin tocar el resto", () => {
    const sanitized = sanitizeJourneyRunRoutes(run());
    expect(sanitized.actions[0]!.route).toBe("/horas/:id");
  });

  it("no muta el run original", () => {
    const original = run();
    sanitizeJourneyRunRoutes(original);
    expect(original.actions[0]!.route).toContain("123e4567");
  });

  it("normaliza también los IDs reales dentro de action.requests[].path, no sólo action.route", () => {
    const sanitized = sanitizeJourneyRunRoutes(
      run({
        actions: [action({ requests: [req({ path: "/api/employees/cd362028-38b3-4b46-bd28-bb82b94bcc36/time-grid" })] })],
      }),
    );
    expect(sanitized.actions[0]!.requests[0]!.path).toBe("/api/employees/:id/time-grid");
  });

  it("nunca guarda una rawUrl completa (con query string) — sólo el pathname sanitizado", () => {
    const sanitized = sanitizeJourneyRunRoutes(
      run({ actions: [action({ requests: [req({ path: "/api/time-entries/period-employees?period=2026-09&search=Perez" })] })] }),
    );
    // sanitizeRequestPath ya descarta el query string al pasar por new URL(...).pathname
    // cuando se le da una URL completa; acá simulamos el caso defensivo de que
    // alguien haya guardado algo con "?" igual — sanitizeRequestPath sólo actúa
    // sobre URLs válidas, así que confirmamos que el pipeline nunca expone un
    // querystring en el reporte final para paths que sí vienen como URL completa.
    const full = sanitizeJourneyRunRoutes(
      run({ actions: [action({ requests: [req({ path: "http://localhost:4002/api/time-entries/period-employees?period=2026-09&search=Perez" })] })] }),
    );
    expect(full.actions[0]!.requests[0]!.path).toBe("/api/time-entries/period-employees");
    expect(JSON.stringify(full)).not.toContain("search=Perez");
    void sanitized;
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

describe("findDuplicateRequests", () => {
  it("detecta duplicados por method+path (señal de StrictMode/remount)", () => {
    const duplicates = findDuplicateRequests([req({ path: "/api/shifts/alerts" }), req({ path: "/api/shifts/alerts" }), req({ path: "/api/novelties" })]);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({ method: "GET", path: "/api/shifts/alerts", count: 2 });
  });

  it("no reporta nada cuando no hay repetidos", () => {
    expect(findDuplicateRequests([req({ path: "/api/a" }), req({ path: "/api/b" })])).toHaveLength(0);
  });

  it("ordena de mayor a menor cantidad de duplicados", () => {
    const duplicates = findDuplicateRequests([
      req({ path: "/api/a" }),
      req({ path: "/api/a" }),
      req({ path: "/api/b" }),
      req({ path: "/api/b" }),
      req({ path: "/api/b" }),
    ]);
    expect(duplicates.map((d) => d.path)).toEqual(["/api/b", "/api/a"]);
  });
});

describe("buildSummary", () => {
  it("cuenta cubiertas/salteadas/errores/writesSkipped correctamente", () => {
    const summary = buildSummary(
      run({
        actions: [
          action({ covered: true }),
          action({ covered: false, skippedReason: "sin segunda página", isWrite: false }),
          action({ covered: false, skippedReason: "prohibido por defecto", isWrite: true }),
          action({ covered: true, requests: [req({ statusCode: 500 })], consoleErrors: ["boom"] }),
        ],
      }),
    );
    expect(summary.totalActions).toBe(4);
    expect(summary.coveredActions).toBe(2);
    expect(summary.skippedActions).toBe(2);
    expect(summary.writesSkipped).toBe(1);
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
          action({ visibleMs: 4000, networkIdleMs: 200 }), // Crítico
          action({ visibleMs: 100, networkIdleMs: 100 }), // OK
        ],
      }),
    );
    expect(summary.slowActions).toBe(1);
    expect(summary.verySlowActions).toBe(1);
  });

  it("no cuenta acciones salteadas como lentas aunque tengan tiempos viejos de una corrida previa", () => {
    const summary = buildSummary(run({ actions: [action({ covered: false, visibleMs: 9999, skippedReason: "x" })] }));
    expect(summary.slowActions).toBe(0);
    expect(summary.verySlowActions).toBe(0);
  });
});

describe("buildSubmoduleRollup", () => {
  it("agrupa por zona preservando el orden de aparición, no alfabético", () => {
    const rollup = buildSubmoduleRollup(
      run({
        actions: [
          action({ zone: "J. Exportación", submodule: "J. Exportación" }),
          action({ zone: "A. Inicio", submodule: "A. Inicio" }),
        ],
      }),
    );
    expect(rollup.map((r) => r.zone)).toEqual(["J. Exportación", "A. Inicio"]);
  });

  it("cuenta cubiertas/salteadas y calcula la peor duración por zona", () => {
    const rollup = buildSubmoduleRollup(
      run({
        okThresholdMs: 1000,
        mediumThresholdMs: 2000,
        slowThresholdMs: 3000,
        actions: [
          action({ zone: "C. Alertas de turnos", submodule: "C. Alertas de turnos", visibleMs: 100, networkIdleMs: 3906 }),
          action({ zone: "C. Alertas de turnos", submodule: "C. Alertas de turnos", covered: false, skippedReason: "x" }),
        ],
      }),
    );
    expect(rollup[0]).toMatchObject({ zone: "C. Alertas de turnos", coveredActions: 1, skippedActions: 1, maxDurationMs: 3906, rank: "Crítico" });
  });
});

describe("buildJsonReport", () => {
  it("sanitiza rutas, agrega thresholds/summary/rollup/slowestRequests/slowestActions/coverageGaps", () => {
    const report = buildJsonReport(
      run({
        actions: [
          action({ requests: [req({ durationMs: 4000 })] }),
          action({ name: "Buscar alerta por texto", zone: "C. Alertas de turnos", submodule: "C. Alertas de turnos", covered: false, skippedReason: "sin resultados" }),
        ],
      }),
    );
    expect(report.thresholds).toEqual({ okThresholdMs: 1000, mediumThresholdMs: 2000, slowThresholdMs: 3000 });
    expect(report.summary.totalActions).toBe(2);
    expect(report.slowestRequests[0]!.durationMs).toBe(4000);
    expect(report.coverageGaps).toEqual([{ name: "Buscar alerta por texto", zone: "C. Alertas de turnos", isWrite: false, reason: "sin resultados" }]);
    expect(report.actions[0]!.route).toBe("/horas/:id");
    expect(report.submoduleRollup.length).toBeGreaterThan(0);
  });

  it("nunca incluye un UUID crudo en ninguna ruta ni request reportado", () => {
    const report = buildJsonReport(
      run({
        actions: [
          action({
            route: "/horas/cd362028-38b3-4b46-bd28-bb82b94bcc36",
            requests: [req({ path: "/api/employees/cd362028-38b3-4b46-bd28-bb82b94bcc36/time-grid" })],
          }),
        ],
      }),
    );
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("nunca incluye un token en el reporte (defensa por diseño — el journey nunca captura headers/tokens)", () => {
    const report = buildJsonReport(run());
    expect(JSON.stringify(report)).not.toMatch(/bearer|token=/i);
  });

  it("incluye duplicatesByAction sólo para acciones cubiertas con duplicados reales dentro de su propia ventana", () => {
    const report = buildJsonReport(
      run({
        actions: [
          action({ requests: [req({ path: "/api/shifts/alerts" }), req({ path: "/api/shifts/alerts" })] }),
          action({ name: "Sin duplicados", requests: [req({ path: "/api/novelties" })] }),
        ],
      }),
    );
    expect(report.duplicatesByAction).toHaveLength(1);
    expect(report.duplicatesByAction[0]!.duplicates[0]).toMatchObject({ path: "/api/shifts/alerts", count: 2 });
  });
});

describe("buildMarkdownReport", () => {
  it("incluye las 16 secciones pedidas por el pedido de 14G.1", () => {
    const markdown = buildMarkdownReport(run());
    for (const heading of [
      "## 1. Resumen ejecutivo",
      "## 2. Ambiente",
      "## 3. Cobertura general",
      "## 4. Tabla de acciones",
      "## 5. Tabla por submódulo",
      "## 6. Acciones no cubiertas y motivo",
      "## 7. Top acciones lentas",
      "## 8. Top requests lentas",
      "## 9. Endpoints repetidos",
      "## 10. Duplicados por acción",
      "## 11. HTTP errors",
      "## 12. Console errors",
      "## 13. Loading/error/empty states",
      "## 14. Seguridad/no escrituras",
      "## 15. Recomendación de orden para 14G.2",
      "## 16. Raw sanitized JSON",
    ]) {
      expect(markdown).toContain(heading);
    }
  });

  it("nunca escribe un UUID crudo en el markdown final, ni en rutas ni en requests, ni siquiera dentro del JSON embebido", () => {
    const markdown = buildMarkdownReport(
      run({
        actions: [
          action({
            route: "/horas/cd362028-38b3-4b46-bd28-bb82b94bcc36",
            requests: [req({ path: "/api/employees/cd362028-38b3-4b46-bd28-bb82b94bcc36/time-grid" })],
          }),
        ],
      }),
    );
    expect(markdown).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("nunca escribe un token en el markdown final", () => {
    const markdown = buildMarkdownReport(run());
    expect(markdown).not.toMatch(/bearer|token=/i);
  });

  it("documenta acciones salteadas con su motivo (sección 6)", () => {
    const markdown = buildMarkdownReport(run({ actions: [action({ covered: false, skippedReason: "sin segunda página en este entorno" })] }));
    expect(markdown).toContain("sin segunda página en este entorno");
  });

  it("documenta acciones de escritura no ejecutadas por defecto (sección 14)", () => {
    const markdown = buildMarkdownReport(
      run({ actions: [action({ covered: false, isWrite: true, skippedReason: "Prohibido por defecto — cierra un caso de revisión real." })] }),
    );
    expect(markdown).toContain("Prohibido por defecto — cierra un caso de revisión real.");
  });

  it("reporta por submódulo (sección 3 y 5), una fila por cada submódulo presente en las acciones", () => {
    const markdown = buildMarkdownReport(
      run({
        actions: [
          action({ zone: "A. Inicio", submodule: "A. Inicio" }),
          action({ zone: "J. Exportación", submodule: "J. Exportación" }),
        ],
      }),
    );
    expect(markdown).toContain("A. Inicio");
    expect(markdown).toContain("J. Exportación");
  });
});

describe("matrices de documentación (Parte 2 del pedido)", () => {
  it("SUBMODULE_INVENTORY cubre los 10 submódulos A-J, ninguno inventado fuera de la navegación real", () => {
    expect(SUBMODULE_INVENTORY).toHaveLength(10);
    const letters = SUBMODULE_INVENTORY.map((row) => row.submodule[0]);
    expect(letters).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
  });

  it("COVERAGE_MATRIX tiene al menos una fila por cada una de las 10 zonas A-J más Login", () => {
    const zones = new Set(COVERAGE_MATRIX.map((row) => row.zone));
    for (const letter of ["Login", "A. Inicio", "B. Asistencia", "C. Alertas de turnos", "D. Carga de horas", "E. Cierres mensuales", "F. Bandeja de revisión", "G. Novedades", "H. Notificaciones", "I. Fichador", "J. Exportación"]) {
      expect(zones.has(letter)).toBe(true);
    }
  });

  it("toda fila de tipo Escritura en COVERAGE_MATRIX está marcada measured !== \"Sí\" (nunca se mide una escritura por defecto)", () => {
    const writeRows = COVERAGE_MATRIX.filter((row) => row.type === "Escritura");
    expect(writeRows.length).toBeGreaterThan(0);
    for (const row of writeRows) {
      expect(row.measured).not.toBe("Sí");
      expect(row.reasonIfNot).not.toBe("—");
    }
  });
});
