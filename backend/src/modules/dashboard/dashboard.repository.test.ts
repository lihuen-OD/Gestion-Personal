import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { dashboardRepository } from "./dashboard.repository";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    timeEntry: { aggregate: vi.fn() },
    hourConceptBreakdown: { aggregate: vi.fn() },
    employee: { groupBy: vi.fn() },
  },
}));

const mockedPrisma = prisma as unknown as { timeEntry: { aggregate: Mock }; hourConceptBreakdown: { aggregate: Mock }; employee: { groupBy: Mock } };

beforeEach(() => {
  vi.clearAllMocks();
});

// docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md: "Horas cargadas" es el total
// trabajado real del período = Horas base + conceptos ADDITIVE_TO_WORKED_TOTAL.
// Nunca suma conceptos WITHIN_BASE (ya están dentro de la base).
describe("sumLoadedHours — KPI 'horas cargadas' = base + horas adicionales", () => {
  it("base: TimeEntry NORMAL_BASE APROBADO/EN_REVISION, con período y scope del usuario", async () => {
    mockedPrisma.timeEntry.aggregate.mockResolvedValue({ _sum: { hours: { toString: () => "40" } } });
    mockedPrisma.hourConceptBreakdown.aggregate.mockResolvedValue({ _sum: { minutes: 0 } });

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

  it("adicionales: sólo conceptos ADDITIVE_TO_WORKED_TOTAL sin RECHAZADO (nunca WITHIN_BASE)", async () => {
    mockedPrisma.timeEntry.aggregate.mockResolvedValue({ _sum: { hours: null } });
    mockedPrisma.hourConceptBreakdown.aggregate.mockResolvedValue({ _sum: { minutes: null } });

    await dashboardRepository.sumLoadedHours("2026-08", { costCenterId: { in: ["cc-1"] } });

    expect(mockedPrisma.hourConceptBreakdown.aggregate).toHaveBeenCalledWith({
      where: {
        period: "2026-08",
        employee: { costCenterId: { in: ["cc-1"] } },
        status: { not: "RECHAZADO" },
        hourConcept: { workTreatment: "ADDITIVE_TO_WORKED_TOTAL" },
      },
      _sum: { minutes: true },
    });
  });

  it("devuelve los insumos reales (nunca inflados por Hora Especial)", async () => {
    mockedPrisma.timeEntry.aggregate.mockResolvedValue({ _sum: { hours: { toString: () => "8" } } });
    mockedPrisma.hourConceptBreakdown.aggregate.mockResolvedValue({ _sum: { minutes: 60 } });

    await expect(dashboardRepository.sumLoadedHours("2026-08", {})).resolves.toEqual({ baseHours: 8, additiveMinutes: 60 });
  });
});

// Etapa 14E.1: `countTotal`+`countActive` (2 `Employee.count` separados)
// colapsados en `countTotalAndActive` (1 `groupBy`) — parte de la reducción
// de 15 a 14 queries en `calculateMetrics`. Ver docs/decisions/
// DASHBOARD_METRICS_PERFORMANCE_14E1.md.
describe("countTotalAndActive — colapsa countTotal+countActive en 1 groupBy (Etapa 14E.1)", () => {
  it("agrupa por status con _count._all, respetando el accessWhere recibido", async () => {
    mockedPrisma.employee.groupBy.mockResolvedValue([]);

    await dashboardRepository.countTotalAndActive({ costCenterId: { in: ["sec-1"] } });

    expect(mockedPrisma.employee.groupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: { costCenterId: { in: ["sec-1"] } },
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
