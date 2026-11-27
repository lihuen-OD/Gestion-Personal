import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadRotationConfiguration } from "./rotationPlan.loader";
import { resolveRotationDayPlan } from "./rotationPlan";
import { resolveConvocationSchedules, scheduleRequiresTemplate } from "./holidayConvocationSchedule";

vi.mock("./rotationPlan.loader", () => ({ loadRotationConfiguration: vi.fn() }));
vi.mock("./rotationPlan", async (importOriginal) => ({ ...(await importOriginal<typeof import("./rotationPlan")>()), resolveRotationDayPlan: vi.fn() }));

/**
 * WORKED_TIME_ACCOUNTING_MODEL.md §20: turno REAL del feriado (sin la
 * convocatoria). Defecto de Planta: un turno fijo cerrado al entrar a una
 * rotación sigue HABILITADO y no debe proponerse.
 */
const DATE = "2026-12-08"; // martes
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const tpl = (id: string, startTime: string) => ({ id, code: id.toUpperCase(), name: `Turno ${id}`, startTime, endTime: "23:00", status: "ACTIVO" });
const assignment = (employeeId: string, template: ReturnType<typeof tpl>, overrides: Record<string, unknown> = {}) => ({ employeeId, status: "HABILITADO", effectiveFrom: day("2026-01-01"), effectiveTo: null, weekdays: [], shiftTemplate: template, ...overrides });
const plans = (entries: Record<string, Record<string, unknown>>) =>
  vi.mocked(resolveRotationDayPlan).mockImplementation(((employeeId: string) => (entries[employeeId] ? { employeeId, dateKey: DATE, source: "ROTATION", ...entries[employeeId] } : null)) as never);

let assignments: Array<ReturnType<typeof assignment>> = [];
let regimes: Array<{ employeeId: string; effectiveFrom: Date; effectiveTo: Date | null; workRegime: { kind: string } }> = [];
const db = {
  shiftAssignment: { findMany: vi.fn(async ({ where }: { where: { employeeId: { in: string[] } } }) => assignments.filter((row) => where.employeeId.in.includes(row.employeeId))) },
  employeeWorkRegime: { findMany: vi.fn(async () => regimes) },
};

beforeEach(() => {
  vi.clearAllMocks();
  assignments = [];
  regimes = [];
  vi.mocked(loadRotationConfiguration).mockResolvedValue({ memberships: [], rotations: [] } as never);
  plans({});
});

describe("resolveConvocationSchedules — §20", () => {
  it("rotación: SHIFTS con sus bloques; REST, MISSING y CONFLICT explícitos; reemplaza a los fijos", async () => {
    plans({
      "rot-shifts": { kind: "SHIFTS", blocks: [{ template: { id: "t", code: "PLANTA-M", startTime: "07:00", endTime: "17:00" } }] },
      "rot-rest": { kind: "REST" },
      "rot-missing": { kind: "MISSING", reason: "NO_DAY_ROW" },
      "rot-conflict": { kind: "CONFLICT", reason: "OVERLAPPING_BLOCKS", detail: ["block:x#0"] },
    });
    assignments = [assignment("rot-rest", tpl("old", "06:00"))];

    const result = await resolveConvocationSchedules(db as never, ["rot-shifts", "rot-rest", "rot-missing", "rot-conflict"], DATE);

    expect(Object.fromEntries(result)).toEqual({
      "rot-shifts": { kind: "ROTATION_SHIFTS", blocks: [{ templateId: "t", code: "PLANTA-M", name: null, startTime: "07:00", endTime: "17:00" }], planReason: null },
      "rot-rest": { kind: "ROTATION_REST", blocks: [], planReason: null },
      "rot-missing": { kind: "ROTATION_MISSING", blocks: [], planReason: "NO_DAY_ROW" },
      "rot-conflict": { kind: "ROTATION_CONFLICT", blocks: [], planReason: "OVERLAPPING_BLOCKS" },
    });
    expect(db.shiftAssignment.findMany).not.toHaveBeenCalled();
    expect(loadRotationConfiguration).toHaveBeenCalledWith(db, { fromKey: DATE, toKey: DATE, employeeIds: ["rot-shifts", "rot-rest", "rot-missing", "rot-conflict"] });
  });

  it("fijos: sólo vigentes ese día y aplicables a su día de semana, ordenados por inicio; la consulta filtra vigencia", async () => {
    assignments = [
      assignment("emp-1", tpl("tarde", "14:00")),
      assignment("emp-1", tpl("manana", "06:00")),
      assignment("emp-1", tpl("finde", "08:00"), { weekdays: [0, 6] }),
      assignment("emp-2", tpl("vencido", "06:00"), { effectiveTo: day("2026-11-01") }),
    ];

    const result = await resolveConvocationSchedules(db as never, ["emp-1", "emp-2", "emp-3"], DATE);

    expect(result.get("emp-1")).toEqual({ kind: "FIXED", planReason: null, blocks: [expect.objectContaining({ templateId: "manana", name: "Turno manana" }), expect.objectContaining({ templateId: "tarde" })] });
    expect(result.get("emp-2")).toEqual({ kind: "NONE", blocks: [], planReason: null });
    expect(result.get("emp-3")).toEqual({ kind: "NONE", blocks: [], planReason: null });
    expect(db.shiftAssignment.findMany.mock.calls[0]![0].where).toMatchObject({ status: "HABILITADO", shiftTemplate: { status: "ACTIVO" }, effectiveFrom: { lte: day(DATE) } });
    expect(db.shiftAssignment.findMany).toHaveBeenCalledTimes(1);
  });

  it("régimen SIN_TURNO vigente → sin turno aplicable aunque conserve asignaciones", async () => {
    assignments = [assignment("emp-1", tpl("manana", "06:00"))];
    regimes = [{ employeeId: "emp-1", effectiveFrom: day("2026-01-01"), effectiveTo: null, workRegime: { kind: "SIN_TURNO" } }];
    expect((await resolveConvocationSchedules(db as never, ["emp-1"], DATE)).get("emp-1")!.kind).toBe("NONE");
  });

  it("sin legajos no consulta nada", async () => {
    expect((await resolveConvocationSchedules(db as never, [], DATE)).size).toBe(0);
    expect(loadRotationConfiguration).not.toHaveBeenCalled();
  });

  it("qué casos exigen plantilla", () => {
    expect(["FIXED", "ROTATION_SHIFTS", "ROTATION_REST", "ROTATION_MISSING", "ROTATION_CONFLICT", "NONE"].filter((kind) => scheduleRequiresTemplate(kind as never))).toEqual(["ROTATION_CONFLICT"]);
  });
});
