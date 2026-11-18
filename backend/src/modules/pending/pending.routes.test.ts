import type { Request, RequestHandler, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import type { AppError } from "../../shared/errors/AppError";
import { roles } from "../../shared/security/roles";
import { pendingRouter } from "./pending.routes";

vi.mock("./pending.controller", () => ({ pendingController: { list: vi.fn() } }));

// 2026-11-17: GET /pending sólo lo consume la Bandeja de revisión
// (/pendientes), que es de Nivel 1 y Nivel 2. Se prueba el router real.
function listGuard(): RequestHandler {
  const layer = pendingRouter.stack.find((item) => item.route?.path === "/");
  const handler = layer?.route?.stack[0]?.handle;
  if (!handler) throw new Error("GET / route not found on pendingRouter");
  return handler;
}

function invoke(role: string) {
  const next = vi.fn();
  listGuard()({ user: { id: "user-1", role } } as unknown as Request, {} as Response, next);
  return next.mock.calls[0]?.[0] as AppError | undefined;
}

describe("pendingRouter GET / — Bandeja de revisión sólo Nivel 1 y Nivel 2", () => {
  it("Nivel 1 y Nivel 2 acceden", () => {
    expect(invoke(roles.rrhh)).toBeUndefined();
    expect(invoke(roles.supervision)).toBeUndefined();
  });

  it("Nivel 3 recibe 403", () => {
    expect(invoke(roles.cargaHoraria)).toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
  });
});
