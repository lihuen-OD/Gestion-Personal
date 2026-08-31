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
    employee: { count: vi.fn(), findMany: vi.fn() },
    timeEntry: { groupBy: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    monthlyTimeClosure: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    timeCorrectionRequest: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), create: vi.fn() },
    shiftTemplate: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    doubleHourRule: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
    systemNotification: { findMany: vi.fn(), count: vi.fn() },
    shiftAlert: { findMany: vi.fn() },
    workShift: { findMany: vi.fn() },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
  },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

const mockedPrisma = prisma as unknown as {
  employee: { count: Mock; findMany: Mock };
  timeEntry: { groupBy: Mock; findFirst: Mock; update: Mock };
  monthlyTimeClosure: { findMany: Mock; findUnique: Mock; update: Mock; updateMany: Mock; upsert: Mock };
  timeCorrectionRequest: { findUnique: Mock; findUniqueOrThrow: Mock; update: Mock; create: Mock };
  shiftTemplate: { create: Mock; findUnique: Mock; update: Mock; delete: Mock };
  doubleHourRule: { create: Mock; findUnique: Mock; findMany: Mock; update: Mock; delete: Mock };
  systemNotification: { findMany: Mock; count: Mock };
  shiftAlert: { findMany: Mock };
  workShift: { findMany: Mock };
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

  it("Etapa 8C — una regla cuya vigencia ya comenzó se inactiva en vez de borrarse (preserva la trazabilidad de SpecialHourRuleApplication ya generada)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    mockedPrisma.doubleHourRule.findUnique.mockResolvedValue({
      id: "rule-1",
      name: "Domingo",
      fromDate: new Date("2026-01-01T00:00:00.000Z"),
      employees: [],
    });
    mockedPrisma.doubleHourRule.update.mockResolvedValue({ id: "rule-1", name: "Domingo", status: "INACTIVO" });

    try {
      await expect(workforceService.removeDoubleRule("rule-1")).resolves.toMatchObject({ mode: "INACTIVATED" });
      expect(mockedPrisma.doubleHourRule.delete).not.toHaveBeenCalled();
      expect(mockedPrisma.doubleHourRule.update).toHaveBeenCalledWith({ where: { id: "rule-1" }, data: { status: "INACTIVO" }, include: { employees: true } });
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

  it("Etapa 8B (test 1) — crea una Hora Especial general (sin empresa/sector/centro de costo/puesto/empleados)", async () => {
    mockedPrisma.doubleHourRule.create.mockResolvedValue({ id: "rule-1", name: "Domingo" });

    await workforceService.createDoubleRule({ name: "Domingo", recurrenceType: "SEMANAL", weekdays: [0], employeeIds: [] }, user);

    expect(mockedPrisma.doubleHourRule.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ employees: { create: [] } }) }),
    );
    const createdData = mockedPrisma.doubleHourRule.create.mock.calls[0]![0].data;
    expect(createdData.companyId).toBeUndefined();
    expect(createdData.sectorId).toBeUndefined();
  });

  it("Etapa 8B (test 2) — crea una Hora Especial con empresa pero sin empleados", async () => {
    mockedPrisma.doubleHourRule.create.mockResolvedValue({ id: "rule-2", name: "Domingo Odwyer" });

    await workforceService.createDoubleRule({ name: "Domingo Odwyer", recurrenceType: "SEMANAL", weekdays: [0], companyId: "company-odwyer", employeeIds: [] }, user);

    expect(mockedPrisma.doubleHourRule.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: "company-odwyer", employees: { create: [] } }) }),
    );
  });

  it("Etapa 8B (test 3) — crea una Hora Especial con empresa + sector pero sin empleados", async () => {
    mockedPrisma.doubleHourRule.create.mockResolvedValue({ id: "rule-3", name: "Domingo Pañol" });

    await workforceService.createDoubleRule({ name: "Domingo Pañol", recurrenceType: "SEMANAL", weekdays: [0], companyId: "company-odwyer", sectorId: "sector-panol", employeeIds: [] }, user);

    expect(mockedPrisma.doubleHourRule.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: "company-odwyer", sectorId: "sector-panol", employees: { create: [] } }) }),
    );
  });

  it("Etapa 8B (test 4) — crea una Hora Especial con empleados específicos (comportamiento preexistente, sigue igual)", async () => {
    mockedPrisma.doubleHourRule.create.mockResolvedValue({ id: "rule-4", name: "Domingo Pañol" });

    await workforceService.createDoubleRule({ name: "Domingo Pañol", recurrenceType: "SEMANAL", weekdays: [0], employeeIds: ["juan", "pedro", "carlos"] }, user);

    expect(mockedPrisma.doubleHourRule.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ employees: { create: [{ employeeId: "juan" }, { employeeId: "pedro" }, { employeeId: "carlos" }] } }) }),
    );
  });

  it("Etapa 8B — crea una Hora Especial de fechas específicas (FECHA) con varias fechas cargadas (feriados)", async () => {
    mockedPrisma.doubleHourRule.create.mockResolvedValue({ id: "rule-5", name: "Feriados 2026" });
    const navidad = new Date("2026-12-25");
    const anioNuevo = new Date("2027-01-01");

    await workforceService.createDoubleRule({ name: "Feriados 2026", recurrenceType: "FECHA", employeeIds: [], dates: [{ date: navidad, isActive: true }, { date: anioNuevo, isActive: true }] }, user);

    expect(mockedPrisma.doubleHourRule.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ dates: { create: [{ date: navidad, isActive: true }, { date: anioNuevo, isActive: true }] } }) }),
    );
    // fromDate/toDate se derivan server-side como min/max de las fechas cargadas,
    // nunca se confía en lo que mande el cliente para una regla FECHA.
    expect(mockedPrisma.doubleHourRule.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fromDate: navidad, toDate: anioNuevo }) }),
    );
  });

  it("Etapa 12B — crea una regla con kind FERIADO", async () => {
    mockedPrisma.doubleHourRule.create.mockResolvedValue({ id: "rule-feriado", name: "Feriado", kind: "FERIADO" });

    await workforceService.createDoubleRule({ name: "Feriado", recurrenceType: "SEMANAL", weekdays: [0], employeeIds: [], kind: "FERIADO" }, user);

    expect(mockedPrisma.doubleHourRule.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "FERIADO" }) }));
  });

  it("Etapa 12B — crea una regla con kind DOMINGO", async () => {
    mockedPrisma.doubleHourRule.create.mockResolvedValue({ id: "rule-domingo", name: "Domingo", kind: "DOMINGO" });

    await workforceService.createDoubleRule({ name: "Domingo", recurrenceType: "SEMANAL", weekdays: [0], employeeIds: [], kind: "DOMINGO" }, user);

    expect(mockedPrisma.doubleHourRule.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "DOMINGO" }) }));
  });

  it("Etapa 12B — crea una regla con kind JORNADA_ESPECIAL", async () => {
    mockedPrisma.doubleHourRule.create.mockResolvedValue({ id: "rule-jornada", name: "Jornada especial", kind: "JORNADA_ESPECIAL" });

    await workforceService.createDoubleRule({ name: "Jornada especial", recurrenceType: "RANGO", employeeIds: [], kind: "JORNADA_ESPECIAL" }, user);

    expect(mockedPrisma.doubleHourRule.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "JORNADA_ESPECIAL" }) }));
  });

  it("Etapa 12B — crea una regla con kind OTRO (explícito)", async () => {
    mockedPrisma.doubleHourRule.create.mockResolvedValue({ id: "rule-otro", name: "Pedro", kind: "OTRO" });

    await workforceService.createDoubleRule({ name: "Pedro", recurrenceType: "SEMANAL", weekdays: [0], employeeIds: [], kind: "OTRO" }, user);

    expect(mockedPrisma.doubleHourRule.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "OTRO" }) }));
  });

  it("Etapa 12B — updateDoubleRule reclasifica el kind de una regla existente sin tocar el resto", async () => {
    mockedPrisma.doubleHourRule.findUnique.mockResolvedValue({ id: "rule-domingo", name: "Domingo", kind: "OTRO", employees: [], dates: [] });
    mockedPrisma.doubleHourRule.update.mockResolvedValue({ id: "rule-domingo", name: "Domingo", kind: "DOMINGO" });

    await workforceService.updateDoubleRule("rule-domingo", { kind: "DOMINGO" });

    expect(mockedPrisma.doubleHourRule.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "DOMINGO" }) }));
  });

  it("Etapa 12B — calendarPreview sin kind mantiene el comportamiento anterior (sin filtro adicional en el where)", async () => {
    mockedPrisma.doubleHourRule.findMany.mockResolvedValue([]);

    await workforceService.calendarPreview(new Date("2026-08-01"), new Date("2026-08-02"));

    const where = mockedPrisma.doubleHourRule.findMany.mock.calls[0]![0].where;
    expect(where.kind).toBeUndefined();
  });

  it("Etapa 12B — calendarPreview con kind pasa el filtro exacto al where de Prisma", async () => {
    mockedPrisma.doubleHourRule.findMany.mockResolvedValue([]);

    await workforceService.calendarPreview(new Date("2026-08-01"), new Date("2026-08-02"), "FERIADO");

    const where = mockedPrisma.doubleHourRule.findMany.mock.calls[0]![0].where;
    expect(where.kind).toBe("FERIADO");
  });

  it("Etapa 12B — calendarPreview con kind=FERIADO sólo devuelve reglas clasificadas como feriado: una regla 'Pedro' con kind FERIADO aparece, una 'Feriados' con kind OTRO no", async () => {
    const day = new Date("2026-08-16T00:00:00.000Z");
    const pedroFeriado = { id: "pedro", name: "Pedro", recurrenceType: "FECHA" as const, fromDate: day, toDate: day, weekdays: [], priority: 0, multiplier: 2, kind: "FERIADO" as const, companyId: null, sectorId: null, costCenterId: null, positionId: null, employees: [], dates: [{ date: day, isActive: true }] };
    const feriadosOtro = { id: "feriados-otro", name: "Feriados", recurrenceType: "FECHA" as const, fromDate: day, toDate: day, weekdays: [], priority: 0, multiplier: 2, kind: "OTRO" as const, companyId: null, sectorId: null, costCenterId: null, positionId: null, employees: [], dates: [{ date: day, isActive: true }] };
    // El mock simula lo que Postgres devolvería ya filtrado por `where.kind` —
    // el objetivo de este test es la construcción de la query + el pass-through
    // de `kind` en la respuesta, no la ejecución real del filtro SQL.
    mockedPrisma.doubleHourRule.findMany.mockImplementation((args: { where?: { kind?: string } }) =>
      Promise.resolve(args?.where?.kind ? [pedroFeriado, feriadosOtro].filter((r) => r.kind === args.where!.kind) : [pedroFeriado, feriadosOtro]),
    );

    const filtered = await workforceService.calendarPreview(day, day, "FERIADO");
    expect(filtered).toEqual([{ date: "2026-08-16", rules: [expect.objectContaining({ id: "pedro", name: "Pedro", kind: "FERIADO" })], hasOverlap: false, hasConflict: false }]);

    const unfiltered = await workforceService.calendarPreview(day, day);
    expect(unfiltered[0]!.rules.map((r) => r.id).sort()).toEqual(["feriados-otro", "pedro"]);
  });

  it("Etapa 12B — calendarPreview con kind=FERIADO no incluye reglas clasificadas como DOMINGO", async () => {
    const day = new Date("2026-08-16T00:00:00.000Z");
    const domingo = { id: "domingo", name: "Domingo", recurrenceType: "SEMANAL" as const, fromDate: new Date("2026-01-01"), toDate: null, weekdays: [0], priority: 0, multiplier: 2, kind: "DOMINGO" as const, companyId: null, sectorId: null, costCenterId: null, positionId: null, employees: [], dates: [] };
    mockedPrisma.doubleHourRule.findMany.mockImplementation((args: { where?: { kind?: string } }) =>
      Promise.resolve(args?.where?.kind ? [] : [domingo]),
    );

    const filtered = await workforceService.calendarPreview(day, day, "FERIADO");
    expect(filtered).toEqual([]);

    const unfiltered = await workforceService.calendarPreview(day, day);
    expect(unfiltered).toEqual([{ date: "2026-08-16", rules: [expect.objectContaining({ id: "domingo", kind: "DOMINGO" })], hasOverlap: false, hasConflict: false }]);
  });

  it("Etapa 12D — holidayDatesInRange reutiliza calendarPreview(kind=FERIADO), sin duplicar el cálculo de calendario", async () => {
    mockedPrisma.doubleHourRule.findMany.mockResolvedValue([]);

    await workforceService.holidayDatesInRange(new Date("2026-08-01"), new Date("2026-08-31"));

    const where = mockedPrisma.doubleHourRule.findMany.mock.calls[0]![0].where;
    expect(where.kind).toBe("FERIADO");
  });

  it("Etapa 12D — holidayDatesInRange devuelve una forma angosta: sólo date y rules[{id,name}], sin multiplier/priority/hasOverlap/hasConflict", async () => {
    const day = new Date("2026-08-16T00:00:00.000Z");
    const pedroFeriado = { id: "pedro", name: "Pedro", recurrenceType: "FECHA" as const, fromDate: day, toDate: day, weekdays: [], priority: 3, multiplier: 2, kind: "FERIADO" as const, companyId: null, sectorId: null, costCenterId: null, positionId: null, employees: [], dates: [{ date: day, isActive: true }] };
    mockedPrisma.doubleHourRule.findMany.mockResolvedValue([pedroFeriado]);

    const result = await workforceService.holidayDatesInRange(day, day);

    expect(result).toEqual([{ date: "2026-08-16", rules: [{ id: "pedro", name: "Pedro" }] }]);
  });

  it("Etapa 12D — una regla 'Pedro' clasificada FERIADO aparece en holidayDatesInRange; una 'Feriados' clasificada OTRO no", async () => {
    const day = new Date("2026-08-16T00:00:00.000Z");
    const pedroFeriado = { id: "pedro", name: "Pedro", recurrenceType: "FECHA" as const, fromDate: day, toDate: day, weekdays: [], priority: 0, multiplier: 2, kind: "FERIADO" as const, companyId: null, sectorId: null, costCenterId: null, positionId: null, employees: [], dates: [{ date: day, isActive: true }] };
    const feriadosOtro = { id: "feriados-otro", name: "Feriados", recurrenceType: "FECHA" as const, fromDate: day, toDate: day, weekdays: [], priority: 0, multiplier: 2, kind: "OTRO" as const, companyId: null, sectorId: null, costCenterId: null, positionId: null, employees: [], dates: [{ date: day, isActive: true }] };
    mockedPrisma.doubleHourRule.findMany.mockImplementation((args: { where?: { kind?: string } }) =>
      Promise.resolve([pedroFeriado, feriadosOtro].filter((r) => r.kind === args?.where?.kind)),
    );

    const result = await workforceService.holidayDatesInRange(day, day);

    expect(result).toEqual([{ date: "2026-08-16", rules: [{ id: "pedro", name: "Pedro" }] }]);
  });

  it("Etapa 12D — una regla clasificada DOMINGO no aparece en holidayDatesInRange", async () => {
    const day = new Date("2026-08-16T00:00:00.000Z");
    const domingo = { id: "domingo", name: "Domingo", recurrenceType: "SEMANAL" as const, fromDate: new Date("2026-01-01"), toDate: null, weekdays: [0], priority: 0, multiplier: 2, kind: "DOMINGO" as const, companyId: null, sectorId: null, costCenterId: null, positionId: null, employees: [], dates: [] };
    mockedPrisma.doubleHourRule.findMany.mockImplementation((args: { where?: { kind?: string } }) =>
      Promise.resolve(args?.where?.kind === "DOMINGO" ? [] : args?.where?.kind ? [] : [domingo]),
    );

    const result = await workforceService.holidayDatesInRange(day, day);

    expect(result).toEqual([]);
  });

  it("Etapa 8B — calendarPreview marca hasOverlap cuando dos reglas con alcances no excluyentes matchean el mismo día", async () => {
    const sunday = new Date("2026-08-16T00:00:00.000Z");
    mockedPrisma.doubleHourRule.findMany.mockResolvedValue([
      { id: "domingo", name: "Domingo", recurrenceType: "SEMANAL", fromDate: new Date("2026-01-01"), toDate: null, weekdays: [0], priority: 1, multiplier: 2, companyId: null, sectorId: null, costCenterId: null, positionId: null, employees: [], dates: [] },
      { id: "feriado", name: "Feriado", recurrenceType: "FECHA", fromDate: new Date("2026-08-16"), toDate: null, weekdays: [], priority: 1, multiplier: 2, companyId: null, sectorId: null, costCenterId: null, positionId: null, employees: [], dates: [{ date: sunday, isActive: true }] },
    ]);

    const days = await workforceService.calendarPreview(sunday, sunday);

    expect(days).toEqual([{ date: "2026-08-16", rules: expect.arrayContaining([expect.objectContaining({ id: "domingo" }), expect.objectContaining({ id: "feriado" })]), hasOverlap: true, hasConflict: true }]);
  });

  it("Etapa 8B — calendarPreview NO marca overlap cuando los alcances configurados son mutuamente excluyentes (empresas distintas)", async () => {
    const sunday = new Date("2026-08-16T00:00:00.000Z");
    mockedPrisma.doubleHourRule.findMany.mockResolvedValue([
      { id: "domingo-odwyer", name: "Domingo Odwyer", recurrenceType: "SEMANAL", fromDate: new Date("2026-01-01"), toDate: null, weekdays: [0], priority: 1, multiplier: 2, companyId: "odwyer", sectorId: null, costCenterId: null, positionId: null, employees: [], dates: [] },
      { id: "domingo-tropa", name: "Domingo Tropa", recurrenceType: "SEMANAL", fromDate: new Date("2026-01-01"), toDate: null, weekdays: [0], priority: 1, multiplier: 1, companyId: "tropa", sectorId: null, costCenterId: null, positionId: null, employees: [], dates: [] },
    ]);

    const days = await workforceService.calendarPreview(sunday, sunday);

    expect(days[0]).toMatchObject({ hasOverlap: false, hasConflict: false });
  });

  it("Etapa 8B — calendarPreview no incluye días sin ninguna regla matcheando (payload chico)", async () => {
    mockedPrisma.doubleHourRule.findMany.mockResolvedValue([
      { id: "domingo", name: "Domingo", recurrenceType: "SEMANAL", fromDate: new Date("2026-01-01"), toDate: null, weekdays: [0], priority: 1, multiplier: 2, companyId: null, sectorId: null, costCenterId: null, positionId: null, employees: [], dates: [] },
    ]);

    const days = await workforceService.calendarPreview(new Date("2026-08-17"), new Date("2026-08-18")); // lunes y martes, ninguno domingo

    expect(days).toEqual([]);
  });

  it("Etapa 8B (corrección) — calendarPreview muestra CADA fecha de una regla 'Feriado' con varias fechas, no sólo la primera", async () => {
    const anioNuevo = new Date("2026-01-01");
    const nueveDeJulio = new Date("2026-07-09");
    const navidad = new Date("2026-12-25");
    mockedPrisma.doubleHourRule.findMany.mockResolvedValue([
      { id: "feriado", name: "Feriado", recurrenceType: "FECHA", fromDate: anioNuevo, toDate: navidad, weekdays: [], priority: 1, multiplier: 2, companyId: null, sectorId: null, costCenterId: null, positionId: null, employees: [], dates: [{ date: anioNuevo, isActive: true }, { date: nueveDeJulio, isActive: true }, { date: navidad, isActive: true }] },
    ]);

    const days = await workforceService.calendarPreview(anioNuevo, navidad);

    expect(days.map((day) => day.date)).toEqual(["2026-01-01", "2026-07-09", "2026-12-25"]);
    expect(days.every((day) => day.rules[0]!.id === "feriado")).toBe(true);
  });

  it("Etapa 8B (corrección) — updateDoubleRule reemplaza el set completo de fechas de una regla FECHA existente (agregar + quitar en la misma operación)", async () => {
    mockedPrisma.doubleHourRule.findUnique.mockResolvedValue({
      id: "rule-feriado",
      name: "Feriado",
      recurrenceType: "FECHA",
      employees: [],
      dates: [{ id: "date-1", date: new Date("2026-12-25"), isActive: true }],
    });
    mockedPrisma.doubleHourRule.update.mockResolvedValue({ id: "rule-feriado", name: "Feriado" });
    const anioNuevo = new Date("2027-01-01");
    const nueveDeJulio = new Date("2026-07-09");

    await workforceService.updateDoubleRule("rule-feriado", { dates: [{ date: anioNuevo, isActive: true }, { date: nueveDeJulio, isActive: false }] });

    expect(mockedPrisma.doubleHourRule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dates: { deleteMany: {}, create: [{ date: anioNuevo, isActive: true }, { date: nueveDeJulio, isActive: false }] },
        }),
      }),
    );
  });
});

