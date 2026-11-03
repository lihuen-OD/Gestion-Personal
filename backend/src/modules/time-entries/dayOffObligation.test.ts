import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { workforceService } from "../workforce-management/workforce.service";
import { resolveActiveWorkRegimesForDate } from "../work-regimes/workRegimes.service";
import { checkMissingExpectedEntries } from "./missingEntry.service";
import { detectAttendanceInactivity } from "./attendanceInactivity.service";

/**
 * docs/decisions/EMPLOYEE_DAY_OFF.md §6: falta de ingreso (intradía) e
 * inactividad (diaria) NO tienen filtros de franco propios — heredan el
 * resultado del motor central `resolveWorkObligationCandidates`, que acá corre
 * REAL (sólo Prisma, calendario de feriados y régimen están mockeados).
 */
vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    holidayWorkAssignment: { findMany: vi.fn() },
    shiftAssignment: { findMany: vi.fn() },
    employeeDayOff: { findMany: vi.fn() },
    employee: { findMany: vi.fn() },
    attendancePunch: { findMany: vi.fn() },
    workShift: { findMany: vi.fn() },
    timeEntry: { findMany: vi.fn() },
    novelty: { findMany: vi.fn() },
    attendanceInactivityIncident: { createMany: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    user: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../workforce-management/workforce.service", () => ({ workforceService: { holidayDatesInRange: vi.fn() } }));
vi.mock("../work-regimes/workRegimes.service", () => ({ resolveActiveWorkRegimesForDate: vi.fn() }));

const mockedPrisma = prisma as unknown as Record<string, Record<string, Mock>> & { $transaction: Mock };
const DATE = "2026-11-05";

const shiftAssignment = {
  employeeId: "employee-1",
  shiftTemplateId: "t1",
  status: "HABILITADO",
  effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  effectiveTo: null,
  weekdays: [],
  shiftTemplate: {
    id: "t1", code: "MANANA", startTime: "08:00", endTime: "16:00", crossesMidnight: false,
    entryToleranceBeforeMinutes: 10, entryToleranceAfterMinutes: 10, exitToleranceBeforeMinutes: 10, exitToleranceAfterMinutes: 10,
    minimumMinutesForCompliance: null, maximumInformativeMinutes: 480, missingOutAlertAfterMinutes: null, absoluteOpenShiftLimitMinutes: 1200, status: "ACTIVO",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(workforceService.holidayDatesInRange).mockResolvedValue([]);
  vi.mocked(resolveActiveWorkRegimesForDate).mockResolvedValue(new Map());
  mockedPrisma.holidayWorkAssignment!.findMany!.mockResolvedValue([]);
  mockedPrisma.shiftAssignment!.findMany!.mockResolvedValue([shiftAssignment]);
  mockedPrisma.employeeDayOff!.findMany!.mockResolvedValue([]);
  mockedPrisma.employee!.findMany!.mockResolvedValue([{ id: "employee-1", legajo: "001", firstName: "Ana", lastName: "Pérez", assignments: [] }]);
  for (const model of ["attendancePunch", "workShift", "timeEntry", "novelty"]) mockedPrisma[model]!.findMany!.mockResolvedValue([]);
  mockedPrisma.attendanceInactivityIncident!.createMany!.mockResolvedValue({ count: 1 });
  mockedPrisma.attendanceInactivityIncident!.findMany!.mockResolvedValue([]);
  mockedPrisma.attendanceInactivityIncident!.updateMany!.mockResolvedValue({ count: 0 });
  mockedPrisma.user!.findMany!.mockResolvedValue([{ id: "user-rrhh" }]);
});

describe("franco → sin falta de ingreso ni 'Sin actividad registrada' (motor de obligación real)", () => {
  it("control: sin franco, turno 08:00 vencido y sin fichada → se crea el incidente FALTA_INGRESO", async () => {
    const result = await checkMissingExpectedEntries(new Date(`${DATE}T11:30:00.000Z`)); // 08:30 ART

    expect(result.created).toBe(1);
    expect(mockedPrisma.attendanceInactivityIncident!.createMany).toHaveBeenCalledTimes(1);
  });

  it("franco ACTIVO: FALTA_INGRESO no se crea ni se notifica", async () => {
    mockedPrisma.employeeDayOff!.findMany!.mockResolvedValue([{ employeeId: "employee-1" }]);

    const result = await checkMissingExpectedEntries(new Date(`${DATE}T11:30:00.000Z`));

    expect(result).toEqual({ candidates: 0, due: 0, created: 0, resolved: 0 });
    expect(mockedPrisma.attendanceInactivityIncident!.createMany).not.toHaveBeenCalled();
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("franco ACTIVO: el chequeo diario no crea 'Sin actividad registrada' ni notifica", async () => {
    mockedPrisma.employeeDayOff!.findMany!.mockResolvedValue([{ employeeId: "employee-1" }]);

    const result = await detectAttendanceInactivity(DATE);

    expect(result).toEqual({ date: DATE, detected: 0, notified: 0 });
    expect(mockedPrisma.attendanceInactivityIncident!.createMany).not.toHaveBeenCalled();
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("control: sin franco el chequeo diario sí detecta la inactividad", async () => {
    const result = await detectAttendanceInactivity(DATE);

    expect(result.detected).toBe(1);
  });
});
