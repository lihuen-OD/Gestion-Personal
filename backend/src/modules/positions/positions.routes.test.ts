import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/AppError";
import { roles } from "../../shared/security/roles";
import { positionsRouter } from "./positions.routes";

vi.mock("./positions.controller", () => ({
  positionsController: {
    list: vi.fn(),
    getById: vi.fn(),
    assignedEmployees: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

// Auditoria 2026-08-24 (critico): GET /:id/employees estaba registrada sin
// ningun requireAnyRole, a diferencia de sus endpoints hermanos. Este test
// verifica el router realmente registrado (no solo la funcion requireAnyRole
// en aislamiento), para que una futura reordenacion de middlewares en
// positions.routes.ts no pueda volver a dejarla sin guard sin que un test
// se de cuenta.
function fakeReq(role?: string): Request {
  return { user: role ? { id: "user-1", role } : undefined } as unknown as Request;
}

type Handler = (req: Request, res: Response, next: (error?: unknown) => void) => void;

function findEmployeesRouteGuard(): Handler {
  type RouterLayer = { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } };
  const layer = (positionsRouter.stack as RouterLayer[]).find(
    (candidate) => candidate.route?.path === "/:id/employees" && candidate.route.methods.get,
  );
  if (!layer?.route) throw new Error("GET /:id/employees route not found on positionsRouter");
  const guard = layer.route.stack[0]?.handle as Handler | undefined;
  if (!guard) throw new Error("GET /:id/employees has no middleware registered before the controller");
  return guard;
}

describe("positionsRouter GET /:id/employees", () => {
  it("tiene un requireAnyRole registrado antes del controller (no solo requireAuth a nivel router)", () => {
    const guard = findEmployeesRouteGuard();
    // El primer handler de la ruta debe ser el guard de rol: rechaza sin usuario.
    const next = vi.fn();
    guard(fakeReq(undefined), {} as Response, next);
    const error = next.mock.calls[0]![0] as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(401);
  });

  it("permite a los 3 roles operativos (mismo criterio que hour-concepts/work-regimes)", () => {
    const guard = findEmployeesRouteGuard();
    for (const role of [roles.rrhh, roles.supervision, roles.cargaHoraria]) {
      const next = vi.fn();
      guard(fakeReq(role), {} as Response, next);
      expect(next).toHaveBeenCalledWith();
    }
  });
});
