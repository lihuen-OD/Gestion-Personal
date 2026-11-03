import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { roles } from "../../shared/security/roles";
import { findProtectedClosurePeriods } from "../../shared/monthlyClosure/closurePeriodGuard";
import { auditService } from "../audit/audit.service";
import { auditClosureRecalculations } from "../workforce-management/closureRecalculationAudit";
import { findClosuresForEmployeePeriods, rebuildClosureSnapshots } from "../workforce-management/closureSnapshot";
import { lockEmployeeDays } from "./employeeDayLock";
import { ensureDayOffActivityAlert, findClockWorkShiftsForOperationalDate, resolveDayOffActivityAlerts } from "./employeeDayOffActivity";
import { employeeDayOffRepository } from "./employeeDayOff.repository";
import { employeeDayOffService } from "./employeeDayOff.service";

vi.mock("./employeeDayOff.repository", () => ({
  employeeDayOffRepository: {
    findForPeriod: vi.fn(),
    findCandidatesByDate: vi.fn(),
    countEmployeesInScope: vi.fn(),
    findOnDate: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findActiveHolidayWork: vi.fn(),
    resolvePendingInactivity: vi.fn(),
  },
}));
vi.mock("./employeeDayLock", () => ({ lockEmployeeDays: vi.fn() }));
vi.mock("./employeeDayOffActivity", () => ({ ensureDayOffActivityAlert: vi.fn(), findClockWorkShiftsForOperationalDate: vi.fn(), resolveDayOffActivityAlerts: vi.fn() }));
vi.mock("../../shared/monthlyClosure/closurePeriodGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared/monthlyClosure/closurePeriodGuard")>()),
  findProtectedClosurePeriods: vi.fn(),
}));
vi.mock("../workforce-management/closureSnapshot", () => ({ findClosuresForEmployeePeriods: vi.fn(), rebuildClosureSnapshots: vi.fn() }));
vi.mock("../workforce-management/closureRecalculationAudit", () => ({ auditClosureRecalculations: vi.fn() }));
vi.mock("../audit/audit.service", () => ({ auditService: { register: vi.fn() } }));
vi.mock("../../shared/prisma/client", () => ({ prisma: { $transaction: vi.fn() } }));

const repo = employeeDayOffRepository as unknown as Record<keyof typeof employeeDayOffRepository, Mock>;
const TX = { tx: true };

const EMP_1 = "11111111-1111-4111-8111-111111111111";
const EMP_2 = "22222222-2222-4222-8222-222222222222";
const OUTSIDE = "33333333-3333-4333-8333-333333333333";
const DATE = "2026-11-05";
const rrhh = { id: "user-rrhh", role: roles.rrhh } as Express.AuthUser;
const supervision = { id: "user-sup", role: roles.supervision } as Express.AuthUser;
const carga = { id: "user-carga", role: roles.cargaHoraria } as Express.AuthUser;

const person = (id: string, legajo: string, lastName: string) => ({ id, legajo, firstName: "Ana", lastName });
const people: Record<string, ReturnType<typeof person>> = { [EMP_1]: person(EMP_1, "10", "Pérez"), [EMP_2]: person(EMP_2, "20", "Gómez") };
function row(employeeId: string, status: "ACTIVO" | "CANCELADO", notes: string | null = null) {
  return { id: `dayoff-${employeeId.slice(0, 4)}`, employeeId, date: new Date(`${DATE}T00:00:00.000Z`), status, notes, createdAt: new Date(), updatedAt: new Date(), employee: people[employeeId] };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation(((callback: (tx: unknown) => unknown) => Promise.resolve(callback(TX))) as never);
  repo.countEmployeesInScope.mockImplementation(async (ids: string[]) => ids.filter((id) => id !== OUTSIDE).length);
  repo.findOnDate.mockResolvedValue([]);
  repo.create.mockImplementation(async (_db: unknown, input: { employeeId: string; notes: string | null }) => row(input.employeeId, "ACTIVO", input.notes));
  repo.update.mockImplementation(async (_db: unknown, id: string, input: { status: "ACTIVO" | "CANCELADO"; notes: string | null }) => row(id === row(EMP_1, "ACTIVO").id ? EMP_1 : EMP_2, input.status, input.notes));
  repo.findActiveHolidayWork.mockResolvedValue([]);
  repo.resolvePendingInactivity.mockResolvedValue({ count: 0 });
  vi.mocked(findProtectedClosurePeriods).mockResolvedValue(new Map());
  vi.mocked(findClockWorkShiftsForOperationalDate).mockResolvedValue([]);
  vi.mocked(resolveDayOffActivityAlerts).mockResolvedValue(0);
  vi.mocked(ensureDayOffActivityAlert).mockResolvedValue(true);
  vi.mocked(findClosuresForEmployeePeriods).mockResolvedValue([]);
  vi.mocked(rebuildClosureSnapshots).mockResolvedValue([]);
});

