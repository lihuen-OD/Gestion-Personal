import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConvocationSchedules, type ConvocationSchedule } from "./holidayConvocationSchedule";
import { validateConvocationSchedules } from "./holidayConvocationValidation";

vi.mock("../../shared/prisma/client", () => ({ prisma: {} }));
vi.mock("./holidayConvocationSchedule", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./holidayConvocationSchedule")>()),
  resolveConvocationSchedules: vi.fn(),
}));

/**
 * WORKED_TIME_ACCOUNTING_MODEL.md §20 (D9): tabla de validación del horario de
 * las convocatorias ACTIVAS. El horario real lo da resolveConvocationSchedules
 * (probado en holidayConvocationSchedule.test.ts y en PostgreSQL).
 */
const DATE = "2026-12-08";
const template = (id: string, overrides: Record<string, unknown> = {}) => ({ id, code: id.toUpperCase(), startTime: "08:00", endTime: "16:00", crossesMidnight: false, status: "ACTIVO", ...overrides });
const schedule = (kind: ConvocationSchedule["kind"], planReason: ConvocationSchedule["planReason"] = null): ConvocationSchedule => ({ kind, blocks: [], planReason });

let templates: Array<ReturnType<typeof template>> = [];
const db = {
  shiftTemplate: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => templates.filter((row) => where.id.in.includes(row.id))) },
  employee: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, legajo: id.replace("emp-", ""), firstName: "Ana", lastName: `Apellido ${id}` }))) },
};
const validate = (items: Array<{ employeeId: string; shiftTemplateId: string | null }>) => validateConvocationSchedules(db as never, DATE, items);
const given = (entries: Record<string, ConvocationSchedule>) => vi.mocked(resolveConvocationSchedules).mockResolvedValue(new Map(Object.entries(entries)));

beforeEach(() => {
  vi.clearAllMocks();
  templates = [template("tpl"), template("inactive", { status: "INACTIVO" }), template("broken", { startTime: "8", endTime: "x" })];
});

describe("validateConvocationSchedules — §20 D9", () => {
  it("sin convocatorias activadas no consulta nada", async () => {
    expect(await validate([])).toEqual(new Map());
    expect(resolveConvocationSchedules).not.toHaveBeenCalled();
  });

  it.each([["FIXED"], ["ROTATION_SHIFTS"]] as const)("%s sin plantilla → OK (usa el turno del día)", async (kind) => {
    given({ "emp-1": schedule(kind) });
    expect(await validate([{ employeeId: "emp-1", shiftTemplateId: null }])).toEqual(new Map());
  });

  it.each([["ROTATION_REST"], ["ROTATION_MISSING"], ["NONE"]] as const)("%s sin plantilla → 422 HOLIDAY_WORK_SCHEDULE_REQUIRED con el legajo", async (kind) => {
    given({ "emp-1": schedule(kind) });
    await expect(validate([{ employeeId: "emp-1", shiftTemplateId: null }])).rejects.toMatchObject({
      statusCode: 422,
      code: "HOLIDAY_WORK_SCHEDULE_REQUIRED",
      message: expect.stringContaining("Apellido emp-1, Ana · Legajo 1 no tiene un turno para el 08/12/2026"),
    });
  });

  it.each([["FIXED"], ["ROTATION_SHIFTS"], ["ROTATION_REST"], ["ROTATION_MISSING"], ["NONE"]] as const)("%s con plantilla válida → OK, sin aviso", async (kind) => {
    given({ "emp-1": schedule(kind) });
    expect(await validate([{ employeeId: "emp-1", shiftTemplateId: "tpl" }])).toEqual(new Map());
  });

  it("rotación con conflicto sin plantilla → 422 con el motivo legible (sin identificadores técnicos)", async () => {
    given({ "emp-1": schedule("ROTATION_CONFLICT", "OVERLAPPING_BLOCKS") });
    const error = await validate([{ employeeId: "emp-1", shiftTemplateId: null }]).catch((reason: unknown) => reason);
    expect(error).toMatchObject({ statusCode: 422, code: "HOLIDAY_WORK_ROTATION_CONFLICT", message: expect.stringContaining("los bloques del día se superponen") });
    expect((error as Error).message).not.toMatch(/block:|OVERLAPPING/);
  });

  it("rotación con conflicto y plantilla válida → OK con aviso visible", async () => {
    given({ "emp-1": schedule("ROTATION_CONFLICT", "MULTIPLE_VERSIONS") });
    expect(await validate([{ employeeId: "emp-1", shiftTemplateId: "tpl" }])).toEqual(new Map([["emp-1", expect.stringContaining("más de una versión de la grilla rige ese día")]]));
  });

  it.each([["inactive"], ["broken"], ["missing"]])("plantilla %s → 422 HOLIDAY_WORK_TEMPLATE_INVALID (aunque tenga turno ese día)", async (templateId) => {
    given({ "emp-1": schedule("FIXED") });
    await expect(validate([{ employeeId: "emp-1", shiftTemplateId: templateId }])).rejects.toMatchObject({ statusCode: 422, code: "HOLIDAY_WORK_TEMPLATE_INVALID" });
  });

  it("valida todo el lote con consultas fijas y nombra a todos los afectados", async () => {
    given({ "emp-1": schedule("NONE"), "emp-2": schedule("ROTATION_REST"), "emp-3": schedule("FIXED") });
    await expect(validate([{ employeeId: "emp-1", shiftTemplateId: null }, { employeeId: "emp-2", shiftTemplateId: null }, { employeeId: "emp-3", shiftTemplateId: null }])).rejects.toMatchObject({
      message: expect.stringMatching(/Legajo 1; .*Legajo 2 no tiene/),
    });
    expect(resolveConvocationSchedules).toHaveBeenCalledTimes(1);
    expect(db.employee.findMany).toHaveBeenCalledTimes(1);
  });
});
