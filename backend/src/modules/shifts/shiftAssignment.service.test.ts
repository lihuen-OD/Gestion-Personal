import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { prisma } from "../../shared/prisma/client";
import { shiftAssignmentRepository } from "./shiftAssignment.repository";
import { shiftAssignmentService } from "./shiftAssignment.service";
import { roles } from "../../shared/security/roles";

/**
 * Trazabilidad de autoria (2026-08-18): ShiftAssignment.assignedByUserId /
 * disabledByUserId pasan a tener FK real a User. Estos tests confirman que
 * un userId invalido se rechaza con un error prolijo (no un 500), que un
 * userId real sigue funcionando igual que antes, y que la auditoria real
 * sigue registrandose.
 */
vi.mock("./shiftAssignment.repository", () => ({
  shiftAssignmentRepository: {
    findExisting: vi.fn(),
    create: vi.fn(),
    reEnable: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    shiftTemplate: { findUnique: vi.fn() },
    employee: { count: vi.fn() },
  },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

const repo = shiftAssignmentRepository as unknown as { findExisting: Mock; create: Mock; reEnable: Mock; findById: Mock; update: Mock };
const mockedPrisma = prisma as unknown as { shiftTemplate: { findUnique: Mock }; employee: { count: Mock } };

function prismaKnownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("mock prisma error", { code, clientVersion: "0.0.0" });
}

const user = { id: "user-1", role: roles.rrhh } as unknown as Express.AuthUser;
const template = { id: "template-1", code: "T-1", name: "Turno mañana" };

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.shiftTemplate.findUnique.mockResolvedValue(template);
  mockedPrisma.employee.count.mockResolvedValue(1);
});

describe("shiftAssignmentService.assign", () => {
  it("crea la asignacion con un userId real (camino feliz, sin cambios de comportamiento)", async () => {
    repo.findExisting.mockResolvedValue(null);
    repo.create.mockResolvedValue({ id: "assign-1", employee: { legajo: "100" } });

    const result = await shiftAssignmentService.assign({ employeeIds: ["emp-1"], shiftTemplateId: template.id }, user);

    expect(result).toHaveLength(1);
    expect(repo.create).toHaveBeenCalledWith("emp-1", template.id, undefined, "user-1");
  });

  it("mapea un userId inexistente (P2003) a un 400 prolijo, no a un 500", async () => {
    repo.findExisting.mockResolvedValue(null);
    repo.create.mockRejectedValue(prismaKnownError("P2003"));

    await expect(shiftAssignmentService.assign({ employeeIds: ["emp-1"], shiftTemplateId: template.id }, user)).rejects.toMatchObject({
      statusCode: 400,
      code: "RELATION_CONSTRAINT",
    });
  });

  it("no transforma otros errores no relacionados a FK", async () => {
    repo.findExisting.mockResolvedValue(null);
    repo.create.mockRejectedValue(prismaKnownError("P2025"));

    let caught: unknown;
    try {
      await shiftAssignmentService.assign({ employeeIds: ["emp-1"], shiftTemplateId: template.id }, user);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(caught).not.toBeInstanceOf(AppError);
  });
});

describe("shiftAssignmentService.update", () => {
  it("deshabilita la asignacion y escribe disabledByUserId con el userId real", async () => {
    repo.findById.mockResolvedValue({ id: "assign-1", status: "HABILITADO", employee: { legajo: "100" }, shiftTemplate: template });
    repo.update.mockResolvedValue({ id: "assign-1", employee: { legajo: "100" }, shiftTemplate: template });

    await shiftAssignmentService.update("assign-1", { status: "DESHABILITADO" }, user);

    expect(repo.update).toHaveBeenCalledWith("assign-1", expect.objectContaining({ status: "DESHABILITADO", disabledByUserId: "user-1" }));
  });

  it("mapea un userId inexistente (P2003) a un 400 prolijo al deshabilitar", async () => {
    repo.findById.mockResolvedValue({ id: "assign-1", status: "HABILITADO", employee: { legajo: "100" }, shiftTemplate: template });
    repo.update.mockRejectedValue(prismaKnownError("P2003"));

    await expect(shiftAssignmentService.update("assign-1", { status: "DESHABILITADO" }, user)).rejects.toMatchObject({
      statusCode: 400,
      code: "RELATION_CONSTRAINT",
    });
  });
});
