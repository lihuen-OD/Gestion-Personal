import type { Request, RequestHandler, Response, Router } from "express";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../shared/errors/AppError";
import { roles } from "../../shared/security/roles";
import { employeesRouter } from "./employees.routes";

function authorizationFor(router: Router, path: string): RequestHandler {
  const layer = router.stack.find((item) => item.route?.path === path);
  if (!layer?.route?.stack[0]) throw new Error(`Route not found: ${path}`);
  return layer.route.stack[0].handle;
}

function invoke(handler: RequestHandler, role: string) {
  const next = vi.fn();
  handler({ user: { id: "user-1", role } } as unknown as Request, {} as Response, next);
  return next.mock.calls[0]?.[0] as AppError | undefined;
}

describe("employee detail route security", () => {
  for (const path of ["/:id", "/:id/overview", "/:id/overview-details", "/:id/field-history", "/:id/block-history"]) {
    it(`Nivel 3 recibe 403 en ${path}`, () => {
      expect(invoke(authorizationFor(employeesRouter, path), roles.cargaHoraria)).toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
      expect(invoke(authorizationFor(employeesRouter, path), roles.rrhh)).toBeUndefined();
    });
  }

  it("Nivel 3 conserva acceso a options y time-grid", () => {
    expect(invoke(authorizationFor(employeesRouter, "/options"), roles.cargaHoraria)).toBeUndefined();
    expect(invoke(authorizationFor(employeesRouter, "/:id/time-grid"), roles.cargaHoraria)).toBeUndefined();
  });

  it("Nivel 3 puede operar breakdowns manuales sujeto al scope del servicio", () => {
    expect(invoke(authorizationFor(employeesRouter, "/:id/hour-concept-breakdowns/manual"), roles.cargaHoraria)).toBeUndefined();
  });

  it("Nivel 3 puede recalcular breakdowns automáticos sujeto al scope del servicio", () => {
    expect(invoke(authorizationFor(employeesRouter, "/:id/hour-concept-breakdowns/recalculate-automatic"), roles.cargaHoraria)).toBeUndefined();
  });
});
