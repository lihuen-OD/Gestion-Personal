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
  type AdminConfigJourneyRun,
  type CapturedRequest,
} from "./adminConfigurationJourney";

function req(overrides: Partial<CapturedRequest> = {}): CapturedRequest {
  return { method: "GET", path: "/api/positions", statusCode: 200, durationMs: 100, ...overrides };
}

function action(overrides: Partial<ActionResult> = {}): ActionResult {
  return {
    name: "Entrar a Puestos",
    zone: "L. Puestos (listado)",
    submodule: "L. Puestos (listado)",
    route: "/puestos/123e4567-e89b-12d3-a456-426614174000",
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

function run(overrides: Partial<AdminConfigJourneyRun> = {}): AdminConfigJourneyRun {
  return {
    generatedAt: "2026-09-08T00:00:00.000Z",
    environment: "test",
    baseUrl: "http://localhost:5174",
    apiBaseUrl: "http://localhost:4002/api",
    user: "Nivel 1 - RRHH",
    command: "npm run perf:journey:admin-config",
    mode: "read-only",
    actions: [action()],
    okThresholdMs: 1000,
    mediumThresholdMs: 2000,
    slowThresholdMs: 3000,
    ...overrides,
  };
}

describe("rankDuration", () => {
  it("clasifica los 4 rangos", () => {
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
    expect(sanitized.actions[0]!.route).toBe("/puestos/:id");
  });

  it("no muta el run original", () => {
    const original = run();
    sanitizeJourneyRunRoutes(original);
    expect(original.actions[0]!.route).toContain("123e4567");
  });

  it("normaliza también los IDs reales dentro de action.requests[].path, no sólo action.route", () => {
    const sanitized = sanitizeJourneyRunRoutes(
      run({
        actions: [action({ requests: [req({ path: "/api/positions/cd362028-38b3-4b46-bd28-bb82b94bcc36/employees" })] })],
      }),
    );
    expect(sanitized.actions[0]!.requests[0]!.path).toBe("/api/positions/:id/employees");
  });

  it("nunca guarda una rawUrl completa (con query string) — sólo el pathname sanitizado", () => {
    const full = sanitizeJourneyRunRoutes(
      run({ actions: [action({ requests: [req({ path: "http://localhost:4002/api/positions?page=1&search=Legal" })] })] }),
    );
    expect(full.actions[0]!.requests[0]!.path).toBe("/api/positions");
    expect(JSON.stringify(full)).not.toContain("search=Legal");
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
  it("detecta duplicados por method+path (señal de StrictMode/remount de AppShell)", () => {
    const duplicates = findDuplicateRequests([req({ path: "/api/org-structure" }), req({ path: "/api/org-structure" }), req({ path: "/api/positions" })]);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({ method: "GET", path: "/api/org-structure", count: 2 });
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
          action({ zone: "N. Puesto (creación, sólo navegación)", submodule: "N. Puesto (creación, sólo navegación)" }),
          action({ zone: "A. Configuración (landing)", submodule: "A. Configuración (landing)" }),
        ],
      }),
    );
    expect(rollup.map((r) => r.zone)).toEqual(["N. Puesto (creación, sólo navegación)", "A. Configuración (landing)"]);
  });

  it("cuenta cubiertas/salteadas y calcula la peor duración por zona", () => {
    const rollup = buildSubmoduleRollup(
      run({
        okThresholdMs: 1000,
        mediumThresholdMs: 2000,
        slowThresholdMs: 3000,
        actions: [
          action({ zone: "D. Horas especiales", submodule: "D. Horas especiales", visibleMs: 100, networkIdleMs: 3906 }),
          action({ zone: "D. Horas especiales", submodule: "D. Horas especiales", covered: false, skippedReason: "x" }),
        ],
      }),
    );
    expect(rollup[0]).toMatchObject({ zone: "D. Horas especiales", coveredActions: 1, skippedActions: 1, maxDurationMs: 3906, rank: "Crítico" });
  });
});

