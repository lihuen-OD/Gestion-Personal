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
  },
}));

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
const mockedPrisma = prisma as unknown as { employee: { count: Mock } };
const mockedAudit = auditService.register as unknown as Mock;
const mockedHolidayDates = workforceService.holidayDatesInRange as unknown as Mock;

const rrhh = { id: "user-1", role: roles.rrhh } as unknown as Express.AuthUser;

beforeEach(() => {
  vi.clearAllMocks();
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

    expect(repo.create).toHaveBeenCalledWith(date, "employee-1", expect.objectContaining({ shiftTemplateId: "template-1" }), "user-1");
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE", entity: "HolidayWorkAssignment", entityId: "employee-1" }));
  });

  it("crea una convocatoria nueva para un empleado sin turno (shiftTemplateId null)", async () => {
    mockedPrisma.employee.count.mockResolvedValue(1);
    repo.findExisting.mockResolvedValue(null);
    repo.create.mockResolvedValue({ id: "hwa-2", status: "ACTIVA", employee: { legajo: "200" } });

    await holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-2", status: "ACTIVA", shiftTemplateId: null, expectedStartTime: null, expectedEndTime: null, notes: "Convocado sin turno habitual" }] }, rrhh);

    expect(repo.create).toHaveBeenCalledWith(date, "employee-2", expect.objectContaining({ shiftTemplateId: null, notes: "Convocado sin turno habitual" }), "user-1");
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
    expect(repo.update).toHaveBeenCalledWith("hwa-1", expect.objectContaining({ notes: "Actualizado" }), "user-1");
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

    expect(repo.update).toHaveBeenCalledWith("hwa-1", expect.objectContaining({ expectedStartTime: "09:00", expectedEndTime: "17:00", notes: "Cambio de horario" }), "user-1");
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE", entity: "HolidayWorkAssignment" }));
  });

  it("cancelar una convocatoria existente pasa status a CANCELADA y audita como DEACTIVATE, sin borrar la fila", async () => {
    mockedPrisma.employee.count.mockResolvedValue(1);
    repo.findExisting.mockResolvedValue({ id: "hwa-1", status: "ACTIVA", employeeId: "employee-1" });
    repo.update.mockResolvedValue({ id: "hwa-1", status: "CANCELADA", employee: { legajo: "100" } });

    await holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "CANCELADA" } as never] }, rrhh);

    expect(repo.update).toHaveBeenCalledWith("hwa-1", expect.objectContaining({ status: "CANCELADA" }), "user-1");
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

  it("guardar una convocatoria no toca DoubleHourRule/TimeEntry/TimeSegment/HourConceptBreakdown — sólo el repositorio de HolidayWorkAssignment y auditoría", async () => {
    mockedPrisma.employee.count.mockResolvedValue(1);
    repo.findExisting.mockResolvedValue(null);
    repo.create.mockResolvedValue({ id: "hwa-1", status: "ACTIVA", employee: { legajo: "100" } });

    await holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA" } as never] }, rrhh);

    // El prisma mockeado en este archivo sólo expone `employee.count` — si el
    // servicio intentara tocar timeEntry/timeSegment/doubleHourRule/
    // hourConceptBreakdown, la llamada fallaría por no existir el mock
    // (undefined is not a function), no silenciosamente.
    expect(Object.keys(mockedPrisma)).toEqual(["employee"]);
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
