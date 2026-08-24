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
    countByTemplateAndStatus: vi.fn(),
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

const repo = shiftAssignmentRepository as unknown as { countByTemplateAndStatus: Mock; findExisting: Mock; create: Mock; reEnable: Mock; findById: Mock; update: Mock };
const mockedPrisma = prisma as unknown as { shiftTemplate: { findUnique: Mock }; employee: { count: Mock } };

function prismaKnownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("mock prisma error", { code, clientVersion: "0.0.0" });
}

const user = { id: "user-1", role: roles.rrhh } as unknown as Express.AuthUser;
const supervisor = { id: "supervisor-1", role: roles.supervision } as unknown as Express.AuthUser;
const template = { id: "template-1", code: "T-1", name: "Turno mañana" };
const baseAssignInput = { shiftTemplateId: template.id, effectiveFrom: new Date("2026-01-01"), weekdays: [] as number[] };

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.shiftTemplate.findUnique.mockResolvedValue(template);
  mockedPrisma.employee.count.mockResolvedValue(1);
});

describe("shiftAssignmentService.summary", () => {
  it("agrupa total, habilitados, deshabilitados y estados futuros por turno", async () => {
    repo.countByTemplateAndStatus.mockResolvedValue([
      { shiftTemplateId: "template-1", status: "HABILITADO", _count: { _all: 3 } },
      { shiftTemplateId: "template-1", status: "DESHABILITADO", _count: { _all: 2 } },
      { shiftTemplateId: "template-2", status: "OTRO", _count: { _all: 4 } },
    ]);

    await expect(shiftAssignmentService.summary(user)).resolves.toEqual([
      { shiftTemplateId: "template-1", total: 5, enabled: 3, disabled: 2, other: 0 },
      { shiftTemplateId: "template-2", total: 4, enabled: 0, disabled: 0, other: 4 },
    ]);
  });

  it("aplica al resumen el alcance TIME_RESPONSIBLE del usuario de Supervisión", async () => {
    repo.countByTemplateAndStatus.mockResolvedValue([]);

    await shiftAssignmentService.summary(supervisor);

    expect(repo.countByTemplateAndStatus).toHaveBeenCalledWith(expect.objectContaining({
      assignments: {
        some: expect.objectContaining({ type: "TIME_RESPONSIBLE", userId: "supervisor-1" }),
      },
    }));
  });
});

