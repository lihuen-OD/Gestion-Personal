import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { resolveWorkObligationCandidates } from "../shifts/workObligation.service";
import { detectAttendanceInactivity } from "./attendanceInactivity.service";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    employee: { findMany: vi.fn() },
    attendancePunch: { findMany: vi.fn() },
    workShift: { findMany: vi.fn() },
    timeEntry: { findMany: vi.fn() },
    novelty: { findMany: vi.fn() },
    attendanceInactivityIncident: { createMany: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// Etapa 15M.19B: el universo de candidatos ("¿obligación real de trabajar
// hoy?") ahora lo resuelve workObligation.service.ts, ya probado por su
// cuenta (workObligation.service.test.ts) — acá se mockea como una caja
// negra, igual que ya se mockeaba workforceService.holidayDatesInRange antes
// de esta etapa.
vi.mock("../shifts/workObligation.service", () => ({
  resolveWorkObligationCandidates: vi.fn(),
}));

const mockedPrisma = prisma as unknown as {
  employee: { findMany: Mock };
  attendancePunch: { findMany: Mock };
  workShift: { findMany: Mock };
  timeEntry: { findMany: Mock };
  novelty: { findMany: Mock };
  attendanceInactivityIncident: { createMany: Mock; findMany: Mock };
  user: { findMany: Mock };
  $transaction: Mock;
};
const mockedObligation = resolveWorkObligationCandidates as unknown as Mock;

const dateKey = "2026-08-27";
const operationalDate = new Date("2026-08-27T00:00:00.000Z");

function employeeRow(overrides: Partial<{ id: string; legajo: string; firstName: string; lastName: string }> = {}) {
  return { id: "employee-1", legajo: "100", firstName: "Juan", lastName: "Pérez", assignments: [], ...overrides };
}

function obligationCandidate(employeeId: string) {
  return { employeeId, template: { id: "t1", code: "T1", startTime: "08:00" }, scheduledStartAt: new Date("2026-08-27T11:00:00.000Z") };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [] });
  mockedPrisma.attendancePunch.findMany.mockResolvedValue([]);
  mockedPrisma.workShift.findMany.mockResolvedValue([]);
  mockedPrisma.timeEntry.findMany.mockResolvedValue([]);
  mockedPrisma.novelty.findMany.mockResolvedValue([]);
  mockedPrisma.employee.findMany.mockResolvedValue([]);
  mockedPrisma.attendanceInactivityIncident.createMany.mockResolvedValue({ count: 0 });
  mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([]);
  mockedPrisma.user.findMany.mockResolvedValue([]);
  const tx = { systemNotification: { createMany: vi.fn() }, attendanceInactivityIncident: { update: vi.fn() } };
  mockedPrisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
});

