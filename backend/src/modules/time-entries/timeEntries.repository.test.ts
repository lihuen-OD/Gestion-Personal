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
    hourConcept: { findMany: vi.fn() },
    specialHourRuleApplication: { create: vi.fn() },
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
  hourConcept: { findMany: Mock };
  specialHourRuleApplication: { create: Mock };
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
  mockedPrisma.__tx.hourConcept.findMany.mockResolvedValue([]);
  mockedPrisma.__tx.timeEntry.findFirst.mockResolvedValue(null);
  let segmentCounter = 0;
  let specialApplicationCounter = 0;
  mockedPrisma.__tx.timeSegment.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `segment-${++segmentCounter}`, ...data }));
  mockedPrisma.__tx.timeEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `entry-${segmentCounter}`, ...data }));
  mockedPrisma.__tx.specialHourRuleApplication.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `special-application-${++specialApplicationCounter}`, ...data }));
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

describe("SpecialHourRuleApplication y multiplicador efectivo (Etapa 3)", () => {
  const employeeId = "employee-1";
  const sunday = new Date("2026-08-16T00:00:00.000Z"); // domingo (weekday 0)
  const monday = new Date("2026-08-17T00:00:00.000Z"); // lunes (weekday 1)

  function rule(overrides: Partial<{ id: string; name: string; recurrenceType: string; fromDate: Date; toDate: Date | null; weekdays: number[]; multiplier: number }>) {
    return {
      id: "rule-1",
      name: "Regla",
      recurrenceType: "SEMANAL",
      fromDate: new Date("2026-01-01T00:00:00.000Z"),
      toDate: null,
      weekdays: [0],
      multiplier: 2,
      status: "ACTIVO",
      reason: "Domingo",
      ...overrides,
    };
  }

  function oneSegmentInput(date: Date, overrides: Partial<{ hourConceptId: string }> = {}) {
    const startAt = date;
    const endAt = new Date(date.getTime() + 4 * 60 * 60_000);
    return {
      employeeId,
      hourConceptId: overrides.hourConceptId ?? "concept-normal",
      hourConceptName: "Hora normal",
      source: "ADMIN" as never,
      startAt,
      endAt,
      totalMinutes: 240,
      segments: [{ date, startAt, endAt, minutes: 240, hours: 4, hourConceptId: overrides.hourConceptId ?? "concept-normal", hourConceptName: "Hora normal", conceptStatus: "SUGERIDO" as const, hourConceptRuleId: null }],
    };
  }

  it("Caso A — sin regla especial: no crea SpecialHourRuleApplication, appliedMultiplier queda en 1, isSpecial false", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-a" });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([]);

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(monday));

    expect(mockedPrisma.__tx.specialHourRuleApplication.create).not.toHaveBeenCalled();
    expect(mockedPrisma.__tx.timeSegment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isSpecial: false }) }));
    expect(mockedPrisma.__tx.timeEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ appliedMultiplier: 1 }) }));
  });

  it("Caso B — una regla especial: crea 1 SpecialHourRuleApplication, appliedMultiplier = multiplier de la regla, isSpecial true", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-b" });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([rule({ id: "rule-domingo", multiplier: 2 })]);

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday));

    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ doubleHourRuleId: "rule-domingo", multiplierApplied: 2 }) }),
    );
    expect(mockedPrisma.__tx.timeSegment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isSpecial: true }) }));
    expect(mockedPrisma.__tx.timeEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ appliedMultiplier: 2 }) }));
  });

  it("Caso C — dos reglas aplicables al mismo segmento: registra ambas, usa el mayor multiplicador, no multiplica ni suma", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-c" });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([
      rule({ id: "rule-domingo", multiplier: 2 }),
      rule({ id: "rule-especial", multiplier: 1.5, recurrenceType: "RANGO", fromDate: new Date("2026-08-01T00:00:00.000Z"), toDate: new Date("2026-08-31T00:00:00.000Z") }),
    ]);

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday));

    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledTimes(2);
    const ruleIds = mockedPrisma.__tx.specialHourRuleApplication.create.mock.calls.map((call) => call[0]?.data?.doubleHourRuleId);
    expect(new Set(ruleIds)).toEqual(new Set(["rule-domingo", "rule-especial"]));
    // Mayor multiplicador (2), nunca 2*1.5=3 ni 2+1.5=3.5.
    expect(mockedPrisma.__tx.timeEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ appliedMultiplier: 2 }) }));
  });

  it("Caso D — dos segmentos (HourConceptRule) el mismo día: la regla semanal se registra en cada uno por separado, sin perder minutos", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-d" });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([rule({ id: "rule-domingo", multiplier: 2 })]);

    const startAt = sunday;
    const mid = new Date(sunday.getTime() + 3 * 60 * 60_000);
    const endAt = new Date(sunday.getTime() + 8 * 60 * 60_000);

    await timeEntriesRepository.createFromWorkShift({
      employeeId,
      hourConceptId: "concept-normal",
      hourConceptName: "Hora normal",
      source: "ADMIN" as never,
      startAt,
      endAt,
      totalMinutes: 480,
      segments: [
        { date: sunday, startAt, endAt: mid, minutes: 180, hours: 3, hourConceptId: "concept-normal", hourConceptName: "Hora normal", conceptStatus: "SUGERIDO", hourConceptRuleId: "rule-normal" },
        { date: sunday, startAt: mid, endAt, minutes: 300, hours: 5, hourConceptId: "concept-guardia", hourConceptName: "Guardia", conceptStatus: "SUGERIDO", hourConceptRuleId: "rule-guardia" },
      ],
    });

    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledTimes(2); // una por segmento
    const timeSegmentIds = mockedPrisma.__tx.specialHourRuleApplication.create.mock.calls.map((call) => call[0]?.data?.timeSegmentId);
    expect(new Set(timeSegmentIds).size).toBe(2); // cada aplicación referencia un TimeSegment distinto

    const totalActualMinutes = mockedPrisma.__tx.timeEntry.create.mock.calls.reduce((sum, call) => sum + (call[0]?.data?.actualMinutes ?? 0), 0);
    expect(totalActualMinutes).toBe(480); // minutos reales (no multiplicados) == 08:00 reales entre startAt y endAt
  });

  it("Caso E — regla por fecha exacta: aplica solo ese día, no en otro", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValue({ id: "punch" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-e" });
    const feriado = rule({ id: "rule-feriado", recurrenceType: "FECHA", fromDate: sunday, toDate: null, multiplier: 2 });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([feriado]);

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday));
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([feriado]);
    mockedPrisma.__tx.hourConcept.findMany.mockResolvedValue([]);
    mockedPrisma.__tx.timeEntry.findFirst.mockResolvedValue(null);
    mockedPrisma.__tx.timeSegment.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "segment-x", ...data }));
    mockedPrisma.__tx.timeEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "entry-x", ...data }));
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValue({ id: "punch" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-e2" });

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(monday)); // un día distinto al de la regla FECHA
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).not.toHaveBeenCalled();
  });

  it("Caso F — regla por rango: aplica dentro del rango, no fuera de él", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValue({ id: "punch" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-f" });
    const rango = rule({ id: "rule-rango", recurrenceType: "RANGO", fromDate: new Date("2026-08-01T00:00:00.000Z"), toDate: new Date("2026-08-10T00:00:00.000Z"), multiplier: 1.5 });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([rango]);

    const fueraDeRango = new Date("2026-08-18T00:00:00.000Z"); // posterior al toDate
    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(fueraDeRango));
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([rango]);
    mockedPrisma.__tx.hourConcept.findMany.mockResolvedValue([]);
    mockedPrisma.__tx.timeEntry.findFirst.mockResolvedValue(null);
    mockedPrisma.__tx.timeSegment.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "segment-y", ...data }));
    mockedPrisma.__tx.timeEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "entry-y", ...data }));
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValue({ id: "punch" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-f2" });

    const dentroDeRango = new Date("2026-08-05T00:00:00.000Z");
    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(dentroDeRango));
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledTimes(1);
  });

  it("Caso G — regla semanal: aplica en el weekday configurado, no en otro", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValue({ id: "punch" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-g" });
    const semanal = rule({ id: "rule-semanal", recurrenceType: "SEMANAL", weekdays: [0], multiplier: 2 }); // solo domingo

    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([semanal]);
    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(monday)); // lunes: no matchea
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([semanal]);
    mockedPrisma.__tx.hourConcept.findMany.mockResolvedValue([]);
    mockedPrisma.__tx.timeEntry.findFirst.mockResolvedValue(null);
    mockedPrisma.__tx.timeSegment.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "segment-z", ...data }));
    mockedPrisma.__tx.timeEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "entry-z", ...data }));
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValue({ id: "punch" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-g2" });

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday)); // domingo: matchea
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledTimes(1);
  });

  it("Caso H — un único cierre no duplica SpecialHourRuleApplication (no hay recálculo implementado todavía)", async () => {
    mockedPrisma.__tx.workShift.updateMany.mockResolvedValue({ count: 1 });
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValue({ id: "punch-out" });
    mockedPrisma.__tx.workShift.update.mockResolvedValue({ id: "shift-h" });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([rule({ id: "rule-domingo", multiplier: 2 })]);

    await timeEntriesRepository.closeOpenWorkShift({
      workShiftId: "shift-h",
      employeeId,
      hourConceptId: "concept-normal",
      hourConceptName: "Hora normal",
      source: "PORTAL_DNI" as never,
      endAt: new Date(sunday.getTime() + 4 * 60 * 60_000),
      totalMinutes: 240,
      segments: [{ date: sunday, startAt: sunday, endAt: new Date(sunday.getTime() + 4 * 60 * 60_000), minutes: 240, hours: 4, hourConceptId: "concept-normal", hourConceptName: "Hora normal", conceptStatus: "SUGERIDO", hourConceptRuleId: null }],
    });

    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledTimes(1); // una regla, un segmento -> una sola fila, sin duplicar
  });

  it("Caso I — invariante: la suma de TimeEntry.actualMinutes (minutos reales, no multiplicados) coincide con el rango real del WorkShift", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-i" });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([rule({ id: "rule-domingo", multiplier: 2 })]);

    const result = await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday));

    // appliedMultiplier=2 infla totalMinutes/hours a propósito (pago de horas extra) —
    // por eso el invariante de "minutos reales" se mide sobre actualMinutes, no sobre
    // totalMinutes (que sí puede superar los minutos reales cuando aplica un multiplicador).
    const totalActualMinutes = result.entries.reduce((sum, entry) => sum + (entry as { actualMinutes: number }).actualMinutes, 0);
    expect(totalActualMinutes).toBe(240);
    expect((result.entries[0] as { totalMinutes: number }).totalMinutes).toBe(480); // 240 * multiplier 2, comportamiento preexistente sin cambios
  });

  it("isNight se deriva del HourConceptKind (NOCTURNA/GUARDIA/SERENO) del concepto del segmento, sin comparar nombres", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-night" });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([]);
    mockedPrisma.__tx.hourConcept.findMany.mockResolvedValue([
      { id: "concept-guardia", kind: "GUARDIA" },
      { id: "concept-normal", kind: "NORMAL" },
    ]);

    const startAt = sunday;
    const mid = new Date(sunday.getTime() + 2 * 60 * 60_000);
    const endAt = new Date(sunday.getTime() + 4 * 60 * 60_000);

    await timeEntriesRepository.createFromWorkShift({
      employeeId,
      hourConceptId: "concept-normal",
      hourConceptName: "Hora normal",
      source: "ADMIN" as never,
      startAt,
      endAt,
      totalMinutes: 240,
      segments: [
        { date: sunday, startAt, endAt: mid, minutes: 120, hours: 2, hourConceptId: "concept-normal", hourConceptName: "Hora normal", conceptStatus: "SUGERIDO", hourConceptRuleId: null },
        { date: sunday, startAt: mid, endAt, minutes: 120, hours: 2, hourConceptId: "concept-guardia", hourConceptName: "Guardia", conceptStatus: "SUGERIDO", hourConceptRuleId: null },
      ],
    });

    expect(mockedPrisma.__tx.timeSegment.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ hourConceptId: "concept-normal", isNight: false }) }));
    expect(mockedPrisma.__tx.timeSegment.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ hourConceptId: "concept-guardia", isNight: true }) }));
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
