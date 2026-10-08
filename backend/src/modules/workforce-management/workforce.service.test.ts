import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { prisma } from "../../shared/prisma/client";
import { auditService } from "../audit/audit.service";
import { workforceService } from "./workforce.service";
import { reinterpretSpecialHours } from "./specialHourReinterpretation";
import { roles } from "../../shared/security/roles";
import { NOTIFICATION_ORDER_BY, parseNotificationCursor } from "./notificationListing";
import type { ListNotificationsQuery } from "./workforce.schemas";

/**
 * Trazabilidad de autoria (2026-08-18): cierra el hueco de auditoria en el
 * flujo de cierres/correcciones (antes ninguna de estas 6 funciones llamaba
 * a auditService.register) y confirma que las nuevas FK sobre ShiftTemplate/
 * DoubleHourRule mapean un userId inexistente a un error prolijo.
 */
vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    employee: { count: vi.fn(), findMany: vi.fn() },
    timeEntry: { groupBy: vi.fn(), findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    hourConceptBreakdown: { findMany: vi.fn().mockResolvedValue([]) },
    monthlyTimeClosure: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    timeCorrectionRequest: { findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), create: vi.fn() },
    shiftTemplate: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    doubleHourRule: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
    sector: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    company: { findMany: vi.fn().mockResolvedValue([]) },
    position: { findMany: vi.fn().mockResolvedValue([]) },
    specialHourRuleApplication: { deleteMany: vi.fn() },
    systemNotification: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
    shiftAlert: { findMany: vi.fn() },
    workShift: { findMany: vi.fn() },
    // Etapa 15G.2 (docs/decisions/ALERT_TO_NOVELTY_FLOW_15G2.md): enriquecimiento
    // de notificaciones "no asistió" (entityType AttendanceInactivityIncident)
    // con el mismo patrón ya usado para ShiftAlert/WorkShift/Employee.
    attendanceInactivityIncident: { findMany: vi.fn() },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    // D-5: advisory locks del closurePeriodGuard dentro de las transacciones.
    $executeRaw: vi.fn().mockResolvedValue(0),
    $transaction: vi.fn(),
  },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

// La reinterpretación de la historia tiene su propio test
// (specialHourReinterpretation.test.ts); acá sólo importa que el CRUD de
// reglas la invoque dentro de la misma transacción.
vi.mock("./specialHourReinterpretation", () => ({
  reinterpretSpecialHours: vi.fn().mockResolvedValue({ timeEntries: 0, breakdowns: 0, segments: 0, employees: 0, periods: [], rebuiltClosures: [], protectedPeriods: [] }),
}));

// Fila completa de DoubleHourRule (las columnas son NOT NULL en schema.prisma).
function ruleRow(overrides: Record<string, unknown>) {
  return {
    recurrenceType: "SEMANAL", fromDate: new Date("2026-01-01T00:00:00.000Z"), toDate: null, weekdays: [0], dates: [],
    multiplier: 2, kind: "OTRO", status: "ACTIVO", employees: [],
    ...overrides,
  };
}

const mockedPrisma = prisma as unknown as {
  employee: { count: Mock; findMany: Mock };
  timeEntry: { groupBy: Mock; findFirst: Mock; findMany: Mock; update: Mock };
  hourConceptBreakdown: { findMany: Mock };
  monthlyTimeClosure: { findMany: Mock; findUnique: Mock; update: Mock; updateMany: Mock; upsert: Mock };
  timeCorrectionRequest: { findMany: Mock; findUnique: Mock; findUniqueOrThrow: Mock; update: Mock; create: Mock };
  shiftTemplate: { create: Mock; findUnique: Mock; update: Mock; delete: Mock };
  doubleHourRule: { create: Mock; findUnique: Mock; findMany: Mock; update: Mock; delete: Mock };
  sector: { findUnique: Mock; findMany: Mock };
  company: { findMany: Mock };
  position: { findMany: Mock };
  specialHourRuleApplication: { deleteMany: Mock };
  systemNotification: { findMany: Mock; count: Mock; findFirst: Mock };
  shiftAlert: { findMany: Mock };
  workShift: { findMany: Mock };
  attendanceInactivityIncident: { findMany: Mock };
  $executeRaw: Mock;
  $transaction: Mock;
};

function prismaKnownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("mock prisma error", { code, clientVersion: "0.0.0" });
}

const user = { id: "user-1", role: roles.rrhh } as unknown as Express.AuthUser;
const supervisor = { id: "user-2", role: roles.supervision } as unknown as Express.AuthUser;

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.employee.findMany.mockResolvedValue([]);
  // Forma interactiva (callback con tx) o array, como Prisma.
  mockedPrisma.$transaction.mockImplementation((arg: unknown) => (typeof arg === "function" ? (arg as (tx: unknown) => unknown)(mockedPrisma) : Promise.all(arg as unknown[])));
});