describe("shiftAssignmentService.assign", () => {
  it("crea la asignacion con un userId real (camino feliz, sin cambios de comportamiento)", async () => {
    repo.findExisting.mockResolvedValue(null);
    repo.create.mockResolvedValue({ id: "assign-1", employee: { legajo: "100" } });

    const result = await shiftAssignmentService.assign({ employeeIds: ["emp-1"], ...baseAssignInput }, user);

    expect(result).toHaveLength(1);
    expect(repo.create).toHaveBeenCalledWith(
      "emp-1",
      template.id,
      { observation: undefined, effectiveFrom: baseAssignInput.effectiveFrom, effectiveTo: undefined, weekdays: [] },
      "user-1",
    );
  });

  it("mapea un userId inexistente (P2003) a un 400 prolijo, no a un 500", async () => {
    repo.findExisting.mockResolvedValue(null);
    repo.create.mockRejectedValue(prismaKnownError("P2003"));

    await expect(shiftAssignmentService.assign({ employeeIds: ["emp-1"], ...baseAssignInput }, user)).rejects.toMatchObject({
      statusCode: 400,
      code: "RELATION_CONSTRAINT",
    });
  });

  it("no transforma otros errores no relacionados a FK", async () => {
    repo.findExisting.mockResolvedValue(null);
    repo.create.mockRejectedValue(prismaKnownError("P2025"));

    let caught: unknown;
    try {
      await shiftAssignmentService.assign({ employeeIds: ["emp-1"], ...baseAssignInput }, user);
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

describe("shiftAssignmentService.assign — reactivación (reEnable) con vigencia nueva (Etapa 8I)", () => {
  it("si la asignación existente está DESHABILITADO, la reactiva con la vigencia/weekdays del payload nuevo, no con los viejos", async () => {
    repo.findExisting.mockResolvedValue({ id: "assign-1", status: "DESHABILITADO", effectiveFrom: new Date("2025-01-01"), effectiveTo: new Date("2025-06-30"), weekdays: [1] });
    repo.reEnable.mockResolvedValue({ id: "assign-1", employee: { legajo: "100" } });

    await shiftAssignmentService.assign(
      { employeeIds: ["emp-1"], shiftTemplateId: template.id, effectiveFrom: new Date("2026-07-01"), effectiveTo: null, weekdays: [0, 6] },
      user,
    );

    expect(repo.reEnable).toHaveBeenCalledWith(
      "assign-1",
      { observation: undefined, effectiveFrom: new Date("2026-07-01"), effectiveTo: null, weekdays: [0, 6] },
      "user-1",
    );
  });

  it("si la asignación existente ya está HABILITADO, no la toca (no reEnable, no create) — comportamiento de no-op preservado", async () => {
    repo.findExisting.mockResolvedValue({ id: "assign-1", status: "HABILITADO" });
    repo.findById.mockResolvedValue({ id: "assign-1", employee: { legajo: "100" } });

    await shiftAssignmentService.assign({ employeeIds: ["emp-1"], ...baseAssignInput }, user);

    expect(repo.reEnable).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe("shiftAssignmentService.update — vigencia (Etapa 8I)", () => {
  const baseBefore = { id: "assign-1", status: "HABILITADO", effectiveFrom: new Date("2026-01-01"), effectiveTo: null, weekdays: [], employee: { legajo: "100" }, shiftTemplate: template };

  it("actualiza weekdays sin tocar status", async () => {
    repo.findById.mockResolvedValue(baseBefore);
    repo.update.mockResolvedValue({ ...baseBefore, weekdays: [1, 2, 3] });

    await shiftAssignmentService.update("assign-1", { weekdays: [1, 2, 3] }, user);

    expect(repo.update).toHaveBeenCalledWith("assign-1", expect.objectContaining({ weekdays: [1, 2, 3] }));
  });

  it("actualiza solo effectiveTo (cerrar vigencia) validando contra el effectiveFrom ya guardado", async () => {
    repo.findById.mockResolvedValue(baseBefore); // effectiveFrom: 2026-01-01
    repo.update.mockResolvedValue({ ...baseBefore, effectiveTo: new Date("2026-12-31") });

    await shiftAssignmentService.update("assign-1", { effectiveTo: new Date("2026-12-31") }, user);

    expect(repo.update).toHaveBeenCalledWith("assign-1", expect.objectContaining({ effectiveTo: new Date("2026-12-31") }));
  });

  it("rechaza effectiveTo anterior al effectiveFrom ya guardado, aunque el payload solo mande effectiveTo", async () => {
    repo.findById.mockResolvedValue(baseBefore); // effectiveFrom: 2026-01-01

    await expect(shiftAssignmentService.update("assign-1", { effectiveTo: new Date("2025-12-31") }, user)).rejects.toMatchObject({
      statusCode: 400,
      code: "SHIFT_ASSIGNMENT_INVALID_RANGE",
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("rechaza effectiveFrom posterior al effectiveTo ya guardado", async () => {
    repo.findById.mockResolvedValue({ ...baseBefore, effectiveTo: new Date("2026-06-30") });

    await expect(shiftAssignmentService.update("assign-1", { effectiveFrom: new Date("2026-07-01") }, user)).rejects.toMatchObject({
      statusCode: 400,
      code: "SHIFT_ASSIGNMENT_INVALID_RANGE",
    });
    expect(repo.update).not.toHaveBeenCalled();
  });
});
