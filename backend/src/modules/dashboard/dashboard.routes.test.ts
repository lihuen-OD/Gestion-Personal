import type { Request, RequestHandler, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import type { AppError } from "../../shared/errors/AppError";
import { roles } from "../../shared/security/roles";
import { dashboardRouter } from "./dashboard.routes";

vi.mock("./dashboard.controller", () => ({ dashboardController: { metrics: vi.fn() } }));

// 2026-11-17: Dashboard y Reportes de Gestión son sólo de Nivel 1 y son los
// únicos consumidores de GET /dashboard/metrics. Se prueba el router real
// registrado (no sólo requireAnyRole aislado).
function metricsGuard(): RequestHandler {
  const layer = dashboardRouter.stack.find((item) => item.route?.path === "/metrics");
  const handler = layer?.route?.stack[0]?.handle;
  if (!handler) throw new Error("GET /metrics route not found on dashboardRouter");
  return handler;
}

function invoke(role: string) {
  const next = vi.fn();
  metricsGuard()({ user: { id: "user-1", role } } as unknown as Request, {} as Response, next);
  return next.mock.calls[0]?.[0] as AppError | undefined;
}

describe("dashboardRouter GET /metrics — sólo Nivel 1", () => {
  it("Nivel 1 accede", () => {
    expect(invoke(roles.rrhh)).toBeUndefined();
  });

  it("Nivel 2 y Nivel 3 reciben 403", () => {
    expect(invoke(roles.supervision)).toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
    expect(invoke(roles.cargaHoraria)).toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
  });
});
