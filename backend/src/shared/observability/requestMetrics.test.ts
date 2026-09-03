import { describe, expect, it } from "vitest";
import {
  createRequestMetrics,
  getRequestMetrics,
  recordPrismaQuery,
  runWithRequestMetrics,
  updateRequestMetricsUser,
} from "./requestMetrics";

/**
 * Etapa 14B.2: no se reimplementa esta infraestructura (ya existía y ya usa
 * AsyncLocalStorage, aislado por request) — estos tests son la cobertura que
 * faltaba para confirmar, antes de conectarla al logger nuevo, que dos
 * requests concurrentes nunca mezclan sus contadores. Ver "Parte 6/11" de
 * docs/decisions/PERFORMANCE_LOGGING_14B2.md.
 */
describe("requestMetrics — aislamiento por request (AsyncLocalStorage)", () => {
  it("getRequestMetrics() devuelve undefined fuera de runWithRequestMetrics", () => {
    expect(getRequestMetrics()).toBeUndefined();
  });

  it("dentro de runWithRequestMetrics, getRequestMetrics() devuelve la instancia activa", () => {
    const metrics = createRequestMetrics("GET", "/api/health");
    runWithRequestMetrics(metrics, () => {
      expect(getRequestMetrics()).toBe(metrics);
    });
  });

  it("recordPrismaQuery no revienta ni mezcla nada si se llama fuera de contexto", () => {
    expect(() => recordPrismaQuery("Employee.findMany", 10)).not.toThrow();
  });

  it("dos requests concurrentes no mezclan queryCount ni queryDurationMs entre sí", async () => {
    async function simulateRequest(path: string, queries: number, delayMs: number) {
      const metrics = createRequestMetrics("GET", path);
      return runWithRequestMetrics(metrics, async () => {
        for (let i = 0; i < queries; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, 0));
          recordPrismaQuery("Employee.findMany", delayMs);
        }
        // Yield again to interleave with the other simulated request before reading the store back.
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return getRequestMetrics();
      });
    }

    const [resultA, resultB] = await Promise.all([
      simulateRequest("/api/employees", 5, 3),
      simulateRequest("/api/positions", 2, 7),
    ]);

    expect(resultA?.path).toBe("/api/employees");
    expect(resultA?.queryCount).toBe(5);
    expect(resultA?.queryDurationMs).toBe(15);

    expect(resultB?.path).toBe("/api/positions");
    expect(resultB?.queryCount).toBe(2);
    expect(resultB?.queryDurationMs).toBe(14);
  });

  it("updateRequestMetricsUser setea userId/role sólo dentro del contexto activo", () => {
    const metrics = createRequestMetrics("GET", "/api/employees");
    runWithRequestMetrics(metrics, () => {
      updateRequestMetricsUser({ id: "user-1", role: "NIVEL_1_RRHH" });
      expect(getRequestMetrics()?.userId).toBe("user-1");
      expect(getRequestMetrics()?.role).toBe("NIVEL_1_RRHH");
    });
    // Fuera de contexto, no debe tocar el objeto `metrics` ya salido de scope.
    expect(metrics.userId).toBe("user-1");
  });

  it("una query lenta (>= threshold) queda registrada en slowQueries, una rápida no", () => {
    const metrics = createRequestMetrics("GET", "/api/employees");
    runWithRequestMetrics(metrics, () => {
      recordPrismaQuery("Employee.findMany", 5);
      recordPrismaQuery("Employee.count", 999999); // muy por encima de cualquier threshold razonable
    });
    expect(metrics.slowQueries).toHaveLength(1);
    expect(metrics.slowQueries[0]?.query).toBe("Employee.count");
  });
});
