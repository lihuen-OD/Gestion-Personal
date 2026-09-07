import { describe, expect, it } from "vitest";
import {
  buildLandingMarkdownReport,
  countHttpErrors,
  findDuplicateRequests,
  toSanitizedRequest,
  topSlowestRequests,
  type LandingJourneyRun,
} from "./landingJourney";

describe("toSanitizedRequest — Etapa 14F.1", () => {
  it("sanitiza la URL (sin query string, IDs normalizados a :id) y nunca conserva la URL cruda", () => {
    const result = toSanitizedRequest({
      method: "GET",
      rawUrl: "http://localhost:4002/api/employees/9f8b6c1a-1234-4abc-8def-0123456789ab?search=algo",
      statusCode: 200,
      durationMs: 123.6,
      startOffsetMs: 10.2,
      endOffsetMs: 133.8,
    });

    expect(result.path).toBe("/api/employees/:id");
    expect(result).not.toHaveProperty("rawUrl");
    expect(JSON.stringify(result)).not.toContain("9f8b6c1a");
    expect(JSON.stringify(result)).not.toContain("search=algo");
  });

  it("redondea duraciones/offsets a enteros, nunca negativos", () => {
    const result = toSanitizedRequest({
      method: "GET",
      rawUrl: "http://localhost:4002/api/audit",
      statusCode: 200,
      durationMs: -5,
      startOffsetMs: -1,
      endOffsetMs: 99.9,
    });

    expect(result.durationMs).toBe(0);
    expect(result.startOffsetMs).toBe(0);
    expect(result.endOffsetMs).toBe(100);
  });

  it("nunca incluye un token/Authorization aunque la URL cruda lo llevara por error", () => {
    const result = toSanitizedRequest({
      method: "GET",
      rawUrl: "http://localhost:4002/api/audit?token=super-secreto-no-debe-aparecer",
      statusCode: 200,
      durationMs: 10,
      startOffsetMs: 0,
      endOffsetMs: 10,
    });

    expect(JSON.stringify(result)).not.toContain("super-secreto");
  });
});

describe("findDuplicateRequests — Etapa 14F.1", () => {
  const req = (method: string, path: string, durationMs = 100) =>
    toSanitizedRequest({ method, rawUrl: `http://localhost:4002/api${path}`, statusCode: 200, durationMs, startOffsetMs: 0, endOffsetMs: durationMs });

  it("detecta el mismo método+path repetido como duplicado", () => {
    const requests = [req("GET", "/workforce/notifications-unread-count", 187), req("GET", "/workforce/notifications-unread-count", 394), req("GET", "/audit", 591)];

    const duplicates = findDuplicateRequests(requests);

    expect(duplicates).toEqual([{ method: "GET", path: "/api/workforce/notifications-unread-count", count: 2, durationsMs: [187, 394] }]);
  });

  it("no marca como duplicado un mismo path con método distinto", () => {
    const requests = [req("GET", "/audit"), req("POST", "/audit")];

    expect(findDuplicateRequests(requests)).toEqual([]);
  });

  it("sin duplicados reales, devuelve un array vacío (no todo agrupado)", () => {
    const requests = [req("GET", "/audit"), req("GET", "/dashboard/metrics"), req("POST", "/auth/login")];

    expect(findDuplicateRequests(requests)).toEqual([]);
  });

  it("ordena los grupos por cantidad descendente", () => {
    const requests = [
      req("GET", "/a"), req("GET", "/a"), req("GET", "/a"),
      req("GET", "/b"), req("GET", "/b"),
    ];

    const duplicates = findDuplicateRequests(requests);

    expect(duplicates.map((d) => d.path)).toEqual(["/api/a", "/api/b"]);
  });
});

describe("topSlowestRequests / countHttpErrors — Etapa 14F.1", () => {
  const req = (path: string, durationMs: number, statusCode = 200) =>
    toSanitizedRequest({ method: "GET", rawUrl: `http://localhost:4002/api${path}`, statusCode, durationMs, startOffsetMs: 0, endOffsetMs: durationMs });

  it("ordena de más lento a más rápido y respeta el límite pedido", () => {
    const requests = [req("/a", 100), req("/b", 900), req("/c", 300)];

    const top = topSlowestRequests(requests, 2);

    expect(top.map((r) => r.path)).toEqual(["/api/b", "/api/c"]);
  });

  it("cuenta sólo status >= 400 como error HTTP", () => {
    const requests = [req("/a", 100, 200), req("/b", 100, 404), req("/c", 100, 500), req("/d", 100, 302)];

    expect(countHttpErrors(requests)).toBe(2);
  });
});

describe("buildLandingMarkdownReport — Etapa 14F.1", () => {
  it("nunca incluye una URL cruda ni un ID sin sanitizar en el texto final", () => {
    const run: LandingJourneyRun = {
      generatedAt: "2026-09-07T00:00:00.000Z",
      environment: "test",
      baseUrl: "http://localhost:5174",
      apiBaseUrl: "http://localhost:4002/api",
      command: "npm run perf:journey:landing",
      runs: [
        {
          label: "fría",
          loginVisibleMs: 700,
          loginNetworkIdleMs: 3700,
          requests: [
            toSanitizedRequest({ method: "POST", rawUrl: "http://localhost:4002/api/auth/login", statusCode: 200, durationMs: 1090, startOffsetMs: 0, endOffsetMs: 1090 }),
            toSanitizedRequest({ method: "GET", rawUrl: "http://localhost:4002/api/workforce/notifications-unread-count", statusCode: 200, durationMs: 187, startOffsetMs: 1090, endOffsetMs: 1277 }),
            toSanitizedRequest({ method: "GET", rawUrl: "http://localhost:4002/api/workforce/notifications-unread-count", statusCode: 200, durationMs: 394, startOffsetMs: 1090, endOffsetMs: 1484 }),
          ],
          consoleErrors: [],
        },
      ],
    };

    const markdown = buildLandingMarkdownReport(run);

    expect(markdown).toContain("Landing Performance Journey");
    expect(markdown).toContain("notifications-unread-count");
    expect(markdown).toContain("2 llamadas");
    expect(markdown).not.toContain("9f8b6c1a");
    expect(markdown).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("reporta 'sin duplicados' cuando no hay ninguno", () => {
    const run: LandingJourneyRun = {
      generatedAt: "2026-09-07T00:00:00.000Z",
      environment: "test",
      baseUrl: "http://localhost:5174",
      apiBaseUrl: "http://localhost:4002/api",
      command: "npm run perf:journey:landing",
      runs: [
        {
          label: "con cache (misma sesión)",
          requests: [toSanitizedRequest({ method: "POST", rawUrl: "http://localhost:4002/api/auth/login", statusCode: 200, durationMs: 500, startOffsetMs: 0, endOffsetMs: 500 })],
          consoleErrors: [],
        },
      ],
    };

    const markdown = buildLandingMarkdownReport(run);
    expect(markdown).toContain("sin duplicados");
  });
});