describe("buildJsonReport", () => {
  it("sanitiza rutas, agrega thresholds/summary/rollup/slowestRequests/slowestActions/coverageGaps", () => {
    const report = buildJsonReport(
      run({
        actions: [
          action({ requests: [req({ durationMs: 4000 })] }),
          action({ name: "Buscar en Regímenes laborales", zone: "E. Regímenes laborales", submodule: "E. Regímenes laborales", covered: false, skippedReason: "sin resultados" }),
        ],
      }),
    );
    expect(report.thresholds).toEqual({ okThresholdMs: 1000, mediumThresholdMs: 2000, slowThresholdMs: 3000 });
    expect(report.summary.totalActions).toBe(2);
    expect(report.slowestRequests[0]!.durationMs).toBe(4000);
    expect(report.coverageGaps).toEqual([{ name: "Buscar en Regímenes laborales", zone: "E. Regímenes laborales", isWrite: false, reason: "sin resultados" }]);
    expect(report.actions[0]!.route).toBe("/puestos/:id");
    expect(report.submoduleRollup.length).toBeGreaterThan(0);
  });

  it("nunca incluye un UUID crudo en ninguna ruta ni request reportado", () => {
    const report = buildJsonReport(
      run({
        actions: [
          action({
            route: "/puestos/cd362028-38b3-4b46-bd28-bb82b94bcc36",
            requests: [req({ path: "/api/positions/cd362028-38b3-4b46-bd28-bb82b94bcc36/employees" })],
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
          action({ requests: [req({ path: "/api/org-structure" }), req({ path: "/api/org-structure" })] }),
          action({ name: "Sin duplicados", requests: [req({ path: "/api/novelty-types" })] }),
        ],
      }),
    );
    expect(report.duplicatesByAction).toHaveLength(1);
    expect(report.duplicatesByAction[0]!.duplicates[0]).toMatchObject({ path: "/api/org-structure", count: 2 });
  });
});

describe("buildMarkdownReport", () => {
  it("incluye las 16 secciones del reporte", () => {
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
      "## 15. Recomendación de orden para 14H.2",
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
            route: "/puestos/cd362028-38b3-4b46-bd28-bb82b94bcc36",
            requests: [req({ path: "/api/positions/cd362028-38b3-4b46-bd28-bb82b94bcc36/employees" })],
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
      run({ actions: [action({ covered: false, isWrite: true, skippedReason: "Prohibido por defecto — asignaría/cerraría un régimen real de un empleado real." })] }),
    );
    expect(markdown).toContain("Prohibido por defecto — asignaría/cerraría un régimen real de un empleado real.");
  });

  it("reporta por submódulo (sección 3 y 5), una fila por cada submódulo presente en las acciones", () => {
    const markdown = buildMarkdownReport(
      run({
        actions: [
          action({ zone: "A. Configuración (landing)", submodule: "A. Configuración (landing)" }),
          action({ zone: "I. Exportación Finnegans", submodule: "I. Exportación Finnegans" }),
        ],
      }),
    );
    expect(markdown).toContain("A. Configuración (landing)");
    expect(markdown).toContain("I. Exportación Finnegans");
  });
});

describe("matrices de documentación (Parte 2 del pedido)", () => {
  it("SUBMODULE_INVENTORY cubre las 14 zonas A-N, ninguna inventada fuera de la navegación real", () => {
    expect(SUBMODULE_INVENTORY).toHaveLength(14);
    const letters = SUBMODULE_INVENTORY.map((row) => row.submodule[0]);
    expect(letters).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"]);
  });

  it("COVERAGE_MATRIX tiene al menos una fila por cada una de las 14 zonas A-N más Login", () => {
    const zones = new Set(COVERAGE_MATRIX.map((row) => row.zone));
    for (const zone of [
      "Login",
      "A. Configuración (landing)",
      "B. Turnos",
      "C. Asignaciones de feriados",
      "D. Horas especiales",
      "E. Regímenes laborales",
      "F. Empresas y estructura",
      "G. Tipos de novedades",
      "H. Conceptos horarios",
      "I. Exportación Finnegans",
      "J. Categorías documentales",
      "K. Parámetros de auditoría",
      "L. Puestos (listado)",
      "M. Puesto (detalle)",
      "N. Puesto (creación, sólo navegación)",
    ]) {
      expect(zones.has(zone)).toBe(true);
    }
  });

  it('toda fila de tipo Escritura en COVERAGE_MATRIX está marcada measured !== "Sí" (nunca se mide una escritura por defecto)', () => {
    const writeRows = COVERAGE_MATRIX.filter((row) => row.type === "Escritura");
    expect(writeRows.length).toBeGreaterThan(0);
    for (const row of writeRows) {
      expect(row.measured).not.toBe("Sí");
      expect(row.reasonIfNot).not.toBe("—");
    }
  });
});
