import { describe, expect, it } from "vitest";
import {
  aggregateEndpoints,
  buildJsonReport,
  buildMarkdownReport,
  rankEndpoint,
  type CapturedRequest,
  type JourneyRun,
} from "./reportBuilder";

function req(overrides: Partial<CapturedRequest> = {}): CapturedRequest {
  return { method: "GET", path: "/api/employees", statusCode: 200, durationMs: 100, ...overrides };
}

describe("aggregateEndpoints", () => {
  it("agrupa por method+path y calcula count/avg/max", () => {
    const [stat] = aggregateEndpoints([req({ durationMs: 100 }), req({ durationMs: 300 })]);
    expect(stat!.key).toBe("GET /api/employees");
    expect(stat!.count).toBe(2);
    expect(stat!.avgDurationMs).toBe(200);
    expect(stat!.maxDurationMs).toBe(300);
  });

  it("no mezcla endpoints distintos", () => {
    const stats = aggregateEndpoints([req({ path: "/api/employees" }), req({ path: "/api/positions" })]);
    expect(stats).toHaveLength(2);
  });

  it("marca hasErrorStatus/hasServerErrorStatus correctamente", () => {
    const [okStat] = aggregateEndpoints([req({ statusCode: 200 })]);
    expect(okStat!.hasErrorStatus).toBe(false);
    expect(okStat!.hasServerErrorStatus).toBe(false);

    const [clientErrorStat] = aggregateEndpoints([req({ statusCode: 404 })]);
    expect(clientErrorStat!.hasErrorStatus).toBe(true);
    expect(clientErrorStat!.hasServerErrorStatus).toBe(false);

    const [serverErrorStat] = aggregateEndpoints([req({ statusCode: 503 })]);
    expect(serverErrorStat!.hasErrorStatus).toBe(true);
    expect(serverErrorStat!.hasServerErrorStatus).toBe(true);
  });
});

describe("rankEndpoint", () => {
  const slow = 1000;
  const verySlow = 3000;

  it("Crítico si hubo algún 5xx", () => {
    const [stat] = aggregateEndpoints([req({ statusCode: 500, durationMs: 50 })]);
    expect(rankEndpoint(stat!, slow, verySlow)).toBe("Crítico");
  });

  it("Crítico si algún request individual superó verySlowThresholdMs", () => {
    const [stat] = aggregateEndpoints([req({ durationMs: 3500 })]);
    expect(rankEndpoint(stat!, slow, verySlow)).toBe("Crítico");
  });

  it("Alto si hubo algún 4xx sin llegar a 5xx", () => {
    const [stat] = aggregateEndpoints([req({ statusCode: 404, durationMs: 50 })]);
    expect(rankEndpoint(stat!, slow, verySlow)).toBe("Alto");
  });

  it("Alto si algún request individual superó slowThresholdMs sin llegar a verySlow", () => {
    const [stat] = aggregateEndpoints([req({ durationMs: 1500 })]);
    expect(rankEndpoint(stat!, slow, verySlow)).toBe("Alto");
  });

  it("Medio si el promedio ya es visible aunque ningún request cruzó el umbral slow", () => {
    const [stat] = aggregateEndpoints([req({ durationMs: 600 }), req({ durationMs: 700 })]);
    expect(stat!.maxDurationMs).toBeLessThan(slow);
    expect(rankEndpoint(stat!, slow, verySlow)).toBe("Medio");
  });

  it("Bajo para una request rápida y sin error", () => {
    const [stat] = aggregateEndpoints([req({ durationMs: 80 })]);
    expect(rankEndpoint(stat!, slow, verySlow)).toBe("Bajo");
  });
});

function baseRun(overrides: Partial<JourneyRun> = {}): JourneyRun {
  return {
    generatedAt: "2026-09-03T00:00:00.000Z",
    environment: "local (staging DB)",
    baseUrl: "http://localhost:5174",
    apiBaseUrl: "http://localhost:4002/api",
    user: "Nivel 1 - RRHH",
    command: "npm run perf:journey",
    screens: [],
    extraActions: [],
    slowThresholdMs: 1000,
    verySlowThresholdMs: 3000,
    ...overrides,
  };
}