describe("workforceService.notifications — Etapa 9I (paginación real, antes fetch-all take:200)", () => {
  it("filtra siempre por el usuario autenticado (recipientUserId)", async () => {
    mockedPrisma.$transaction.mockResolvedValue([[], 0]);

    await workforceService.notifications({ page: 1, take: 20 }, user);

    expect(mockedPrisma.systemNotification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { recipientUserId: "user-1" } }),
    );
    expect(mockedPrisma.systemNotification.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { recipientUserId: "user-1" } }),
    );
  });

  it("nunca mezcla notificaciones de otro usuario — supervisor y RH piden con su propio id", async () => {
    mockedPrisma.$transaction.mockResolvedValue([[], 0]);

    await workforceService.notifications({ page: 1, take: 20 }, supervisor);

    expect(mockedPrisma.systemNotification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { recipientUserId: "user-2" } }),
    );
  });

  it("ordena por fecha descendente", async () => {
    mockedPrisma.$transaction.mockResolvedValue([[], 0]);

    await workforceService.notifications({ page: 1, take: 20 }, user);

    expect(mockedPrisma.systemNotification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } }),
    );
  });

  it("respeta page/take — page 3 con take 10 pide skip:20 take:10", async () => {
    mockedPrisma.$transaction.mockResolvedValue([[], 0]);

    await workforceService.notifications({ page: 3, take: 10 }, user);

    expect(mockedPrisma.systemNotification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
  });

  it("sin filtro de status no agrega status al where (todas)", async () => {
    mockedPrisma.$transaction.mockResolvedValue([[], 0]);

    await workforceService.notifications({ page: 1, take: 20 }, user);

    expect(mockedPrisma.systemNotification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { recipientUserId: "user-1" } }),
    );
  });

  it("filtro status=NO_LEIDA se traduce a where.status server-side", async () => {
    mockedPrisma.$transaction.mockResolvedValue([[], 0]);

    await workforceService.notifications({ page: 1, take: 20, status: "NO_LEIDA" }, user);

    expect(mockedPrisma.systemNotification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { recipientUserId: "user-1", status: "NO_LEIDA" } }),
    );
    expect(mockedPrisma.systemNotification.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { recipientUserId: "user-1", status: "NO_LEIDA" } }),
    );
  });

  it("devuelve meta correcta (total/page/pageSize/hasMore) cuando hay más páginas", async () => {
    const rows = [{ id: "n-1", entityType: null, entityId: null }];
    mockedPrisma.$transaction.mockResolvedValue([rows, 45]);

    const result = await workforceService.notifications({ page: 2, take: 20 }, user);

    expect(result.meta).toEqual({ total: 45, page: 2, pageSize: 20, hasMore: true });
  });

  it("hasMore es false en la última página", async () => {
    const rows = [{ id: "n-1", entityType: null, entityId: null }];
    mockedPrisma.$transaction.mockResolvedValue([rows, 21]);

    const result = await workforceService.notifications({ page: 2, take: 20 }, user);

    expect(result.meta).toEqual({ total: 21, page: 2, pageSize: 20, hasMore: false });
  });

  it("sin resultados: items vacío y meta válida (no rompe con 0 notificaciones)", async () => {
    mockedPrisma.$transaction.mockResolvedValue([[], 0]);

    const result = await workforceService.notifications({ page: 1, take: 20 }, user);

    expect(result).toEqual({ items: [], meta: { total: 0, page: 1, pageSize: 20, hasMore: false } });
  });

  it("enriquece con el legajo del empleado sólo para las notificaciones de la página actual (no re-consulta las 200 de antes)", async () => {
    const rows = [{ id: "n-1", entityType: "ShiftAlert", entityId: "alert-1" }];
    mockedPrisma.$transaction.mockResolvedValue([rows, 1]);
    mockedPrisma.shiftAlert.findMany.mockResolvedValue([{ id: "alert-1", employee: { id: "emp-1", legajo: "100", firstName: "Ana", lastName: "Gomez" } }]);

    const result = await workforceService.notifications({ page: 1, take: 20 }, user);

    expect(mockedPrisma.shiftAlert.findMany).toHaveBeenCalledWith({ where: { id: { in: ["alert-1"] } }, select: { id: true, employee: { select: { id: true, legajo: true, firstName: true, lastName: true } } } });
    expect(result.items[0]).toMatchObject({ id: "n-1", employee: { id: "emp-1", legajo: "100" } });
  });

  it("no dispara ninguna query de enriquecimiento cuando ninguna notificación de la página tiene entityId", async () => {
    const rows = [{ id: "n-1", entityType: null, entityId: null }];
    mockedPrisma.$transaction.mockResolvedValue([rows, 1]);

    await workforceService.notifications({ page: 1, take: 20 }, user);

    expect(mockedPrisma.shiftAlert.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.workShift.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.employee.findMany).not.toHaveBeenCalled();
  });
});
