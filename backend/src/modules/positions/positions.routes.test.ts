import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/AppError";
import { roles } from "../../shared/security/roles";
import { positionsRouter } from "./positions.routes";

vi.mock("./positions.controller", () => ({
  positionsController: {
    list: vi.fn(),
    listOptions: vi.fn(),
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

  it("2026-11-17: sólo Nivel 1 (único nivel con acceso al módulo Puestos)", () => {
    const guard = findEmployeesRouteGuard();
    const allowed = vi.fn();
    guard(fakeReq(roles.rrhh), {} as Response, allowed);
    expect(allowed).toHaveBeenCalledWith();
    for (const role of [roles.supervision, roles.cargaHoraria]) {
      const next = vi.fn();
      guard(fakeReq(role), {} as Response, next);
      expect((next.mock.calls[0]![0] as AppError).statusCode).toBe(403);
    }
  });
});

// 2026-11-17: Puestos dejó de estar disponible para Nivel 2. El listado y el
// detalle sólo los consume el módulo Puestos (y Horario laboral, de Nivel 1);
// /options sigue abierto porque lo usan los selects de Legajos.
function guardFor(path: string): Handler | undefined {
  type RouterLayer = { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown; name?: string }> } };
  const layer = (positionsRouter.stack as RouterLayer[]).find((candidate) => candidate.route?.path === path && candidate.route.methods.get);
  if (!layer?.route) throw new Error(`GET ${path} route not found on positionsRouter`);
  const first = layer.route.stack[0];
  // validateQuery/asyncHandler no rechazan por rol: sólo un guard real devuelve 401 sin usuario.
  const handle = first?.handle as Handler;
  const probe = vi.fn();
  handle(fakeReq(undefined), {} as Response, probe);
  const error = probe.mock.calls[0]?.[0] as AppError | undefined;
  return error?.statusCode === 401 ? handle : undefined;
}

describe("positionsRouter — lecturas del módulo Puestos sólo para Nivel 1", () => {
  for (const path of ["/", "/:id"]) {
    it(`GET ${path}: Nivel 1 accede; Nivel 2 y Nivel 3 reciben 403`, () => {
      const guard = guardFor(path);
      expect(guard).toBeDefined();
      const allowed = vi.fn();
      guard!(fakeReq(roles.rrhh), {} as Response, allowed);
      expect(allowed).toHaveBeenCalledWith();
      for (const role of [roles.supervision, roles.cargaHoraria]) {
        const next = vi.fn();
        guard!(fakeReq(role), {} as Response, next);
        expect((next.mock.calls[0]![0] as AppError).statusCode).toBe(403);
      }
    });
  }

  it("GET /options no tiene guard de rol (catálogo liviano de los selects de Legajos)", () => {
    expect(guardFor("/options")).toBeUndefined();
  });
});

// Etapa 14D.4: Express matchea rutas en el orden en que se registran — si
// "/options" quedara DESPUÉS de "/:id", Express interpretaría cualquier
// pedido a GET /positions/options como GET /positions/:id con id="options",
// rompiendo el catálogo liviano en silencio (sin error, sólo el handler
// equivocado). Este test protege ese orden directamente contra el router
// real registrado, no contra una suposición de lectura del archivo.
describe("positionsRouter — orden de registro de /options (Etapa 14D.4)", () => {
  it("GET /options está registrada antes que GET /:id", () => {
    type RouterLayer = { route?: { path: string; methods: Record<string, boolean> } };
    const getRoutes = (positionsRouter.stack as RouterLayer[])
      .filter((layer) => layer.route?.methods.get)
      .map((layer) => layer.route!.path);

    const optionsIndex = getRoutes.indexOf("/options");
    const byIdIndex = getRoutes.indexOf("/:id");

    expect(optionsIndex).toBeGreaterThanOrEqual(0);
    expect(byIdIndex).toBeGreaterThanOrEqual(0);
    expect(optionsIndex).toBeLessThan(byIdIndex);
  });
});
