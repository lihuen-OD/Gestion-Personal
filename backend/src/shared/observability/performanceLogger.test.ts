import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPerformanceLogEntry,
  generateRequestId,
  logPerformanceEntry,
  logSlowQuery,
  shouldLogEntry,
} from "./performanceLogger";

const baseInput = {
  requestId: "req_abcdef0123456789",
  method: "GET",
  rawPath: "/api/workforce/notifications-unread-count",
  statusCode: 200,
  durationMs: 120,
  environment: "local",
  slowThresholdMs: 1000,
  verySlowThresholdMs: 3000,
};

describe("buildPerformanceLogEntry", () => {
  it("registra method/path/status/duration", () => {
    const entry = buildPerformanceLogEntry(baseInput);
    expect(entry.method).toBe("GET");
    expect(entry.path).toBe("/api/workforce/notifications-unread-count");
    expect(entry.statusCode).toBe(200);
    expect(entry.durationMs).toBe(120);
    expect(entry.timestamp).toBeTypeOf("string");
    expect(entry.requestId).toBe("req_abcdef0123456789");
    expect(entry.environment).toBe("local");
  });

  it("una request rápida no se marca slow ni verySlow", () => {
    const entry = buildPerformanceLogEntry({ ...baseInput, durationMs: 382 });
    expect(entry.slow).toBe(false);
    expect(entry.verySlow).toBe(false);
    expect(entry.level).toBe("info");
    expect(entry.event).toBe("http_request");
  });

  it("marca slow al igualar o superar el threshold configurado", () => {
    const atThreshold = buildPerformanceLogEntry({ ...baseInput, durationMs: 1000 });
    expect(atThreshold.slow).toBe(true);

    const belowThreshold = buildPerformanceLogEntry({ ...baseInput, durationMs: 999 });
    expect(belowThreshold.slow).toBe(false);
  });

  it("marca verySlow al igualar o superar el threshold muy lento, y slow queda true también", () => {
    const entry = buildPerformanceLogEntry({ ...baseInput, durationMs: 2450 });
    expect(entry.slow).toBe(true);
    expect(entry.verySlow).toBe(false);
    expect(entry.event).toBe("slow_http_request");
    expect(entry.level).toBe("warn");

    const veryEntry = buildPerformanceLogEntry({ ...baseInput, durationMs: 3000 });
    expect(veryEntry.slow).toBe(true);
    expect(veryEntry.verySlow).toBe(true);
  });

  it("statusCode >= 500 marca error=true y level=warn, aunque sea rápida", () => {
    const entry = buildPerformanceLogEntry({ ...baseInput, statusCode: 503, durationMs: 50 });
    expect(entry.error).toBe(true);
    expect(entry.level).toBe("warn");
    expect(entry.slow).toBe(false);
  });

  it("statusCode < 500 nunca marca error, aunque sea 4xx", () => {
    const entry = buildPerformanceLogEntry({ ...baseInput, statusCode: 404 });
    expect(entry.error).toBe(false);
  });

  it("nunca incluye body/headers/query params — sólo los campos declarados", () => {
    const entry = buildPerformanceLogEntry({
      ...baseInput,
      rawPath: "/api/employees?search=Juan+Perez&dni=99999999",
      role: "NIVEL_1_RRHH",
      userId: "user-1",
    });
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain("Juan");
    expect(serialized).not.toContain("Perez");
    expect(serialized).not.toContain("99999999");
    expect(serialized).not.toContain("search");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("Bearer");
    expect(entry.path).toBe("/api/employees");
  });

  it("role/userId sólo se incluyen si se pasan explícitamente", () => {
    const withUser = buildPerformanceLogEntry({ ...baseInput, role: "NIVEL_1_RRHH", userId: "user-1" });
    expect(withUser.role).toBe("NIVEL_1_RRHH");
    expect(withUser.userId).toBe("user-1");

    const withoutUser = buildPerformanceLogEntry(baseInput);
    expect(withoutUser.role).toBeUndefined();
    expect(withoutUser.userId).toBeUndefined();
  });

  it("queryCount/queryTimeMs sólo se incluyen si includeQueryMetrics=true", () => {
    const withMetrics = buildPerformanceLogEntry({
      ...baseInput,
      includeQueryMetrics: true,
      queryCount: 2,
      queryTimeMs: 310.4,
    });
    expect(withMetrics.queryCount).toBe(2);
    expect(withMetrics.queryTimeMs).toBe(310);

    const withoutMetrics = buildPerformanceLogEntry({
      ...baseInput,
      includeQueryMetrics: false,
      queryCount: 2,
      queryTimeMs: 310,
    });
    expect(withoutMetrics.queryCount).toBeUndefined();
    expect(withoutMetrics.queryTimeMs).toBeUndefined();
  });
});

describe("shouldLogEntry", () => {
  it("una request slow siempre se loguea, sin importar el sample rate", () => {
    expect(shouldLogEntry({ slow: true, verySlow: false, error: false }, 0)).toBe(true);
  });

  it("una request con error siempre se loguea, sin importar el sample rate", () => {
    expect(shouldLogEntry({ slow: false, verySlow: false, error: true }, 0)).toBe(true);
  });

  it("sampleRate=1 loguea siempre una request normal", () => {
    expect(shouldLogEntry({ slow: false, verySlow: false, error: false }, 1)).toBe(true);
  });

  it("sampleRate=0 nunca loguea una request normal", () => {
    expect(shouldLogEntry({ slow: false, verySlow: false, error: false }, 0)).toBe(false);
  });

  it("sampleRate intermedio respeta la función random inyectada", () => {
    const normal = { slow: false, verySlow: false, error: false } as const;
    expect(shouldLogEntry(normal, 0.5, () => 0.4)).toBe(true);
    expect(shouldLogEntry(normal, 0.5, () => 0.6)).toBe(false);
  });
});

describe("generateRequestId", () => {
  it("genera un id con el prefijo esperado y valores distintos en cada llamada", () => {
    const a = generateRequestId();
    const b = generateRequestId();
    expect(a).toMatch(/^req_[0-9a-f]{16}$/);
    expect(b).toMatch(/^req_[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
  });
});

describe("logPerformanceEntry / logSlowQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("una entry info se loguea vía console.info como JSON válido", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const entry = buildPerformanceLogEntry(baseInput);

    logPerformanceEntry(entry);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(infoSpy.mock.calls[0]![0] as string);
    expect(logged.event).toBe("http_request");
    expect(logged.path).toBe("/api/workforce/notifications-unread-count");
  });

  it("una entry warn (slow) se loguea vía console.warn, nunca console.info", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const entry = buildPerformanceLogEntry({ ...baseInput, durationMs: 2450 });

    logPerformanceEntry(entry);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("logSlowQuery nunca incluye SQL crudo, sólo el label Model.operation ya truncado aguas arriba", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    logSlowQuery({
      requestId: "req_abcdef0123456789",
      method: "GET",
      path: "/api/employees",
      durationMs: 300.7,
      query: "Employee.findMany",
    });

    const logged = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    expect(logged.event).toBe("slow_query");
    expect(logged.query).toBe("Employee.findMany");
    expect(logged.durationMs).toBe(301);
  });
});
