import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { workforceService } from "../workforce-management/workforce.service";
import { resolveActiveWorkRegimesForDate } from "../work-regimes/workRegimes.service";
import { checkMissingEntriesForElapsedDate, checkMissingExpectedEntries } from "./missingEntry.service";

/**
 * Etapa 15M.19F (docs/decisions/MISSING_ENTRY_CROSS_MIDNIGHT_RECONCILIATION_15M19F.md):
 * caso real reportado por usuario — Sereno (turno nocturno 23:00-07:00)
 * trabaja correctamente 20/09 23:00 -> 21/09 07:00 (deja actividad real
 * durante la madrugada del 21/09), pero no ficha su NUEVA obligación de esa
 * misma noche (21/09 23:00) porque el backend estaba caído. Al volver el
 * 22/09, la falta de ingreso del 21/09 23:00 debía detectarse igual.
 *
 * A propósito NO se mockea `resolveWorkObligationCandidates` (§40/§41 del
 * pedido): se mockean sólo sus dependencias de infraestructura
 * (Prisma, workforceService.holidayDatesInRange, resolveActiveWorkRegimesForDate)
 * para atravesar la lógica real de assignment -> obligación -> deadline ->
 * evidencia específica -> incidente -> SystemNotification.
 */
vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    holidayWorkAssignment: { findMany: vi.fn() },
    shiftAssignment: { findMany: vi.fn() },
    employee: { findMany: vi.fn() },
    attendancePunch: { findMany: vi.fn() },
    novelty: { findMany: vi.fn() },
    attendanceInactivityIncident: { createMany: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    user: { findMany: vi.fn() },
    $transaction: vi.fn(),
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
  employee: { findMany: Mock };
  attendancePunch: { findMany: Mock };
  novelty: { findMany: Mock };
  attendanceInactivityIncident: { createMany: Mock; findMany: Mock; updateMany: Mock };
  user: { findMany: Mock };
  $transaction: Mock;
};
const mockedHolidayDates = workforceService.holidayDatesInRange as unknown as Mock;
const mockedRegimes = resolveActiveWorkRegimesForDate as unknown as Mock;

const SERENO_ID = "employee-sereno";

const nightTemplate = {
  id: "template-noc",
  code: "NOC",
  startTime: "23:00",
  endTime: "07:00",
  crossesMidnight: true,
  entryToleranceBeforeMinutes: 10,
  entryToleranceAfterMinutes: 10,
  exitToleranceBeforeMinutes: 20,
  exitToleranceAfterMinutes: 20,
  minimumMinutesForCompliance: null,
  maximumInformativeMinutes: 600,
  missingOutAlertAfterMinutes: null,
  absoluteOpenShiftLimitMinutes: 1200,
  status: "ACTIVO",
};

function sereno_assignment() {
  return {
    employeeId: SERENO_ID,
    shiftTemplateId: "template-noc",
    status: "HABILITADO",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    weekdays: [],
    shiftTemplate: nightTemplate,
  };
}

function serenoRow() {
  return { id: SERENO_ID, legajo: "000777", firstName: "Sereno", lastName: "Nocturno", assignments: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedHolidayDates.mockResolvedValue([]);
  mockedRegimes.mockResolvedValue(new Map());
  mockedPrisma.holidayWorkAssignment.findMany.mockResolvedValue([]);
  mockedPrisma.shiftAssignment.findMany.mockResolvedValue([sereno_assignment()]);
  mockedPrisma.employee.findMany.mockResolvedValue([serenoRow()]);
  mockedPrisma.attendancePunch.findMany.mockResolvedValue([]);
  mockedPrisma.novelty.findMany.mockResolvedValue([]);
  mockedPrisma.attendanceInactivityIncident.createMany.mockResolvedValue({ count: 1 });
  mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([{ id: "incident-1", employeeId: SERENO_ID, employee: serenoRow() }]);
  mockedPrisma.attendanceInactivityIncident.updateMany.mockResolvedValue({ count: 0 });
  mockedPrisma.user.findMany.mockResolvedValue([{ id: "user-rrhh" }]);
  const tx = { systemNotification: { createMany: vi.fn() }, attendanceInactivityIncident: { update: vi.fn() } };
  mockedPrisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
});

