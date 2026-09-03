import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import { _resetSlowEndpointStatsForTests, getSlowEndpointStats, requestLogger } from "./requestLogger";

/**
 * Etapa 14B.2. Mismo patrón de mutación directa de `env` que ya usa
 * `clockDeviceAuth.test.ts` — el middleware lee `env.*` en cada request, no
 * cachea nada al importar, así que mutar acá alcanza para simular cada
 * configuración sin reiniciar el proceso.
 */
type MutableEnv = {
  NODE_ENV?: string;
  PERFORMANCE_LOGGING_ENABLED?: boolean;
  PERFORMANCE_LOGGING_SAMPLE_RATE?: number;
  PERFORMANCE_SLOW_REQUEST_MS?: number;
  PERFORMANCE_VERY_SLOW_REQUEST_MS?: number;
  PERFORMANCE_LOG_INCLUDE_QUERY_METRICS?: boolean;
};

function fakeReq(overrides: Record<string, unknown> = {}): Request {
  return {
    method: "GET",
    originalUrl: "/api/workforce/notifications-unread-count",
    headers: { authorization: "Bearer super-secret-token" },
    body: { password: "should-never-be-logged" },
    ...overrides,
  } as unknown as Request;
}

function fakeRes(statusCode = 200): Response & EventEmitter {
  const emitter = new EventEmitter();
  Object.assign(emitter, { statusCode });
  return emitter as unknown as Response & EventEmitter;
}

