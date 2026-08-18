import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import { AppError } from "./AppError";
import { auditService } from "../../modules/audit/audit.service";
import { errorHandler } from "./errorHandler";

vi.mock("../../modules/audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

const audit = auditService as unknown as { register: Mock };

function fakeReq(overrides: Partial<Request> = {}) {
  return {
    ip: "127.0.0.1",
    method: "GET",
    originalUrl: "/api/employees/1",
    get: vi.fn().mockReturnValue("test-agent"),
    ...overrides,
  } as unknown as Request;
}

function fakeRes() {
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
  (res.status as Mock).mockReturnValue(res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("errorHandler", () => {
  it("audita un REJECT sobre 'Route' cuando el AppError es 403, sin usuario autenticado", () => {
    const req = fakeReq({ user: undefined });
    const res = fakeRes();
    const error = new AppError("You do not have permission to perform this action", 403, "FORBIDDEN");

    errorHandler(error, req, res, vi.fn());

    expect(audit.register).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        action: "REJECT",
        entity: "Route",
        description: expect.stringContaining("GET /api/employees/1 (FORBIDDEN)"),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: { code: "FORBIDDEN", message: error.message, details: undefined } });
  });

  it("audita el 403 con el usuario autenticado cuando req.user esta presente", () => {
    const req = fakeReq({ user: { id: "user-9", role: "NIVEL_2_SUPERVISION" } as Request["user"] });
    const res = fakeRes();
    const error = new AppError("Forbidden", 403, "NOVELTY_APPROVAL_FORBIDDEN");

    errorHandler(error, req, res, vi.fn());

    expect(audit.register).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-9", action: "REJECT", entity: "Route" }),
    );
  });

  it("no audita nada para errores que no son 403 (por ejemplo 404)", () => {
    const req = fakeReq();
    const res = fakeRes();
    const error = new AppError("Not found", 404, "NOT_FOUND");

    errorHandler(error, req, res, vi.fn());

    expect(audit.register).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("mapea errores no-AppError a 500 sin auditar y sin cambiar el contrato de la respuesta", () => {
    const req = fakeReq();
    const res = fakeRes();

    errorHandler(new Error("boom"), req, res, vi.fn());

    expect(audit.register).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: "INTERNAL_ERROR", message: "Unexpected server error", details: undefined },
    });
  });
});
