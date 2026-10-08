import { describe, expect, it, vi } from "vitest";
import { evaluateSpecialHourRulesByDate, resolveSpecialHourRulesByDate } from "./timeEntries.repository";

vi.mock("../../shared/prisma/client", () => ({ prisma: {} }));

/**
 * D-4/D-5 (docs/decisions/ORG_LOCATION_REORGANIZATION.md §18-§19):
 * caracterización del motor de horas especiales con HISTORIA temporal.
 * Reemplaza a la caracterización de A7 (alcance por valores vigentes). El
 * motor real corre contra un cliente en memoria: las vigencias y reglas son
 * las de la base; nada se escribe.
 */
type Row = { id: string; effectiveFrom: Date; effectiveTo: Date | null };
const d = (key: string) => new Date(`${key}T00:00:00.000Z`);
const period = (from: string, to: string | null = null) => ({ id: `p-${from}`, effectiveFrom: d(from), effectiveTo: to ? d(to) : null });

type World = {
  position?: Array<Row & { positionId: string | null }>;
  costCenter?: Array<Row & { costCenterId: string | null }>;
  legacySector?: Array<Row & { sectorId: string | null }>;
  employer?: Array<Row & { companies: Array<{ companyId: string }> }>;
  scopes?: Array<Row & { positionId: string; nodes: Array<{ level: string; companyId: string | null; businessUnitId: string | null; sectorId: string | null; areaId: string | null; areaSectorId: string | null }> }>;
  rules: Array<Record<string, unknown>>;
  convocations?: Array<{ date: Date; employeeId: string }>;
};

function db(world: World) {
  return {
    employeePositionPeriod: { findMany: async () => world.position ?? [] },
    employeeCostCenterPeriod: { findMany: async () => world.costCenter ?? [] },
    employeeLegacySectorPeriod: { findMany: async () => world.legacySector ?? [] },
    employeeEmployerPeriod: { findMany: async () => world.employer ?? [] },
    positionOrgScopePeriod: { findMany: async () => world.scopes ?? [] },
    doubleHourRule: { findMany: async ({ where }: { where: { kind?: string } }) => world.rules.filter((rule) => !where.kind || rule.kind === where.kind) },
    holidayWorkAssignment: { findMany: async () => world.convocations ?? [] },
  } as never;
}

const rule = (overrides: Record<string, unknown>) => ({
  id: "rule", name: "Regla", kind: "OTRO", recurrenceType: "SEMANAL", fromDate: d("2026-01-01"), toDate: d("2028-12-31"), weekdays: [0],
  multiplier: 2, priority: 0, companyId: null, sectorId: null, costCenterId: null, positionId: null, dates: [], sector: null, ...overrides,
});
const domingos = rule({ id: "domingos", name: "Domingos", companyId: "losod" });
const feriados = rule({ id: "feriados", name: "Feriados", kind: "FERIADO", recurrenceType: "FECHA", priority: 1, weekdays: [], dates: [{ date: d("2026-10-12"), isActive: true }] });

const SAT = d("2026-09-26");
const SUN_BEFORE = d("2026-09-27");
const SUN_AFTER = d("2026-10-04");
const HOLIDAY = d("2026-10-12");

const outcome = async (world: World, dates: Date[]) =>
  Object.fromEntries([...(await evaluateSpecialHourRulesByDate("emp-1", dates, db(world)))].map(([key, value]) => [key, value.missingHistory ? `MISSING:${value.missingHistory.dimensions.join("+")}` : Number(value.resolution!.multiplier)]));

