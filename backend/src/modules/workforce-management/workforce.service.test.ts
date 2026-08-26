import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { prisma } from "../../shared/prisma/client";
import { auditService } from "../audit/audit.service";
import { workforceService } from "./workforce.service";
import { roles } from "../../shared/security/roles";

/**
 * Trazabilidad de autoria (2026-08-18): cierra el hueco de auditoria en el
 * flujo de cierres/correcciones (antes ninguna de estas 6 funciones llamaba
 * a auditService.register) y confirma que las nuevas FK sobre ShiftTemplate/
 * DoubleHourRule mapean un userId inexistente a un error prolijo.
 */
vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    employee: { count: vi.fn() },
    timeEntry: { groupBy: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    monthlyTimeClosure: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    timeCorrectionRequest: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), create: vi.fn() },
    shiftTemplate: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    doubleHourRule: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
  },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

const mockedPrisma = prisma as unknown as {
  employee: { count: Mock };
  timeEntry: { groupBy: Mock; findFirst: Mock; update: Mock };
  monthlyTimeClosure: { findMany: Mock; findUnique: Mock; update: Mock; updateMany: Mock; upsert: Mock };
  timeCorrectionRequest: { findUnique: Mock; findUniqueOrThrow: Mock; update: Mock; create: Mock };
  shiftTemplate: { create: Mock; findUnique: Mock; update: Mock; delete: Mock };
  doubleHourRule: { create: Mock; findUnique: Mock; update: Mock; delete: Mock };
  $transaction: Mock;
};

function prismaKnownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("mock prisma error", { code, clientVersion: "0.0.0" });
}

