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
import type { HolidayWorkAssignmentFields } from "./holidayWorkAssignmentChanges";
import { validateConvocationSchedules } from "./holidayConvocationValidation";
import { resolveConvocationSchedules } from "./holidayConvocationSchedule";
import { findProtectedClosurePeriods } from "../../shared/monthlyClosure/closurePeriodGuard";

// Etapa 5: el recálculo de cobertura de novedades se prueba en
// noveltyCoverageRecalculation.test.ts y en la integración PostgreSQL.
import { lockNoveltyCoverageGlobally } from "../novelties/noveltyCoverage.service";
import { auditNoveltyCoverageRecalculation, emptyNoveltyCoverageRecalculation, lockNoveltyCoverageForEmployees, rebuildNoveltyCoverageSnapshots, recalculateNoveltyCoverage } from "../novelties/noveltyCoverageRecalculation";
vi.mock("../novelties/noveltyCoverage.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../novelties/noveltyCoverage.service")>()),
  lockEmployeeCoverage: vi.fn(),
  lockNoveltyCoverageGlobally: vi.fn(),
}));
vi.mock("../novelties/noveltyCoverageRecalculation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../novelties/noveltyCoverageRecalculation")>();
  return {
    ...actual,
    lockNoveltyCoverageForEmployees: vi.fn(),
    recalculateNoveltyCoverage: vi.fn(async (_db: unknown, _scope: unknown, reason: Parameters<typeof actual.emptyNoveltyCoverageRecalculation>[0]) => actual.emptyNoveltyCoverageRecalculation(reason)),
    rebuildNoveltyCoverageSnapshots: vi.fn().mockResolvedValue([]),
    auditNoveltyCoverageRecalculation: vi.fn(),
    auditNoveltyCoverageRecalculationWithin: vi.fn(),
  };
});


vi.mock("./holidayWorkAssignment.repository", () => ({
  holidayWorkAssignmentRepository: {
    findCandidates: vi.fn(),
    findByDate: vi.fn(),
    findExistingForEmployees: vi.fn(),
    createMany: vi.fn(),
    updateMany: vi.fn(),
    findForEmployeesWithRelations: vi.fn(),
  },
}));

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    employee: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// §20: la convocatoria sólo define la obligación; el guardado nunca
// reinterpreta horas. El período protegido se consulta sólo para Nivel 2/3.
vi.mock("../../shared/monthlyClosure/closurePeriodGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared/monthlyClosure/closurePeriodGuard")>()),
  findProtectedClosurePeriods: vi.fn(),
}));

// §20 (D9): la validación del horario se prueba en holidayConvocationValidation.test.ts.
vi.mock("./holidayConvocationValidation", () => ({ validateConvocationSchedules: vi.fn() }));
vi.mock("./holidayConvocationSchedule", () => ({ resolveConvocationSchedules: vi.fn() }));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

// Etapa 12D: nunca duplica el cálculo de calendario — se mockea sólo la
// función fina que el service consume, no calendarPreview/DoubleHourRule
// (eso ya está cubierto en workforce.service.test.ts).
vi.mock("../workforce-management/workforce.service", () => ({
  workforceService: { holidayDatesInRange: vi.fn() },
}));

type Row = HolidayWorkAssignmentFields & { id: string; employeeId: string; createdByUserId: string | null; updatedByUserId: string | null };
const repo = holidayWorkAssignmentRepository as unknown as {
  findCandidates: Mock; findByDate: Mock; findExistingForEmployees: Mock; createMany: Mock; updateMany: Mock; findForEmployeesWithRelations: Mock;
};
const mockedPrisma = prisma as unknown as { employee: { count: Mock }; $transaction: Mock };
// EMPLOYEE_DAY_OFF.md §5: el guardado toma el lock por empleado + fecha y
// verifica francos activos; sin francos por default.
const TX = { holidayWorkAssignment: {}, $executeRaw: vi.fn(), employeeDayOff: { findMany: vi.fn() } };
const mockedAudit = auditService.register as unknown as Mock;
const mockedHolidayDates = workforceService.holidayDatesInRange as unknown as Mock;

const rrhh = { id: "user-1", role: roles.rrhh } as unknown as Express.AuthUser;
const supervisor = { id: "user-2", role: roles.supervision } as unknown as Express.AuthUser;
const loader = { id: "user-3", role: roles.cargaHoraria } as unknown as Express.AuthUser;
// Legajos del alcance de los Nivel 2/3 de prueba (employeeAccessWhere real).
let inScopeIds = new Set<string>();

