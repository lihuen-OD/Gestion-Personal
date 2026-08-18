import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { shiftAlertRepository } from "./shiftAlert.repository";
import { shiftAlertService } from "./shiftAlert.service";
import { roles } from "../../shared/security/roles";

/**
 * Trazabilidad de autoria (2026-08-18): ShiftAlert.resolvedByUserId pasa a
 * tener FK real a User. Confirma que un userId invalido se rechaza con un
 * error prolijo y que uno real sigue funcionando igual que antes.
 */
vi.mock("./shiftAlert.repository", () => ({
  shiftAlertRepository: {
    findById: vi.fn(),
    resolve: vi.fn(),
  },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

const repo = shiftAlertRepository as unknown as { findById: Mock; resolve: Mock };

function prismaKnownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("mock prisma error", { code, clientVersion: "0.0.0" });
}

const user = { id: "user-1", role: roles.rrhh } as unknown as Express.AuthUser;
const pendingAlert = { id: "alert-1", status: "PENDIENTE", employee: { legajo: "100" } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("shiftAlertService.resolve", () => {
  it("resuelve la alerta con un userId real (camino feliz)", async () => {
    repo.findById.mockResolvedValue(pendingAlert);
    repo.resolve.mockResolvedValue({ ...pendingAlert, status: "RESUELTA" });

    const result = await shiftAlertService.resolve("alert-1", { resolution: "RESUELTA", reason: "Revisado" }, user);

    expect(result.status).toBe("RESUELTA");
    expect(repo.resolve).toHaveBeenCalledWith("alert-1", "RESUELTA", "Revisado", "user-1");
  });

  it("mapea un userId inexistente (P2003) a un 400 prolijo, no a un 500", async () => {
    repo.findById.mockResolvedValue(pendingAlert);
    repo.resolve.mockRejectedValue(prismaKnownError("P2003"));

    await expect(shiftAlertService.resolve("alert-1", { resolution: "RESUELTA", reason: "Revisado" }, user)).rejects.toMatchObject({
      statusCode: 400,
      code: "RELATION_CONSTRAINT",
    });
  });

  it("no transforma otros errores no relacionados a FK", async () => {
    repo.findById.mockResolvedValue(pendingAlert);
    repo.resolve.mockRejectedValue(prismaKnownError("P2025"));

    let caught: unknown;
    try {
      await shiftAlertService.resolve("alert-1", { resolution: "RESUELTA", reason: "Revisado" }, user);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(caught).not.toBeInstanceOf(AppError);
  });
});