describe("motor de horas especiales con historia temporal (D-5)", () => {
  it("“Domingos” (empresa LOSOD) usa la empresa empleadora VIGENTE ESE DÍA: antes y después de un cambio de empresa", async () => {
    const world: World = { rules: [domingos], employer: [{ ...period("2026-01-01", "2026-09-30"), companies: [{ companyId: "losod" }] }, { ...period("2026-10-01"), companies: [{ companyId: "tropa" }] }] };
    expect(await outcome(world, [SUN_BEFORE, SUN_AFTER])).toEqual({ "2026-09-27": 2, "2026-10-04": 1 });
  });

  it("sin historia que cubra la fecha falta evidencia: MISSING, nunca el valor actual", async () => {
    const world: World = { rules: [domingos], employer: [{ ...period("2026-10-01"), companies: [{ companyId: "losod" }] }] };
    expect(await outcome(world, [SUN_BEFORE, SUN_AFTER])).toEqual({ "2026-09-27": "MISSING:EMPLOYER", "2026-10-04": 2 });
  });

  it("sólo exige historia donde la regla puede aplicar: un sábado o una regla sin alcance se resuelven sin historia", async () => {
    expect(await outcome({ rules: [domingos, feriados] }, [SAT, HOLIDAY])).toEqual({ "2026-09-26": 1, "2026-10-12": 2 });
  });

  it("FERIADO con convocatoria: decide la convocatoria, no el alcance ni la historia", async () => {
    const scopedFeriado = { ...feriados, companyId: "tropa" };
    const convoked: World = { rules: [scopedFeriado], convocations: [{ date: HOLIDAY, employeeId: "emp-1" }] };
    expect(await outcome(convoked, [HOLIDAY])).toEqual({ "2026-10-12": 2 });
    const others: World = { rules: [scopedFeriado], convocations: [{ date: HOLIDAY, employeeId: "emp-2" }] };
    expect(await outcome(others, [HOLIDAY])).toEqual({ "2026-10-12": 1 });
  });

  it("sector nuevo: “Ubicado dentro de” con el alcance del puesto vigente ese día (cambio de alcance del puesto compartido)", async () => {
    const agro = rule({ id: "agro", sectorId: "agro", sector: { isLegacy: false } });
    const world: World = {
      rules: [agro],
      position: [{ ...period("2026-01-01"), positionId: "pos-shared" }],
      scopes: [
        { ...period("2026-01-01", "2026-09-30"), positionId: "pos-shared", nodes: [{ level: "SECTOR", companyId: null, businessUnitId: null, sectorId: "agro", areaId: null, areaSectorId: null }] },
        { ...period("2026-10-01"), positionId: "pos-shared", nodes: [{ level: "SECTOR", companyId: null, businessUnitId: null, sectorId: "ganaderia", areaId: null, areaSectorId: null }] },
      ],
    };
    expect(await outcome(world, [SUN_BEFORE, SUN_AFTER])).toEqual({ "2026-09-27": 2, "2026-10-04": 1 });
  });

  it("resolveSpecialHourRulesByDate exige historia para TODAS las fechas: 409 por la primera sin evidencia, antes de que el llamador escriba", async () => {
    const world: World = { rules: [domingos], employer: [{ ...period("2026-10-01"), companies: [{ companyId: "losod" }] }] };
    await expect(resolveSpecialHourRulesByDate("emp-1", [SUN_AFTER, SUN_BEFORE], db(world))).rejects.toMatchObject({
      statusCode: 409,
      code: "SPECIAL_HOUR_SCOPE_HISTORY_MISSING",
      details: expect.objectContaining({ employeeId: "emp-1", date: "2026-09-27", period: "2026-09", dimensions: ["EMPLOYER"], ruleId: "domingos", ruleName: "Domingos" }),
      message: expect.stringContaining("27/09/2026"),
    });
  });

  it("carga atrasada con historia suficiente: resuelve con los valores de esa fecha aunque hoy sean otros", async () => {
    const world: World = { rules: [domingos], employer: [{ ...period("2026-01-01", "2026-09-30"), companies: [{ companyId: "losod" }] }, { ...period("2026-10-01"), companies: [] }] };
    const resolved = await resolveSpecialHourRulesByDate("emp-1", [SUN_BEFORE], db(world));
    expect(Number(resolved.get("2026-09-27")!.multiplier)).toBe(2);
  });
});