// Repositorio en memoria: las pruebas verifican filas, respuesta y auditoría
// reales, no sólo llamadas. `stored` es la tabla de convocatorias de la fecha.
let stored = new Map<string, Row>();
const legajoOf = (employeeId: string) => employeeId.replace("employee-", "");
const seed = (employeeId: string, fields: Partial<HolidayWorkAssignmentFields> = {}) => {
  stored.set(employeeId, { id: `hwa-${employeeId}`, employeeId, status: "ACTIVA", shiftTemplateId: null, expectedStartTime: null, expectedEndTime: null, notes: null, createdByUserId: "user-0", updatedByUserId: "user-0", ...fields });
};
const repositoryCalls = () => repo.findExistingForEmployees.mock.calls.length + repo.createMany.mock.calls.length + repo.updateMany.mock.calls.length + repo.findForEmployeesWithRelations.mock.calls.length;

beforeEach(() => {
  vi.clearAllMocks();
  stored = new Map();
  mockedPrisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(TX));
  inScopeIds = new Set();
  // countEmployeesInScope: { AND: [{ id: { in } }, accessWhere] }. RRHH ({})
  // ve todo; Nivel 2/3 sólo `inScopeIds`.
  mockedPrisma.employee.count.mockImplementation(async ({ where }: { where: { AND: [{ id: { in: string[] } }, Record<string, unknown>] } }) => {
    const ids = new Set(where.AND[0].id.in);
    return Object.keys(where.AND[1]).length ? [...ids].filter((id) => inScopeIds.has(id)).length : ids.size;
  });
  TX.$executeRaw.mockResolvedValue(0);
  TX.employeeDayOff.findMany.mockResolvedValue([]);
  vi.mocked(findProtectedClosurePeriods).mockResolvedValue(new Map());
  // Toda fecha de estos tests es feriado; el horario de los convocados, válido.
  mockedHolidayDates.mockResolvedValue([{ date: "feriado", rules: [] }]);
  vi.mocked(validateConvocationSchedules).mockResolvedValue(new Map());
  repo.findExistingForEmployees.mockImplementation(async (_date: Date, ids: string[]) => ids.flatMap((id) => (stored.has(id) ? [{ ...stored.get(id)! }] : [])));
  repo.createMany.mockImplementation(async (_date: Date, items: Array<{ employeeId: string; fields: HolidayWorkAssignmentFields }>, userId: string) => {
    for (const { employeeId, fields } of items) stored.set(employeeId, { id: `hwa-${employeeId}`, employeeId, ...fields, createdByUserId: userId, updatedByUserId: userId });
    return { count: items.length };
  });
  repo.updateMany.mockImplementation(async (ids: string[], fields: HolidayWorkAssignmentFields, userId: string) => {
    for (const row of stored.values()) if (ids.includes(row.id)) Object.assign(row, fields, { updatedByUserId: userId });
    return { count: ids.length };
  });
  repo.findForEmployeesWithRelations.mockImplementation(async (_date: Date, ids: string[]) =>
    ids.flatMap((id) => (stored.has(id) ? [{ ...stored.get(id)!, employee: { legajo: legajoOf(id) }, shiftTemplate: null }] : [])),
  );
});

describe("holidayWorkAssignmentService.holidayDates — Etapa 12D", () => {
  it("delega en workforceService.holidayDatesInRange, no reimplementa el cálculo de calendario", async () => {
    mockedHolidayDates.mockResolvedValue([{ date: "2026-08-27", rules: [{ id: "r1", name: "Feriados" }] }]);

    const result = await holidayWorkAssignmentService.holidayDates(new Date("2026-08-01"), new Date("2026-08-31"));

    expect(mockedHolidayDates).toHaveBeenCalledWith(new Date("2026-08-01"), new Date("2026-08-31"));
    expect(result).toEqual([{ date: "2026-08-27", rules: [{ id: "r1", name: "Feriados" }] }]);
  });
});

