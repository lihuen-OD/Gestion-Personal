import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { workforceService } from "../workforce-management/workforce.service";
import { detectAttendanceInactivity } from "./attendanceInactivity.service";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    employee: { findMany: vi.fn() },
    holidayWorkAssignment: { findMany: vi.fn() },
    attendanceInactivityIncident: { createMany: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// Etapa 12E: nunca reimplementa el cálculo de calendario — se mockea sólo
// la función fina que este servicio consume (ya probada en
// workforce.service.test.ts/12B/12D).
vi.mock("../workforce-management/workforce.service", () => ({
  workforceService: { holidayDatesInRange: vi.fn() },
}));

const mockedPrisma = prisma as unknown as {
  employee: { findMany: Mock };
  holidayWorkAssignment: { findMany: Mock };
  attendanceInactivityIncident: { createMany: Mock; findMany: Mock };
  user: { findMany: Mock };
  $transaction: Mock;
};
const mockedHolidayDates = workforceService.holidayDatesInRange as unknown as Mock;

const dateKey = "2026-08-27";
const operationalDate = new Date("2026-08-27T00:00:00.000Z");

function employeeRow(overrides: Partial<{ id: string; legajo: string; firstName: string; lastName: string }> = {}) {
  return { id: "employee-1", legajo: "100", firstName: "Juan", lastName: "Pérez", assignments: [], ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedHolidayDates.mockResolvedValue([]);
  mockedPrisma.employee.findMany.mockResolvedValue([]);
  mockedPrisma.holidayWorkAssignment.findMany.mockResolvedValue([]);
  mockedPrisma.attendanceInactivityIncident.createMany.mockResolvedValue({ count: 0 });
  mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([]);
  mockedPrisma.user.findMany.mockResolvedValue([]);
  const tx = { systemNotification: { createMany: vi.fn() }, attendanceInactivityIncident: { update: vi.fn() } };
  mockedPrisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
});

describe("detectAttendanceInactivity — Etapa 12E (feriado + HolidayWorkAssignment)", () => {
  it("1 — feriado sin ningún convocado: no genera SIN_ACTIVIDAD_REGISTRADA (corta antes de evaluar empleados)", async () => {
    mockedHolidayDates.mockResolvedValue([{ date: dateKey, rules: [{ id: "rule-1", name: "Feriados" }] }]);
    mockedPrisma.holidayWorkAssignment.findMany.mockResolvedValue([]);

    const result = await detectAttendanceInactivity(dateKey);

    expect(result).toEqual({ date: dateKey, detected: 0, notified: 0 });
    expect(mockedPrisma.employee.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.attendanceInactivityIncident.createMany).not.toHaveBeenCalled();
  });

  it("2 — feriado con un convocado sin actividad: genera SIN_ACTIVIDAD_REGISTRADA", async () => {
    mockedHolidayDates.mockResolvedValue([{ date: dateKey, rules: [{ id: "rule-1", name: "Feriados" }] }]);
    mockedPrisma.holidayWorkAssignment.findMany.mockResolvedValue([{ employeeId: "employee-1" }]);
    mockedPrisma.employee.findMany.mockResolvedValue([employeeRow()]);
    mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([
      { id: "incident-1", employeeId: "employee-1", employee: employeeRow() },
    ]);

    const result = await detectAttendanceInactivity(dateKey);

    expect(result.detected).toBe(1);
    expect(mockedPrisma.attendanceInactivityIncident.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ employeeId: "employee-1", operationalDate })] }),
    );
  });

  it("3 — feriado: el where de candidatos exige convocatoria activa Y ausencia de fichadas (una fichada excluye, aunque esté convocado)", async () => {
    mockedHolidayDates.mockResolvedValue([{ date: dateKey, rules: [{ id: "rule-1", name: "Feriados" }] }]);
    mockedPrisma.holidayWorkAssignment.findMany.mockResolvedValue([{ employeeId: "employee-1" }]);
    mockedPrisma.employee.findMany.mockResolvedValue([]);

    await detectAttendanceInactivity(dateKey);

    const where = mockedPrisma.employee.findMany.mock.calls[0]![0].where;
    expect(where.id).toEqual({ in: ["employee-1"] });
    expect(where.attendancePunches).toEqual({ none: expect.any(Object) });
  });

  it("4 — feriado: el where de candidatos también exige ausencia de TimeEntry (horas cargadas manualmente excluyen)", async () => {
    mockedHolidayDates.mockResolvedValue([{ date: dateKey, rules: [{ id: "rule-1", name: "Feriados" }] }]);
    mockedPrisma.holidayWorkAssignment.findMany.mockResolvedValue([{ employeeId: "employee-1" }]);
    mockedPrisma.employee.findMany.mockResolvedValue([]);

    await detectAttendanceInactivity(dateKey);

    const where = mockedPrisma.employee.findMany.mock.calls[0]![0].where;
    expect(where.timeEntries).toEqual({ none: expect.any(Object) });
  });

  it("5 — feriado: el where de candidatos mantiene la misma exclusión de novedades ya vigente antes de esta etapa", async () => {
    mockedHolidayDates.mockResolvedValue([{ date: dateKey, rules: [{ id: "rule-1", name: "Feriados" }] }]);
    mockedPrisma.holidayWorkAssignment.findMany.mockResolvedValue([{ employeeId: "employee-1" }]);
    mockedPrisma.employee.findMany.mockResolvedValue([]);

    await detectAttendanceInactivity(dateKey);

    const where = mockedPrisma.employee.findMany.mock.calls[0]![0].where;
    expect(where.novelties).toEqual({
      none: {
        status: { not: "RECHAZADO" },
        fromDate: { lte: operationalDate },
        OR: [
          { toDate: { gte: operationalDate } },
          { toDate: null, noveltyType: { allowsDateTo: true } },
          { toDate: null, noveltyType: { allowsDateTo: false }, fromDate: operationalDate },
        ],
      },
    });
  });

  it("6 — asignación CANCELADA se trata como no convocado: la query de asignaciones sólo pide ACTIVA, y sin ninguna activa no notifica", async () => {
    mockedHolidayDates.mockResolvedValue([{ date: dateKey, rules: [{ id: "rule-1", name: "Feriados" }] }]);
    // El mock simula lo que Postgres ya filtró (status: "ACTIVA") — una
    // convocatoria CANCELADA para este empleado nunca aparece acá.
    mockedPrisma.holidayWorkAssignment.findMany.mockResolvedValue([]);

    const result = await detectAttendanceInactivity(dateKey);

    expect(mockedPrisma.holidayWorkAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { date: operationalDate, status: "ACTIVA" } }),
    );
    expect(result).toEqual({ date: dateKey, detected: 0, notified: 0 });
  });

  it("7 — día normal (no feriado): mantiene el comportamiento anterior, sin filtro de convocatoria en el where", async () => {
    mockedHolidayDates.mockResolvedValue([]);
    mockedPrisma.employee.findMany.mockResolvedValue([]);

    await detectAttendanceInactivity(dateKey);

    const where = mockedPrisma.employee.findMany.mock.calls[0]![0].where;
    expect(where.id).toBeUndefined();
    expect(mockedPrisma.holidayWorkAssignment.findMany).not.toHaveBeenCalled();
  });

  it("8 — una regla llamada 'Feriados' pero kind OTRO no activa la lógica de feriado (holidayDatesInRange ya la excluyó)", async () => {
    // holidayDatesInRange (12B/12D) ya filtra por kind=FERIADO — una regla
    // OTRO, sin importar su nombre, nunca aparece en su respuesta. Este
    // servicio confía en ese resultado sin volver a mirar ningún nombre.
    mockedHolidayDates.mockResolvedValue([]);
    mockedPrisma.employee.findMany.mockResolvedValue([employeeRow()]);

    await detectAttendanceInactivity(dateKey);

    const where = mockedPrisma.employee.findMany.mock.calls[0]![0].where;
    expect(where.id).toBeUndefined();
    expect(mockedPrisma.holidayWorkAssignment.findMany).not.toHaveBeenCalled();
  });

  it("9 — una regla llamada 'Pedro' pero kind FERIADO sí activa la lógica de feriado", async () => {
    mockedHolidayDates.mockResolvedValue([{ date: dateKey, rules: [{ id: "rule-1", name: "Pedro" }] }]);
    mockedPrisma.holidayWorkAssignment.findMany.mockResolvedValue([{ employeeId: "employee-1" }]);
    mockedPrisma.employee.findMany.mockResolvedValue([]);

    await detectAttendanceInactivity(dateKey);

    const where = mockedPrisma.employee.findMany.mock.calls[0]![0].where;
    expect(where.id).toEqual({ in: ["employee-1"] });
  });

  it("10 — sin N+1: holidayDatesInRange y holidayWorkAssignment.findMany se llaman una sola vez para toda la corrida, nunca por empleado", async () => {
    mockedHolidayDates.mockResolvedValue([{ date: dateKey, rules: [{ id: "rule-1", name: "Feriados" }] }]);
    mockedPrisma.holidayWorkAssignment.findMany.mockResolvedValue([{ employeeId: "employee-1" }, { employeeId: "employee-2" }, { employeeId: "employee-3" }]);
    mockedPrisma.employee.findMany.mockResolvedValue([employeeRow(), employeeRow({ id: "employee-2" }), employeeRow({ id: "employee-3" })]);
    mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([
      { id: "incident-1", employeeId: "employee-1", employee: employeeRow() },
      { id: "incident-2", employeeId: "employee-2", employee: employeeRow({ id: "employee-2" }) },
      { id: "incident-3", employeeId: "employee-3", employee: employeeRow({ id: "employee-3" }) },
    ]);

    await detectAttendanceInactivity(dateKey);

    expect(mockedHolidayDates).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.holidayWorkAssignment.findMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.employee.findMany).toHaveBeenCalledTimes(1);
  });

  it("11 — no toca ninguna tabla de liquidación (el mock de Prisma sólo expone employee/holidayWorkAssignment/attendanceInactivityIncident/user)", () => {
    expect(Object.keys(mockedPrisma).sort()).toEqual(["$transaction", "attendanceInactivityIncident", "employee", "holidayWorkAssignment", "user"]);
  });

  it("12 — no crea fichadas ni TimeEntry (ningún mock de escritura de attendancePunch/timeEntry existe; si el servicio intentara tocarlos, fallaría en vez de pasar en silencio)", async () => {
    mockedHolidayDates.mockResolvedValue([{ date: dateKey, rules: [{ id: "rule-1", name: "Feriados" }] }]);
    mockedPrisma.holidayWorkAssignment.findMany.mockResolvedValue([{ employeeId: "employee-1" }]);
    mockedPrisma.employee.findMany.mockResolvedValue([employeeRow()]);

    await expect(detectAttendanceInactivity(dateKey)).resolves.toBeDefined();
  });

  it("13 — control anti-duplicado: createMany usa skipDuplicates y sólo se notifican incidentes con notifiedAt=null", async () => {
    mockedHolidayDates.mockResolvedValue([]);
    mockedPrisma.employee.findMany.mockResolvedValue([employeeRow()]);
    mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([{ id: "incident-1", employeeId: "employee-1", employee: employeeRow() }]);

    await detectAttendanceInactivity(dateKey);

    expect(mockedPrisma.attendanceInactivityIncident.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    expect(mockedPrisma.attendanceInactivityIncident.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { operationalDate, notifiedAt: null } }));
  });

  it("14 — el mensaje de un feriado asignado indica la convocatoria, sin lenguaje técnico", async () => {
    mockedHolidayDates.mockResolvedValue([{ date: dateKey, rules: [{ id: "rule-1", name: "Feriados" }] }]);
    mockedPrisma.holidayWorkAssignment.findMany.mockResolvedValue([{ employeeId: "employee-1" }]);
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
    expect(capturedNotification?.message).toBe("Pérez, Juan · Legajo 100 estaba convocado a trabajar el feriado del 2026-08-27 y no registra actividad.");
    expect(capturedNotification?.message).not.toMatch(/HolidayWorkAssignment|DoubleHourRule|kind|enum|backend/i);
  });

  it("día normal sin feriado sigue generando el mensaje genérico de siempre (regresión)", async () => {
    mockedHolidayDates.mockResolvedValue([]);
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

    expect(capturedNotification?.message).toBe("Pérez, Juan · Legajo 100 no registra actividad para el 2026-08-27.");
  });
});