const save = (employees: Array<{ employeeId: string; status: "ACTIVO" | "CANCELADO"; notes?: string | null }>, user = rrhh, correctionReason?: string) =>
  employeeDayOffService.save({ date: DATE, employees, ...(correctionReason ? { correctionReason } : {}) }, user, { userId: user.id, ipAddress: "1.1.1.1" });

describe("employeeDayOffService.save — selección múltiple, auditoría e idempotencia", () => {
  it("asigna franco a varias personas de una vez, cada una con su auditoría humana (before/after, usuario, empleado, fecha)", async () => {
    const result = await save([{ employeeId: EMP_1, status: "ACTIVO", notes: "Pedido del encargado" }, { employeeId: EMP_2, status: "ACTIVO" }]);

    expect(repo.create).toHaveBeenCalledTimes(2);
    expect(repo.create).toHaveBeenCalledWith(TX, { employeeId: EMP_1, date: new Date(`${DATE}T00:00:00.000Z`), notes: "Pedido del encargado", userId: "user-rrhh" });
    expect(result.summary).toMatchObject({ changed: 2, unchanged: 0 });
    const audits = vi.mocked(auditService.register).mock.calls.map(([entry]) => entry);
    expect(audits.map((entry) => entry.description)).toEqual([
      "Se asignó franco a Pérez, Ana · Legajo 10 para el 05/11/2026.",
      "Se asignó franco a Gómez, Ana · Legajo 20 para el 05/11/2026.",
    ]);
    expect(audits[0]).toMatchObject({ action: "CREATE", entity: "EmployeeDayOff", userId: "user-rrhh", after: expect.objectContaining({ employeeId: EMP_1, date: DATE, status: "ACTIVO" }) });
    // Lock por empleado + fecha para todo el lote (serializa guardados concurrentes).
    expect(lockEmployeeDays).toHaveBeenCalledWith(TX, [{ employeeId: EMP_1, dateKey: DATE }, { employeeId: EMP_2, dateKey: DATE }]);
  });

  it("cancelar y reactivar nunca borran: actualizan el estado, con 'Se canceló…' / 'Se reactivó…'", async () => {
    repo.findOnDate.mockResolvedValue([row(EMP_1, "ACTIVO"), row(EMP_2, "CANCELADO")]);

    await save([{ employeeId: EMP_1, status: "CANCELADO" }, { employeeId: EMP_2, status: "ACTIVO" }]);

    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith(TX, row(EMP_1, "ACTIVO").id, { status: "CANCELADO", notes: null, userId: "user-rrhh" });
    const audits = vi.mocked(auditService.register).mock.calls.map(([entry]) => entry);
    expect(audits.map((entry) => [entry.action, entry.description])).toEqual([
      ["DEACTIVATE", "Se canceló el franco de Pérez, Ana · Legajo 10 para el 05/11/2026."],
      ["ACTIVATE", "Se reactivó el franco de Gómez, Ana · Legajo 20 para el 05/11/2026."],
    ]);
    expect(audits[0]).toMatchObject({ before: expect.objectContaining({ status: "ACTIVO" }), after: expect.objectContaining({ status: "CANCELADO" }) });
  });

  it("idempotente: repetir el mismo guardado no escribe, no audita y no recalcula nada", async () => {
    repo.findOnDate.mockResolvedValue([row(EMP_1, "ACTIVO", "nota")]);

    const result = await save([{ employeeId: EMP_1, status: "ACTIVO", notes: "nota" }, { employeeId: EMP_2, status: "CANCELADO" }]);

    expect(result.summary).toMatchObject({ changed: 0, unchanged: 2 });
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
    expect(auditService.register).not.toHaveBeenCalled();
    expect(findProtectedClosurePeriods).not.toHaveBeenCalled();
  });

  it("sólo cambia la nota: UPDATE auditado; sin `notes` en el ítem se conserva la guardada", async () => {
    repo.findOnDate.mockResolvedValue([row(EMP_1, "ACTIVO", "vieja"), row(EMP_2, "ACTIVO", "se queda")]);

    await save([{ employeeId: EMP_1, status: "ACTIVO", notes: "nueva" }, { employeeId: EMP_2, status: "ACTIVO" }]);

    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(vi.mocked(auditService.register).mock.calls[0]![0]).toMatchObject({ action: "UPDATE", description: "Se actualizó la nota del franco de Pérez, Ana · Legajo 10 para el 05/11/2026." });
  });

  it("misma persona dos veces en el lote → 400 sin tocar nada", async () => {
    await expect(save([{ employeeId: EMP_1, status: "ACTIVO" }, { employeeId: EMP_1, status: "CANCELADO" }])).rejects.toMatchObject({ statusCode: 400, code: "DAY_OFF_DUPLICATE_EMPLOYEE" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("dos guardados concurrentes del mismo empleado/fecha: el @@unique (P2002) se traduce a 409 prolijo, nunca 500", async () => {
    repo.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "6" }));

    await expect(save([{ employeeId: EMP_1, status: "ACTIVO" }])).rejects.toMatchObject({ statusCode: 409, code: "DAY_OFF_CONCURRENT_UPDATE" });
    expect(auditService.register).not.toHaveBeenCalled();
  });
});

describe("employeeDayOffService.save — permisos por alcance (backend, nunca sólo frontend)", () => {
  it("un UUID fuera del alcance pasado a mano → 403 y no se guarda NADA del lote", async () => {
    await expect(save([{ employeeId: EMP_1, status: "ACTIVO" }, { employeeId: OUTSIDE, status: "ACTIVO" }], carga)).rejects.toMatchObject({ statusCode: 403, code: "EMPLOYEE_SCOPE_FORBIDDEN" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("Nivel 1 RRHH: alcance administrativo completo (employeeAccessWhere = {})", async () => {
    await save([{ employeeId: EMP_1, status: "ACTIVO" }], rrhh);
    expect(repo.countEmployeesInScope).toHaveBeenCalledWith([EMP_1], {});
  });

  it.each([
    ["Nivel 2 Supervisión", supervision],
    ["Nivel 3 Carga horaria", carga],
  ])("%s: sólo legajos con su asignación TIME_RESPONSIBLE vigente", async (_label, user) => {
    await save([{ employeeId: EMP_1, status: "ACTIVO" }], user);
    expect(repo.countEmployeesInScope).toHaveBeenCalledWith([EMP_1], { assignments: { some: expect.objectContaining({ type: "TIME_RESPONSIBLE", userId: user.id }) } });
  });
});

describe("employeeDayOffService.save — períodos cerrados (EMPLOYEE_DAY_OFF.md §12)", () => {
  const closed = () => vi.mocked(findProtectedClosurePeriods).mockResolvedValue(new Map([[`${EMP_1}:2026-11`, "APROBADO"]]));

  it.each([["Nivel 2", supervision], ["Nivel 3", carga]])("%s no puede modificar un franco de un período enviado/aprobado → 409 PERIOD_CLOSED", async (_label, user) => {
    closed();
    await expect(save([{ employeeId: EMP_1, status: "ACTIVO" }], user)).rejects.toMatchObject({ statusCode: 409, code: "PERIOD_CLOSED" });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("RRHH sin motivo → 400; con motivo → guarda, audita el motivo y NO reconstruye el snapshot del cierre protegido", async () => {
    closed();
    await expect(save([{ employeeId: EMP_1, status: "ACTIVO" }], rrhh)).rejects.toMatchObject({ statusCode: 400, code: "DAY_OFF_CORRECTION_REASON_REQUIRED" });

    vi.mocked(findClosuresForEmployeePeriods).mockResolvedValue([{ id: "closure-1", employeeId: EMP_1, period: "2026-11", snapshot: {} }]);
    await save([{ employeeId: EMP_1, status: "ACTIVO" }], rrhh, "Franco acordado y omitido");

    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(vi.mocked(auditService.register).mock.calls[0]![0]).toMatchObject({
      description: "Se asignó franco a Pérez, Ana · Legajo 10 para el 05/11/2026. Motivo: Franco acordado y omitido",
      after: expect.objectContaining({ correctionReason: "Franco acordado y omitido" }),
    });
    expect(rebuildClosureSnapshots).toHaveBeenCalledWith(TX, [], { reason: "EMPLOYEE_DAY_OFF_CHANGED", date: DATE });
  });

  it("período no protegido con snapshot (DEVUELTO): se reconstruye y se audita el recálculo", async () => {
    const closure = { id: "closure-1", employeeId: EMP_1, period: "2026-11", snapshot: {} };
    vi.mocked(findClosuresForEmployeePeriods).mockResolvedValue([closure]);
    vi.mocked(rebuildClosureSnapshots).mockResolvedValue([{ ...closure, before: {}, after: {} }]);

    await save([{ employeeId: EMP_1, status: "ACTIVO" }]);

    expect(rebuildClosureSnapshots).toHaveBeenCalledWith(TX, [closure], { reason: "EMPLOYEE_DAY_OFF_CHANGED", date: DATE });
    expect(auditClosureRecalculations).toHaveBeenCalledWith([{ ...closure, before: {}, after: {} }], "cambio de francos del 05/11/2026", expect.anything(), expect.any(Function));
  });
});

describe("employeeDayOffService.save — feriado y actividad ya registrada", () => {
  it("persona convocada a trabajar ese feriado → 409 explícito, nunca resolución silenciosa", async () => {
    repo.findActiveHolidayWork.mockResolvedValue([{ employee: people[EMP_1] }]);

    await expect(save([{ employeeId: EMP_1, status: "ACTIVO" }])).rejects.toMatchObject({
      statusCode: 409,
      code: "DAY_OFF_CONFLICTS_HOLIDAY_WORK",
      message: expect.stringContaining("Pérez, Ana · Legajo 10 está convocado a trabajar el feriado del 05/11/2026"),
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("cancelar un franco nunca choca con una convocatoria (sólo se verifica al activar)", async () => {
    repo.findOnDate.mockResolvedValue([row(EMP_1, "ACTIVO")]);
    await save([{ employeeId: EMP_1, status: "CANCELADO" }]);
    expect(repo.findActiveHolidayWork).toHaveBeenCalledWith(TX, new Date(`${DATE}T00:00:00.000Z`), []);
  });

  it("franco creado DESPUÉS de la fichada: en la misma transacción alerta las jornadas de esa fecha operativa y resuelve la inactividad pendiente", async () => {
    const shift = { id: "shift-1", employeeId: EMP_1, startAt: new Date("2026-11-05T11:00:00.000Z"), shiftTemplate: null };
    vi.mocked(findClockWorkShiftsForOperationalDate).mockResolvedValue([shift]);
    repo.resolvePendingInactivity.mockResolvedValue({ count: 1 });

    const result = await save([{ employeeId: EMP_1, status: "ACTIVO" }]);

    expect(findClockWorkShiftsForOperationalDate).toHaveBeenCalledWith(TX, [EMP_1], DATE);
    expect(ensureDayOffActivityAlert).toHaveBeenCalledWith(TX, shift);
    expect(repo.resolvePendingInactivity).toHaveBeenCalledWith(TX, new Date(`${DATE}T00:00:00.000Z`), [EMP_1]);
    expect(result.summary).toMatchObject({ activityAlerts: 1, resolvedInactivityIncidents: 1 });
  });

  it("cancelar el franco después: resuelve las alertas de franco pendientes de esas jornadas (sin borrar evidencia)", async () => {
    repo.findOnDate.mockResolvedValue([row(EMP_1, "ACTIVO")]);
    vi.mocked(findClockWorkShiftsForOperationalDate).mockResolvedValue([{ id: "shift-1", employeeId: EMP_1, startAt: new Date(), shiftTemplate: null }]);
    vi.mocked(resolveDayOffActivityAlerts).mockResolvedValue(1);

    const result = await save([{ employeeId: EMP_1, status: "CANCELADO" }]);

    expect(resolveDayOffActivityAlerts).toHaveBeenCalledWith(TX, ["shift-1"]);
    expect(ensureDayOffActivityAlert).not.toHaveBeenCalled();
    expect(repo.resolvePendingInactivity).toHaveBeenCalledWith(TX, expect.any(Date), []);
    expect(result.summary.resolvedActivityAlerts).toBe(1);
  });
});

describe("employeeDayOffService.byDate", () => {
  it("devuelve personas del alcance con franco, convocatoria y período cerrado de esa fecha", async () => {
    repo.findCandidatesByDate.mockResolvedValue([[
      { ...people[EMP_1], dayOffs: [{ id: "d1", status: "ACTIVO", notes: null, updatedAt: new Date("2026-11-01T00:00:00.000Z") }], holidayWorkAssignments: [], monthlyClosures: [{ status: "APROBADO" }] },
      { ...people[EMP_2], dayOffs: [], holidayWorkAssignments: [{ id: "h1" }], monthlyClosures: [] },
    ], 2]);

    const result = await employeeDayOffService.byDate({ date: DATE, page: 1, take: 50 }, carga);

    expect(repo.findCandidatesByDate).toHaveBeenCalledWith({ date: DATE, page: 1, take: 50 }, new Date(`${DATE}T00:00:00.000Z`), "2026-11", expect.objectContaining({ assignments: expect.anything() }));
    expect(result.items).toEqual([
      { employee: people[EMP_1], dayOff: { id: "d1", status: "ACTIVO", notes: null, updatedAt: new Date("2026-11-01T00:00:00.000Z") }, holidayWork: false, periodLocked: true },
      { employee: people[EMP_2], dayOff: null, holidayWork: true, periodLocked: false },
    ]);
    expect(result.meta).toEqual({ total: 2, page: 1, pageSize: 50, hasMore: false });
  });
});