describe("detectAttendanceInactivity — Etapa 15M.19B (universo de candidatos por obligación real)", () => {
  it("sin candidatos con obligación real (workObligation devuelve vacío): no consulta nada más, no genera nada", async () => {
    mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [] });

    const result = await detectAttendanceInactivity(dateKey);

    expect(result).toEqual({ date: dateKey, detected: 0, notified: 0 });
    expect(mockedPrisma.attendancePunch.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.novelty.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.employee.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.attendanceInactivityIncident.createMany).not.toHaveBeenCalled();
  });

  it("candidato con obligación real y sin ninguna evidencia de actividad: genera el incidente", async () => {
    mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [obligationCandidate("employee-1")] });
    mockedPrisma.employee.findMany.mockResolvedValue([employeeRow()]);
    mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([{ id: "incident-1", employeeId: "employee-1", employee: employeeRow() }]);

    const result = await detectAttendanceInactivity(dateKey);

    expect(result.detected).toBe(1);
    expect(mockedPrisma.attendanceInactivityIncident.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ employeeId: "employee-1", operationalDate })], skipDuplicates: true }),
    );
  });

  it("candidato con fichada ese día: NO genera incidente (evidencia vía attendancePunch)", async () => {
    mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [obligationCandidate("employee-1")] });
    mockedPrisma.attendancePunch.findMany.mockResolvedValue([{ employeeId: "employee-1" }]);

    const result = await detectAttendanceInactivity(dateKey);

    expect(result).toEqual({ date: dateKey, detected: 0, notified: 0 });
    expect(mockedPrisma.employee.findMany).not.toHaveBeenCalled();
  });

  it("candidato con WorkShift ese día: NO genera incidente (evidencia vía workShift)", async () => {
    mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [obligationCandidate("employee-1")] });
    mockedPrisma.workShift.findMany.mockResolvedValue([{ employeeId: "employee-1" }]);

    const result = await detectAttendanceInactivity(dateKey);

    expect(result).toEqual({ date: dateKey, detected: 0, notified: 0 });
  });

  it("candidato con TimeEntry cargado ese día: NO genera incidente (evidencia vía timeEntry)", async () => {
    mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [obligationCandidate("employee-1")] });
    mockedPrisma.timeEntry.findMany.mockResolvedValue([{ employeeId: "employee-1" }]);

    const result = await detectAttendanceInactivity(dateKey);

    expect(result).toEqual({ date: dateKey, detected: 0, notified: 0 });
  });

  it("candidato con novedad vigente no rechazada: NO genera incidente", async () => {
    mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [obligationCandidate("employee-1")] });
    mockedPrisma.novelty.findMany.mockResolvedValue([
      { employeeId: "employee-1", fromDate: operationalDate, toDate: null, noveltyType: { allowsDateRange: true } },
    ]);

    const result = await detectAttendanceInactivity(dateKey);

    expect(result).toEqual({ date: dateKey, detected: 0, notified: 0 });
  });

  // Etapa 15M.19D §17: "verificar comportamiento definido realmente por el
  // sistema, no inventar una política nueva" -- la política vigente (sin
  // cambios desde antes de 15M.18) es que sólo RECHAZADO no exime: se
  // confirma que la propia query nunca puede traer una novedad RECHAZADA
  // como excluyente (Postgres real jamás la devolvería con este where).
  it("una novedad RECHAZADA nunca exime -- el where de la consulta de exclusión la descarta explícitamente", async () => {
    mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [obligationCandidate("employee-1")] });
    mockedPrisma.employee.findMany.mockResolvedValue([employeeRow()]);
    mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([{ id: "incident-1", employeeId: "employee-1", employee: employeeRow() }]);

    await detectAttendanceInactivity(dateKey);

    expect(mockedPrisma.novelty.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { not: "RECHAZADO" } }) }),
    );
  });

  it("dos candidatos, sólo uno con evidencia: el otro sí genera incidente", async () => {
    mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [obligationCandidate("employee-1"), obligationCandidate("employee-2")] });
    mockedPrisma.attendancePunch.findMany.mockResolvedValue([{ employeeId: "employee-1" }]);
    mockedPrisma.employee.findMany.mockResolvedValue([employeeRow({ id: "employee-2" })]);
    mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([{ id: "incident-2", employeeId: "employee-2", employee: employeeRow({ id: "employee-2" }) }]);

    await detectAttendanceInactivity(dateKey);

    expect(mockedPrisma.employee.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["employee-2"] } }) }));
  });

  it("las 3 consultas de evidencia + la de novedades se llaman una sola vez para toda la corrida, nunca por candidato (sin N+1)", async () => {
    mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [obligationCandidate("employee-1"), obligationCandidate("employee-2"), obligationCandidate("employee-3")] });
    mockedPrisma.employee.findMany.mockResolvedValue([employeeRow(), employeeRow({ id: "employee-2" }), employeeRow({ id: "employee-3" })]);

    await detectAttendanceInactivity(dateKey);

    expect(mockedObligation).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.attendancePunch.findMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.workShift.findMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.timeEntry.findMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.novelty.findMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.employee.findMany).toHaveBeenCalledTimes(1);
  });

  it("control anti-duplicado: createMany usa skipDuplicates y sólo se notifican incidentes con notifiedAt=null, acotado a los candidatos de esta corrida", async () => {
    mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [obligationCandidate("employee-1")] });
    mockedPrisma.employee.findMany.mockResolvedValue([employeeRow()]);
    mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([{ id: "incident-1", employeeId: "employee-1", employee: employeeRow() }]);

    await detectAttendanceInactivity(dateKey);

    expect(mockedPrisma.attendanceInactivityIncident.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    expect(mockedPrisma.attendanceInactivityIncident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { operationalDate, notifiedAt: null, employeeId: { in: ["employee-1"] } } }),
    );
  });

  it("no toca ninguna tabla de liquidación (el mock de Prisma sólo expone los modelos de asistencia/inactividad)", () => {
    expect(Object.keys(mockedPrisma).sort()).toEqual(
      ["$transaction", "attendanceInactivityIncident", "attendancePunch", "employee", "novelty", "timeEntry", "user", "workShift"].sort(),
    );
  });

  describe("feriados — Etapa 12E preservada tal cual (isHoliday viene de workObligation, no se reimplementa acá)", () => {
    it("isHoliday=true: mensaje de feriado convocado", async () => {
      mockedObligation.mockResolvedValue({ isHoliday: true, candidates: [obligationCandidate("employee-1")] });
      mockedPrisma.employee.findMany.mockResolvedValue([employeeRow()]);
      mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([{ id: "incident-1", employeeId: "employee-1", employee: employeeRow() }]);
      mockedPrisma.user.findMany.mockResolvedValue([{ id: "user-rrhh" }]);

      let capturedNotification: { message: string; title: string } | undefined;
      const tx = {
        systemNotification: { createMany: vi.fn((args: { data: Array<{ message: string; title: string }> }) => { capturedNotification = args.data[0]; }) },
        attendanceInactivityIncident: { update: vi.fn() },
      };
      mockedPrisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));

      await detectAttendanceInactivity(dateKey);

      expect(capturedNotification?.title).toBe("Sin actividad registrada");
      expect(capturedNotification?.message).toBe("Pérez, Juan · Legajo 100 estaba convocado a trabajar el feriado del 27/08/2026 y no registra actividad.");
      expect(capturedNotification?.message).not.toMatch(/HolidayWorkAssignment|DoubleHourRule|kind|enum|backend/i);
    });

    it("isHoliday=false: mensaje genérico de siempre (regresión)", async () => {
      mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [obligationCandidate("employee-1")] });
      mockedPrisma.employee.findMany.mockResolvedValue([employeeRow()]);
      mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([{ id: "incident-1", employeeId: "employee-1", employee: employeeRow() }]);
      mockedPrisma.user.findMany.mockResolvedValue([{ id: "user-rrhh" }]);

      let capturedNotification: { message: string } | undefined;
      const tx = {
        systemNotification: { createMany: vi.fn((args: { data: Array<{ message: string }> }) => { capturedNotification = args.data[0]; }) },
        attendanceInactivityIncident: { update: vi.fn() },
      };
      mockedPrisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));

      await detectAttendanceInactivity(dateKey);

      expect(capturedNotification?.message).toBe("Pérez, Juan · Legajo 100 no registra actividad para el 27/08/2026.");
    });
  });
});