const user = { id: "user-1", role: roles.rrhh } as unknown as Express.AuthUser;
const supervisor = { id: "user-2", role: roles.supervision } as unknown as Express.AuthUser;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("workforceService — auditoria en correcciones/cierres (hueco cerrado)", () => {
  it("submitClosures registra un AuditLog por cada cierre enviado", async () => {
    mockedPrisma.employee.count.mockResolvedValue(1);
    mockedPrisma.timeEntry.groupBy.mockResolvedValue([]);
    mockedPrisma.$transaction.mockResolvedValue([{ id: "closure-1", employeeId: "emp-1" }]);

    await workforceService.submitClosures("2026-08", ["emp-1"], supervisor);

    expect(auditService.register).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE", entity: "MonthlyTimeClosure", entityId: "closure-1" }));
  });

  it("submitClosures snapshotea sólo Horas normales (systemRole NORMAL_BASE), no conceptos adicionales (Etapa 6M)", async () => {
    mockedPrisma.employee.count.mockResolvedValue(1);
    mockedPrisma.timeEntry.groupBy.mockResolvedValue([]);
    mockedPrisma.$transaction.mockResolvedValue([{ id: "closure-1", employeeId: "emp-1" }]);

    await workforceService.submitClosures("2026-08", ["emp-1"], supervisor);

    expect(mockedPrisma.timeEntry.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ hourConcept: { systemRole: "NORMAL_BASE" } }),
      }),
    );
  });

  it("Etapa 8F — el snapshot del cierre guarda exactamente el _sum.hours devuelto por Prisma, sin multiplicarlo de nuevo (hours ya es real desde 8F)", async () => {
    mockedPrisma.employee.count.mockResolvedValue(1);
    mockedPrisma.timeEntry.groupBy.mockResolvedValue([{ employeeId: "emp-1", status: "APROBADO", _sum: { hours: 8 }, _count: 3 }]);
    mockedPrisma.monthlyTimeClosure.upsert.mockResolvedValue({ id: "closure-1", employeeId: "emp-1" });
    mockedPrisma.$transaction.mockImplementation((operations: unknown[]) => Promise.all(operations));

    await workforceService.submitClosures("2026-08", ["emp-1"], supervisor);

    expect(mockedPrisma.monthlyTimeClosure.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          snapshot: expect.objectContaining({ entries: [{ status: "APROBADO", hours: 8, records: 3 }] }),
        }),
      }),
    );
  });

  it("approveClosures registra un AuditLog por cada cierre aprobado", async () => {
    mockedPrisma.monthlyTimeClosure.findMany.mockResolvedValue([{ id: "closure-1", employeeId: "emp-1", period: "2026-08" }]);
    mockedPrisma.monthlyTimeClosure.updateMany.mockResolvedValue({ count: 1 });

    await workforceService.approveClosures(["closure-1"], "ok", user);

    expect(auditService.register).toHaveBeenCalledWith(expect.objectContaining({ action: "APPROVE", entity: "MonthlyTimeClosure", entityId: "closure-1" }));
  });

  it("returnClosure registra un AuditLog", async () => {
    mockedPrisma.monthlyTimeClosure.findUnique.mockResolvedValue({ id: "closure-1", employeeId: "emp-1", period: "2026-08" });
    mockedPrisma.monthlyTimeClosure.update.mockResolvedValue({ id: "closure-1", employeeId: "emp-1", period: "2026-08", status: "DEVUELTO" });

    await workforceService.returnClosure("closure-1", "falta revisar horas extra", user);

    expect(auditService.register).toHaveBeenCalledWith(expect.objectContaining({ action: "RETURN", entity: "MonthlyTimeClosure", entityId: "closure-1" }));
  });

  it("createCorrection registra un AuditLog", async () => {
    mockedPrisma.timeEntry.findFirst.mockResolvedValue({ id: "entry-1", employeeId: "emp-1", period: "2026-08", hours: 8 });
    mockedPrisma.monthlyTimeClosure.findUnique.mockResolvedValue({ id: "closure-1", status: "APROBADO" });
    mockedPrisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback({
      timeCorrectionRequest: { create: vi.fn().mockResolvedValue({ id: "correction-1" }) },
      monthlyTimeClosure: { update: vi.fn().mockResolvedValue({}) },
    }));

    await workforceService.createCorrection({ timeEntryId: "entry-1", proposedHours: 9, reason: "olvido de fichada" }, user);

    expect(auditService.register).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE", entity: "TimeCorrectionRequest", entityId: "correction-1" }));
  });

  it("approveCorrection registra un AuditLog y sigue escribiendo TimeEntry.approvedByUserId", async () => {
    const request = { id: "correction-1", status: "PENDIENTE", timeEntryId: "entry-1", closureId: null, employeeId: "emp-1", previousHours: 8, proposedHours: 9 };
    const txTimeEntryUpdate = vi.fn().mockResolvedValue({});
    mockedPrisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback({
      timeCorrectionRequest: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(request),
        update: vi.fn().mockResolvedValue({ ...request, status: "APROBADA" }),
      },
      timeEntry: { update: txTimeEntryUpdate },
      monthlyTimeClosure: { update: vi.fn() },
    }));

    await workforceService.approveCorrection("correction-1", user);

    expect(txTimeEntryUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ approvedByUserId: "user-1" }) }));
    expect(auditService.register).toHaveBeenCalledWith(expect.objectContaining({ action: "APPROVE", entity: "TimeCorrectionRequest", entityId: "correction-1" }));
  });

  it("rejectCorrection registra un AuditLog", async () => {
    mockedPrisma.timeCorrectionRequest.findUnique.mockResolvedValue({ id: "correction-1", employeeId: "emp-1" });
    mockedPrisma.timeCorrectionRequest.update.mockResolvedValue({ id: "correction-1", status: "RECHAZADA" });

    await workforceService.rejectCorrection("correction-1", "no corresponde", user);

    expect(auditService.register).toHaveBeenCalledWith(expect.objectContaining({ action: "REJECT", entity: "TimeCorrectionRequest", entityId: "correction-1" }));
  });
});