describe("workforceService — auditoria en correcciones/cierres (hueco cerrado)", () => {
  it("submitClosures registra un AuditLog por cada cierre enviado", async () => {
    mockedPrisma.employee.count.mockResolvedValue(1);
    mockedPrisma.timeEntry.groupBy.mockResolvedValue([]);
    mockedPrisma.monthlyTimeClosure.upsert.mockResolvedValue({ id: "closure-1", employeeId: "emp-1" });

    await workforceService.submitClosures("2026-08", ["emp-1"], supervisor);

    expect(auditService.register).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE", entity: "MonthlyTimeClosure", entityId: "closure-1" }));
  });

  // docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md: el snapshot congela la
  // composición real (base, Horas normales residuales, dentro de la
  // jornada, adicionales, total trabajado y equivalencia) con el mismo
  // modelo y criterio de estado que la grilla por legajo.
  it("submitClosures congela la contabilidad del período: base 8 + Sereno 3 + Colectivo 1 en domingo x2 → real 9, equivalencia 18", async () => {
    mockedPrisma.employee.count.mockResolvedValue(1);
    mockedPrisma.timeEntry.groupBy.mockResolvedValue([{ employeeId: "emp-1", status: "APROBADO", _sum: { hours: 8 }, _count: 1 }]);
    mockedPrisma.timeEntry.findMany.mockResolvedValue([{ employeeId: "emp-1", day: 2, hours: 8, appliedMultiplier: 2 }]);
    mockedPrisma.hourConceptBreakdown.findMany.mockResolvedValue([
      { employeeId: "emp-1", day: 2, hourConceptId: "sereno", minutes: 180, appliedMultiplier: 2, startAt: null, endAt: null, hourConcept: { workTreatment: "WITHIN_BASE", code: "HOR-001", name: "Sereno" } },
      { employeeId: "emp-1", day: 2, hourConceptId: "colectivo", minutes: 60, appliedMultiplier: 2, startAt: null, endAt: null, hourConcept: { workTreatment: "ADDITIVE_TO_WORKED_TOTAL", code: "HOR-002", name: "Colectivo" } },
    ]);
    mockedPrisma.monthlyTimeClosure.upsert.mockResolvedValue({ id: "closure-1", employeeId: "emp-1" });

    await workforceService.submitClosures("2026-08", ["emp-1"], supervisor);

    expect(mockedPrisma.timeEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ["APROBADO", "EN_REVISION"] }, hourConcept: { systemRole: "NORMAL_BASE" } }),
    }));
    expect(mockedPrisma.hourConceptBreakdown.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { not: "RECHAZADO" } }),
    }));
    const snapshot = mockedPrisma.monthlyTimeClosure.upsert.mock.calls[0]![0].create.snapshot;
    expect(snapshot.accounting).toMatchObject({
      model: "WORKED_TIME_ACCOUNTING_V1",
      baseMinutes: 480,
      normalResidualMinutes: 300,
      withinBaseMinutes: 180,
      additiveMinutes: 60,
      totalWorkedMinutes: 540,
      settlement: { normalMinutes: 600, withinBaseMinutes: 360, additiveMinutes: 120, totalMinutes: 1080 },
    });
    expect(snapshot.accounting.concepts).toEqual(expect.arrayContaining([
      expect.objectContaining({ hourConceptId: "sereno", name: "Sereno", treatment: "WITHIN_BASE", realMinutes: 180, settlementMinutes: 360 }),
      expect.objectContaining({ hourConceptId: "colectivo", name: "Colectivo", treatment: "ADDITIVE_TO_WORKED_TOTAL", realMinutes: 60, settlementMinutes: 120 }),
    ]));
  });

  it("submitClosures snapshotea las Horas base por estado (systemRole NORMAL_BASE) sin inflarlas", async () => {
    mockedPrisma.employee.count.mockResolvedValue(1);
    mockedPrisma.timeEntry.groupBy.mockResolvedValue([]);
    mockedPrisma.monthlyTimeClosure.upsert.mockResolvedValue({ id: "closure-1", employeeId: "emp-1" });

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
      $executeRaw: vi.fn().mockResolvedValue(0),
      timeCorrectionRequest: { create: vi.fn().mockResolvedValue({ id: "correction-1" }) },
      monthlyTimeClosure: { update: vi.fn().mockResolvedValue({}) },
    }));

    await workforceService.createCorrection({ timeEntryId: "entry-1", proposedHours: 9, reason: "olvido de fichada" }, user);

    expect(auditService.register).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE", entity: "TimeCorrectionRequest", entityId: "correction-1" }));
  });

  it("approveCorrection registra un AuditLog y sigue escribiendo TimeEntry.approvedByUserId", async () => {
    const request = { id: "correction-1", status: "PENDIENTE", timeEntryId: "entry-1", closureId: null, employeeId: "emp-1", previousHours: 8, proposedHours: 9, timeEntry: { period: "2026-08" } };
    const txTimeEntryUpdate = vi.fn().mockResolvedValue({});
    mockedPrisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback({
      $executeRaw: vi.fn().mockResolvedValue(0),
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

// Lenguaje de negocio en auditoría: "(legajo <employeeId>)" mostraba el UUID
// interno en Dashboard/Auditoría. Ahora: "Apellido, Nombre · Legajo N".
describe("workforceService — cierres y correcciones auditan identidad humana, nunca el employeeId", () => {
  const juanId = "016dc01c-655d-4474-8319-67f1b8108c93";
  const anaId = "5b0e6f0a-1c2d-4e3f-8a9b-0c1d2e3f4a5b";
  const juan = { legajo: "30", firstName: "Juan", lastName: "Pérez" };
  const ana = { legajo: "31", firstName: "Ana", lastName: "Gómez" };
  const auditDescriptions = () => (auditService.register as Mock).mock.calls.map(([input]) => input.description as string);
  const expectNoEmployeeUuid = () => {
    for (const description of auditDescriptions()) {
      expect(description).not.toContain(juanId);
      expect(description).not.toContain(anaId);
    }
  };

  it("submitClosures de varios legajos resuelve todas las identidades en UNA consulta (sin N+1)", async () => {
    mockedPrisma.employee.count.mockResolvedValue(2);
    mockedPrisma.timeEntry.groupBy.mockResolvedValue([]);
    mockedPrisma.employee.findMany.mockResolvedValue([{ id: juanId, ...juan }, { id: anaId, ...ana }]);
    mockedPrisma.$transaction.mockResolvedValue([
      { id: "closure-1", employeeId: juanId },
      { id: "closure-2", employeeId: anaId },
    ]);

    await workforceService.submitClosures("2026-09", [juanId, anaId], supervisor);

    expect(mockedPrisma.employee.findMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.employee.findMany).toHaveBeenCalledWith({
      where: { id: { in: [juanId, anaId] } },
      select: { id: true, legajo: true, firstName: true, lastName: true },
    });
    expect(auditDescriptions()).toEqual([
      "Se envió a revisión el cierre de septiembre de 2026 de Pérez, Juan · Legajo 30.",
      "Se envió a revisión el cierre de septiembre de 2026 de Gómez, Ana · Legajo 31.",
    ]);
  });

  it("approveClosures toma la identidad del mismo findMany que ya lee los cierres (sin consultas extra)", async () => {
    mockedPrisma.monthlyTimeClosure.findMany.mockResolvedValue([
      { id: "closure-1", employeeId: juanId, period: "2026-09", employee: juan },
      { id: "closure-2", employeeId: anaId, period: "2026-09", employee: ana },
    ]);
    mockedPrisma.monthlyTimeClosure.updateMany.mockResolvedValue({ count: 2 });

    await workforceService.approveClosures(["closure-1", "closure-2"], undefined, user);

    expect(mockedPrisma.monthlyTimeClosure.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: { employee: { select: { legajo: true, firstName: true, lastName: true } } },
    }));
    expect(mockedPrisma.employee.findMany).not.toHaveBeenCalled();
    expect(auditDescriptions()).toEqual([
      "Se aprobó el cierre de septiembre de 2026 de Pérez, Juan · Legajo 30.",
      "Se aprobó el cierre de septiembre de 2026 de Gómez, Ana · Legajo 31.",
    ]);
  });

  it("returnClosure describe período, persona y motivo", async () => {
    mockedPrisma.monthlyTimeClosure.findUnique.mockResolvedValue({ id: "closure-1", employeeId: juanId, period: "2026-09", employee: juan });
    mockedPrisma.monthlyTimeClosure.update.mockResolvedValue({ id: "closure-1", employeeId: juanId, period: "2026-09", status: "DEVUELTO" });

    await workforceService.returnClosure("closure-1", "faltan horas", user);

    expect(auditDescriptions()).toEqual(["Se devolvió el cierre de septiembre de 2026 de Pérez, Juan · Legajo 30 — motivo: faltan horas."]);
  });

  it("createCorrection / approveCorrection / rejectCorrection describen a la persona, no su UUID", async () => {
    mockedPrisma.timeEntry.findFirst.mockResolvedValue({ id: "entry-1", employeeId: juanId, period: "2026-09", hours: 8, employee: juan });
    mockedPrisma.monthlyTimeClosure.findUnique.mockResolvedValue({ id: "closure-1", status: "APROBADO" });
    mockedPrisma.$transaction.mockImplementationOnce((callback: (tx: unknown) => unknown) => callback({
      $executeRaw: vi.fn().mockResolvedValue(0),
      timeCorrectionRequest: { create: vi.fn().mockResolvedValue({ id: "correction-1" }) },
      monthlyTimeClosure: { update: vi.fn().mockResolvedValue({}) },
    }));
    await workforceService.createCorrection({ timeEntryId: "entry-1", proposedHours: 9, reason: "olvido" }, user);

    const request = { id: "correction-1", status: "PENDIENTE", timeEntryId: "entry-1", closureId: null, employeeId: juanId, previousHours: 8, proposedHours: 9, employee: juan, timeEntry: { period: "2026-09" } };
    mockedPrisma.$transaction.mockImplementationOnce((callback: (tx: unknown) => unknown) => callback({
      $executeRaw: vi.fn().mockResolvedValue(0),
      timeCorrectionRequest: { findUniqueOrThrow: vi.fn().mockResolvedValue(request), update: vi.fn().mockResolvedValue({ ...request, status: "APROBADA" }) },
      timeEntry: { update: vi.fn().mockResolvedValue({}) },
      monthlyTimeClosure: { update: vi.fn() },
    }));
    await workforceService.approveCorrection("correction-1", user);

    mockedPrisma.timeCorrectionRequest.findUnique.mockResolvedValue({ id: "correction-2", employeeId: anaId, employee: ana });
    mockedPrisma.timeCorrectionRequest.update.mockResolvedValue({ id: "correction-2", status: "RECHAZADA" });
    await workforceService.rejectCorrection("correction-2", "no corresponde", user);

    expect(auditDescriptions()).toEqual([
      "Se solicitó una corrección de carga horaria de septiembre de 2026 para Pérez, Juan · Legajo 30 (de 8h a 9h).",
      "Se aprobó la corrección de carga horaria de Pérez, Juan · Legajo 30 (de 8h a 9h).",
      "Se rechazó la corrección de carga horaria de Gómez, Ana · Legajo 31.",
    ]);
    expectNoEmployeeUuid();
  });
});

// Etapa 14G.8: `closures`/`corrections` ya eran una sola query cada una (sin
// `$transaction`, sin antipatrón que corregir) -- estos tests fijan el
// contrato (scope, filtros, orden) que la cache backend nueva (§ workforce.
// controller.test.ts) debe preservar exactamente.
describe("workforceService.closures/corrections — contrato preservado (Etapa 14G.8)", () => {
  it("closures filtra por período y por el scope del usuario (employeeAccessWhere)", async () => {
    mockedPrisma.monthlyTimeClosure.findMany.mockResolvedValue([]);

    await workforceService.closures("2026-08", supervisor);

    expect(mockedPrisma.monthlyTimeClosure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ period: "2026-08" }) }),
    );
  });

  it("closures ordena por apellido del empleado ascendente", async () => {
    mockedPrisma.monthlyTimeClosure.findMany.mockResolvedValue([]);

    await workforceService.closures("2026-08", user);

    expect(mockedPrisma.monthlyTimeClosure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { employee: { lastName: "asc" } } }),
    );
  });

  it("closures devuelve exactamente lo que resuelve la query (sin transformar el shape)", async () => {
    const rows = [{ id: "closure-1", employeeId: "emp-1", period: "2026-08", status: "ENVIADO" }];
    mockedPrisma.monthlyTimeClosure.findMany.mockResolvedValue(rows);

    const result = await workforceService.closures("2026-08", user);

    expect(result).toEqual(rows);
  });

  it("corrections filtra por scope del usuario, período y estado en el where (antes el período lo filtraba el frontend sobre las últimas 500)", async () => {
    mockedPrisma.timeCorrectionRequest.findMany.mockResolvedValue([]);

    await workforceService.corrections(supervisor, { period: "2026-08", status: "PENDIENTE" });

    expect(mockedPrisma.timeCorrectionRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { employee: expect.anything(), timeEntry: { period: "2026-08" }, status: "PENDIENTE" } }),
    );
  });

  it("corrections no tiene tope fijo (acotado por período) y ordena por creación desc con desempate estable", async () => {
    mockedPrisma.timeCorrectionRequest.findMany.mockResolvedValue([]);

    await workforceService.corrections(user, { period: "2026-08" });

    const args = mockedPrisma.timeCorrectionRequest.findMany.mock.calls[0]![0];
    expect(args).not.toHaveProperty("take");
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "asc" }]);
    expect(args.where).not.toHaveProperty("status");
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

  // Eliminar = borrado físico SIEMPRE, sin importar vigencia ni estado. La
  // política anterior (regla ya iniciada → se inactivaba) se quitó: Inactivar
  // es el botón Power (PATCH status), no el tacho.
  it.each([
    ["A — futura", { fromDate: new Date("2026-12-01T00:00:00.000Z"), toDate: null, status: "ACTIVO" }],
    ["B — activa y ya iniciada", { fromDate: new Date("2026-01-01T00:00:00.000Z"), toDate: null, status: "ACTIVO" }],
    ["C — inactiva y ya iniciada", { fromDate: new Date("2026-01-01T00:00:00.000Z"), toDate: null, status: "INACTIVO" }],
    ["D — ya finalizada", { fromDate: new Date("2026-01-01T00:00:00.000Z"), toDate: new Date("2026-03-31T00:00:00.000Z"), status: "ACTIVO" }],
  ])("regla %s → se elimina físicamente (DELETED), nunca se inactiva", async (_label, vigency) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    mockedPrisma.doubleHourRule.findUnique.mockResolvedValue(ruleRow({ id: "rule-1", name: "Domingo", recurrenceType: "RANGO", employees: [], ...vigency }));
    try {
      await expect(workforceService.removeDoubleRule("rule-1")).resolves.toEqual({ mode: "DELETED", id: "rule-1" });
    } finally {
      vi.useRealTimers();
    }

    expect(mockedPrisma.specialHourRuleApplication.deleteMany).toHaveBeenCalledWith({ where: { doubleHourRuleId: "rule-1" } });
    expect(mockedPrisma.doubleHourRule.delete).toHaveBeenCalledWith({ where: { id: "rule-1" } });
    expect(mockedPrisma.doubleHourRule.update).not.toHaveBeenCalled();
    expect(auditService.register).toHaveBeenCalledWith(expect.objectContaining({ action: "DELETE", entity: "DoubleHourRule", entityId: "rule-1" }));
  });

  it("regla inexistente → 404, sin borrar ni auditar", async () => {
    mockedPrisma.doubleHourRule.findUnique.mockResolvedValue(null);

    await expect(workforceService.removeDoubleRule("rule-x")).rejects.toMatchObject({ statusCode: 404, code: "DOUBLE_HOUR_RULE_NOT_FOUND" });
    expect(mockedPrisma.doubleHourRule.delete).not.toHaveBeenCalled();
    expect(auditService.register).not.toHaveBeenCalled();
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
    mockedPrisma.doubleHourRule.create.mockResolvedValue(ruleRow({ id: "rule-1", name: "Domingo" }));

    await workforceService.createDoubleRule({ name: "Domingo", recurrenceType: "SEMANAL", weekdays: [0], employeeIds: [] }, user);

    expect(mockedPrisma.doubleHourRule.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ employees: { create: [] } }) }),
    );
    const createdData = mockedPrisma.doubleHourRule.create.mock.calls[0]![0].data;
    expect(createdData.companyId).toBeUndefined();
    expect(createdData.sectorId).toBeUndefined();
  });

  it("Etapa 8B (test 2) — crea una Hora Especial con empresa pero sin empleados", async () => {
    mockedPrisma.doubleHourRule.create.mockResolvedValue(ruleRow({ id: "rule-2", name: "Domingo Odwyer" }));

    await workforceService.createDoubleRule({ name: "Domingo Odwyer", recurrenceType: "SEMANAL", weekdays: [0], companyId: "company-odwyer", employeeIds: [] }, user);

    expect(mockedPrisma.doubleHourRule.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: "company-odwyer", employees: { create: [] } }) }),
    );
  });

  it("Etapa 8B (test 3) — crea una Hora Especial con empresa + sector pero sin empleados", async () => {
    mockedPrisma.doubleHourRule.create.mockResolvedValue(ruleRow({ id: "rule-3", name: "Domingo Pañol" }));
    mockedPrisma.sector.findUnique.mockResolvedValue({ name: "Pañol", businessUnitId: null });

    await workforceService.createDoubleRule({ name: "Domingo Pañol", recurrenceType: "SEMANAL", weekdays: [0], companyId: "company-odwyer", sectorId: "sector-panol", employeeIds: [] }, user);

    expect(mockedPrisma.doubleHourRule.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: "company-odwyer", sectorId: "sector-panol", employees: { create: [] } }) }),
    );
  });

  it("Etapa 8B (test 4) — crea una Hora Especial con empleados específicos (comportamiento preexistente, sigue igual)", async () => {
    mockedPrisma.doubleHourRule.create.mockResolvedValue(ruleRow({ id: "rule-4", name: "Domingo Pañol" }));

    await workforceService.createDoubleRule({ name: "Domingo Pañol", recurrenceType: "SEMANAL", weekdays: [0], employeeIds: ["juan", "pedro", "carlos"] }, user);

    expect(mockedPrisma.doubleHourRule.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ employees: { create: [{ employeeId: "juan" }, { employeeId: "pedro" }, { employeeId: "carlos" }] } }) }),
    );
  });

  it("Etapa 8B — crea una Hora Especial de fechas específicas (FECHA) con varias fechas cargadas (feriados)", async () => {
    mockedPrisma.doubleHourRule.create.mockResolvedValue(ruleRow({ id: "rule-5", name: "Feriados 2026" }));
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
    mockedPrisma.doubleHourRule.create.mockResolvedValue(ruleRow({ id: "rule-feriado", name: "Feriado", kind: "FERIADO" }));

    await workforceService.createDoubleRule({ name: "Feriado", recurrenceType: "SEMANAL", weekdays: [0], employeeIds: [], kind: "FERIADO" }, user);

    expect(mockedPrisma.doubleHourRule.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "FERIADO" }) }));
  });

  it("Etapa 12B — crea una regla con kind DOMINGO", async () => {
    mockedPrisma.doubleHourRule.create.mockResolvedValue(ruleRow({ id: "rule-domingo", name: "Domingo", kind: "DOMINGO" }));

    await workforceService.createDoubleRule({ name: "Domingo", recurrenceType: "SEMANAL", weekdays: [0], employeeIds: [], kind: "DOMINGO" }, user);

    expect(mockedPrisma.doubleHourRule.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "DOMINGO" }) }));
  });

  it("Etapa 12B — crea una regla con kind JORNADA_ESPECIAL", async () => {
    mockedPrisma.doubleHourRule.create.mockResolvedValue(ruleRow({ id: "rule-jornada", name: "Jornada especial", kind: "JORNADA_ESPECIAL" }));

    await workforceService.createDoubleRule({ name: "Jornada especial", recurrenceType: "RANGO", employeeIds: [], kind: "JORNADA_ESPECIAL" }, user);

    expect(mockedPrisma.doubleHourRule.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "JORNADA_ESPECIAL" }) }));
  });

  it("Etapa 12B — crea una regla con kind OTRO (explícito)", async () => {
    mockedPrisma.doubleHourRule.create.mockResolvedValue(ruleRow({ id: "rule-otro", name: "Pedro", kind: "OTRO" }));

    await workforceService.createDoubleRule({ name: "Pedro", recurrenceType: "SEMANAL", weekdays: [0], employeeIds: [], kind: "OTRO" }, user);

    expect(mockedPrisma.doubleHourRule.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "OTRO" }) }));
  });

  it("A8 §12.4 — createDoubleRule rechaza una empresa archivada con su propio código", async () => {
    mockedPrisma.company.findMany.mockResolvedValueOnce([{ name: "Odwyer Vieja" }]);

    await expect(
      workforceService.createDoubleRule({ name: "Domingo", recurrenceType: "SEMANAL", weekdays: [0], companyId: "c-arch", employeeIds: [] }, user),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "DOUBLE_HOUR_RULE_DESTINATION_ARCHIVED",
      message: expect.stringContaining("Odwyer Vieja"),
    });
    expect(mockedPrisma.doubleHourRule.create).not.toHaveBeenCalled();
  });

  it("A8 §12.4 — createDoubleRule rechaza un puesto archivado", async () => {
    mockedPrisma.position.findMany.mockResolvedValueOnce([{ name: "Encargado Archivado" }]);

    await expect(
      workforceService.createDoubleRule({ name: "Rango", recurrenceType: "RANGO", weekdays: [1], positionId: "p-arch", employeeIds: [] }, user),
    ).rejects.toMatchObject({ statusCode: 400, code: "DOUBLE_HOUR_RULE_DESTINATION_ARCHIVED", message: expect.stringContaining("Encargado Archivado") });
    expect(mockedPrisma.doubleHourRule.create).not.toHaveBeenCalled();
  });

  it("A8 §12.4 — updateDoubleRule CONSERVA sin cambio una FK ya apuntando a un archivado", async () => {
    mockedPrisma.doubleHourRule.findUnique.mockResolvedValue({ id: "rule-arch", name: "Domingo", multiplier: 2, companyId: "c-arch", employees: [], dates: [] });
    mockedPrisma.doubleHourRule.update.mockResolvedValue(ruleRow({ id: "rule-arch", name: "Domingo", multiplier: 3 }));

    await workforceService.updateDoubleRule("rule-arch", { multiplier: 3 });

    expect(mockedPrisma.company.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.doubleHourRule.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ multiplier: 3 }) }));
  });

  it("A8 §12.4 — updateDoubleRule RECHAZA asignar por primera vez una empresa archivada", async () => {
    mockedPrisma.doubleHourRule.findUnique.mockResolvedValue({ id: "rule-new", name: "Domingo", multiplier: 2, companyId: null, employees: [], dates: [] });
    mockedPrisma.company.findMany.mockResolvedValueOnce([{ name: "Odwyer Vieja" }]);

    await expect(workforceService.updateDoubleRule("rule-new", { companyId: "c-arch" })).rejects.toMatchObject({
      statusCode: 400,
      code: "DOUBLE_HOUR_RULE_DESTINATION_ARCHIVED",
    });
    expect(mockedPrisma.doubleHourRule.update).not.toHaveBeenCalled();
  });

  it("Etapa 12B — updateDoubleRule reclasifica el kind de una regla existente sin tocar el resto", async () => {
    mockedPrisma.doubleHourRule.findUnique.mockResolvedValue({ id: "rule-domingo", name: "Domingo", kind: "OTRO", employees: [], dates: [] });
    mockedPrisma.doubleHourRule.update.mockResolvedValue(ruleRow({ id: "rule-domingo", name: "Domingo", kind: "DOMINGO" }));

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
    mockedPrisma.doubleHourRule.update.mockResolvedValue(ruleRow({ id: "rule-feriado", name: "Feriado" }));
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

// Etapa 14G.6: `$transaction([...])` -> `Promise.all([...])` (listado + count
// sobre el cliente global, sin $transaction).
// Etapa "orden por fecha efectiva" (docs/decisions/NOTIFICATIONS_EVENT_ORDER.md):
// orden (eventAt, createdAt, id) DESC, filtro Desde/Hasta y cursor estable se
// resuelven en la DB. Para probar la SEMÁNTICA (no sólo la forma de la query),
// `useNotificationTable` evalúa en memoria el mismo subconjunto de where/orderBy
// de Prisma que usa el servicio sobre una tabla de filas fijas.
type NotificationTableRow = { id: string; recipientUserId: string; status: "NO_LEIDA" | "LEIDA"; eventAt: Date; createdAt: Date; entityType: string | null; entityId: string | null };

function compareValues(left: unknown, right: unknown) {
  const a = left instanceof Date ? left.getTime() : (left as string | number);
  const b = right instanceof Date ? right.getTime() : (right as string | number);
  return a < b ? -1 : a > b ? 1 : 0;
}

function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "AND") return (condition as Record<string, unknown>[]).every((item) => matchesWhere(row, item));
    if (key === "OR") return (condition as Record<string, unknown>[]).some((item) => matchesWhere(row, item));
    if (key === "NOT") return !matchesWhere(row, condition as Record<string, unknown>);
    if (condition instanceof Date || typeof condition !== "object" || condition === null) return compareValues(row[key], condition) === 0;
    return Object.entries(condition).every(([operator, operand]) => {
      const order = compareValues(row[key], operand);
      if (operator === "lt") return order < 0;
      if (operator === "lte") return order <= 0;
      if (operator === "gt") return order > 0;
      if (operator === "gte") return order >= 0;
      throw new Error(`Operador no soportado por la tabla en memoria: ${operator}`);
    });
  });
}

