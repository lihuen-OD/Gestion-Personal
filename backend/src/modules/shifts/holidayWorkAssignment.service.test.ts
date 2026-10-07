import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { prisma } from "../../shared/prisma/client";
import { auditService } from "../audit/audit.service";
import { workforceService } from "../workforce-management/workforce.service";
import { roles } from "../../shared/security/roles";
import { holidayWorkAssignmentRepository } from "./holidayWorkAssignment.repository";
import { holidayWorkAssignmentService } from "./holidayWorkAssignment.service";
import { reinterpretSpecialHoursOnDates } from "../workforce-management/specialHourReinterpretation";
import { auditClosureRecalculations } from "../workforce-management/closureRecalculationAudit";

vi.mock("./holidayWorkAssignment.repository", () => ({
  holidayWorkAssignmentRepository: {
    findCandidates: vi.fn(),
    findByDate: vi.fn(),
    findExisting: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    employee: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// §16: la convocatoria define quién cobra el FERIADO; el guardado delega la
// reinterpretación en el motor central (cubierto en specialHourReinterpretation.test.ts).
vi.mock("../workforce-management/specialHourReinterpretation", () => ({ reinterpretSpecialHoursOnDates: vi.fn() }));
vi.mock("../workforce-management/closureRecalculationAudit", () => ({ auditClosureRecalculations: vi.fn() }));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

// Etapa 12D: nunca duplica el cálculo de calendario — se mockea sólo la
// función fina que el service consume, no calendarPreview/DoubleHourRule
// (eso ya está cubierto en workforce.service.test.ts).
vi.mock("../workforce-management/workforce.service", () => ({
  workforceService: { holidayDatesInRange: vi.fn() },
}));

const repo = holidayWorkAssignmentRepository as unknown as { findCandidates: Mock; findByDate: Mock; findExisting: Mock; create: Mock; update: Mock };
const mockedPrisma = prisma as unknown as { employee: { count: Mock }; $transaction: Mock };
const TX = { holidayWorkAssignment: {} };
const noChanges = { timeEntries: 0, breakdowns: 0, segments: 0, employees: 0, periods: [], rebuiltClosures: [], protectedPeriods: [], changes: { timeEntries: [], breakdowns: [], segments: [] } };
const mockedAudit = auditService.register as unknown as Mock;
const mockedHolidayDates = workforceService.holidayDatesInRange as unknown as Mock;

const rrhh = { id: "user-1", role: roles.rrhh } as unknown as Express.AuthUser;

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(TX));
  vi.mocked(reinterpretSpecialHoursOnDates).mockResolvedValue(noChanges as never);
});

describe("holidayWorkAssignmentService.holidayDates — Etapa 12D", () => {
  it("delega en workforceService.holidayDatesInRange, no reimplementa el cálculo de calendario", async () => {
    mockedHolidayDates.mockResolvedValue([{ date: "2026-08-27", rules: [{ id: "r1", name: "Feriados" }] }]);

    const result = await holidayWorkAssignmentService.holidayDates(new Date("2026-08-01"), new Date("2026-08-31"));

    expect(mockedHolidayDates).toHaveBeenCalledWith(new Date("2026-08-01"), new Date("2026-08-31"));
    expect(result).toEqual([{ date: "2026-08-27", rules: [{ id: "r1", name: "Feriados" }] }]);
  });
});

describe("holidayWorkAssignmentService.save — Etapa 12D", () => {
  const date = new Date("2026-08-27");

  it("crea una convocatoria nueva para un empleado con turno", async () => {
    mockedPrisma.employee.count.mockResolvedValue(1);
    repo.findExisting.mockResolvedValue(null);
    repo.create.mockResolvedValue({ id: "hwa-1", status: "ACTIVA", employee: { legajo: "100" } });

    await holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA", shiftTemplateId: "template-1", expectedStartTime: "08:00", expectedEndTime: "16:00", notes: null }] }, rrhh);

    expect(repo.create).toHaveBeenCalledWith(date, "employee-1", expect.objectContaining({ shiftTemplateId: "template-1" }), "user-1", TX);
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE", entity: "HolidayWorkAssignment", entityId: "employee-1" }));
  });

  it("crea una convocatoria nueva para un empleado sin turno (shiftTemplateId null)", async () => {
    mockedPrisma.employee.count.mockResolvedValue(1);
    repo.findExisting.mockResolvedValue(null);
    repo.create.mockResolvedValue({ id: "hwa-2", status: "ACTIVA", employee: { legajo: "200" } });

    await holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-2", status: "ACTIVA", shiftTemplateId: null, expectedStartTime: null, expectedEndTime: null, notes: "Convocado sin turno habitual" }] }, rrhh);

    expect(repo.create).toHaveBeenCalledWith(date, "employee-2", expect.objectContaining({ shiftTemplateId: null, notes: "Convocado sin turno habitual" }), "user-1", TX);
  });

  it("no permite duplicar el mismo employeeId dentro del mismo guardado", async () => {
    mockedPrisma.employee.count.mockResolvedValue(1);

    const attempt = holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA" } as never, { employeeId: "employee-1", status: "ACTIVA" } as never] }, rrhh);

    await expect(attempt).rejects.toBeInstanceOf(AppError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("si ya existe una convocatoria activa para (date, employeeId), reactivar/actualizar pasa por update, nunca crea una segunda fila", async () => {
    mockedPrisma.employee.count.mockResolvedValue(1);
    repo.findExisting.mockResolvedValue({ id: "hwa-1", status: "ACTIVA", employeeId: "employee-1" });
    repo.update.mockResolvedValue({ id: "hwa-1", status: "ACTIVA", employee: { legajo: "100" } });

    await holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA", notes: "Actualizado" } as never] }, rrhh);

    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith("hwa-1", expect.objectContaining({ notes: "Actualizado" }), "user-1", TX);
  });

  it("una race real contra la base (P2002 en create) se traduce en un AppError 409 prolijo, no un 500", async () => {
    mockedPrisma.employee.count.mockResolvedValue(1);
    repo.findExisting.mockResolvedValue(null);
    repo.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("unique violation", { code: "P2002", clientVersion: "0.0.0" }));

    const attempt = holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA" } as never] }, rrhh);

    await expect(attempt).rejects.toMatchObject({ statusCode: 409, code: "HOLIDAY_WORK_ASSIGNMENT_ALREADY_EXISTS" });
  });

  it("actualizar una convocatoria existente cambia horario esperado y notas", async () => {
    mockedPrisma.employee.count.mockResolvedValue(1);
    repo.findExisting.mockResolvedValue({ id: "hwa-1", status: "ACTIVA", employeeId: "employee-1" });
    repo.update.mockResolvedValue({ id: "hwa-1", status: "ACTIVA", employee: { legajo: "100" } });

    await holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA", expectedStartTime: "09:00", expectedEndTime: "17:00", notes: "Cambio de horario" } as never] }, rrhh);

    expect(repo.update).toHaveBeenCalledWith("hwa-1", expect.objectContaining({ expectedStartTime: "09:00", expectedEndTime: "17:00", notes: "Cambio de horario" }), "user-1", TX);
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE", entity: "HolidayWorkAssignment" }));
  });

  it("cancelar una convocatoria existente pasa status a CANCELADA y audita como DEACTIVATE, sin borrar la fila", async () => {
    mockedPrisma.employee.count.mockResolvedValue(1);
    repo.findExisting.mockResolvedValue({ id: "hwa-1", status: "ACTIVA", employeeId: "employee-1" });
    repo.update.mockResolvedValue({ id: "hwa-1", status: "CANCELADA", employee: { legajo: "100" } });

    await holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "CANCELADA" } as never] }, rrhh);

    expect(repo.update).toHaveBeenCalledWith("hwa-1", expect.objectContaining({ status: "CANCELADA" }), "user-1", TX);
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "DEACTIVATE", entity: "HolidayWorkAssignment" }));
  });

  it("reactivar una convocatoria CANCELADA audita como ACTIVATE", async () => {
    mockedPrisma.employee.count.mockResolvedValue(1);
    repo.findExisting.mockResolvedValue({ id: "hwa-1", status: "CANCELADA", employeeId: "employee-1" });
    repo.update.mockResolvedValue({ id: "hwa-1", status: "ACTIVA", employee: { legajo: "100" } });

    await holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA" } as never] }, rrhh);

    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "ACTIVATE", entity: "HolidayWorkAssignment" }));
  });

  it("un item CANCELADA para una convocatoria que nunca existió es un no-op — no crea una fila cancelada vacía", async () => {
    mockedPrisma.employee.count.mockResolvedValue(1);
    repo.findExisting.mockResolvedValue(null);

    const result = await holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "CANCELADA" } as never] }, rrhh);

    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("rechaza si algún employeeId no existe", async () => {
    mockedPrisma.employee.count.mockResolvedValue(0);

    const attempt = holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-inexistente", status: "ACTIVA" } as never] }, rrhh);

    await expect(attempt).rejects.toBeInstanceOf(AppError);
  });

  // §16 (reemplaza "no toca liquidación" de 12D): guardar la convocatoria y
  // reinterpretar las horas de la fecha ocurren en la MISMA transacción, con
  // el motor central — el servicio no escribe horas por su cuenta.
  it("guarda la convocatoria y reinterpreta las horas de la fecha en la misma transacción", async () => {
    mockedPrisma.employee.count.mockResolvedValue(1);
    repo.findExisting.mockResolvedValue(null);
    repo.create.mockResolvedValue({ id: "hwa-1", status: "ACTIVA", employee: { legajo: "100" } });

    await holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA" } as never] }, rrhh);

    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000 });
    expect(repo.findExisting).toHaveBeenCalledWith(date, "employee-1", TX);
    expect(repo.create).toHaveBeenCalledWith(date, "employee-1", expect.any(Object), "user-1", TX);
    expect(reinterpretSpecialHoursOnDates).toHaveBeenCalledWith(TX, [date], { reason: "HOLIDAY_WORK_ASSIGNMENT_CHANGED", date: date.toISOString().slice(0, 10) });
  });

  it("si cambió la equivalencia, audita el recálculo en lenguaje humano y los cierres recalculados", async () => {
    mockedPrisma.employee.count.mockResolvedValue(1);
    repo.findExisting.mockResolvedValue(null);
    repo.create.mockResolvedValue({ id: "hwa-1", status: "ACTIVA", employee: { legajo: "31" } });
    const rebuiltClosures = [{ id: "closure-1", employeeId: "employee-1", period: "2026-10", before: {}, after: {} }];
    vi.mocked(reinterpretSpecialHoursOnDates).mockResolvedValueOnce({ ...noChanges, timeEntries: 1, breakdowns: 1, employees: 1, periods: ["2026-10"], rebuiltClosures } as never);

    await holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA" } as never] }, rrhh, { userId: "user-1" });

    const descriptions = mockedAudit.mock.calls.map(([input]) => input.description);
    expect(descriptions).toEqual([
      `Se convocó a 31 a trabajar el feriado del ${date.toISOString().slice(8, 10)}/${date.toISOString().slice(5, 7)}/${date.toISOString().slice(0, 4)}.`,
      `Convocatoria del feriado del ${date.toISOString().slice(8, 10)}/${date.toISOString().slice(5, 7)}/${date.toISOString().slice(0, 4)}: Se recalcularon 2 carga(s) de 1 legajo(s) y 1 cierre(s) mensual(es).`,
    ]);
    expect(auditClosureRecalculations).toHaveBeenCalledWith(rebuiltClosures, expect.stringContaining("cambio de la convocatoria del feriado"), { userId: "user-1" }, expect.any(Function));
  });

  it("si la reinterpretación falla, nada se audita (la transacción no confirmó la convocatoria)", async () => {
    mockedPrisma.employee.count.mockResolvedValue(1);
    repo.findExisting.mockResolvedValue(null);
    repo.create.mockResolvedValue({ id: "hwa-1", status: "ACTIVA", employee: { legajo: "100" } });
    vi.mocked(reinterpretSpecialHoursOnDates).mockRejectedValueOnce(new Error("boom"));

    await expect(holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA" } as never] }, rrhh)).rejects.toThrow("boom");
    expect(mockedAudit).not.toHaveBeenCalled();
  });

  it("guardar una convocatoria no dispara ninguna notificación — sólo registra auditoría", async () => {
    mockedPrisma.employee.count.mockResolvedValue(1);
    repo.findExisting.mockResolvedValue(null);
    repo.create.mockResolvedValue({ id: "hwa-1", status: "ACTIVA", employee: { legajo: "100" } });

    await holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA" } as never] }, rrhh);

    // auditService es el único mock de efectos secundarios en este archivo —
    // ninguna llamada a systemNotification/notifyUsers/notifyRrhh es posible
    // sin importarlas, y el service no las importa (ver holidayWorkAssignment.service.ts).
    expect(mockedAudit).toHaveBeenCalledTimes(1);
  });
});

describe("holidayWorkAssignmentService.candidates/listByDate — permisos y scope (Etapa 12D)", () => {
  it("candidates aplica employeeAccessWhere del usuario autenticado", async () => {
    repo.findCandidates.mockResolvedValue([[], 0]);

    await holidayWorkAssignmentService.candidates({ page: 1, take: 100 }, rrhh);

    expect(repo.findCandidates).toHaveBeenCalledWith({ page: 1, take: 100 }, {});
  });

  it("listByDate aplica employeeAccessWhere del usuario autenticado", async () => {
    repo.findByDate.mockResolvedValue([]);
    const date = new Date("2026-08-27");

    await holidayWorkAssignmentService.listByDate(date, rrhh);

    expect(repo.findByDate).toHaveBeenCalledWith(date, {});
  });
});
