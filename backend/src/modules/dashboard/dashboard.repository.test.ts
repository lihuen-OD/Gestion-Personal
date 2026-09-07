import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { dashboardRepository } from "./dashboard.repository";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    timeEntry: { aggregate: vi.fn() },
    employee: { groupBy: vi.fn() },
  },
}));

const mockedPrisma = prisma as unknown as { timeEntry: { aggregate: Mock }; employee: { groupBy: Mock } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sumLoadedHours — KPI 'horas cargadas' = sólo Horas normales (Etapa 6M)", () => {
  it("filtra el aggregate por hourConcept.systemRole = NORMAL_BASE, excluyendo conceptos adicionales", async () => {
    mockedPrisma.timeEntry.aggregate.mockResolvedValue({ _sum: { hours: { toString: () => "40" } } });

    await dashboardRepository.sumLoadedHours("2026-08", { costCenterId: { in: ["cc-1"] } });

    expect(mockedPrisma.timeEntry.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ hourConcept: { systemRole: "NORMAL_BASE" } }),
      }),
    );
  });

  it("preserva el filtro por período, estado contable (APROBADO/EN_REVISION) y scope del usuario", async () => {
    mockedPrisma.timeEntry.aggregate.mockResolvedValue({ _sum: { hours: { toString: () => "40" } } });

    await dashboardRepository.sumLoadedHours("2026-08", { costCenterId: { in: ["cc-1"] } });

    expect(mockedPrisma.timeEntry.aggregate).toHaveBeenCalledWith({
      where: {
        period: "2026-08",
        employee: { costCenterId: { in: ["cc-1"] } },
        status: { in: ["APROBADO", "EN_REVISION"] },
        hourConcept: { systemRole: "NORMAL_BASE" },
      },
      _sum: { hours: true },
    });
  });

  it("Etapa 8F — no aplica ninguna multiplicación propia sobre el resultado: el KPI 'horas cargadas' es exactamente el _sum.hours de la base, que desde 8F ya es real (nunca inflado por appliedMultiplier de una Hora Especial)", async () => {
    const aggregateResult = { _sum: { hours: { toString: () => "8" } } };
    mockedPrisma.timeEntry.aggregate.mockResolvedValue(aggregateResult);

    const result = await dashboardRepository.sumLoadedHours("2026-08", {});

    expect(result).toBe(aggregateResult);
  });
});

// Etapa 14E.1: `countTotal`+`countActive` (2 `Employee.count` separados)
// colapsados en `countTotalAndActive` (1 `groupBy`) — parte de la reducción
// de 15 a 14 queries en `calculateMetrics`. Ver docs/decisions/
// DASHBOARD_METRICS_PERFORMANCE_14E1.md.
describe("countTotalAndActive — colapsa countTotal+countActive en 1 groupBy (Etapa 14E.1)", () => {
  it("agrupa por status con _count._all, respetando el accessWhere recibido", async () => {
    mockedPrisma.employee.groupBy.mockResolvedValue([]);

    await dashboardRepository.countTotalAndActive({ sectorId: { in: ["sec-1"] } });

    expect(mockedPrisma.employee.groupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: { sectorId: { in: ["sec-1"] } },
      _count: { _all: true },
    });
  });

  it("con accessWhere vacío (RRHH), no agrega ningún filtro extra", async () => {
    mockedPrisma.employee.groupBy.mockResolvedValue([]);

    await dashboardRepository.countTotalAndActive({});

    expect(mockedPrisma.employee.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });
});