describe("holidayWorkAssignmentService.save — guardado en lote (fix/holiday-work-assignment-performance)", () => {
  const date = new Date("2026-08-27");
  const label = "27/08/2026";
  const active = (employeeId: string, fields: Partial<HolidayWorkAssignmentFields> = {}) => ({ employeeId, status: "ACTIVA" as const, ...fields });

  it("alta de un empleado: crea la fila con turno/horario/notas, la audita como CREATE y la devuelve", async () => {
    const result = await holidayWorkAssignmentService.save({ date, assignments: [active("employee-1", { shiftTemplateId: "template-1", expectedStartTime: "08:00", expectedEndTime: "16:00", notes: null })] }, rrhh);

    expect(repo.createMany).toHaveBeenCalledWith(date, [{ kind: "CREATE", employeeId: "employee-1", fields: { status: "ACTIVA", shiftTemplateId: "template-1", expectedStartTime: "08:00", expectedEndTime: "16:00", notes: null } }], "user-1", TX);
    expect(stored.get("employee-1")).toMatchObject({ status: "ACTIVA", shiftTemplateId: "template-1", createdByUserId: "user-1", updatedByUserId: "user-1" });
    expect(result).toEqual([expect.objectContaining({ employeeId: "employee-1", employee: { legajo: "1" } })]);
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE", entity: "HolidayWorkAssignment", entityId: "employee-1", description: `Se convocó a 1 a trabajar el feriado del ${label}.` }));
  });

  it("alta masiva: todas las altas en un solo createMany, una auditoría por empleado y respuesta en el orden del pedido", async () => {
    const ids = Array.from({ length: 40 }, (_, index) => `employee-${index + 1}`);

    const result = await holidayWorkAssignmentService.save({ date, assignments: ids.map((id) => active(id)) }, rrhh);

    expect(repo.createMany).toHaveBeenCalledTimes(1);
    expect(repo.createMany.mock.calls[0]![1]).toHaveLength(40);
    expect(repo.updateMany).not.toHaveBeenCalled();
    expect(result.map((row) => row.employeeId)).toEqual(ids);
    expect(mockedAudit.mock.calls.filter(([input]) => input.action === "CREATE")).toHaveLength(40);
  });

  it("guardado sin cambios: no escribe, no audita y no recalcula cobertura, pero valida francos y toma el lock de día", async () => {
    seed("employee-1", { notes: "Convocado" });
    seed("employee-2");

    const result = await holidayWorkAssignmentService.save({ date, assignments: [active("employee-1", { notes: "Convocado" }), active("employee-2")] }, rrhh);

    expect(repo.createMany).not.toHaveBeenCalled();
    expect(repo.updateMany).not.toHaveBeenCalled();
    expect(mockedAudit).not.toHaveBeenCalled();
    expect(recalculateNoveltyCoverage).not.toHaveBeenCalled();
    expect(auditNoveltyCoverageRecalculation).not.toHaveBeenCalled();
    expect(TX.$executeRaw).toHaveBeenCalledTimes(1);
    expect(lockNoveltyCoverageGlobally).not.toHaveBeenCalled();
    expect(lockNoveltyCoverageForEmployees).toHaveBeenCalledWith(TX, []);
    expect(TX.employeeDayOff.findMany).toHaveBeenCalledTimes(1);
    expect(stored.get("employee-1")!.updatedByUserId).toBe("user-0");
    expect(result.map((row) => row.employeeId)).toEqual(["employee-1", "employee-2"]);
  });

  it("cambio de turno u horario de una convocatoria existente: un update y auditoría UPDATE con antes y después", async () => {
    seed("employee-1", { shiftTemplateId: "template-1", expectedStartTime: "08:00", expectedEndTime: "16:00" });

    await holidayWorkAssignmentService.save({ date, assignments: [active("employee-1", { shiftTemplateId: "template-2", expectedStartTime: "09:00", expectedEndTime: "17:00" })] }, rrhh);

    expect(repo.updateMany).toHaveBeenCalledWith(["hwa-employee-1"], { status: "ACTIVA", shiftTemplateId: "template-2", expectedStartTime: "09:00", expectedEndTime: "17:00", notes: null }, "user-1", TX);
    expect(mockedAudit).toHaveBeenCalledTimes(1);
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "UPDATE",
      description: `Se actualizó la convocatoria de 1 para el feriado del ${label}.`,
      before: expect.objectContaining({ shiftTemplateId: "template-1", expectedStartTime: "08:00" }),
      after: expect.objectContaining({ shiftTemplateId: "template-2", expectedStartTime: "09:00" }),
    }));
    expect(recalculateNoveltyCoverage).toHaveBeenCalledTimes(1);
  });

  it("cambio de observaciones: es una modificación real (update + auditoría)", async () => {
    seed("employee-1", { notes: "Antes" });

    await holidayWorkAssignmentService.save({ date, assignments: [active("employee-1", { notes: "Después" })] }, rrhh);

    expect(stored.get("employee-1")!.notes).toBe("Después");
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE", before: expect.objectContaining({ notes: "Antes" }), after: expect.objectContaining({ notes: "Después" }) }));
  });

  it("un campo omitido se guarda como null (misma semántica que antes): omitir notas existentes es un cambio", async () => {
    seed("employee-1", { notes: "Convocado" });

    await holidayWorkAssignmentService.save({ date, assignments: [active("employee-1")] }, rrhh);

    expect(stored.get("employee-1")!.notes).toBeNull();
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE" }));
  });

  it("cancelación existente: pasa a CANCELADA sin borrar la fila y audita DEACTIVATE; las cancelaciones comparten un updateMany", async () => {
    seed("employee-1", { notes: "Convocado" });
    seed("employee-2");

    const result = await holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "CANCELADA" }, { employeeId: "employee-2", status: "CANCELADA" }] }, rrhh);

    expect(repo.updateMany).toHaveBeenCalledTimes(1);
    expect(repo.updateMany).toHaveBeenCalledWith(["hwa-employee-1", "hwa-employee-2"], { status: "CANCELADA", shiftTemplateId: null, expectedStartTime: null, expectedEndTime: null, notes: null }, "user-1", TX);
    expect(stored.get("employee-1")).toMatchObject({ status: "CANCELADA", notes: null });
    expect(result).toHaveLength(2);
    expect(mockedAudit.mock.calls.map(([input]) => input.action)).toEqual(["DEACTIVATE", "DEACTIVATE"]);
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ description: `Se canceló la convocatoria de 1 para el feriado del ${label}.` }));
  });

  it("reactivar una convocatoria CANCELADA audita como ACTIVATE", async () => {
    seed("employee-1", { status: "CANCELADA" });

    await holidayWorkAssignmentService.save({ date, assignments: [active("employee-1")] }, rrhh);

    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "ACTIVATE", description: `Se reactivó la convocatoria de 1 para el feriado del ${label}.` }));
  });

  it("cancelación inexistente: no-op — no crea una fila cancelada vacía, no audita, no recalcula y no la devuelve", async () => {
    const result = await holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "CANCELADA" }] }, rrhh);

    expect(repo.createMany).not.toHaveBeenCalled();
    expect(repo.updateMany).not.toHaveBeenCalled();
    expect(stored.size).toBe(0);
    expect(result).toEqual([]);
    expect(mockedAudit).not.toHaveBeenCalled();
    expect(recalculateNoveltyCoverage).not.toHaveBeenCalled();
  });

  it("mezcla: sólo audita lo que cambió (sin auditorías innecesarias de los convocados sin cambios)", async () => {
    for (let index = 1; index <= 30; index += 1) seed(`employee-${index}`);
    seed("employee-31", { notes: "Viene" });

    await holidayWorkAssignmentService.save({
      date,
      assignments: [
        ...Array.from({ length: 30 }, (_, index) => active(`employee-${index + 1}`)),
        { employeeId: "employee-31", status: "CANCELADA" },
        active("employee-32"),
        { employeeId: "employee-33", status: "CANCELADA" },
      ],
    }, rrhh);

    expect(mockedAudit.mock.calls.map(([input]) => [input.action, input.entityId])).toEqual([["DEACTIVATE", "employee-31"], ["CREATE", "employee-32"]]);
  });

  it("presupuesto de consultas: la cantidad de llamadas al repositorio no crece con los convocados sin cambios", async () => {
    const run = async (unchanged: number) => {
      vi.clearAllMocks();
      stored = new Map();
      for (let index = 1; index <= unchanged; index += 1) seed(`employee-${index}`);
      await holidayWorkAssignmentService.save({ date, assignments: [...Array.from({ length: unchanged }, (_, index) => active(`employee-${index + 1}`)), active("employee-new")] }, rrhh);
      return repositoryCalls();
    };

    const small = await run(2);
    const large = await run(200);

    expect(large).toBe(small);
    expect(small).toBe(3); // lectura de lo existente + createMany + lectura final
  });

  it("no permite duplicar el mismo employeeId dentro del mismo guardado", async () => {
    const attempt = holidayWorkAssignmentService.save({ date, assignments: [active("employee-1"), active("employee-1")] }, rrhh);

    await expect(attempt).rejects.toMatchObject({ statusCode: 400, code: "HOLIDAY_WORK_DUPLICATE_EMPLOYEE" });
    expect(repo.createMany).not.toHaveBeenCalled();
  });

  it("rechaza si algún employeeId no existe: 403, igual que un legajo ajeno (no revela si existe)", async () => {
    mockedPrisma.employee.count.mockResolvedValue(0);

    const attempt = holidayWorkAssignmentService.save({ date, assignments: [active("employee-inexistente")] }, rrhh);

    await expect(attempt).rejects.toMatchObject({ statusCode: 403, code: "EMPLOYEE_SCOPE_FORBIDDEN" });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("error de unicidad concurrente (P2002 en createMany) se traduce en un 409 prolijo y no audita", async () => {
    repo.createMany.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("unique violation", { code: "P2002", clientVersion: "0.0.0" }));

    const attempt = holidayWorkAssignmentService.save({ date, assignments: [active("employee-1")] }, rrhh);

    await expect(attempt).rejects.toMatchObject({ statusCode: 409, code: "HOLIDAY_WORK_ASSIGNMENT_ALREADY_EXISTS" });
    expect(mockedAudit).not.toHaveBeenCalled();
  });

  it("timeout transaccional (P2028): 503 TRANSACTION_TIMEOUT que informa que no se guardó nada, sin detalle de Prisma y sin auditar", async () => {
    mockedPrisma.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("Transaction already closed: The timeout for this transaction was 30000 ms", { code: "P2028", clientVersion: "6.19.3" }));

    const attempt = holidayWorkAssignmentService.save({ date, assignments: [active("employee-1")] }, rrhh);

    const error = await attempt.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 503, code: "TRANSACTION_TIMEOUT", message: expect.stringContaining("No se guardó ningún cambio") });
    expect((error as AppError).message).not.toMatch(/Transaction|Prisma|P2028|\d+ ms/);
    expect(mockedAudit).not.toHaveBeenCalled();
    expect(auditNoveltyCoverageRecalculation).not.toHaveBeenCalled();
  });

  it("después de un guardado confirmado, repetir el mismo pedido (reintento manual) es seguro: no duplica filas ni auditorías", async () => {
    await holidayWorkAssignmentService.save({ date, assignments: [active("employee-1")] }, rrhh);
    vi.clearAllMocks();

    await holidayWorkAssignmentService.save({ date, assignments: [active("employee-1")] }, rrhh);

    expect(repo.createMany).not.toHaveBeenCalled();
    expect(mockedAudit).not.toHaveBeenCalled();
    expect(stored.size).toBe(1);
  });

  it("el timeout no se cambia: la transacción sigue con 30 s", async () => {
    await holidayWorkAssignmentService.save({ date, assignments: [active("employee-1")] }, rrhh);

    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000 });
  });

  // §20 (reemplaza §16): la convocatoria sólo define la obligación de asistir.
  // El guardado nunca reinterpreta horas ni audita recálculos de liquidación:
  // el servicio ya no importa el motor de reinterpretación.
  it("guarda la convocatoria y recalcula sólo la cobertura de los legajos cambiados en la misma transacción", async () => {
    seed("employee-2");
    await holidayWorkAssignmentService.save({ date, assignments: [active("employee-1"), active("employee-2")] }, rrhh);

    expect(repo.findExistingForEmployees).toHaveBeenCalledWith(date, ["employee-1", "employee-2"], TX);
    expect(repo.createMany).toHaveBeenCalledWith(date, expect.any(Array), "user-1", TX);
    expect(recalculateNoveltyCoverage).toHaveBeenCalledWith(TX, { from: date, to: date, employeeIds: ["employee-1"] }, expect.objectContaining({ source: "HOLIDAY_WORK_ASSIGNMENT_CHANGED" }), { rebuildSnapshots: false });
    expect(mockedAudit.mock.calls.map(([input]) => input.entityId)).toEqual(["employee-1"]);
  });

  it("rollback cuando falla el recálculo de cobertura: el error se propaga dentro de la transacción y nada se audita", async () => {
    vi.mocked(recalculateNoveltyCoverage).mockRejectedValueOnce(new Error("boom"));

    await expect(holidayWorkAssignmentService.save({ date, assignments: [active("employee-1")] }, rrhh)).rejects.toThrow("boom");
    expect(mockedAudit).not.toHaveBeenCalled();
  });

  it("guardar una convocatoria no dispara ninguna notificación — sólo registra auditoría", async () => {
    await holidayWorkAssignmentService.save({ date, assignments: [active("employee-1")] }, rrhh);

    // auditService es el único mock de efectos secundarios en este archivo —
    // ninguna llamada a systemNotification/notifyUsers/notifyRrhh es posible
    // sin importarlas, y el service no las importa (ver holidayWorkAssignment.service.ts).
    expect(mockedAudit).toHaveBeenCalledTimes(1);
  });
});