function useNotificationTable(rows: NotificationTableRow[]) {
  const select = (where: Record<string, unknown>, orderBy: ReadonlyArray<Partial<Record<string, "asc" | "desc">>>) =>
    rows.filter((row) => matchesWhere(row, where)).sort((left, right) => {
      for (const clause of orderBy) {
        const [field, direction] = Object.entries(clause)[0]!;
        const order = compareValues(left[field as keyof NotificationTableRow], right[field as keyof NotificationTableRow]);
        if (order) return direction === "desc" ? -order : order;
      }
      return 0;
    });
  mockedPrisma.systemNotification.findMany.mockImplementation(async ({ where, orderBy, skip = 0, take }) => select(where, orderBy).slice(skip, skip + take));
  mockedPrisma.systemNotification.count.mockImplementation(async ({ where }) => select(where, []).length);
  mockedPrisma.systemNotification.findFirst.mockImplementation(async ({ where }) => select(where, NOTIFICATION_ORDER_BY)[0] ?? null);
}

// UUID determinístico: el orden de los `n` coincide con el orden de los ids.
function notificationId(n: number) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function notificationRow(n: number, overrides: Partial<NotificationTableRow> & { eventAt: Date; createdAt?: Date }): NotificationTableRow {
  return { id: notificationId(n), recipientUserId: "user-1", status: "NO_LEIDA", entityType: null, entityId: null, createdAt: overrides.eventAt, ...overrides };
}

