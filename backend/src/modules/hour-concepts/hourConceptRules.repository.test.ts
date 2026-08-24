import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { hourConceptRulesRepository } from "./hourConceptRules.repository";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    hourConceptRule: { findMany: vi.fn(), count: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
    hourConcept: { findUnique: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

const mockedPrisma = prisma as unknown as {
  hourConceptRule: { findMany: Mock; count: Mock; findUniqueOrThrow: Mock; create: Mock; update: Mock };
  hourConcept: { findUnique: Mock };
  $transaction: Mock;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findMany — filtros y orden de respuesta", () => {
  it("arma filtros y orden estable sin usar priority", async () => {
    mockedPrisma.hourConceptRule.findMany.mockResolvedValue([]);
    mockedPrisma.hourConceptRule.count.mockResolvedValue(0);

    await hourConceptRulesRepository.findMany({ hourConceptId: "concept-1", status: "ACTIVO", crossesMidnight: true, page: 1, take: 100 } as never);

    expect(mockedPrisma.hourConceptRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { hourConceptId: "concept-1", status: "ACTIVO", crossesMidnight: true },
        orderBy: [{ startTime: "asc" }, { id: "asc" }],
      }),
    );
  });

  it("sin filtros, el where queda vacío", async () => {
    mockedPrisma.hourConceptRule.findMany.mockResolvedValue([]);
    mockedPrisma.hourConceptRule.count.mockResolvedValue(0);

    await hourConceptRulesRepository.findMany({ page: 1, take: 100 } as never);

    expect(mockedPrisma.hourConceptRule.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});

describe("findByConceptId — reglas de un concepto en orden horario", () => {
  it("filtra por hourConceptId y aplica el mismo orden que findMany", async () => {
    mockedPrisma.hourConceptRule.findMany.mockResolvedValue([]);

    await hourConceptRulesRepository.findByConceptId("concept-1");

    expect(mockedPrisma.hourConceptRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hourConceptId: "concept-1" }, orderBy: [{ startTime: "asc" }, { id: "asc" }] }),
    );
  });
});

describe("findHourConceptConfiguration", () => {
  it("consulta los campos necesarios para decidir si admite reglas", async () => {
    mockedPrisma.hourConcept.findUnique.mockResolvedValue({ id: "concept-1" });

    await hourConceptRulesRepository.findHourConceptConfiguration("concept-1");
    expect(mockedPrisma.hourConcept.findUnique).toHaveBeenCalledWith({
      where: { id: "concept-1" },
      select: { id: true, status: true, deletedAt: true, loadMode: true, systemRole: true },
    });
  });

  it("create fija priority=0 internamente", async () => {
    mockedPrisma.hourConceptRule.create.mockResolvedValue({});
    await hourConceptRulesRepository.create({ hourConceptId: "concept-1", startTime: "08:00", endTime: "09:00", crossesMidnight: false, status: "ACTIVO" });
    expect(mockedPrisma.hourConceptRule.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ priority: 0 }) }));
  });
});
