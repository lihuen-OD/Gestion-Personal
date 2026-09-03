import { afterEach, describe, expect, it } from "vitest";
import { env, isPerformanceLoggingEnabled, shouldRecordQueryMetrics } from "./env";

/**
 * Etapa 14B.2. Mismo patrón ya usado por
 * `middlewares/clockDeviceAuth.test.ts`: `env` es el objeto ya parseado
 * (singleton de módulo), así que mutarlo acá alcanza para testear los
 * helpers — ambos leen `env.*` en cada llamada, no cachean nada al importar.
 */
type MutableEnv = {
  NODE_ENV?: string;
  PERFORMANCE_LOGGING_ENABLED?: boolean;
  PERFORMANCE_LOG_INCLUDE_QUERY_METRICS?: boolean;
};

describe("isPerformanceLoggingEnabled", () => {
  const originalNodeEnv = env.NODE_ENV;
  const originalEnabled = env.PERFORMANCE_LOGGING_ENABLED;

  afterEach(() => {
    (env as MutableEnv).NODE_ENV = originalNodeEnv;
    (env as MutableEnv).PERFORMANCE_LOGGING_ENABLED = originalEnabled;
  });

  it("sin valor explícito, está activo fuera de production", () => {
    (env as MutableEnv).NODE_ENV = "development";
    (env as MutableEnv).PERFORMANCE_LOGGING_ENABLED = undefined;
    expect(isPerformanceLoggingEnabled()).toBe(true);
  });

  it("sin valor explícito, está apagado en production (default seguro, opt-in requerido)", () => {
    (env as MutableEnv).NODE_ENV = "production";
    (env as MutableEnv).PERFORMANCE_LOGGING_ENABLED = undefined;
    expect(isPerformanceLoggingEnabled()).toBe(false);
  });

  it("PERFORMANCE_LOGGING_ENABLED=true fuerza que esté activo incluso en production", () => {
    (env as MutableEnv).NODE_ENV = "production";
    (env as MutableEnv).PERFORMANCE_LOGGING_ENABLED = true;
    expect(isPerformanceLoggingEnabled()).toBe(true);
  });

  it("PERFORMANCE_LOGGING_ENABLED=false fuerza que esté apagado incluso fuera de production", () => {
    (env as MutableEnv).NODE_ENV = "development";
    (env as MutableEnv).PERFORMANCE_LOGGING_ENABLED = false;
    expect(isPerformanceLoggingEnabled()).toBe(false);
  });
});

describe("shouldRecordQueryMetrics", () => {
  const originalNodeEnv = env.NODE_ENV;
  const originalEnabled = env.PERFORMANCE_LOGGING_ENABLED;
  const originalIncludeQueryMetrics = env.PERFORMANCE_LOG_INCLUDE_QUERY_METRICS;

  afterEach(() => {
    (env as MutableEnv).NODE_ENV = originalNodeEnv;
    (env as MutableEnv).PERFORMANCE_LOGGING_ENABLED = originalEnabled;
    (env as MutableEnv).PERFORMANCE_LOG_INCLUDE_QUERY_METRICS = originalIncludeQueryMetrics;
  });

  it("false si el logging de performance está apagado, aunque include-query-metrics esté en true", () => {
    (env as MutableEnv).NODE_ENV = "production";
    (env as MutableEnv).PERFORMANCE_LOGGING_ENABLED = false;
    (env as MutableEnv).PERFORMANCE_LOG_INCLUDE_QUERY_METRICS = true;
    expect(shouldRecordQueryMetrics()).toBe(false);
  });

  it("false si el logging está activo pero include-query-metrics está en false", () => {
    (env as MutableEnv).NODE_ENV = "development";
    (env as MutableEnv).PERFORMANCE_LOGGING_ENABLED = true;
    (env as MutableEnv).PERFORMANCE_LOG_INCLUDE_QUERY_METRICS = false;
    expect(shouldRecordQueryMetrics()).toBe(false);
  });

  it("true sólo cuando ambos están activos", () => {
    (env as MutableEnv).NODE_ENV = "production";
    (env as MutableEnv).PERFORMANCE_LOGGING_ENABLED = true;
    (env as MutableEnv).PERFORMANCE_LOG_INCLUDE_QUERY_METRICS = true;
    expect(shouldRecordQueryMetrics()).toBe(true);
  });
});
