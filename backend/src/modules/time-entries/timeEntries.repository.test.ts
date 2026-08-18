import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { timeEntriesRepository } from "./timeEntries.repository";

vi.mock("../../shared/prisma/client", () => {
  const tx = {
    workShift: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    employeeHourConcept: { findFirst: vi.fn() },
    timeEntry: { create: vi.fn() },
    attendancePunch: { create: vi.fn() },
  };
  return {
    prisma: {
      workShift: { findMany: vi.fn() },
      employeeHourConcept: { findFirst: vi.fn() },
      $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback(tx)),
      __tx: tx,
    },
  };
});

type TxMocks = {
  workShift: { findFirst: Mock; updateMany: Mock; create: Mock };
  employeeHourConcept: { findFirst: Mock };
  timeEntry: { create: Mock };
  attendancePunch: { create: Mock };
};

const mockedPrisma = prisma as unknown as {
  workShift: { findMany: Mock };
  employeeHourConcept: { findFirst: Mock };
  $transaction: Mock;
  __tx: TxMocks;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("expireOpenWorkShifts — regresión de atribución de día/período (Etapa 2)", () => {
  it("un turno abierto que arrancó a las 23:15 hora Argentina se atribuye a agosto/día 14, no a septiembre/día 1 en UTC", async () => {
    // 2026-08-14 23:15 ART = 2026-08-15 02:15 UTC.
    const startAt = new Date("2026-08-15T02:15:00.000Z");
    const now = new Date("2026-08-15T04:00:00.000Z"); // ~1h45 después: supera maxAllowedMinutes de 60.

    mockedPrisma.workShift.findMany.mockResolvedValue([
      {
        id: "shift-1",
        employeeId: "employee-1",
        startAt,
        maxAllowedMinutes: 60,
        source: "PORTAL_DNI",
        hourConcept: { id: "concept-1", name: "Normal" },
      },
    ]);
    mockedPrisma.__tx.workShift.updateMany.mockResolvedValue({ count: 1 });
    mockedPrisma.__tx.timeEntry.create.mockResolvedValue({});

    const result = await timeEntriesRepository.expireOpenWorkShifts(now);

    expect(result.count).toBe(1);
    expect(mockedPrisma.__tx.timeEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ period: "2026-08", day: 14 }),
      }),
    );
  });
});

describe("rolloverExpiredOpenWorkShift — regresión de atribución de día/período (Etapa 2)", () => {
  it("la jornada anterior que arrancó a las 23:30 hora Argentina se atribuye a agosto/día 14, no a septiembre/día 1 en UTC", async () => {
    // 2026-08-14 23:30 ART = 2026-08-15 02:30 UTC.
    const previousStartAt = new Date("2026-08-15T02:30:00.000Z");

    mockedPrisma.__tx.workShift.findFirst.mockResolvedValue({
      id: "shift-prev",
      startAt: previousStartAt,
      source: "PORTAL_DNI",
      hourConcept: { id: "concept-1", name: "Normal" },
    });
    mockedPrisma.__tx.workShift.updateMany.mockResolvedValue({ count: 1 });
    mockedPrisma.__tx.timeEntry.create.mockResolvedValue({});
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValue({ id: "punch-1" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-new" });

    await timeEntriesRepository.rolloverExpiredOpenWorkShift({
      openWorkShiftId: "shift-prev",
      employeeId: "employee-1",
      source: "PORTAL_DNI" as never,
      startAt: new Date("2026-08-15T10:00:00.000Z"),
      missingOutObservation: "Olvido de salida.",
    });

    expect(mockedPrisma.__tx.timeEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ period: "2026-08", day: 14 }),
      }),
    );
  });
});
