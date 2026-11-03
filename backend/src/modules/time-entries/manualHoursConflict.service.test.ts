import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// docs/decisions/MANUAL_HOURS_VS_CLOCK_PUNCH.md: decisión del responsable sobre
// una fichada que cayó en una fecha con horas cargadas a mano.

const tx = { marker: "tx" };

vi.mock("../../shared/prisma/client", () => ({
  prisma: { $transaction: vi.fn(async (callback: (db: unknown) => unknown) => callback(tx)) },
}));
vi.mock("./manualHoursConflict.repository", () => ({
  manualHoursConflictRepository: {
    findConflicts: vi.fn(),
    findConflict: vi.fn(),
    findTarget: vi.fn(),
    countEmployeeInScope: vi.fn(),
    findDecisionState: vi.fn(),
    findNormalEntries: vi.fn(),
    findNormalHourConceptId: vi.fn(),
    updateEntry: vi.fn(),
    createEntry: vi.fn(),
    updateShift: vi.fn(),
    markResolved: vi.fn(),
    findDecisionAudits: vi.fn(async () => new Map()),
  },
}));
vi.mock("./timeEntries.repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./timeEntries.repository")>()),
  resolveSpecialHourRulesByDate: vi.fn(),
}));
vi.mock("./timeEntries.service", () => ({ syncAutomaticHourConceptBreakdownsSafely: vi.fn() }));
vi.mock("../employee-day-offs/employeeDayLock", () => ({ lockEmployeeDays: vi.fn() }));
vi.mock("../../shared/monthlyClosure/closurePeriodGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared/monthlyClosure/closurePeriodGuard")>()),
  findProtectedClosurePeriods: vi.fn(),
}));
vi.mock("../workforce-management/closureSnapshot", () => ({ findClosuresForEmployeePeriods: vi.fn(async () => []), rebuildClosureSnapshots: vi.fn(async () => []) }));
vi.mock("../workforce-management/closureRecalculationAudit", () => ({ auditClosureRecalculations: vi.fn() }));
vi.mock("../audit/audit.service", () => ({ auditService: { registerWithin: vi.fn() }, clearAuditDerivedCaches: vi.fn() }));
vi.mock("./workedTimeReadCaches", () => ({ clearWorkedTimeDerivedReadCaches: vi.fn() }));
vi.mock("../shifts/shiftAlert.cache", () => ({ clearShiftAlertReadCaches: vi.fn() }));
vi.mock("../workforce-management/workforce.cache", () => ({ clearNotificationsListCache: vi.fn() }));

import { findProtectedClosurePeriods } from "../../shared/monthlyClosure/closurePeriodGuard";
import { auditService } from "../audit/audit.service";
import { lockEmployeeDays } from "../employee-day-offs/employeeDayLock";
import { KEEP_MANUAL_RESOLUTION_NOTE, USE_CLOCK_RESOLUTION_NOTE } from "./manualHoursConflict";
import { manualHoursConflictRepository as repository } from "./manualHoursConflict.repository";
import { manualHoursConflictService } from "./manualHoursConflict.service";
import { resolveSpecialHourRulesByDate } from "./timeEntries.repository";
import { syncAutomaticHourConceptBreakdownsSafely } from "./timeEntries.service";

const rrhh = { id: "user-rrhh", role: "NIVEL_1_RRHH" } as Express.AuthUser;
const supervisor = { id: "user-sup", role: "NIVEL_2_SUPERVISION" } as Express.AuthUser;
const carga = { id: "user-carga", role: "NIVEL_3_CARGA_HORARIA" } as Express.AuthUser;

