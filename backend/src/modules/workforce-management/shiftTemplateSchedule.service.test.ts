import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { auditService } from "../audit/audit.service";
import { recalculateNoveltyCoverage } from "../novelties/noveltyCoverageRecalculation";
import { pendingFixedEntryJobs, shiftTemplateHistory, shiftTemplateScheduleService } from "./shiftTemplateSchedule.service";
import { globalShiftActor } from "../shifts/shiftWriteAccess";
const RRHH_ACTOR = globalShiftActor({ id: "user-1", role: "NIVEL_1_RRHH" } as never);

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    shiftTemplate: { findUnique: vi.fn(), create: vi.fn() },
    shiftAssignment: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    holidayWorkAssignment: { findFirst: vi.fn(), findMany: vi.fn() },
    workShift: { findFirst: vi.fn() },
    shiftRotationBlock: { findFirst: vi.fn() },
    shiftRotationVersion: { findMany: vi.fn() },
    clockPunchPostProcessJob: { count: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));
vi.mock("../audit/audit.service", () => ({ auditService: { registerWithin: vi.fn() } }));
vi.mock("../novelties/noveltyCoverage.service", () => ({ lockNoveltyCoverageGlobally: vi.fn() }));
vi.mock("../novelties/noveltyCoverageRecalculation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../novelties/noveltyCoverageRecalculation")>();
  return {
    ...actual,
    recalculateNoveltyCoverage: vi.fn(async (_db, _scope, reason) => actual.emptyNoveltyCoverageRecalculation(reason)),
    auditNoveltyCoverageRecalculationWithin: vi.fn(),
  };
});

const db = prisma as any;
const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";
const NEW_ID = "22222222-2222-4222-8222-222222222222";
const input = { effectiveFrom: "2026-11-25", startTime: "08:00", endTime: "16:00", code: "NUEVO", name: "Horario nuevo" };

function template(updatedAt = new Date("2026-11-24T12:00:00.000Z")) {
  return {
    id: TEMPLATE_ID, code: "VIEJO", name: "Horario viejo", description: null, categoryName: null, shiftGroupId: null, shiftGroup: null,
    startTime: "07:00", endTime: "15:00", crossesMidnight: false, expectedMinutes: 480,
    entryToleranceBeforeMinutes: 10, entryToleranceAfterMinutes: 10, exitToleranceBeforeMinutes: 20, exitToleranceAfterMinutes: 20,
    minimumMinutesForCompliance: 420, maximumInformativeMinutes: 540, missingOutAlertAfterMinutes: 60,
    absoluteOpenShiftLimitMinutes: 1200, warningThresholdMinutes: 720, reviewThresholdMinutes: 960, criticalThresholdMinutes: null,
    status: "ACTIVO", updatedAt,
  };
}

