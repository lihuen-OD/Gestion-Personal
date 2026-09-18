import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { workforceService } from "../workforce-management/workforce.service";
import { resolveActiveWorkRegimesForDate } from "../work-regimes/workRegimes.service";
import { resolveWorkObligationCandidates } from "./workObligation.service";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    holidayWorkAssignment: { findMany: vi.fn() },
    shiftAssignment: { findMany: vi.fn() },
  },
}));

vi.mock("../workforce-management/workforce.service", () => ({
  workforceService: { holidayDatesInRange: vi.fn() },
}));

vi.mock("../work-regimes/workRegimes.service", () => ({
  resolveActiveWorkRegimesForDate: vi.fn(),
}));

const mockedPrisma = prisma as unknown as {
  holidayWorkAssignment: { findMany: Mock };
  shiftAssignment: { findMany: Mock };
};
const mockedHolidayDates = workforceService.holidayDatesInRange as unknown as Mock;
const mockedRegimes = resolveActiveWorkRegimesForDate as unknown as Mock;

const dateKey = "2026-09-14";
// Día de semana real de dateKey, calculado (no hardcodeado) para que el test
// no dependa de una suposición manual sobre qué día cae el 2026-09-14.
const weekday = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
const otherWeekday = (weekday + 1) % 7;

function template(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "template-1",
    code: "T1",
    startTime: "08:00",
    endTime: "16:00",
    crossesMidnight: false,
    entryToleranceBeforeMinutes: 10,
    entryToleranceAfterMinutes: 10,
    exitToleranceBeforeMinutes: 20,
    exitToleranceAfterMinutes: 20,
    minimumMinutesForCompliance: null,
    maximumInformativeMinutes: 480,
    missingOutAlertAfterMinutes: null,
    absoluteOpenShiftLimitMinutes: 1200,
    status: "ACTIVO",
    ...overrides,
  };
}

function assignment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    employeeId: "employee-1",
    shiftTemplateId: "template-1",
    status: "HABILITADO",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    weekdays: [],
    shiftTemplate: template(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedHolidayDates.mockResolvedValue([]);
  mockedPrisma.holidayWorkAssignment.findMany.mockResolvedValue([]);
  mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]);
  mockedRegimes.mockResolvedValue(new Map());
});