describe("buildMarkdownReport", () => {
  it("incluye las 13 secciones pedidas", () => {
    const md = buildMarkdownReport(baseRun());
    for (let section = 1; section <= 13; section += 1) {
      expect(md).toContain(`## ${section}.`);
    }
  });

  it("una pantalla no cubierta aparece en la sección 6 con su motivo", () => {
    const md = buildMarkdownReport(
      baseRun({
        screens: [
          {
            name: "Detalle de un legajo existente",
            route: "/legajos/:id",
            covered: false,
            reason: "no había legajos disponibles en el listado",
            requests: [],
            consoleErrors: [],
          },
        ],
      }),
    );
    expect(md).toContain("Detalle de un legajo existente");
    expect(md).toContain("no había legajos disponibles en el listado");
  });

  it("nunca incluye la palabra password/token/authorization/bearer (nada sensible se pasa nunca al builder)", () => {
    const md = buildMarkdownReport(
      baseRun({
        screens: [
          {
            name: "Dashboard",
            route: "/",
            covered: true,
            headerVisibleMs: 120,
            networkIdleMs: 300,
            requests: [req({ path: "/api/dashboard/metrics", durationMs: 200 })],
            consoleErrors: [],
          },
        ],
      }),
    );
    const lower = md.toLowerCase();
    expect(lower).not.toContain("password");
    expect(lower).not.toContain("bearer");
    expect(lower).not.toContain("authorization");
    expect(lower).not.toContain("admin1234");
  });

  it("un endpoint lento aparece en la sección de endpoints más lentos y en el ranking Alto/Crítico", () => {
    const md = buildMarkdownReport(
      baseRun({
        screens: [
          {
            name: "Notificaciones",
            route: "/notificaciones",
            covered: true,
            requests: [req({ path: "/api/workforce/notifications-unread-count", durationMs: 1200 })],
            consoleErrors: [],
          },
        ],
      }),
    );
    expect(md).toContain("/api/workforce/notifications-unread-count");
    expect(md).toContain("### Alto");
  });
});

describe("sanitización de route en el reporte (Etapa 14B.3.1)", () => {
  const EXAMPLE_UUID = "123e4567-e89b-12d3-a456-426614174000";
  const rawScreens = [
    {
      name: "Detalle de un legajo existente",
      route: `/legajos/${EXAMPLE_UUID}`,
      covered: true,
      headerVisibleMs: 832,
      networkIdleMs: 7016,
      requests: [req({ path: "/api/employees/:id/overview-details", durationMs: 6441 })],
      consoleErrors: [],
    },
  ];

  it("buildMarkdownReport nunca contiene el UUID real de la ruta, y sí muestra /legajos/:id", () => {
    const md = buildMarkdownReport(baseRun({ screens: rawScreens }));
    expect(md).not.toContain(EXAMPLE_UUID);
    expect(md).toContain("/legajos/:id");
  });

  it("buildJsonReport nunca contiene el UUID real de la ruta, y sí muestra /legajos/:id", () => {
    const json = buildJsonReport(baseRun({ screens: rawScreens }));
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain(EXAMPLE_UUID);
    expect(json.screens[0]!.route).toBe("/legajos/:id");
  });

  it("una ruta sin ID (ej. /legajos) queda exactamente igual en ambos reportes", () => {
    const screens = [{ ...rawScreens[0]!, route: "/legajos" }];
    const md = buildMarkdownReport(baseRun({ screens }));
    const json = buildJsonReport(baseRun({ screens }));
    expect(md).toContain("`/legajos`");
    expect(json.screens[0]!.route).toBe("/legajos");
  });

  it("los requests a la API (ya sanitizados en captura) no se ven afectados por este saneo adicional", () => {
    const json = buildJsonReport(baseRun({ screens: rawScreens }));
    expect(json.screens[0]!.requests[0]!.path).toBe("/api/employees/:id/overview-details");
  });
});

describe("buildJsonReport", () => {
  it("incluye endpoints agregados con su rank", () => {
    const json = buildJsonReport(
      baseRun({
        screens: [
          {
            name: "Dashboard",
            route: "/",
            covered: true,
            requests: [req({ path: "/api/dashboard/metrics", durationMs: 5000 })],
            consoleErrors: [],
          },
        ],
      }),
    );
    expect(json.endpoints).toHaveLength(1);
    expect(json.endpoints[0]!.rank).toBe("Crítico");
    expect(json.generatedAt).toBe("2026-09-03T00:00:00.000Z");
  });
});
