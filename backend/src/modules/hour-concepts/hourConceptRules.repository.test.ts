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
  it("arma el where con hourConceptId/status/crossesMidnight y ordena priority desc, startTime asc", async () => {
    mockedPrisma.hourConceptRule.findMany.mockResolvedValue([]);
    mockedPrisma.hourConceptRule.count.mockResolvedValue(0);

    await hourConceptRulesRepository.findMany({ hourConceptId: "concept-1", status: "ACTIVO", crossesMidnight: true, page: 1, take: 100 } as never);

    expect(mockedPrisma.hourConceptRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { hourConceptId: "concept-1", status: "ACTIVO", crossesMidnight: true },
        orderBy: [{ priority: "desc" }, { startTime: "asc" }],
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

describe("findByConceptId — reglas de un concepto ordenadas por priority desc, startTime asc", () => {
  it("filtra por hourConceptId y aplica el mismo orden que findMany", async () => {
    mockedPrisma.hourConceptRule.findMany.mockResolvedValue([]);

    await hourConceptRulesRepository.findByConceptId("concept-1");

    expect(mockedPrisma.hourConceptRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hourConceptId: "concept-1" }, orderBy: [{ priority: "desc" }, { startTime: "asc" }] }),
    );
  });
});

describe("findActiveExcept — universo de conflicto para solapamiento ambiguo (global, no por concepto)", () => {
  it("solo pide reglas con status ACTIVO, sin filtrar por hourConceptId", async () => {
    mockedPrisma.hourConceptRule.findMany.mockResolvedValue([]);

    await hourConceptRulesRepository.findActiveExcept();

    expect(mockedPrisma.hourConceptRule.findMany).toHaveBeenCalledWith({ where: { status: "ACTIVO" } });
  });

  it("con excludeId, no compara la regla contra sí misma", async () => {
    mockedPrisma.hourConceptRule.findMany.mockResolvedValue([]);

    await hourConceptRulesRepository.findActiveExcept("rule-1");

    expect(mockedPrisma.hourConceptRule.findMany).toHaveBeenCalledWith({ where: { status: "ACTIVO", id: { not: "rule-1" } } });
  });
});

describe("hourConceptExists", () => {
  it("consulta HourConcept por id con select mínimo", async () => {
    mockedPrisma.hourConcept.findUnique.mockResolvedValue({ id: "concept-1" });

    const result = await hourConceptRulesRepository.hourConceptExists("concept-1");

    expect(result).toEqual({ id: "concept-1" });
    expect(mockedPrisma.hourConcept.findUnique).toHaveBeenCalledWith({ where: { id: "concept-1" }, select: { id: true } });
  });
});