function employee(id: string, legajo: string) {
  return { id, legajo, firstName: "Ana", lastName: "Pérez" };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-24T15:00:00.000Z"));
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
  db.shiftTemplate.findUnique.mockResolvedValue(template());
  db.shiftTemplate.create.mockResolvedValue({ ...template(), id: NEW_ID, code: "NUEVO", name: "Horario nuevo", startTime: "08:00", endTime: "16:00" });
  db.shiftAssignment.findFirst.mockResolvedValue(null);
  db.shiftAssignment.findMany.mockResolvedValue([]);
  db.holidayWorkAssignment.findFirst.mockResolvedValue(null);
  db.holidayWorkAssignment.findMany.mockResolvedValue([]);
  db.workShift.findFirst.mockResolvedValue(null);
  db.shiftRotationBlock.findFirst.mockResolvedValue(null);
  db.shiftRotationVersion.findMany.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("protección histórica de plantillas", () => {
  it("considera las cuatro fuentes y no depende del estado actual", async () => {
    db.shiftAssignment.findFirst.mockResolvedValue({ id: "a" });
    db.holidayWorkAssignment.findFirst.mockResolvedValue({ id: "h" });
    db.workShift.findFirst.mockResolvedValue({ id: "w" });
    db.shiftRotationBlock.findFirst.mockResolvedValue({ id: "r" });
    await expect(shiftTemplateHistory(TEMPLATE_ID, "2026-11-24")).resolves.toEqual({
      hasRuled: true,
      sources: { assignment: true, holiday: true, workShift: true, rotation: true },
    });
  });

  it("cuenta sólo entradas sin snapshot en estados reprocesables", async () => {
    db.clockPunchPostProcessJob.count.mockResolvedValue(3);

    await expect(pendingFixedEntryJobs(TEMPLATE_ID)).resolves.toBe(3);
    expect(db.clockPunchPostProcessJob.count).toHaveBeenCalledWith({
      where: {
        kind: "ENTRY",
        status: { in: ["PENDING", "PROCESSING", "FAILED"] },
        workShift: { shiftTemplateId: null },
        employee: { shiftAssignments: { some: { shiftTemplateId: TEMPLATE_ID, status: "HABILITADO" } } },
      },
    });
  });
});

describe("reemplazo de horario con fecha", () => {
  it("la vista previa es determinística y separa dependencias que no modifica", async () => {
    db.shiftAssignment.findMany.mockResolvedValue([{ id: "a1", employeeId: "e1", employee: employee("e1", "10"), effectiveFrom: new Date("2026-01-01"), effectiveTo: null, weekdays: [1], observation: null, updatedAt: new Date("2026-11-01") }]);
    db.holidayWorkAssignment.findMany.mockResolvedValue([{ id: "h1", employeeId: "e1", employee: employee("e1", "10"), date: new Date("2026-12-08"), updatedAt: new Date("2026-11-02") }]);
    db.shiftRotationVersion.findMany.mockResolvedValue([{ id: "v1", effectiveFrom: new Date("2026-12-01"), effectiveTo: null, updatedAt: new Date("2026-11-03"), rotation: { code: "ROT", name: "Planta" }, days: [{ crew: { code: "A", name: "Equipo A" } }] }]);
    const first = await shiftTemplateScheduleService.preview(TEMPLATE_ID, input, RRHH_ACTOR);
    const second = await shiftTemplateScheduleService.preview(TEMPLATE_ID, input, RRHH_ACTOR);
    expect(first.confirmationToken).toBe(second.confirmationToken);
    expect(first.complete).toBe(false);
    expect(first.assignments[0]).toMatchObject({ action: "SPLIT", employee: "Pérez, Ana · Legajo 10" });
    expect(first.pendingDependencies.holidayAssignments).toHaveLength(1);
    expect(first.pendingDependencies.rotationVersions[0]).toMatchObject({ rotation: "ROT - Planta", crews: ["A - Equipo A"] });
  });

  it("R8.7: a un Nivel 2 no le nombra una rotación de otro grupo que use la plantilla (datos inconsistentes)", async () => {
    db.shiftTemplate.findUnique.mockResolvedValue({ ...template(), shiftGroupId: "g-planta" });
    db.shiftAssignment.findMany.mockResolvedValue([]);
    db.holidayWorkAssignment.findMany.mockResolvedValue([]);
    db.shiftRotationVersion.findMany.mockResolvedValue([
      { id: "v1", effectiveFrom: new Date("2026-12-01"), effectiveTo: null, updatedAt: new Date("2026-11-03"), rotation: { code: "ROT-PL", name: "Planta", shiftGroupId: "g-planta" }, days: [{ crew: { code: "A", name: "Equipo A" } }] },
      { id: "v2", effectiveFrom: new Date("2026-12-01"), effectiveTo: null, updatedAt: new Date("2026-11-03"), rotation: { code: "ROT-TA", name: "Taller", shiftGroupId: "g-taller" }, days: [{ crew: { code: "B", name: "Equipo B" } }] },
    ]);
    const stefi = { user: { id: "u-stefi", role: "NIVEL_2_SUPERVISION" } as never, scope: { all: false as const, groupIds: new Set(["g-planta"]) } };
    const preview = await shiftTemplateScheduleService.preview(TEMPLATE_ID, input, stefi);
    expect(preview.pendingDependencies.rotationVersions).toMatchObject([{ rotation: "ROT-PL - Planta", crews: ["A - Equipo A"] }, { rotation: "Rotación de otro grupo", crews: [] }]);
    expect(JSON.stringify(preview)).not.toContain("ROT-TA");
    const rrhh = await shiftTemplateScheduleService.preview(TEMPLATE_ID, input, RRHH_ACTOR);
    expect(rrhh.pendingDependencies.rotationVersions[1]).toMatchObject({ rotation: "ROT-TA - Taller" });
  });

  it("un cambio entre preview y ejecución invalida el token antes de escribir", async () => {
    const preview = await shiftTemplateScheduleService.preview(TEMPLATE_ID, input, RRHH_ACTOR);
    db.shiftTemplate.findUnique.mockResolvedValue(template(new Date("2026-11-24T13:00:00.000Z")));
    await expect(shiftTemplateScheduleService.replace(TEMPLATE_ID, { ...input, confirmationToken: preview.confirmationToken }, RRHH_ACTOR)).rejects.toMatchObject({ statusCode: 409, code: "SHIFT_TEMPLATE_REPLACEMENT_STALE" });
    expect(db.shiftTemplate.create).not.toHaveBeenCalled();
  });

  it("dependencias futuras exigen reconocimiento explícito y quedan intactas", async () => {
    db.holidayWorkAssignment.findMany.mockResolvedValue([{ id: "h1", employeeId: "e1", employee: employee("e1", "10"), date: new Date("2026-12-08"), updatedAt: new Date("2026-11-02") }]);
    const preview = await shiftTemplateScheduleService.preview(TEMPLATE_ID, input, RRHH_ACTOR);
    await expect(shiftTemplateScheduleService.replace(TEMPLATE_ID, { ...input, confirmationToken: preview.confirmationToken }, RRHH_ACTOR)).rejects.toMatchObject({ statusCode: 409, code: "SHIFT_TEMPLATE_REPLACEMENT_DEPENDENCIES" });
    expect(db.holidayWorkAssignment.findMany).toHaveBeenCalled();
    expect(db.shiftTemplate.create).not.toHaveBeenCalled();
  });

  it("divide asignaciones vigentes, reapunta futuras, audita y recalcula sólo desde X", async () => {
    const split = { id: "a1", employeeId: "e1", employee: employee("e1", "10"), effectiveFrom: new Date("2026-01-01"), effectiveTo: null, weekdays: [1, 2], observation: "vigente", updatedAt: new Date("2026-11-01") };
    const repoint = { id: "a2", employeeId: "e2", employee: employee("e2", "20"), effectiveFrom: new Date("2026-12-01"), effectiveTo: new Date("2027-01-31"), weekdays: [], observation: null, updatedAt: new Date("2026-11-02") };
    db.shiftAssignment.findMany.mockResolvedValue([split, repoint]);
    const preview = await shiftTemplateScheduleService.preview(TEMPLATE_ID, input, RRHH_ACTOR);
    const result = await shiftTemplateScheduleService.replace(TEMPLATE_ID, { ...input, confirmationToken: preview.confirmationToken }, RRHH_ACTOR);
    expect(result).toMatchObject({ assignments: 2, complete: true });
    expect(db.shiftTemplate.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ code: "NUEVO", startTime: "08:00", entryToleranceBeforeMinutes: 10 }) }));
    expect(db.shiftAssignment.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { effectiveTo: new Date("2026-11-24T00:00:00.000Z") } });
    expect(db.shiftAssignment.update).toHaveBeenCalledWith({ where: { id: "a2" }, data: { shiftTemplateId: NEW_ID } });
    expect(db.shiftAssignment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ employeeId: "e1", shiftTemplateId: NEW_ID, effectiveFrom: new Date("2026-11-25T00:00:00.000Z") }) }));
    expect(recalculateNoveltyCoverage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ employeeIds: ["e1", "e2"], from: new Date("2026-11-25T00:00:00.000Z") }), expect.objectContaining({ source: "SHIFT_TEMPLATE_CHANGED" }));
    expect(auditService.registerWithin).toHaveBeenCalledTimes(3);
  });
});
