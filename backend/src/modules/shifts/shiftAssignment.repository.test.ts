import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { shiftAssignmentRepository } from "./shiftAssignment.repository";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    shiftAssignment: { groupBy: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  shiftAssignment: { groupBy: Mock; findMany: Mock; findUnique: Mock; create: Mock; update: Mock; delete: Mock };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("countByTemplateAndStatus", () => {
  it("cuenta en base de datos por turno y estado respetando el alcance del empleado", async () => {
    mockedPrisma.shiftAssignment.groupBy.mockResolvedValue([]);
    const employeeScope = { assignments: { some: { userId: "user-1" } } };

    await shiftAssignmentRepository.countByTemplateAndStatus(employeeScope);

    expect(mockedPrisma.shiftAssignment.groupBy).toHaveBeenCalledWith({
      by: ["shiftTemplateId", "status"],
      where: { employee: employeeScope },
      _count: { _all: true },
    });
  });
});

describe("create — persiste effectiveFrom/effectiveTo/weekdays (Etapa 8I)", () => {
  it("crea la asignación con la vigencia y los días pedidos", async () => {
    mockedPrisma.shiftAssignment.create.mockResolvedValue({ id: "assign-1" });

    await shiftAssignmentRepository.create(
      "employee-1",
      "template-1",
      { observation: "Turno rotativo", effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-06-30"), weekdays: [1, 2, 3, 4, 5] },
      "user-1",
    );

    expect(mockedPrisma.shiftAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          employeeId: "employee-1",
          shiftTemplateId: "template-1",
          effectiveFrom: new Date("2026-01-01"),
          effectiveTo: new Date("2026-06-30"),
          weekdays: [1, 2, 3, 4, 5],
        }),
      }),
    );
  });

  it("sin effectiveTo, persiste null (asignación abierta), no undefined", async () => {
    mockedPrisma.shiftAssignment.create.mockResolvedValue({ id: "assign-1" });

    await shiftAssignmentRepository.create("employee-1", "template-1", { effectiveFrom: new Date("2026-01-01"), weekdays: [] }, "user-1");

    const call = mockedPrisma.shiftAssignment.create.mock.calls.at(0)?.[0];
    expect(call.data.effectiveTo).toBeNull();
  });

  it("weekdays vacío se persiste como [] (todos los días), no se transforma", async () => {
    mockedPrisma.shiftAssignment.create.mockResolvedValue({ id: "assign-1" });

    await shiftAssignmentRepository.create("employee-1", "template-1", { effectiveFrom: new Date("2026-01-01"), weekdays: [] }, "user-1");

    const call = mockedPrisma.shiftAssignment.create.mock.calls.at(0)?.[0];
    expect(call.data.weekdays).toEqual([]);
  });
});

describe("reEnable — pisa vigencia/weekdays con los valores nuevos (Etapa 8I)", () => {
  it("reactiva la asignación con la nueva vigencia y días, no con los anteriores", async () => {
    mockedPrisma.shiftAssignment.update.mockResolvedValue({ id: "assign-1" });

    await shiftAssignmentRepository.reEnable(
      "assign-1",
      { effectiveFrom: new Date("2026-07-01"), effectiveTo: null, weekdays: [0, 6] },
      "user-1",
    );

    expect(mockedPrisma.shiftAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "assign-1" },
        data: expect.objectContaining({
          status: "HABILITADO",
          disabledAt: null,
          disabledByUserId: null,
          effectiveFrom: new Date("2026-07-01"),
          effectiveTo: null,
          weekdays: [0, 6],
        }),
      }),
    );
  });

  it("mantiene la reactivación (reEnable) como camino conocido: limpia disabledAt/disabledByUserId", async () => {
    mockedPrisma.shiftAssignment.update.mockResolvedValue({ id: "assign-1" });

    await shiftAssignmentRepository.reEnable("assign-1", { effectiveFrom: new Date("2026-01-01"), weekdays: [] }, "user-1");

    const call = mockedPrisma.shiftAssignment.update.mock.calls.at(0)?.[0];
    expect(call.data.disabledAt).toBeNull();
    expect(call.data.disabledByUserId).toBeNull();
    expect(call.data.status).toBe("HABILITADO");
  });
});