describe("Caso Sereno — turno nocturno cruza medianoche, actividad previa NO debe ocultar la obligación siguiente", () => {
  it("A) actividad de la madrugada del 21/09 (cola del turno 20/09 23:00->21/09 07:00) + falta al turno 21/09 23:00 -> SÍ genera falta de ingreso del 21/09", async () => {
    // Única evidencia real disponible tras el downtime: el INGRESO de la
    // jornada ANTERIOR (20/09 23:00 ART = 21/09 02:00 UTC). Nunca hay un
    // INGRESO propio de la obligación 21/09 23:00 -- el empleado no fichó.
    mockedPrisma.attendancePunch.findMany.mockResolvedValue([
      { employeeId: SERENO_ID, timestamp: new Date("2026-09-21T02:00:00.000Z") },
    ]);

    const result = await checkMissingEntriesForElapsedDate("2026-09-21");

    expect(result.created).toBe(1);
    expect(mockedPrisma.attendanceInactivityIncident.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ employeeId: SERENO_ID })],
        skipDuplicates: true,
      }),
    );
    // La fecha del incidente es el día de la obligación incumplida (21/09), no el día de detección (22/09).
    const createCall = mockedPrisma.attendanceInactivityIncident.createMany.mock.calls[0]![0];
    expect(createCall.data[0].operationalDate.toISOString().slice(0, 10)).toBe("2026-09-21");
  });

  it("B) control positivo — ingreso correcto 21/09 23:00 para la nueva obligación: NO genera falta de ingreso", async () => {
    mockedPrisma.attendancePunch.findMany.mockResolvedValue([
      { employeeId: SERENO_ID, timestamp: new Date("2026-09-21T02:00:00.000Z") }, // cola del turno anterior (20/09 23:00 ART)
      { employeeId: SERENO_ID, timestamp: new Date("2026-09-22T02:00:00.000Z") }, // ingreso real de la obligación 21/09 23:00 ART
    ]);

    const result = await checkMissingEntriesForElapsedDate("2026-09-21");

    expect(result.created).toBe(0);
    expect(mockedPrisma.attendanceInactivityIncident.createMany).not.toHaveBeenCalled();
  });

  it("C) ingreso tarde (21/09 23:25, tolerancia 10 min): el ingreso tardío igual cuenta como cumplimiento -- no queda una falta de ingreso pendiente", async () => {
    // 21/09 23:25 ART = 22/09 02:25 UTC.
    mockedPrisma.attendancePunch.findMany.mockResolvedValue([
      { employeeId: SERENO_ID, timestamp: new Date("2026-09-22T02:25:00.000Z") },
    ]);

    const result = await checkMissingEntriesForElapsedDate("2026-09-21");

    expect(result.created).toBe(0);
    expect(mockedPrisma.attendanceInactivityIncident.createMany).not.toHaveBeenCalled();
  });

  it("K) cross-midnight -- la evidencia de una obligación nunca se cuenta para la obligación del día siguiente ni del día anterior", async () => {
    // Evaluamos la obligación del 22/09 23:00 -- la única fichada real es la
    // del 20/09 23:00 (turno de dos noches antes) y la del 21/09 23:00 (turno
    // de la noche anterior): ninguna corresponde a la ocurrencia del 22/09.
    mockedPrisma.attendancePunch.findMany.mockResolvedValue([
      { employeeId: SERENO_ID, timestamp: new Date("2026-09-21T02:00:00.000Z") },
      { employeeId: SERENO_ID, timestamp: new Date("2026-09-22T02:00:00.000Z") },
    ]);

    const result = await checkMissingEntriesForElapsedDate("2026-09-22");

    expect(result.created).toBe(1);
  });

  it("D) el chequeo de HOY (checkMissingExpectedEntries) tiene el mismo problema resuelto para obligaciones del día en curso, no sólo para el catch-up de días pasados", async () => {
    // "Hoy" = 21/09; tolerancia del turno 23:00 vencida a las 23:11; la única
    // actividad visible es la cola del turno del 20/09 23:00 (madrugada del
    // 21/09) -- no puede ocultar la obligación de esta misma noche.
    mockedPrisma.attendancePunch.findMany.mockResolvedValue([
      { employeeId: SERENO_ID, timestamp: new Date("2026-09-21T02:00:00.000Z") },
    ]);

    // 21/09 23:11 ART = 22/09 02:11 UTC.
    const result = await checkMissingExpectedEntries(new Date("2026-09-22T02:11:00.000Z"));

    expect(result.due).toBe(1);
    expect(result.created).toBe(1);
  });
});