// 00:00 Argentina de un día — mismo valor que persiste un incidente (fecha calendario).
const arDay = (dateKey: string) => new Date(`${dateKey}T00:00:00.000-03:00`);
const arInstant = (dateKey: string, time: string) => new Date(`${dateKey}T${time}:00.000-03:00`);
const ids = (result: { items: Array<{ id: string }> }) => result.items.map((item) => item.id);
const query = (overrides: Partial<ListNotificationsQuery> = {}): ListNotificationsQuery => ({ page: 1, take: 20, ...overrides });

describe("workforceService.notifications — Etapa 9I + 14G.6 (paginación server-side, sin $transaction)", () => {
  beforeEach(() => useNotificationTable([]));

  it("no envuelve las queries en $transaction — corren sobre el cliente prisma global", async () => {
    await workforceService.notifications(query(), user);

    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedPrisma.systemNotification.findMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.systemNotification.count).toHaveBeenCalledTimes(1);
  });

  it("filtra siempre por el usuario autenticado — nunca mezcla notificaciones de otro usuario", async () => {
    useNotificationTable([notificationRow(1, { eventAt: arDay("2026-10-05") }), notificationRow(2, { eventAt: arDay("2026-10-05"), recipientUserId: "user-2" })]);

    expect(ids(await workforceService.notifications(query(), user))).toEqual([notificationId(1)]);
    expect(ids(await workforceService.notifications(query(), supervisor))).toEqual([notificationId(2)]);
    expect(mockedPrisma.systemNotification.count).toHaveBeenCalledWith({ where: { recipientUserId: "user-1" } });
  });

  it("ordena en la DB por eventAt DESC, createdAt DESC, id DESC", async () => {
    await workforceService.notifications(query(), user);

    expect(mockedPrisma.systemNotification.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ eventAt: "desc" }, { createdAt: "desc" }, { id: "desc" }] }));
  });

  it("page/take (compatibilidad, sin cursor) — page 3 con take 10 pide skip:20 take:10", async () => {
    await workforceService.notifications(query({ page: 3, take: 10 }), user);

    expect(mockedPrisma.systemNotification.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
  });

  it("sin resultados: items vacío y meta válida", async () => {
    const result = await workforceService.notifications(query(), user);

    expect(result).toEqual({ items: [], meta: { total: 0, page: 1, pageSize: 20, hasMore: false, nextCursor: null } });
  });

  it("enriquece con el empleado sólo las notificaciones de la página — la entidad de origen ya no aporta la fecha", async () => {
    useNotificationTable([notificationRow(1, { eventAt: arDay("2026-10-05"), entityType: "ShiftAlert", entityId: "alert-1" })]);
    mockedPrisma.shiftAlert.findMany.mockResolvedValue([{ id: "alert-1", actualAt: new Date("2026-10-07T12:00:00.000Z"), employee: { id: "emp-1", legajo: "100", firstName: "Ana", lastName: "Gomez" } }]);

    const result = await workforceService.notifications(query(), user);

    expect(mockedPrisma.shiftAlert.findMany).toHaveBeenCalledWith({ where: { id: { in: ["alert-1"] } }, select: { id: true, employee: { select: { id: true, legajo: true, firstName: true, lastName: true } } } });
    expect(result.items[0]).toMatchObject({ id: notificationId(1), eventAt: arDay("2026-10-05"), employee: { id: "emp-1", legajo: "100" } });
    expect(result.items[0]).not.toHaveProperty("eventDate");
  });

  it("no dispara ninguna query de enriquecimiento cuando ninguna notificación de la página tiene entityId", async () => {
    useNotificationTable([notificationRow(1, { eventAt: arDay("2026-10-05") })]);

    await workforceService.notifications(query(), user);

    expect(mockedPrisma.shiftAlert.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.workShift.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.employee.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.attendanceInactivityIncident.findMany).not.toHaveBeenCalled();
  });

  // Etapa 15G.2 (docs/decisions/ALERT_TO_NOVELTY_FLOW_15G2.md): los 4
  // entityType con empleado conviven en la misma página.
  it("enriquece ShiftAlert/AttendanceInactivityIncident/WorkShift/Employee en la misma página con employee mínimo", async () => {
    useNotificationTable([
      notificationRow(4, { eventAt: arDay("2026-10-05"), entityType: "ShiftAlert", entityId: "alert-1" }),
      notificationRow(3, { eventAt: arDay("2026-10-05"), entityType: "AttendanceInactivityIncident", entityId: "incident-1" }),
      notificationRow(2, { eventAt: arDay("2026-10-05"), entityType: "WorkShift", entityId: "shift-1" }),
      notificationRow(1, { eventAt: arDay("2026-10-05"), entityType: "Employee", entityId: "emp-4" }),
    ]);
    mockedPrisma.shiftAlert.findMany.mockResolvedValue([{ id: "alert-1", employee: { id: "emp-1", legajo: "100", firstName: "Ana", lastName: "Gomez" } }]);
    mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([{ id: "incident-1", employee: { id: "emp-2", legajo: "200", firstName: "Beto", lastName: "Diaz" } }]);
    mockedPrisma.workShift.findMany.mockResolvedValue([{ id: "shift-1", employee: { id: "emp-3", legajo: "300", firstName: "Cora", lastName: "Ruiz" } }]);
    mockedPrisma.employee.findMany.mockResolvedValue([{ id: "emp-4", legajo: "400", firstName: "Dino", lastName: "Paz" }]);

    const result = await workforceService.notifications(query(), user);

    expect(mockedPrisma.attendanceInactivityIncident.findMany).toHaveBeenCalledWith({ where: { id: { in: ["incident-1"] } }, select: { id: true, employee: { select: { id: true, legajo: true, firstName: true, lastName: true } } } });
    expect(result.items.map((item) => (item as { employee?: { legajo: string } }).employee?.legajo)).toEqual(["100", "200", "300", "400"]);
  });
});

