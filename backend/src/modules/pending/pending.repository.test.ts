import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { pendingRepository } from "./pending.repository";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    hourConceptBreakdown: { findMany: vi.fn() },
    timeEntry: { findMany: vi.fn() },
    novelty: { findMany: vi.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  hourConceptBreakdown: { findMany: Mock };
  timeEntry: { findMany: Mock };
  novelty: { findMany: Mock };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findPendingHourConceptBreakdowns — Etapa 6L.3", () => {
  it("filtra por source MANUAL y status EN_REVISION dentro del scope del usuario", async () => {
    mockedPrisma.hourConceptBreakdown.findMany.mockResolvedValue([]);
    const accessWhere = { assignments: { some: { userId: "user-1" } } };

    await pendingRepository.findPendingHourConceptBreakdowns({ kind: "all", take: 100 } as never, accessWhere as never);

    expect(mockedPrisma.hourConceptBreakdown.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ employee: accessWhere, source: "MANUAL", status: "EN_REVISION" }),
      take: 100,
    }));
  });

  it("con period, agrega el filtro de período a la consulta", async () => {
    mockedPrisma.hourConceptBreakdown.findMany.mockResolvedValue([]);

    await pendingRepository.findPendingHourConceptBreakdowns({ kind: "all", take: 50, period: "2026-08" } as never, {} as never);

    expect(mockedPrisma.hourConceptBreakdown.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ period: "2026-08" }),
    }));
  });

  it("nunca incluye desgloses AUTOMATIC ni otros status (BORRADOR/APROBADO/RECHAZADO)", async () => {
    mockedPrisma.hourConceptBreakdown.findMany.mockResolvedValue([]);

    await pendingRepository.findPendingHourConceptBreakdowns({ kind: "all", take: 100 } as never, {} as never);

    const call = mockedPrisma.hourConceptBreakdown.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(call.where.source).toBe("MANUAL");
    expect(call.where.status).toBe("EN_REVISION");
  });
});