describe("requestLogger", () => {
  const originalEnv = {
    NODE_ENV: env.NODE_ENV,
    PERFORMANCE_LOGGING_ENABLED: env.PERFORMANCE_LOGGING_ENABLED,
    PERFORMANCE_LOGGING_SAMPLE_RATE: env.PERFORMANCE_LOGGING_SAMPLE_RATE,
    PERFORMANCE_SLOW_REQUEST_MS: env.PERFORMANCE_SLOW_REQUEST_MS,
    PERFORMANCE_VERY_SLOW_REQUEST_MS: env.PERFORMANCE_VERY_SLOW_REQUEST_MS,
    PERFORMANCE_LOG_INCLUDE_QUERY_METRICS: env.PERFORMANCE_LOG_INCLUDE_QUERY_METRICS,
  };

  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    (env as MutableEnv).NODE_ENV = "development";
    (env as MutableEnv).PERFORMANCE_LOGGING_ENABLED = true;
    (env as MutableEnv).PERFORMANCE_LOGGING_SAMPLE_RATE = 1;
    (env as MutableEnv).PERFORMANCE_SLOW_REQUEST_MS = 1000;
    (env as MutableEnv).PERFORMANCE_VERY_SLOW_REQUEST_MS = 3000;
    (env as MutableEnv).PERFORMANCE_LOG_INCLUDE_QUERY_METRICS = true;
    _resetSlowEndpointStatsForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    Object.assign(env as MutableEnv, originalEnv);
  });

  it("llama next() siempre, incluso con logging activo", () => {
    const next = vi.fn();
    requestLogger(fakeReq(), fakeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("registra method/path/status/duration en un log info bien formado", () => {
    const res = fakeRes(200);
    requestLogger(fakeReq(), res, vi.fn());

    vi.advanceTimersByTime(120);
    res.emit("finish");

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(infoSpy.mock.calls[0]![0] as string);
    expect(logged.method).toBe("GET");
    expect(logged.path).toBe("/api/workforce/notifications-unread-count");
    expect(logged.statusCode).toBe(200);
    expect(logged.durationMs).toBeGreaterThanOrEqual(120);
    expect(logged.slow).toBe(false);
    expect(logged.requestId).toMatch(/^req_[0-9a-f]{16}$/);
  });

  it("nunca incluye el Authorization header ni el body de la request", () => {
    const res = fakeRes(200);
    requestLogger(fakeReq(), res, vi.fn());
    res.emit("finish");

    const logged = JSON.stringify(infoSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).not.toContain("super-secret-token");
    expect(logged).not.toContain("password");
    expect(logged).not.toContain("should-never-be-logged");
    expect(logged).not.toContain("Bearer");
    expect(logged).not.toContain("authorization");
  });

  it("redacta el query string del path — ningún param queda en el log", () => {
    const res = fakeRes(200);
    requestLogger(fakeReq({ originalUrl: "/api/employees?search=Juan+Perez&dni=99999999" }), res, vi.fn());
    res.emit("finish");

    const logged = JSON.parse(infoSpy.mock.calls[0]![0] as string);
    expect(logged.path).toBe("/api/employees");
  });

  it("marca slow=true cuando la duración supera PERFORMANCE_SLOW_REQUEST_MS", () => {
    (env as MutableEnv).PERFORMANCE_SLOW_REQUEST_MS = 500;
    const res = fakeRes(200);
    requestLogger(fakeReq(), res, vi.fn());

    vi.advanceTimersByTime(600);
    res.emit("finish");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).not.toHaveBeenCalled();
    const logged = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    expect(logged.slow).toBe(true);
    expect(logged.verySlow).toBe(false);
    expect(logged.event).toBe("slow_http_request");
  });

  it("marca verySlow=true cuando la duración supera PERFORMANCE_VERY_SLOW_REQUEST_MS", () => {
    (env as MutableEnv).PERFORMANCE_SLOW_REQUEST_MS = 500;
    (env as MutableEnv).PERFORMANCE_VERY_SLOW_REQUEST_MS = 1500;
    const res = fakeRes(200);
    requestLogger(fakeReq(), res, vi.fn());

    vi.advanceTimersByTime(2000);
    res.emit("finish");

    const logged = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    expect(logged.slow).toBe(true);
    expect(logged.verySlow).toBe(true);
  });

  it("status 500 queda marcado como error, aunque sea rápida", () => {
    const res = fakeRes(500);
    requestLogger(fakeReq(), res, vi.fn());
    res.emit("finish");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    expect(logged.error).toBe(true);
    expect(logged.statusCode).toBe(500);
  });

  it("status 404 no queda marcado como error", () => {
    const res = fakeRes(404);
    requestLogger(fakeReq(), res, vi.fn());
    res.emit("finish");

    const logged = JSON.parse(infoSpy.mock.calls[0]![0] as string);
    expect(logged.error).toBe(false);
  });

  it("se puede desactivar por completo con PERFORMANCE_LOGGING_ENABLED=false", () => {
    (env as MutableEnv).PERFORMANCE_LOGGING_ENABLED = false;
    const next = vi.fn();
    const res = fakeRes(200);
    requestLogger(fakeReq(), res, next);
    res.emit("finish");

    expect(next).toHaveBeenCalledTimes(1);
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("se puede desactivar en production dejando PERFORMANCE_LOGGING_ENABLED sin definir (default seguro)", () => {
    (env as MutableEnv).NODE_ENV = "production";
    (env as MutableEnv).PERFORMANCE_LOGGING_ENABLED = undefined;
    const res = fakeRes(200);
    requestLogger(fakeReq(), res, vi.fn());
    res.emit("finish");

    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("respeta el sample rate para requests normales (no slow/error)", () => {
    (env as MutableEnv).PERFORMANCE_LOGGING_SAMPLE_RATE = 0;
    const res = fakeRes(200);
    requestLogger(fakeReq(), res, vi.fn());
    res.emit("finish");

    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("el sample rate nunca esconde una request slow o con error", () => {
    (env as MutableEnv).PERFORMANCE_LOGGING_SAMPLE_RATE = 0;
    (env as MutableEnv).PERFORMANCE_SLOW_REQUEST_MS = 100;
    const res = fakeRes(200);
    requestLogger(fakeReq(), res, vi.fn());
    vi.advanceTimersByTime(200);
    res.emit("finish");

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("acumula el endpoint en getSlowEndpointStats sólo cuando fue lento", () => {
    (env as MutableEnv).PERFORMANCE_SLOW_REQUEST_MS = 100;
    const res = fakeRes(200);
    requestLogger(fakeReq(), res, vi.fn());
    vi.advanceTimersByTime(200);
    res.emit("finish");

    const stats = getSlowEndpointStats();
    expect(stats).toHaveLength(1);
    expect(stats[0]?.endpoint).toBe("GET /api/workforce/notifications-unread-count");
  });

  it("no acumula nada en getSlowEndpointStats para una request rápida", () => {
    const res = fakeRes(200);
    requestLogger(fakeReq(), res, vi.fn());
    res.emit("finish");

    expect(getSlowEndpointStats()).toHaveLength(0);
  });
});