describe("workforceService.notifications — orden por fecha efectiva (eventAt), no por creación de la fila", () => {
  it("caso fundamental: A(05/10) creada primero y B(02/10)/C(04/10)/D(03/10) recuperadas después por catch-up → 05, 04, 03, 02", async () => {
    useNotificationTable([
      notificationRow(1, { eventAt: arDay("2026-10-05"), createdAt: arInstant("2026-10-05", "08:00") }), // A
      notificationRow(2, { eventAt: arDay("2026-10-02"), createdAt: arInstant("2026-10-05", "10:00") }), // B
      notificationRow(3, { eventAt: arDay("2026-10-04"), createdAt: arInstant("2026-10-05", "10:01") }), // C
      notificationRow(4, { eventAt: arDay("2026-10-03"), createdAt: arInstant("2026-10-05", "10:02") }), // D
    ]);

    expect(ids(await workforceService.notifications(query(), user))).toEqual([notificationId(1), notificationId(3), notificationId(4), notificationId(2)]);
  });

  it("catch-up (§17): evento 02/10 creado 05/10 10:00 queda DEBAJO del evento 05/10 creado 05/10 09:00", async () => {
    useNotificationTable([
      notificationRow(1, { eventAt: arDay("2026-10-02"), createdAt: arInstant("2026-10-05", "10:00") }),
      notificationRow(2, { eventAt: arInstant("2026-10-05", "09:00"), createdAt: arInstant("2026-10-05", "09:00") }),
    ]);

    expect(ids(await workforceService.notifications(query(), user))).toEqual([notificationId(2), notificationId(1)]);
  });

  it("sin hecho propio (eventAt = createdAt) se intercala por su instante de creación — nunca se pierde", async () => {
    useNotificationTable([
      notificationRow(1, { eventAt: arDay("2026-10-04") }),
      notificationRow(2, { eventAt: arInstant("2026-10-04", "15:30") }), // cierre mensual, sin entidad
      notificationRow(3, { eventAt: arDay("2026-10-05") }),
    ]);

    expect(ids(await workforceService.notifications(query(), user))).toEqual([notificationId(3), notificationId(2), notificationId(1)]);
  });

  it("mismo eventAt → createdAt DESC", async () => {
    useNotificationTable([
      notificationRow(1, { eventAt: arDay("2026-10-03"), createdAt: arInstant("2026-10-05", "10:00") }),
      notificationRow(2, { eventAt: arDay("2026-10-03"), createdAt: arInstant("2026-10-05", "11:00") }),
    ]);

    expect(ids(await workforceService.notifications(query(), user))).toEqual([notificationId(2), notificationId(1)]);
  });

  it("mismo eventAt y createdAt → id DESC", async () => {
    const same = { eventAt: arDay("2026-10-03"), createdAt: arInstant("2026-10-05", "10:00") };
    useNotificationTable([notificationRow(1, same), notificationRow(3, same), notificationRow(2, same)]);

    expect(ids(await workforceService.notifications(query(), user))).toEqual([notificationId(3), notificationId(2), notificationId(1)]);
  });
});

