import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { AppError } from "../shared/errors/AppError";
import { adminRoles, roles } from "../shared/security/roles";
import { requireAnyRole, requireRole } from "./authorization";

// RBAC de los endpoints administrativos de Turnos/Régimen laboral (WorkRegime,
// EmployeeWorkRegime): las rutas de creación/edición/asignación usan
// requireAnyRole(adminRoles) — ver workRegimes.routes.ts.
function fakeReq(role?: string): Request {
  return { user: role ? { id: "user-1", role } : undefined } as unknown as Request;
}

describe("requireAnyRole", () => {
  it("RRHH/admin sí puede: deja pasar sin error cuando el rol está permitido", () => {
    const next = vi.fn();
    requireAnyRole(adminRoles)(fakeReq(roles.rrhh), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("usuario sin permiso no puede: rechaza con 403 cuando el rol no está en la lista permitida", () => {
    const next = vi.fn();
    requireAnyRole(adminRoles)(fakeReq(roles.supervision), {} as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0]![0] as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe("FORBIDDEN");
  });

  it("sin usuario autenticado: rechaza con 401, no con 403", () => {
    const next = vi.fn();
    requireAnyRole(adminRoles)(fakeReq(undefined), {} as Response, next);
    const error = next.mock.calls[0]![0] as AppError;
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe("AUTH_REQUIRED");
  });

  it("permite varios roles a la vez (ej. lectura de historial habilitada para más que RRHH)", () => {
    const next = vi.fn();
    requireAnyRole([roles.rrhh, roles.supervision, roles.cargaHoraria])(fakeReq(roles.cargaHoraria), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe("requireRole", () => {
  it("es equivalente a requireAnyRole con un solo rol permitido", () => {
    const next = vi.fn();
    requireRole(roles.rrhh)(fakeReq(roles.rrhh), {} as Response, next);
    expect(next).toHaveBeenCalledWith();

    const nextRejected = vi.fn();
    requireRole(roles.rrhh)(fakeReq(roles.supervision), {} as Response, nextRejected);
    expect((nextRejected.mock.calls[0]![0] as AppError).statusCode).toBe(403);
  });
});