// Jornada 13/10 08:00–14:42 (402 min) del fichador; carga manual de 8 h ese día.
const conflict = (overrides: Record<string, unknown> = {}) => ({
  id: "alert-1",
  status: "PENDIENTE",
  resolutionNote: null,
  resolvedAt: null,
  actualAt: new Date("2026-10-13T17:42:00.000Z"),
  resolvedBy: null,
  employee: { id: "employee-1", legajo: "11", firstName: "Sereno", lastName: "Once" },
  workShift: {
    id: "shift-1",
    source: "KIOSK",
    startAt: new Date("2026-10-13T11:00:00.000Z"),
    endAt: new Date("2026-10-13T17:42:00.000Z"),
    totalMinutes: 402,
    observation: "nota previa",
    hourConceptId: "concept-normal",
    shiftTemplate: null,
    timeSegments: [{ id: "segment-1", date: new Date("2026-10-13T00:00:00.000Z"), minutes: 402, fromDateTime: new Date("2026-10-13T11:00:00.000Z"), toDateTime: new Date("2026-10-13T17:42:00.000Z") }],
  },
  ...overrides,
});
const manualRow = { id: "entry-manual", employeeId: "employee-1", date: new Date("2026-10-13T00:00:00.000Z"), hours: new Prisma.Decimal(8), totalMinutes: 480, actualMinutes: null, status: "EN_REVISION", source: null, observation: "Carga del encargado" };