describe("workforceService.notifications — filtros Desde/Hasta sobre la misma fecha visible (eventAt, días Argentina)", () => {
  const catchUpWeek = [
    notificationRow(1, { eventAt: arDay("2026-10-05"), createdAt: arInstant("2026-10-05", "08:00") }),
    notificationRow(2, { eventAt: arDay("2026-10-02"), createdAt: arInstant("2026-10-05", "10:00") }),
    notificationRow(3, { eventAt: arDay("2026-10-04"), createdAt: arInstant("2026-10-05", "10:01"), status: "LEIDA" }),
    notificationRow(4, { eventAt: arDay("2026-10-03"), createdAt: arInstant("2026-10-05", "10:02") }),
  ];

  it("dateFrom=03/10 + dateTo=05/10 → 05, 04, 03 (no 02, aunque se creó el 05/10)", async () => {
    useNotificationTable(catchUpWeek);

    expect(ids(await workforceService.notifications(query({ dateFrom: "2026-10-03", dateTo: "2026-10-05" }), user))).toEqual([notificationId(1), notificationId(3), notificationId(4)]);
  });

  it("dateFrom solo: desde las 00:00 Argentina — 02/10 23:59 AR (03/10 02:59 UTC) queda afuera", async () => {
    useNotificationTable([
      notificationRow(1, { eventAt: arInstant("2026-10-02", "23:59") }),
      notificationRow(2, { eventAt: arDay("2026-10-03") }),
    ]);

    expect(ids(await workforceService.notifications(query({ dateFrom: "2026-10-03" }), user))).toEqual([notificationId(2)]);
  });

  it("dateTo solo: hasta el final del día Argentina — 05/10 23:59 AR (06/10 02:59 UTC) entra, 06/10 00:00 AR no", async () => {
    useNotificationTable([
      notificationRow(1, { eventAt: arInstant("2026-10-05", "23:59") }),
      notificationRow(2, { eventAt: arDay("2026-10-06") }),
    ]);

    expect(ids(await workforceService.notifications(query({ dateTo: "2026-10-05" }), user))).toEqual([notificationId(1)]);
  });

  it("status + rango se combinan: No leídas entre 01/10 y 05/10", async () => {
    useNotificationTable(catchUpWeek);

    const result = await workforceService.notifications(query({ status: "NO_LEIDA", dateFrom: "2026-10-01", dateTo: "2026-10-05" }), user);

    expect(ids(result)).toEqual([notificationId(1), notificationId(4), notificationId(2)]);
    expect(result.meta.total).toBe(3);
  });

  it("el filtro se aplica ANTES de paginar: total y count usan el mismo where que el listado", async () => {
    useNotificationTable(catchUpWeek);

    await workforceService.notifications(query({ dateFrom: "2026-10-03", dateTo: "2026-10-05" }), user);

    expect(mockedPrisma.systemNotification.count).toHaveBeenCalledWith({
      where: { recipientUserId: "user-1", eventAt: { gte: new Date("2026-10-03T03:00:00.000Z"), lt: new Date("2026-10-06T03:00:00.000Z") } },
    });
  });
});

describe("workforceService.notifications — cursor estable (eventAt, createdAt, id) y refresco de ventana", () => {
  // 25 filas con EXACTAMENTE el mismo eventAt y createdAt: sólo el id desempata.
  const sameInstant = { eventAt: arDay("2026-10-03"), createdAt: arInstant("2026-10-05", "10:00") };
  const tied = Array.from({ length: 25 }, (_, index) => notificationRow(index + 1, sameInstant));

  async function walk(take: number, extra: Partial<ListNotificationsQuery> = {}) {
    const seen: string[] = [];
    let page = await workforceService.notifications(query({ take, ...extra }), user);
    seen.push(...ids(page));
    // Tope: un cursor que no avanza (ej. `lte` en vez de `lt`) repetiría la última fila para siempre.
    for (let guard = 0; page.meta.hasMore; guard += 1) {
      if (guard > 50) throw new Error("El cursor no avanza: la paginación no termina");
      page = await workforceService.notifications(query({ take, after: parseNotificationCursor(page.meta.nextCursor!)!, ...extra }), user);
      seen.push(...ids(page));
    }
    return seen;
  }

  it("recorre 25 filas empatadas en eventAt+createdAt de a 10: sin duplicados, sin pérdidas, en orden id DESC", async () => {
    useNotificationTable(tied);

    const seen = await walk(10);

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    expect(seen).toEqual(tied.map((row) => row.id).reverse());
  });

  it("nextCursor codifica las tres claves de la última fila y la página siguiente arranca justo después", async () => {
    useNotificationTable(tied);

    const first = await workforceService.notifications(query({ take: 10 }), user);
    const second = await workforceService.notifications(query({ take: 10, after: parseNotificationCursor(first.meta.nextCursor!)! }), user);

    expect(first.meta).toMatchObject({ hasMore: true, nextCursor: `2026-10-03T03:00:00.000Z_2026-10-05T13:00:00.000Z_${notificationId(16)}` });
    expect(second.meta.hasMore).toBe(true);
    expect(ids(second)).toEqual(tied.slice(5, 15).map((row) => row.id).reverse());
  });

  it("una notificación atrasada que entra por encima del cursor entre páginas no duplica ni corre la página siguiente (con offset, la 2da página repetiría la fila 9)", async () => {
    const rows = [
      notificationRow(10, { eventAt: arDay("2026-10-05") }),
      notificationRow(9, { eventAt: arDay("2026-10-04") }),
      notificationRow(8, { eventAt: arDay("2026-10-03") }),
      notificationRow(7, { eventAt: arDay("2026-10-01") }),
    ];
    useNotificationTable(rows);
    const first = await workforceService.notifications(query({ take: 2 }), user);
    rows.push(notificationRow(11, { eventAt: arDay("2026-10-04"), createdAt: arInstant("2026-10-05", "12:00") })); // queda entre 10 y 9

    const next = await workforceService.notifications(query({ take: 2, after: parseNotificationCursor(first.meta.nextCursor!)! }), user);

    expect(ids(first)).toEqual([notificationId(10), notificationId(9)]);
    expect(ids(next)).toEqual([notificationId(8), notificationId(7)]);
  });

  it("refresco de ventana (through): devuelve la ventana visible con la atrasada nueva en su posición cronológica", async () => {
    const rows = [
      notificationRow(1, { eventAt: arDay("2026-10-05"), createdAt: arInstant("2026-10-05", "08:00") }),
      notificationRow(3, { eventAt: arDay("2026-10-04"), createdAt: arInstant("2026-10-05", "10:01") }),
      notificationRow(4, { eventAt: arDay("2026-10-03"), createdAt: arInstant("2026-10-05", "10:02") }),
      notificationRow(5, { eventAt: arDay("2026-10-01") }),
    ];
    useNotificationTable(rows);
    const visible = await workforceService.notifications(query({ take: 3 }), user);
    rows.push(notificationRow(2, { eventAt: arDay("2026-10-04"), createdAt: arInstant("2026-10-05", "10:00") })); // B tardía, mismo día que C

    const refreshed = await workforceService.notifications(query({ take: 100, through: parseNotificationCursor(visible.meta.nextCursor!)! }), user);

    expect(ids(refreshed)).toEqual([notificationId(1), notificationId(3), notificationId(2), notificationId(4)]);
    expect(refreshed.meta).toMatchObject({ hasMore: true, nextCursor: visible.meta.nextCursor });
    const after = await workforceService.notifications(query({ take: 3, after: parseNotificationCursor(refreshed.meta.nextCursor!)! }), user);
    expect(ids(after)).toEqual([notificationId(5)]);
  });

  it("refresco de ventana acotado por take: si entraron más filas que el máximo, corta ahí y 'Cargar más' sigue desde la última", async () => {
    const rows = Array.from({ length: 5 }, (_, index) => notificationRow(index + 1, { eventAt: arDay(`2026-10-0${index + 1}`) }));
    useNotificationTable(rows);
    const visible = await workforceService.notifications(query({ take: 2 }), user); // 05, 04
    rows.push(...Array.from({ length: 3 }, (_, index) => notificationRow(10 + index, { eventAt: arDay("2026-10-06") })));

    const refreshed = await workforceService.notifications(query({ take: 3, through: parseNotificationCursor(visible.meta.nextCursor!)! }), user);

    expect(ids(refreshed)).toEqual([notificationId(12), notificationId(11), notificationId(10)]);
    expect(refreshed.meta.hasMore).toBe(true);
    const next = await workforceService.notifications(query({ take: 10, after: parseNotificationCursor(refreshed.meta.nextCursor!)! }), user);
    expect(ids(next)).toEqual([notificationId(5), notificationId(4), notificationId(3), notificationId(2), notificationId(1)]);
  });

  it("refresco bajo No leídas: las que se leyeron en otro lado salen; si la ventana queda vacía, el cursor sigue siendo el borde y hasMore ve lo de abajo", async () => {
    const rows = [
      notificationRow(3, { eventAt: arDay("2026-10-05") }),
      notificationRow(2, { eventAt: arDay("2026-10-04") }),
      notificationRow(1, { eventAt: arDay("2026-10-03") }),
    ];
    useNotificationTable(rows);
    const visible = await workforceService.notifications(query({ take: 2, status: "NO_LEIDA" }), user);
    rows[0]!.status = "LEIDA";
    rows[1]!.status = "LEIDA";

    const refreshed = await workforceService.notifications(query({ take: 100, status: "NO_LEIDA", through: parseNotificationCursor(visible.meta.nextCursor!)! }), user);

    expect(ids(refreshed)).toEqual([]);
    expect(refreshed.meta).toMatchObject({ total: 1, hasMore: true, nextCursor: visible.meta.nextCursor });
  });

  it("cursor + filtros: 'Cargar más' conserva status y rango", async () => {
    useNotificationTable([
      notificationRow(4, { eventAt: arDay("2026-10-05") }),
      notificationRow(3, { eventAt: arDay("2026-10-04"), status: "LEIDA" }),
      notificationRow(2, { eventAt: arDay("2026-10-03") }),
      notificationRow(1, { eventAt: arDay("2026-10-01") }),
    ]);

    expect(await walk(1, { status: "NO_LEIDA", dateFrom: "2026-10-02" })).toEqual([notificationId(4), notificationId(2)]);
  });
});

// docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §15: crear/editar/quitar una
// regla de Hora Especial reinterpreta las horas ya cargadas en la MISMA
// transacción y lo audita en lenguaje de negocio.
describe("workforceService — reglas de Hora Especial reinterpretan la historia", () => {
  const reinterpretation = (overrides: Record<string, unknown> = {}) => ({
    timeEntries: 23, breakdowns: 0, segments: 23, employees: 18, periods: ["2026-10"],
    rebuiltClosures: [{ id: "closure-1", employeeId: "016dc01c-655d-4474-8319-67f1b8108c93", period: "2026-10", before: {}, after: {} }],
    protectedPeriods: [],
    ...overrides,
  });
  const feriadoRow = (overrides: Record<string, unknown> = {}) => ruleRow({
    id: "rule-feriado", name: "Día de la Raza", kind: "FERIADO", recurrenceType: "FECHA",
    fromDate: new Date("2026-10-03T00:00:00.000Z"), toDate: new Date("2026-10-03T00:00:00.000Z"),
    dates: [{ date: new Date("2026-10-03T00:00:00.000Z"), isActive: true }], multiplier: 1, ...overrides,
  });
  const auditDescriptions = () => (auditService.register as Mock).mock.calls.map(([input]) => input.description as string);

  it("crear un feriado reinterpreta dentro de la transacción (before: null → after: la regla nueva) y lo audita en lenguaje humano", async () => {
    vi.mocked(reinterpretSpecialHours).mockResolvedValueOnce(reinterpretation() as never);
    mockedPrisma.doubleHourRule.create.mockResolvedValue(feriadoRow({ multiplier: 2 }));
    mockedPrisma.employee.findMany.mockResolvedValue([{ id: "016dc01c-655d-4474-8319-67f1b8108c93", legajo: "30", firstName: "Juan", lastName: "Pérez" }]);

    await workforceService.createDoubleRule({ name: "Día de la Raza", kind: "FERIADO", recurrenceType: "FECHA", dates: [{ date: new Date("2026-10-03T00:00:00.000Z") }], employeeIds: [] }, user);

    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000 });
    expect(reinterpretSpecialHours).toHaveBeenCalledWith(mockedPrisma, { before: null, after: expect.objectContaining({ id: "rule-feriado", recurrenceType: "FECHA" }) }, { doubleHourRuleId: "rule-feriado", doubleHourRuleName: "Día de la Raza" });
    expect(auditDescriptions()).toEqual([
      "Se creó el feriado Día de la Raza (03/10/2026, x2). Se recalcularon 23 carga(s) de 18 legajo(s) y 1 cierre(s) mensual(es).",
      "Se recalculó el snapshot del cierre de octubre de 2026 de Pérez, Juan · Legajo 30 por cambio del feriado Día de la Raza. El estado del cierre no cambia.",
    ]);
    const ruleAudit = (auditService.register as Mock).mock.calls[0]![0];
    expect(ruleAudit.after.reinterpretation).toEqual({ timeEntries: 23, breakdowns: 0, segments: 23, employees: 18, periods: ["2026-10"], protectedPeriods: [], recalculatedClosureIds: ["closure-1"] });
    for (const description of auditDescriptions()) expect(description).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("cambiar el multiplicador de x1 a x2 pasa before y after al recálculo y describe el cambio", async () => {
    vi.mocked(reinterpretSpecialHours).mockResolvedValueOnce(reinterpretation({ rebuiltClosures: [] }) as never);
    mockedPrisma.doubleHourRule.findUnique.mockResolvedValue(feriadoRow({ multiplier: 1 }));
    mockedPrisma.doubleHourRule.update.mockResolvedValue(feriadoRow({ multiplier: 2 }));

    await workforceService.updateDoubleRule("rule-feriado", { multiplier: 2 });

    expect(reinterpretSpecialHours).toHaveBeenCalledWith(
      mockedPrisma,
      { before: expect.objectContaining({ id: "rule-feriado" }), after: expect.objectContaining({ id: "rule-feriado" }) },
      { doubleHourRuleId: "rule-feriado", doubleHourRuleName: "Día de la Raza" },
    );
    expect(auditDescriptions()).toEqual(["Se actualizó el feriado Día de la Raza (03/10/2026) de x1 a x2. Se recalcularon 23 carga(s) de 18 legajo(s)."]);
  });

  it("sin horas alcanzadas lo dice explícitamente", async () => {
    mockedPrisma.doubleHourRule.findUnique.mockResolvedValue(feriadoRow({ multiplier: 2 }));
    mockedPrisma.doubleHourRule.update.mockResolvedValue(feriadoRow({ multiplier: 1.5 }));

    await workforceService.updateDoubleRule("rule-feriado", { multiplier: 1.5 });

    expect(auditDescriptions()).toEqual(["Se actualizó el feriado Día de la Raza (03/10/2026) de x2 a x1.5. No había horas cargadas alcanzadas por el cambio."]);
  });

  it("eliminar un feriado ya vigente, con horas y cierre: retira su traza, lo borra y reinterpreta (after: null) en la misma transacción; audita en lenguaje humano", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T12:00:00.000Z"));
    mockedPrisma.doubleHourRule.findUnique.mockResolvedValue(feriadoRow({ multiplier: 2, employees: [] }));
    mockedPrisma.employee.findMany.mockResolvedValue([{ id: "016dc01c-655d-4474-8319-67f1b8108c93", legajo: "30", firstName: "Juan", lastName: "Pérez" }]);
    const order: string[] = [];
    mockedPrisma.specialHourRuleApplication.deleteMany.mockImplementationOnce(async () => { order.push("traza"); return { count: 23 }; });
    mockedPrisma.doubleHourRule.delete.mockImplementationOnce(async () => { order.push("regla"); return { id: "rule-feriado" }; });
    vi.mocked(reinterpretSpecialHours).mockImplementationOnce(async () => { order.push("reinterpretación"); return reinterpretation() as never; });
    try {
      await expect(workforceService.removeDoubleRule("rule-feriado")).resolves.toEqual({ mode: "DELETED", id: "rule-feriado" });
    } finally {
      vi.useRealTimers();
    }

    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000 });
    expect(order).toEqual(["reinterpretación", "traza", "regla"]);
    expect(reinterpretSpecialHours).toHaveBeenCalledWith(mockedPrisma, { before: expect.objectContaining({ id: "rule-feriado" }), after: null }, { doubleHourRuleId: "rule-feriado", doubleHourRuleName: "Día de la Raza" });
    expect(auditDescriptions()).toEqual([
      "Se eliminó definitivamente el feriado Día de la Raza (03/10/2026, x2). Se recalcularon 23 carga(s) de 18 legajo(s) y 1 cierre(s) mensual(es).",
      "Se recalculó el snapshot del cierre de octubre de 2026 de Pérez, Juan · Legajo 30 por cambio del feriado Día de la Raza. El estado del cierre no cambia.",
    ]);
    const ruleAudit = (auditService.register as Mock).mock.calls[0]![0];
    expect(ruleAudit).toMatchObject({ action: "DELETE", entity: "DoubleHourRule", entityId: "rule-feriado" });
    expect(ruleAudit.before).toMatchObject({ id: "rule-feriado", name: "Día de la Raza", kind: "FERIADO", multiplier: 2 });
    expect(ruleAudit.after).toEqual({ reinterpretation: { timeEntries: 23, breakdowns: 0, segments: 23, employees: 18, periods: ["2026-10"], protectedPeriods: [], recalculatedClosureIds: ["closure-1"] } });
    for (const description of auditDescriptions()) expect(description).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("J — si la reinterpretación falla al eliminar, el error sale de la transacción (la regla y su traza se revierten) y no se audita", async () => {
    mockedPrisma.doubleHourRule.findUnique.mockResolvedValue(feriadoRow({ multiplier: 2, employees: [] }));
    vi.mocked(reinterpretSpecialHours).mockRejectedValueOnce(new Error("boom"));

    await expect(workforceService.removeDoubleRule("rule-feriado")).rejects.toThrow("boom");
    // El borrado ocurrió dentro del callback de $transaction: al rechazar, Prisma lo revierte.
    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(auditService.register).not.toHaveBeenCalled();
  });

  it("D-5 — no elimina una regla si perdería la traza de un período protegido", async () => {
    mockedPrisma.doubleHourRule.findUnique.mockResolvedValue(feriadoRow({ multiplier: 2, employees: [] }));
    vi.mocked(reinterpretSpecialHours).mockResolvedValueOnce(reinterpretation({
      rebuiltClosures: [],
      protectedPeriods: [{ employeeId: "emp-1", period: "2026-10", status: "APROBADO", timeEntries: 0, breakdowns: 0, segments: 1, missingHistory: 0 }],
    }) as never);

    await expect(workforceService.removeDoubleRule("rule-feriado")).rejects.toMatchObject({
      statusCode: 409,
      code: "DOUBLE_HOUR_RULE_PROTECTED_HISTORY",
    });
    expect(mockedPrisma.specialHourRuleApplication.deleteMany).not.toHaveBeenCalled();
    expect(mockedPrisma.doubleHourRule.delete).not.toHaveBeenCalled();
    expect(auditService.register).not.toHaveBeenCalled();
  });

  it("D-5 — tampoco elimina la regla si un período protegido no se puede evaluar por falta de historia laboral", async () => {
    mockedPrisma.doubleHourRule.findUnique.mockResolvedValue(feriadoRow({ multiplier: 2, employees: [] }));
    vi.mocked(reinterpretSpecialHours).mockResolvedValueOnce(reinterpretation({
      rebuiltClosures: [],
      protectedPeriods: [{ employeeId: "emp-1", period: "2026-10", status: "ENVIADO", timeEntries: 0, breakdowns: 0, segments: 0, missingHistory: 2 }],
    }) as never);

    await expect(workforceService.removeDoubleRule("rule-feriado")).rejects.toMatchObject({ statusCode: 409, code: "DOUBLE_HOUR_RULE_PROTECTED_HISTORY" });
    expect(mockedPrisma.doubleHourRule.delete).not.toHaveBeenCalled();
  });

  it("si la reinterpretación falla, el error sale de la transacción (la regla no queda cambiada) y no se audita", async () => {
    vi.mocked(reinterpretSpecialHours).mockRejectedValueOnce(new Error("boom"));
    mockedPrisma.doubleHourRule.create.mockResolvedValue(feriadoRow({ multiplier: 2 }));

    await expect(workforceService.createDoubleRule({ name: "Día de la Raza", employeeIds: [] }, user)).rejects.toThrow("boom");
    expect(auditService.register).not.toHaveBeenCalled();
  });
});

