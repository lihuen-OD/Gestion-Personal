import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { timeEntriesRepository } from "./timeEntries.repository";

vi.mock("../../shared/prisma/client", () => {
  const tx = {
    workShift: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    employeeHourConcept: { findFirst: vi.fn() },
    timeEntry: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    attendancePunch: { create: vi.fn() },
    timeSegment: { create: vi.fn() },
    doubleHourRule: { findMany: vi.fn() },
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
  workShift: { findFirst: Mock; updateMany: Mock; create: Mock; update: Mock };
  employeeHourConcept: { findFirst: Mock };
  timeEntry: { create: Mock; findFirst: Mock; update: Mock };
  attendancePunch: { create: Mock };
  timeSegment: { create: Mock };
  doubleHourRule: { findMany: Mock };
};

const mockedPrisma = prisma as unknown as {
  workShift: { findMany: Mock };
  employeeHourConcept: { findFirst: Mock };
  $transaction: Mock;
  __tx: TxMocks;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([]);
  mockedPrisma.__tx.timeEntry.findFirst.mockResolvedValue(null);
  let segmentCounter = 0;
  mockedPrisma.__tx.timeSegment.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `segment-${++segmentCounter}`, ...data }));
  mockedPrisma.__tx.timeEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `entry-${segmentCounter}`, ...data }));
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

describe("createFromWorkShift — persistencia de segmentos clasificados (Turnos V1, etapa de clasificación)", () => {
  const employeeId = "employee-1";
  const day = new Date("2026-08-18T00:00:00.000Z");

  it("crea un TimeSegment/TimeEntry por cada segmento clasificado, con su propio hourConceptId y conceptStatus — no se pierden ni duplican minutos", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-1" });

    const startAt = new Date("2026-08-18T20:00:00.000Z"); // 17:00 ART
    const midpoint = new Date("2026-08-19T00:00:00.000Z"); // 21:00 ART
    const endAt = new Date("2026-08-19T07:00:00.000Z"); // 04:00 ART

    const result = await timeEntriesRepository.createFromWorkShift({
      employeeId,
      hourConceptId: "concept-normal",
      hourConceptName: "Hora normal",
      source: "ADMIN" as never,
      startAt,
      endAt,
      totalMinutes: 660,
      segments: [
        { date: day, startAt, endAt: midpoint, minutes: 240, hours: 4, hourConceptId: "concept-normal", hourConceptName: "Hora normal", conceptStatus: "SUGERIDO", hourConceptRuleId: "rule-normal" },
        { date: day, startAt: midpoint, endAt, minutes: 420, hours: 7, hourConceptId: "concept-guardia", hourConceptName: "Guardia", conceptStatus: "SUGERIDO", hourConceptRuleId: "rule-guardia" },
      ],
    });

    expect(mockedPrisma.__tx.timeSegment.create).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.__tx.timeSegment.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ hourConceptId: "concept-normal", hourConceptRuleId: "rule-normal", conceptStatus: "SUGERIDO", minutes: 240 }),
    }));
    expect(mockedPrisma.__tx.timeSegment.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ hourConceptId: "concept-guardia", hourConceptRuleId: "rule-guardia", conceptStatus: "SUGERIDO", minutes: 420 }),
    }));
    expect(mockedPrisma.__tx.timeEntry.create).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.__tx.timeEntry.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ hourConceptId: "concept-normal", totalMinutes: 240 }) }));
    expect(mockedPrisma.__tx.timeEntry.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ hourConceptId: "concept-guardia", totalMinutes: 420 }) }));

    const totalPersistedMinutes = result.entries.reduce((sum, entry) => sum + (entry as { totalMinutes: number }).totalMinutes, 0);
    expect(totalPersistedMinutes).toBe(660); // == minutos reales entre startAt y endAt (17:00 a 04:00)
  });

  it("marca conceptStatus SIN_CONCEPTO_COMPATIBLE / CONCEPTO_NO_HABILITADO cuando corresponde, sin bloquear la creación", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-2" });

    await timeEntriesRepository.createFromWorkShift({
      employeeId,
      hourConceptId: "concept-normal",
      hourConceptName: "Hora normal",
      source: "ADMIN" as never,
      startAt: day,
      endAt: new Date(day.getTime() + 4 * 60 * 60_000),
      totalMinutes: 240,
      segments: [
        { date: day, startAt: day, endAt: new Date(day.getTime() + 60 * 60_000), minutes: 60, hours: 1, hourConceptId: "concept-normal", hourConceptName: "Hora normal", conceptStatus: "SIN_CONCEPTO_COMPATIBLE", hourConceptRuleId: null },
        { date: day, startAt: new Date(day.getTime() + 60 * 60_000), endAt: new Date(day.getTime() + 4 * 60 * 60_000), minutes: 180, hours: 3, hourConceptId: "concept-guardia", hourConceptName: "Guardia", conceptStatus: "CONCEPTO_NO_HABILITADO", hourConceptRuleId: "rule-guardia" },
      ],
    });

    expect(mockedPrisma.__tx.timeSegment.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ conceptStatus: "SIN_CONCEPTO_COMPATIBLE", hourConceptRuleId: null }) }));
    expect(mockedPrisma.__tx.timeSegment.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ conceptStatus: "CONCEPTO_NO_HABILITADO", hourConceptRuleId: "rule-guardia" }) }));
  });

  it("crossesMidnight se calcula por fechas distintas entre los segmentos, no por la cantidad de segmentos (2 conceptos el mismo día no cruzan medianoche)", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-3" });

    await timeEntriesRepository.createFromWorkShift({
      employeeId,
      hourConceptId: "concept-normal",
      hourConceptName: "Hora normal",
      source: "ADMIN" as never,
      startAt: day,
      endAt: new Date(day.getTime() + 4 * 60 * 60_000),
      totalMinutes: 240,
      segments: [
        { date: day, startAt: day, endAt: new Date(day.getTime() + 60 * 60_000), minutes: 60, hours: 1, hourConceptId: "concept-normal", hourConceptName: "Hora normal", conceptStatus: "SUGERIDO", hourConceptRuleId: "rule-normal" },
        { date: day, startAt: new Date(day.getTime() + 60 * 60_000), endAt: new Date(day.getTime() + 4 * 60 * 60_000), minutes: 180, hours: 3, hourConceptId: "concept-guardia", hourConceptName: "Guardia", conceptStatus: "SUGERIDO", hourConceptRuleId: "rule-guardia" },
      ],
    });

    expect(mockedPrisma.__tx.workShift.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ crossesMidnight: false }) }));
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
