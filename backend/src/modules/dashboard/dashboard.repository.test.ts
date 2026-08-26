import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { dashboardRepository } from "./dashboard.repository";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    timeEntry: { aggregate: vi.fn() },
  },
}));

const mockedPrisma = prisma as unknown as { timeEntry: { aggregate: Mock } };

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