// D-4: los sectores nuevos se resuelven con “Ubicado dentro de” sobre el
// alcance del puesto; por eso ya son configurables.
describe("workforceService — reglas de horas especiales y sectores del modelo nuevo (A7)", () => {
  const newSector = { name: "Agricultura", businessUnitId: "bu-1" };
  const legacySector = { name: "Pañol", businessUnitId: null };

  it("permite crear una regla limitada a un sector nuevo y la reinterpreta", async () => {
    mockedPrisma.sector.findUnique.mockResolvedValue(newSector);
    mockedPrisma.doubleHourRule.create.mockResolvedValue(ruleRow({ id: "rule-new-sector", name: "Cosecha", sectorId: "sector-agro" }));

    await workforceService.createDoubleRule({ name: "Cosecha", recurrenceType: "SEMANAL", weekdays: [6], sectorId: "sector-agro", employeeIds: [] }, user);
    expect(mockedPrisma.doubleHourRule.create).toHaveBeenCalled();
    expect(reinterpretSpecialHours).toHaveBeenCalled();
  });

  it("permite cambiar una regla existente hacia un sector nuevo", async () => {
    mockedPrisma.doubleHourRule.findUnique.mockResolvedValue(ruleRow({ id: "rule-1", name: "Domingos", sectorId: null, companyId: "losod" }));
    mockedPrisma.sector.findUnique.mockResolvedValue(newSector);
    mockedPrisma.doubleHourRule.update.mockResolvedValue(ruleRow({ id: "rule-1", name: "Domingos", sectorId: "sector-agro", companyId: "losod" }));

    await workforceService.updateDoubleRule("rule-1", { sectorId: "sector-agro" });
    expect(mockedPrisma.doubleHourRule.update).toHaveBeenCalled();
    expect(reinterpretSpecialHours).toHaveBeenCalled();
  });

  it("una regla por empresa (como “Domingos”) se edita sin consultar sectores: su alcance no cambia", async () => {
    mockedPrisma.doubleHourRule.findUnique.mockResolvedValue(ruleRow({ id: "rule-domingos", name: "Domingos", sectorId: null, companyId: "losod" }));
    mockedPrisma.doubleHourRule.update.mockResolvedValue(ruleRow({ id: "rule-domingos", name: "Domingos", sectorId: null, companyId: "losod", multiplier: 2 }));

    await workforceService.updateDoubleRule("rule-domingos", { multiplier: 2 });

    expect(mockedPrisma.sector.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.doubleHourRule.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.not.objectContaining({ sectorId: expect.anything(), companyId: expect.anything() }) }));
  });

  it("conservar el sector actual de una regla existente no se valida (no se amplía ni se reduce)", async () => {
    mockedPrisma.doubleHourRule.findUnique.mockResolvedValue(ruleRow({ id: "rule-2", name: "Regla sector", sectorId: "sector-x" }));
    mockedPrisma.doubleHourRule.update.mockResolvedValue(ruleRow({ id: "rule-2", name: "Regla sector", sectorId: "sector-x" }));

    await workforceService.updateDoubleRule("rule-2", { sectorId: "sector-x", priority: 3 });

    expect(mockedPrisma.sector.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.doubleHourRule.update).toHaveBeenCalled();
  });

  it("un sector del modelo anterior sigue permitido; un sector inexistente es 400", async () => {
    mockedPrisma.sector.findUnique.mockResolvedValueOnce(legacySector);
    mockedPrisma.doubleHourRule.create.mockResolvedValue(ruleRow({ id: "rule-5", name: "Domingo Pañol" }));
    await workforceService.createDoubleRule({ name: "Domingo Pañol", recurrenceType: "SEMANAL", weekdays: [0], sectorId: "sector-panol", employeeIds: [] }, user);
    expect(mockedPrisma.doubleHourRule.create).toHaveBeenCalled();

    mockedPrisma.sector.findUnique.mockResolvedValueOnce(null);
    await expect(workforceService.createDoubleRule({ name: "X", recurrenceType: "SEMANAL", weekdays: [0], sectorId: "missing", employeeIds: [] }, user))
      .rejects.toMatchObject({ statusCode: 400, code: "DOUBLE_HOUR_RULE_SECTOR_INVALID" });
  });
});