describe("manualHoursConflictService.resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repository.findTarget).mockResolvedValue({ id: "alert-1", employeeId: "employee-1" });
    vi.mocked(repository.countEmployeeInScope).mockResolvedValue(1);
    vi.mocked(repository.findConflict).mockResolvedValue(conflict() as never);
    vi.mocked(repository.findDecisionState).mockResolvedValue({ status: "PENDIENTE", resolutionNote: null } as never);
    vi.mocked(repository.findNormalEntries).mockResolvedValue([manualRow] as never);
    vi.mocked(findProtectedClosurePeriods).mockResolvedValue(new Map());
    vi.mocked(resolveSpecialHourRulesByDate).mockResolvedValue(new Map([["2026-10-13", { multiplier: 1, matchedRules: [], winners: [], conflicting: false }]]) as never);
  });

  it("id inexistente → 404; fuera del alcance → 403 sin abrir la transacción", async () => {
    vi.mocked(repository.findTarget).mockResolvedValueOnce(null);
    await expect(manualHoursConflictService.resolve("missing", { decision: "KEEP_MANUAL" }, rrhh)).rejects.toMatchObject({ statusCode: 404, code: "MANUAL_HOURS_CONFLICT_NOT_FOUND" });

    vi.mocked(repository.countEmployeeInScope).mockResolvedValueOnce(0);
    await expect(manualHoursConflictService.resolve("alert-1", { decision: "KEEP_MANUAL" }, supervisor)).rejects.toMatchObject({ statusCode: 403, code: "EMPLOYEE_SCOPE_FORBIDDEN" });
    expect(repository.countEmployeeInScope).toHaveBeenCalledWith("employee-1", expect.objectContaining({ assignments: expect.anything() }));
    expect(repository.markResolved).not.toHaveBeenCalled();
  });

  it("MANTENER carga manual: no toca horas ni la jornada, deja la decisión y la audita en la misma transacción", async () => {
    await manualHoursConflictService.resolve("alert-1", { decision: "KEEP_MANUAL" }, carga, { userId: carga.id });

    expect(lockEmployeeDays).toHaveBeenCalledWith(tx, [{ employeeId: "employee-1", dateKey: "2026-10-13" }]);
    expect(repository.updateEntry).not.toHaveBeenCalled();
    expect(repository.createEntry).not.toHaveBeenCalled();
    expect(repository.updateShift).not.toHaveBeenCalled();
    expect(repository.markResolved).toHaveBeenCalledWith(tx, "alert-1", { userId: carga.id, resolutionNote: KEEP_MANUAL_RESOLUTION_NOTE });
    expect(auditService.registerWithin).toHaveBeenCalledWith(tx, expect.objectContaining({
      entity: "ShiftAlert",
      entityId: "alert-1",
      description: expect.stringContaining("Once, Sereno · Legajo 11 del 13/10/2026: se mantuvo la carga manual (8 h); la fichada (6 h 42 min) queda como evidencia"),
      before: expect.objectContaining({ decision: null, manualMinutes: 480, clockMinutes: 402 }),
      after: expect.objectContaining({ decision: "KEEP_MANUAL" }),
    }));
    expect(syncAutomaticHourConceptBreakdownsSafely).not.toHaveBeenCalled();
  });

  it("USAR horas fichadas: reemplaza el valor de la carga manual por lo fichado, procesa la jornada y recalcula Motor B después del commit", async () => {
    await manualHoursConflictService.resolve("alert-1", { decision: "USE_CLOCK" }, supervisor, { userId: supervisor.id });

    expect(resolveSpecialHourRulesByDate).toHaveBeenCalledWith("employee-1", [new Date("2026-10-13T00:00:00.000Z")], tx);
    expect(repository.updateEntry).toHaveBeenCalledWith(tx, "entry-manual", expect.objectContaining({
      hours: 402 / 60,
      totalMinutes: 402,
      actualMinutes: 402,
      source: "KIOSK",
      status: "APROBADO",
      workShiftId: "shift-1",
      timeSegmentId: "segment-1",
      observation: expect.stringContaining("Revisión: se reemplazó la carga manual (8 h) por las horas fichadas (6 h 42 min)."),
    }));
    expect(repository.createEntry).not.toHaveBeenCalled();
    expect(repository.updateShift).toHaveBeenCalledWith(tx, "shift-1", { status: "PROCESADO", observation: "nota previa · Revisión: se usaron las horas fichadas." });
    expect(repository.markResolved).toHaveBeenCalledWith(tx, "alert-1", { userId: supervisor.id, resolutionNote: USE_CLOCK_RESOLUTION_NOTE });
    expect(syncAutomaticHourConceptBreakdownsSafely).toHaveBeenCalledWith("employee-1", "2026-10", undefined, { userId: supervisor.id });
  });

  it("USAR horas fichadas sin carga en una fecha de la jornada: crea la fila automática de esa fecha", async () => {
    vi.mocked(repository.findNormalEntries).mockResolvedValue([]);

    await manualHoursConflictService.resolve("alert-1", { decision: "USE_CLOCK" }, rrhh);

    expect(repository.createEntry).toHaveBeenCalledWith(tx, expect.objectContaining({ employeeId: "employee-1", totalMinutes: 402, source: "KIOSK", status: "APROBADO" }));
  });

  it("período enviado/aprobado: Nivel 2/3 → 409; RRHH sin motivo → 400; RRHH con motivo usa las horas fichadas y la jornada sigue observada", async () => {
    vi.mocked(findProtectedClosurePeriods).mockResolvedValue(new Map([["employee-1:2026-10", "APROBADO"]]) as never);

    await expect(manualHoursConflictService.resolve("alert-1", { decision: "USE_CLOCK" }, supervisor)).rejects.toMatchObject({ statusCode: 409, code: "PERIOD_CLOSED" });
    await expect(manualHoursConflictService.resolve("alert-1", { decision: "USE_CLOCK" }, rrhh)).rejects.toMatchObject({ statusCode: 400, code: "MANUAL_HOURS_CORRECTION_REASON_REQUIRED" });
    expect(repository.updateEntry).not.toHaveBeenCalled();

    await manualHoursConflictService.resolve("alert-1", { decision: "USE_CLOCK", correctionReason: "Se verificó con el encargado" }, rrhh, { userId: rrhh.id });
    expect(repository.updateShift).toHaveBeenCalledWith(tx, "shift-1", expect.objectContaining({ status: "OBSERVADO" }));
    expect(auditService.registerWithin).toHaveBeenCalledWith(tx, expect.objectContaining({ description: expect.stringContaining("Motivo: Se verificó con el encargado") }));
  });

  it("MANTENER también se permite en un período protegido (no cambia horas)", async () => {
    vi.mocked(findProtectedClosurePeriods).mockResolvedValue(new Map([["employee-1:2026-10", "ENVIADO"]]) as never);

    await expect(manualHoursConflictService.resolve("alert-1", { decision: "KEEP_MANUAL" }, supervisor)).resolves.toBeDefined();
    expect(findProtectedClosurePeriods).not.toHaveBeenCalled();
  });

  it("idempotencia: la misma decisión repetida no escribe ni audita; otra decisión sobre una revisión resuelta → 409", async () => {
    vi.mocked(repository.findDecisionState).mockResolvedValue({ status: "RESUELTA", resolutionNote: KEEP_MANUAL_RESOLUTION_NOTE } as never);

    await manualHoursConflictService.resolve("alert-1", { decision: "KEEP_MANUAL" }, rrhh);
    expect(repository.markResolved).not.toHaveBeenCalled();
    expect(auditService.registerWithin).not.toHaveBeenCalled();

    await expect(manualHoursConflictService.resolve("alert-1", { decision: "USE_CLOCK" }, rrhh)).rejects.toMatchObject({ statusCode: 409, code: "MANUAL_HOURS_CONFLICT_ALREADY_RESOLVED" });
    expect(repository.updateEntry).not.toHaveBeenCalled();
  });
});