describe("holidayWorkAssignmentService.save — franco el mismo día (docs/decisions/EMPLOYEE_DAY_OFF.md §5)", () => {
  const date = new Date("2026-08-27");

  it("convocar a alguien con franco ACTIVO ese día → 409 explícito y no se guarda (feriado + convocatoria + franco nunca coexisten)", async () => {
    TX.employeeDayOff.findMany.mockResolvedValue([{ employee: { legajo: "100", firstName: "Ana", lastName: "Pérez" } }]);

    const attempt = holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA" }] }, rrhh);

    await expect(attempt).rejects.toMatchObject({ statusCode: 409, code: "HOLIDAY_WORK_CONFLICTS_DAY_OFF", message: expect.stringContaining("Pérez, Ana · Legajo 100 tiene franco asignado") });
    expect(repo.createMany).not.toHaveBeenCalled();
    expect(mockedAudit).not.toHaveBeenCalled();
  });

  it("también valida el franco de un convocado sin cambios (misma regla que antes del procesamiento en lote)", async () => {
    seed("employee-1");
    TX.employeeDayOff.findMany.mockResolvedValue([{ employee: { legajo: "100", firstName: "Ana", lastName: "Pérez" } }]);

    await expect(holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA" }] }, rrhh)).rejects.toMatchObject({ code: "HOLIDAY_WORK_CONFLICTS_DAY_OFF" });
  });

  it("toma el mismo lock por empleado + fecha que el guardado de francos y sólo verifica francos de quienes quedan convocados", async () => {
    await holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA" }, { employeeId: "employee-2", status: "CANCELADA" }] }, rrhh);

    expect(TX.$executeRaw).toHaveBeenCalledTimes(1);
    expect(TX.employeeDayOff.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { date, status: "ACTIVO", employeeId: { in: ["employee-1"] } } }));
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

describe("holidayWorkAssignmentService.save — cobertura de novedades (NOVELTY_COVERAGE_ENGINE.md §13, §20)", () => {
  const holiday = new Date("2026-10-12T00:00:00.000Z");

  it("orden de locks día → cobertura por legajo; sin lock global; reconstruye sólo los snapshots de los pares cambiados", async () => {
    const order: string[] = [];
    // El lock por empleado + fecha es el único $executeRaw de este servicio.
    TX.$executeRaw.mockImplementationOnce(async () => (order.push("dayLock"), 0));
    vi.mocked(lockNoveltyCoverageForEmployees).mockImplementationOnce(async () => void order.push("employeeCoverageLock"));
    vi.mocked(recalculateNoveltyCoverage).mockImplementationOnce(async (_db, _scope, reason) => (order.push("coverage"), { ...emptyNoveltyCoverageRecalculation(reason), changedPairs: [{ employeeId: "employee-1", period: "2026-10" }] }));
    await holidayWorkAssignmentService.save({ date: holiday, assignments: [{ employeeId: "employee-1", status: "ACTIVA" } as never] }, rrhh);

    expect(order).toEqual(["dayLock", "employeeCoverageLock", "coverage"]);
    expect(lockNoveltyCoverageGlobally).not.toHaveBeenCalled();
    expect(lockNoveltyCoverageForEmployees).toHaveBeenCalledWith(TX, ["employee-1"]);
    expect(recalculateNoveltyCoverage).toHaveBeenCalledWith(TX, { from: holiday, to: holiday, employeeIds: ["employee-1"] }, { source: "HOLIDAY_WORK_ASSIGNMENT_CHANGED", label: "cambio de la convocatoria del feriado del 12/10/2026" }, { rebuildSnapshots: false });
    expect(rebuildNoveltyCoverageSnapshots).toHaveBeenCalledWith(TX, [{ employeeId: "employee-1", period: "2026-10" }], expect.objectContaining({ source: "HOLIDAY_WORK_ASSIGNMENT_CHANGED" }));
    expect(auditNoveltyCoverageRecalculation).toHaveBeenCalledTimes(1);
  });
});

// docs/decisions/HOLIDAY_WORK_ASSIGNMENTS_12D.md §5 (actualizado): Nivel 1, 2 y
// 3 convocan, siempre sobre legajos de su alcance (employeeAccessWhere), todo
// o nada. Nunca por grupo de turnos.
describe("holidayWorkAssignmentService.save — alcance por legajo (N1/N2/N3)", () => {
  const date = new Date("2026-08-27");

  it("Nivel 2 convoca legajos de su alcance", async () => {
    inScopeIds = new Set(["employee-1", "employee-2"]);

    await holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA" }, { employeeId: "employee-2", status: "ACTIVA" }] }, supervisor);

    expect(stored.get("employee-1")).toMatchObject({ status: "ACTIVA", createdByUserId: "user-2" });
    const [{ where }] = mockedPrisma.employee.count.mock.calls[0]! as [{ where: { AND: [unknown, Record<string, unknown>] } }];
    expect(where.AND[1]).toHaveProperty("assignments");
  });

  it("un solo legajo ajeno en el lote → 403 EMPLOYEE_SCOPE_FORBIDDEN, antes de la transacción, sin escribir ni auditar", async () => {
    inScopeIds = new Set(["employee-1"]);

    await expect(holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA" }, { employeeId: "employee-9", status: "CANCELADA" }] }, loader))
      .rejects.toMatchObject({ statusCode: 403, code: "EMPLOYEE_SCOPE_FORBIDDEN" });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(stored.size).toBe(0);
    expect(mockedAudit).not.toHaveBeenCalled();
  });

  it("período enviado a cierre: Nivel 2/3 no cambian la convocatoria (409 PERIOD_CLOSED, sin escribir)", async () => {
    inScopeIds = new Set(["employee-1"]);
    vi.mocked(findProtectedClosurePeriods).mockResolvedValue(new Map([["employee-1:2026-08", "ENVIADO"]]) as never);

    await expect(holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA" }] }, supervisor))
      .rejects.toMatchObject({ statusCode: 409, code: "PERIOD_CLOSED" });
    expect(repo.createMany).not.toHaveBeenCalled();
    expect(recalculateNoveltyCoverage).not.toHaveBeenCalled();
  });

  it("período enviado a cierre: RRHH sin motivo → 400 y no escribe", async () => {
    vi.mocked(findProtectedClosurePeriods).mockResolvedValue(new Map([["employee-1:2026-08", "ENVIADO"]]) as never);

    await expect(holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA" }] }, rrhh))
      .rejects.toMatchObject({ statusCode: 400, code: "HOLIDAY_WORK_CORRECTION_REASON_REQUIRED" });
    expect(repo.createMany).not.toHaveBeenCalled();
  });

  it("período enviado a cierre: RRHH con motivo corrige y el motivo queda en la auditoría sólo de los legajos protegidos", async () => {
    vi.mocked(findProtectedClosurePeriods).mockResolvedValue(new Map([["employee-1:2026-08", "ENVIADO"]]) as never);

    await holidayWorkAssignmentService.save({ date, correctionReason: "  Pedido de planta  ", assignments: [{ employeeId: "employee-1", status: "ACTIVA" }, { employeeId: "employee-2", status: "ACTIVA" }] }, rrhh);

    expect(stored.get("employee-1")).toMatchObject({ status: "ACTIVA" });
    const audits = Object.fromEntries(mockedAudit.mock.calls.map(([input]) => [input.entityId, input]));
    expect(audits["employee-1"]).toMatchObject({ description: "Se convocó a 1 a trabajar el feriado del 27/08/2026. Motivo: Pedido de planta", after: expect.objectContaining({ correctionReason: "Pedido de planta" }) });
    expect(audits["employee-2"].description).toBe("Se convocó a 2 a trabajar el feriado del 27/08/2026.");
    expect(audits["employee-2"].after).not.toHaveProperty("correctionReason");
  });

  it("período protegido con guardado sin cambios efectivos: no bloquea (no hay nada que proteger)", async () => {
    inScopeIds = new Set(["employee-1"]);
    seed("employee-1");
    vi.mocked(findProtectedClosurePeriods).mockResolvedValue(new Map([["employee-1:2026-08", "ENVIADO"]]) as never);

    await holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA" }] }, supervisor);

    expect(findProtectedClosurePeriods).not.toHaveBeenCalled();
  });
});

// WORKED_TIME_ACCOUNTING_MODEL.md §20 (D9/P7): sólo se convoca a feriados del
// calendario y ninguna convocatoria ACTIVA queda sin horario resoluble.
describe("holidayWorkAssignmentService.save — horario resoluble (§20)", () => {
  const date = new Date("2026-08-27");

  it("una fecha que no es feriado → 422 antes de la transacción; cancelar igual se permite", async () => {
    mockedHolidayDates.mockResolvedValue([]);

    await expect(holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA" }] }, rrhh))
      .rejects.toMatchObject({ statusCode: 422, code: "HOLIDAY_WORK_DATE_NOT_HOLIDAY" });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();

    seed("employee-1");
    await holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "CANCELADA" }] }, rrhh);
    expect(stored.get("employee-1")!.status).toBe("CANCELADA");
  });

  it("valida sólo las convocatorias que quedan ACTIVAS con un cambio (no las sin cambios ni las cancelaciones), dentro de la transacción y antes de escribir", async () => {
    seed("employee-2");
    seed("employee-3");
    vi.mocked(validateConvocationSchedules).mockImplementationOnce(async () => {
      expect(repo.createMany).not.toHaveBeenCalled();
      return new Map();
    });

    await holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA", shiftTemplateId: "tpl" }, { employeeId: "employee-2", status: "ACTIVA" }, { employeeId: "employee-3", status: "CANCELADA" }] }, rrhh);

    expect(validateConvocationSchedules).toHaveBeenCalledWith(TX, "2026-08-27", [{ employeeId: "employee-1", shiftTemplateId: "tpl" }]);
  });

  it("si la validación rechaza, no escribe ni audita", async () => {
    vi.mocked(validateConvocationSchedules).mockRejectedValueOnce(new AppError("sin turno", 422, "HOLIDAY_WORK_SCHEDULE_REQUIRED"));

    await expect(holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA" }] }, rrhh)).rejects.toMatchObject({ code: "HOLIDAY_WORK_SCHEDULE_REQUIRED" });
    expect(repo.createMany).not.toHaveBeenCalled();
    expect(mockedAudit).not.toHaveBeenCalled();
  });

  it("el aviso de conflicto de rotación viaja en la respuesta y en la auditoría (nunca se oculta)", async () => {
    vi.mocked(validateConvocationSchedules).mockResolvedValueOnce(new Map([["employee-1", "La rotación tiene un conflicto ese día (los bloques del día se superponen); rige el turno de la convocatoria."]]));

    const result = await holidayWorkAssignmentService.save({ date, assignments: [{ employeeId: "employee-1", status: "ACTIVA", shiftTemplateId: "tpl" }] }, rrhh);

    expect(result[0]).toMatchObject({ scheduleWarning: expect.stringContaining("los bloques del día se superponen") });
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("rige el turno de la convocatoria") }));
  });
});

describe("holidayWorkAssignmentService.candidates — turno real del feriado (§20)", () => {
  it("con fecha agrega expectedSchedule, franco y período cerrado; sin fecha, expectedSchedule null", async () => {
    repo.findCandidates.mockResolvedValue([[{ id: "employee-1", legajo: "1", dayOffs: [{ id: "d" }], monthlyClosures: [{ status: "ENVIADO" }] }], 1]);
    vi.mocked(resolveConvocationSchedules).mockResolvedValue(new Map([["employee-1", { kind: "ROTATION_REST", blocks: [], planReason: null }]]));
    const date = new Date("2026-12-08T00:00:00.000Z");

    const result = await holidayWorkAssignmentService.candidates({ date, page: 1, take: 100 }, rrhh);

    expect(resolveConvocationSchedules).toHaveBeenCalledWith(prisma, ["employee-1"], "2026-12-08");
    expect(result.items).toEqual([{ id: "employee-1", legajo: "1", dayOff: true, periodLocked: true, expectedSchedule: { kind: "ROTATION_REST", blocks: [], planReason: null } }]);

    repo.findCandidates.mockResolvedValue([[{ id: "employee-1", legajo: "1", dayOffs: [], monthlyClosures: [] }], 1]);
    expect((await holidayWorkAssignmentService.candidates({ page: 1, take: 100 }, rrhh)).items[0]).toMatchObject({ expectedSchedule: null, dayOff: false, periodLocked: false });
  });
});
