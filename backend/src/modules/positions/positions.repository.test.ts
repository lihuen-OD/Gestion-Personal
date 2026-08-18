import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { positionsRepository } from "./positions.repository";

/**
 * Cubre la limpieza final de Position (2026-08-18): sectorId es la unica
 * fuente oficial de ubicacion (areaDepartment/sectorName/businessUnitName(s)/
 * establishmentName(s)/sectorNames/salaryRangeCategories/areaId ya no existen
 * en el esquema) y PositionSalaryCategory es la unica fuente de categoria
 * salarial. create/update deben escribir salaryCategoryIds en esa relacion
 * real, dentro de una transaccion, nunca en un JSON.
 */
vi.mock("../../shared/prisma/client", () => {
  const tx = {
    position: { create: vi.fn(), update: vi.fn() },
    positionSalaryCategory: { createMany: vi.fn(), deleteMany: vi.fn() },
  };
  return {
    prisma: {
      position: { findUniqueOrThrow: vi.fn() },
      $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback(tx)),
      __tx: tx,
    },
  };
});

const mockedTx = (prisma as unknown as { __tx: { position: { create: Mock; update: Mock }; positionSalaryCategory: { createMany: Mock; deleteMany: Mock } } }).__tx;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("positionsRepository.findById", () => {
  it("incluye el sector real con su cadena area->establishment->businessUnit, sin campos legado", async () => {
    const resolvedPosition = {
      id: "pos-1",
      name: "Puesto 1",
      sector: { id: "sec-1", name: "Sector 1" },
      salaryCategories: [],
      _count: { employees: 0 },
    };
    (prisma.position.findUniqueOrThrow as Mock).mockResolvedValue(resolvedPosition);

    const result = await positionsRepository.findById("pos-1");

    expect(result).toEqual(resolvedPosition);
    const findMock = prisma.position.findUniqueOrThrow as Mock;
    expect(findMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "pos-1" } }));
    const call = findMock.mock.calls.at(0)?.[0];
    expect(call?.include).not.toHaveProperty("area");
    expect(call?.include?.sector?.include?.area?.include?.establishment?.include?.businessUnit).toBe(true);
  });
});

function baseCreateInput(overrides: Record<string, unknown> = {}) {
  return {
    code: "PUE-100",
    name: "Puesto Test",
    status: "ACTIVO",
    mission: null,
    description: null,
    lastUpdatedAt: null,
    responsibilities: [],
    internalRelations: [],
    externalRelations: [],
    competencies: [],
    workConditions: { modality: "PRESENCIAL", workload: "", workplace: "", relationType: "", observations: "" },
    performanceIndicators: [],
    evaluationCriteria: [],
    sectorId: null,
    salaryCategoryIds: [] as string[],
    ...overrides,
  } as Parameters<typeof positionsRepository.create>[0];
}

describe("positionsRepository.create — categoria salarial (PositionSalaryCategory)", () => {
  it("crea el puesto y vincula salaryCategoryIds en la relacion real, dentro de una transaccion", async () => {
    mockedTx.position.create.mockResolvedValue({ id: "pos-1", code: "PUE-100" });

    await positionsRepository.create(baseCreateInput({ salaryCategoryIds: ["sal-1", "sal-2"] }));

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const createData = mockedTx.position.create.mock.calls.at(0)?.[0]?.data;
    expect(createData).not.toHaveProperty("salaryCategoryIds");
    expect(mockedTx.positionSalaryCategory.createMany).toHaveBeenCalledWith({
      data: [{ positionId: "pos-1", salaryCategoryId: "sal-1" }, { positionId: "pos-1", salaryCategoryId: "sal-2" }],
      skipDuplicates: true,
    });
  });

  it("no llama createMany cuando salaryCategoryIds viene vacio", async () => {
    mockedTx.position.create.mockResolvedValue({ id: "pos-2", code: "PUE-101" });

    await positionsRepository.create(baseCreateInput({ salaryCategoryIds: [] }));

    expect(mockedTx.positionSalaryCategory.createMany).not.toHaveBeenCalled();
  });

  it("create usa sectorId como unico dato de ubicacion (no hay areaId/strings legado en el input)", async () => {
    mockedTx.position.create.mockResolvedValue({ id: "pos-3", code: "PUE-102" });

    await positionsRepository.create(baseCreateInput({ sectorId: "sec-1" }));

    const createData = mockedTx.position.create.mock.calls.at(0)?.[0]?.data;
    expect(createData).toMatchObject({ sectorId: "sec-1" });
    expect(createData).not.toHaveProperty("areaId");
    expect(createData).not.toHaveProperty("areaDepartment");
    expect(createData).not.toHaveProperty("sectorName");
  });
});

describe("positionsRepository.update — categoria salarial (PositionSalaryCategory)", () => {
  it("reemplaza los vinculos (delete + create) cuando salaryCategoryIds esta presente", async () => {
    mockedTx.position.update.mockResolvedValue({ id: "pos-1", code: "PUE-100" });

    await positionsRepository.update("pos-1", { salaryCategoryIds: ["sal-3"] } as Parameters<typeof positionsRepository.update>[1]);

    expect(mockedTx.positionSalaryCategory.deleteMany).toHaveBeenCalledWith({ where: { positionId: "pos-1" } });
    expect(mockedTx.positionSalaryCategory.createMany).toHaveBeenCalledWith({
      data: [{ positionId: "pos-1", salaryCategoryId: "sal-3" }],
      skipDuplicates: true,
    });
  });

  it("no toca PositionSalaryCategory cuando salaryCategoryIds no viene en el input (undefined)", async () => {
    mockedTx.position.update.mockResolvedValue({ id: "pos-1", code: "PUE-100" });

    await positionsRepository.update("pos-1", { name: "Nuevo nombre" } as Parameters<typeof positionsRepository.update>[1]);

    expect(mockedTx.positionSalaryCategory.deleteMany).not.toHaveBeenCalled();
    expect(mockedTx.positionSalaryCategory.createMany).not.toHaveBeenCalled();
  });

  it("update usando sectorId no escribe ningun campo legado eliminado", async () => {
    mockedTx.position.update.mockResolvedValue({ id: "pos-1", code: "PUE-100" });

    await positionsRepository.update("pos-1", { sectorId: "sec-2" } as Parameters<typeof positionsRepository.update>[1]);

    const updateData = mockedTx.position.update.mock.calls.at(0)?.[0]?.data;
    expect(updateData).toEqual({ sectorId: "sec-2" });
  });
});