describe("resolveWorkObligationCandidates — Etapa 15M.19B", () => {
  it("día normal, weekdays vacío (todos los días), sin régimen: es candidato (fallback conservador de 15M.7C)", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([assignment()]);

    const result = await resolveWorkObligationCandidates(dateKey);

    expect(result.isHoliday).toBe(false);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ employeeId: "employee-1" });
    expect(result.candidates[0]!.scheduledStartAt.toISOString()).toBe("2026-09-14T11:00:00.000Z"); // 08:00 ART = 11:00 UTC
  });

  it("weekdays incluye el día real de dateKey: es candidato", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([assignment({ weekdays: [weekday] })]);

    const result = await resolveWorkObligationCandidates(dateKey);

    expect(result.candidates).toHaveLength(1);
  });

  it("weekdays NO incluye el día real de dateKey (día de descanso): NO es candidato", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([assignment({ weekdays: [otherWeekday] })]);

    const result = await resolveWorkObligationCandidates(dateKey);

    expect(result.candidates).toHaveLength(0);
  });

  it("effectiveFrom futuro respecto a dateKey: NO es candidato", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([assignment({ effectiveFrom: new Date("2026-12-01T00:00:00.000Z") })]);

    const result = await resolveWorkObligationCandidates(dateKey);

    expect(result.candidates).toHaveLength(0);
  });

  it("effectiveTo pasado respecto a dateKey: NO es candidato", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([assignment({ effectiveTo: new Date("2026-01-31T00:00:00.000Z") })]);

    const result = await resolveWorkObligationCandidates(dateKey);

    expect(result.candidates).toHaveLength(0);
  });

  it("vigente hoy (effectiveFrom pasado, effectiveTo futuro): es candidato", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([
      assignment({ effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: new Date("2026-12-31T00:00:00.000Z") }),
    ]);

    const result = await resolveWorkObligationCandidates(dateKey);

    expect(result.candidates).toHaveLength(1);
  });

  it("la query sólo pide asignaciones HABILITADO, empleado ACTIVO y turno ACTIVO (nunca deshabilitadas/inactivos)", async () => {
    await resolveWorkObligationCandidates(dateKey);

    expect(mockedPrisma.shiftAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "HABILITADO", employee: { status: "ACTIVO" }, shiftTemplate: { status: "ACTIVO" } }) }),
    );
  });

  it("régimen SIN_TURNO: NUNCA es candidato aunque conserve una ShiftAssignment habilitada y aplicable", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([assignment()]);
    mockedRegimes.mockResolvedValue(new Map([["employee-1", { kind: "SIN_TURNO", alertOnOutOfShift: false, openShiftOverflowAction: "ROLLOVER", extendedShiftAlertMinutes: null }]]));

    const result = await resolveWorkObligationCandidates(dateKey);

    expect(result.candidates).toHaveLength(0);
  });

  it("régimen TURNO_FLEXIBLE con ShiftAssignment propia habilitada: SÍ es candidato (15M.7D: la asignación explícita ya es la obligación)", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([assignment()]);
    mockedRegimes.mockResolvedValue(new Map([["employee-1", { kind: "TURNO_FLEXIBLE", alertOnOutOfShift: false, openShiftOverflowAction: "ROLLOVER", extendedShiftAlertMinutes: null }]]));

    const result = await resolveWorkObligationCandidates(dateKey);

    expect(result.candidates).toHaveLength(1);
  });

  it("TURNO_FLEXIBLE sin ninguna ShiftAssignment propia: nunca es candidato — no se fabrica un scheduledStart desde una plantilla global", async () => {
    // Sin ShiftAssignment alguna (mock por defecto: []) -- el régimen ni
    // siquiera llega a resolverse porque earliestByEmployee queda vacío.
    mockedRegimes.mockResolvedValue(new Map([["employee-1", { kind: "TURNO_FLEXIBLE", alertOnOutOfShift: false, openShiftOverflowAction: "ROLLOVER", extendedShiftAlertMinutes: null }]]));

    const result = await resolveWorkObligationCandidates(dateKey);

    expect(result.candidates).toHaveLength(0);
  });

  it("régimen TURNO_OBLIGATORIO: es candidato", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([assignment()]);
    mockedRegimes.mockResolvedValue(new Map([["employee-1", { kind: "TURNO_OBLIGATORIO", alertOnOutOfShift: true, openShiftOverflowAction: "ROLLOVER", extendedShiftAlertMinutes: null }]]));

    const result = await resolveWorkObligationCandidates(dateKey);

    expect(result.candidates).toHaveLength(1);
  });

  it("feriado sin ningún convocado: candidatos vacío, corta antes de consultar ShiftAssignment", async () => {
    mockedHolidayDates.mockResolvedValue([{ date: dateKey, rules: [{ id: "rule-1", name: "Feriados" }] }]);
    mockedPrisma.holidayWorkAssignment.findMany.mockResolvedValue([]);

    const result = await resolveWorkObligationCandidates(dateKey);

    expect(result.isHoliday).toBe(true);
    expect(result.candidates).toHaveLength(0);
    expect(mockedPrisma.shiftAssignment.findMany).not.toHaveBeenCalled();
  });

  it("feriado con convocatoria ACTIVA: sólo el empleado convocado puede ser candidato", async () => {
    mockedHolidayDates.mockResolvedValue([{ date: dateKey, rules: [{ id: "rule-1", name: "Feriados" }] }]);
    mockedPrisma.holidayWorkAssignment.findMany.mockResolvedValue([{ employeeId: "employee-1" }]);
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([assignment()]);

    const result = await resolveWorkObligationCandidates(dateKey);

    expect(result.candidates).toHaveLength(1);
    expect(mockedPrisma.shiftAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ employeeId: { in: ["employee-1"] } }) }),
    );
  });

  it("empleado con dos asignaciones aplicables el mismo día: gana la de scheduledStart más temprano", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([
      assignment({ shiftTemplateId: "late", shiftTemplate: template({ id: "late", code: "TARDE", startTime: "14:00" }) }),
      assignment({ shiftTemplateId: "early", shiftTemplate: template({ id: "early", code: "MANANA", startTime: "06:00" }) }),
    ]);

    const result = await resolveWorkObligationCandidates(dateKey);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.template.code).toBe("MANANA");
  });

  it("dos empleados distintos con asignaciones válidas: ambos son candidatos, sin mezclarse", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([assignment({ employeeId: "employee-1" }), assignment({ employeeId: "employee-2" })]);

    const result = await resolveWorkObligationCandidates(dateKey);

    expect(result.candidates.map((c) => c.employeeId).sort()).toEqual(["employee-1", "employee-2"]);
  });
});