describe("workforceService — FK reales sobre ShiftTemplate/DoubleHourRule", () => {
  it("createShiftTemplate mapea un userId inexistente (P2003) a un 400 prolijo", async () => {
    mockedPrisma.shiftTemplate.create.mockRejectedValue(prismaKnownError("P2003"));

    await expect(workforceService.createShiftTemplate({ code: "T-1", name: "Turno", startTime: "08:00", endTime: "16:00" })).rejects.toMatchObject({
      statusCode: 400,
      code: "RELATION_CONSTRAINT",
    });
  });

  it("createShiftTemplate funciona igual que antes con un userId real", async () => {
    mockedPrisma.shiftTemplate.create.mockResolvedValue({ id: "template-1", code: "T-1", name: "Turno" });

    const item = await workforceService.createShiftTemplate({ code: "T-1", name: "Turno", startTime: "08:00", endTime: "16:00" }, { userId: "user-1" });

    expect(item.id).toBe("template-1");
    expect(auditService.register).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE", entity: "ShiftTemplate" }));
  });

  it("no permite borrar un turno con asignaciones aunque no tenga jornadas", async () => {
    mockedPrisma.shiftTemplate.findUnique.mockResolvedValue({
      id: "template-1",
      code: "T-1",
      name: "Turno",
      _count: { workShifts: 0, assignments: 1 },
    });

    await expect(workforceService.removeShiftTemplate("template-1")).rejects.toMatchObject({
      statusCode: 409,
      code: "SHIFT_TEMPLATE_HAS_ASSIGNMENTS",
      message: "No se puede eliminar el turno porque tiene asignaciones de empleados asociadas",
    });
    expect(mockedPrisma.shiftTemplate.delete).not.toHaveBeenCalled();
  });

  it("inactiva un turno con jornadas históricas y no lo borra", async () => {
    mockedPrisma.shiftTemplate.findUnique.mockResolvedValue({
      id: "template-1",
      code: "T-1",
      name: "Turno",
      _count: { workShifts: 2, assignments: 0 },
    });
    mockedPrisma.shiftTemplate.update.mockResolvedValue({ id: "template-1", code: "T-1", status: "INACTIVO" });

    await expect(workforceService.removeShiftTemplate("template-1")).resolves.toMatchObject({ mode: "INACTIVATED", relatedWorkShifts: 2 });
    expect(mockedPrisma.shiftTemplate.delete).not.toHaveBeenCalled();
  });

  it("borra un turno sin asignaciones ni jornadas", async () => {
    mockedPrisma.shiftTemplate.findUnique.mockResolvedValue({
      id: "template-1",
      code: "T-1",
      name: "Turno",
      _count: { workShifts: 0, assignments: 0 },
    });
    mockedPrisma.shiftTemplate.delete.mockResolvedValue({ id: "template-1" });

    await expect(workforceService.removeShiftTemplate("template-1")).resolves.toEqual({ mode: "DELETED", id: "template-1", relatedWorkShifts: 0 });
    expect(mockedPrisma.shiftTemplate.delete).toHaveBeenCalledWith({ where: { id: "template-1" } });
  });

  it("considera futura una regla del día UTC siguiente mientras en Argentina todavía es el día anterior", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T01:30:00.000Z")); // 14/08 22:30 en Argentina
    mockedPrisma.doubleHourRule.findUnique.mockResolvedValue({
      id: "rule-1",
      name: "Regla futura",
      fromDate: new Date("2026-08-15T00:00:00.000Z"),
      employees: [],
    });
    mockedPrisma.doubleHourRule.delete.mockResolvedValue({ id: "rule-1" });

    try {
      await expect(workforceService.removeDoubleRule("rule-1")).resolves.toEqual({ mode: "DELETED", id: "rule-1" });
      expect(mockedPrisma.doubleHourRule.update).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("createDoubleRule mapea un userId inexistente (P2003) a un 400 prolijo", async () => {
    mockedPrisma.doubleHourRule.create.mockRejectedValue(prismaKnownError("P2003"));

    await expect(workforceService.createDoubleRule({ name: "Regla", employeeIds: [] }, user)).rejects.toMatchObject({
      statusCode: 400,
      code: "RELATION_CONSTRAINT",
    });
  });

  it("no transforma otros errores no relacionados a FK", async () => {
    mockedPrisma.doubleHourRule.create.mockRejectedValue(prismaKnownError("P2025"));

    let caught: unknown;
    try {
      await workforceService.createDoubleRule({ name: "Regla", employeeIds: [] }, user);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(caught).not.toBeInstanceOf(AppError);
  });
});
