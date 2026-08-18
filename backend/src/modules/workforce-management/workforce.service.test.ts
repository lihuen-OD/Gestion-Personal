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
    shiftTemplate: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    doubleHourRule: { create: vi.fn() },
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
  shiftTemplate: { create: Mock; findUnique: Mock; update: Mock };
  doubleHourRule: { create: Mock };
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