describe("manualHoursConflictService.list", () => {
  it("una revisión resuelta muestra las horas que vio quien decidió (la carga manual reemplazada ya no es una fila) y lo que computa hoy", async () => {
    vi.mocked(repository.findConflicts).mockResolvedValue([conflict({ status: "RESUELTA", resolutionNote: USE_CLOCK_RESOLUTION_NOTE })] as never);
    vi.mocked(repository.findNormalEntries).mockResolvedValue([{ ...manualRow, id: "entry-1", hours: new Prisma.Decimal(6.7), totalMinutes: 402, source: "KIOSK", status: "APROBADO" }] as never);
    vi.mocked(repository.findDecisionAudits).mockResolvedValue(new Map([["alert-1", { decision: null, days: [{ date: "2026-10-13", manualMinutes: 480, manualStatus: "EN_REVISION", clockMinutes: 402, countedMinutes: 480 }] }]]) as never);

    const { items } = await manualHoursConflictService.list({ period: "2026-10" }, rrhh);

    expect(repository.findDecisionAudits).toHaveBeenCalledWith(["alert-1"], undefined);
    expect(items[0]).toMatchObject({
      status: "RESUELTA",
      decision: "USE_CLOCK",
      manualMinutes: 480,
      clockMinutes: 402,
      differenceMinutes: -78,
      days: [{ date: "2026-10-13", manualMinutes: 480, manualStatus: "EN_REVISION", clockMinutes: 402, countedMinutes: 402 }],
    });
  });

  it("sólo dentro del alcance del usuario y con la vista que usa Carga de horas (horas manuales, fichadas y diferencia)", async () => {
    vi.mocked(repository.findConflicts).mockResolvedValue([conflict()] as never);
    vi.mocked(repository.findNormalEntries).mockResolvedValue([manualRow] as never);

    const { items } = await manualHoursConflictService.list({ period: "2026-10" }, supervisor);

    expect(repository.findConflicts).toHaveBeenCalledWith(expect.objectContaining({ employee: expect.objectContaining({ assignments: expect.anything() }) }));
    expect(items).toEqual([expect.objectContaining({
      id: "alert-1",
      operationalDate: "2026-10-13",
      status: "PENDIENTE",
      decision: null,
      manualMinutes: 480,
      clockMinutes: 402,
      differenceMinutes: -78,
      days: [{ date: "2026-10-13", manualMinutes: 480, manualStatus: "EN_REVISION", clockMinutes: 402, countedMinutes: 480 }],
    })]);
  });

  it("una revisión de otro período no se lista", async () => {
    vi.mocked(repository.findConflicts).mockResolvedValue([conflict()] as never);
    vi.mocked(repository.findNormalEntries).mockResolvedValue([] as never);

    expect((await manualHoursConflictService.list({ period: "2026-11" }, rrhh)).items).toEqual([]);
  });
});
