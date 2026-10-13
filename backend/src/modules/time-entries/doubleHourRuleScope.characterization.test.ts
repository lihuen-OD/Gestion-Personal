import { describe, expect, it, vi } from "vitest";
import { evaluateSpecialHourRulesByDate, evaluateSpecialHourRulesForEmployees, resolveSpecialHourRulesByDate } from "./timeEntries.repository";

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

/**
 * La reinterpretación de una regla evalúa a todos los legajos alcanzados en
 * lote (evaluateSpecialHourRulesForEmployees). Antes eran 7 consultas por
 * legajo dentro de la transacción de la vista previa de eliminación: con 17
 * legajos superaba su timeout (P2028 → 500). El lote debe dar EXACTAMENTE lo
 * mismo que el motor por legajo, con consultas fijas.
 */
describe("motor de horas especiales en lote (varios legajos)", () => {
  type EmployeeRow<T> = T & { employeeId: string };
  type MultiWorld = {
    employer: Array<EmployeeRow<Row & { companies: Array<{ companyId: string }> }>>;
    rules: Array<Record<string, unknown> & { kind: string; employees: Array<{ employeeId: string }> }>;
    convocations: Array<{ date: Date; employeeId: string }>;
  };
  const forEmployee = (filter: string | { in: string[] }) => (row: { employeeId: string }) => (typeof filter === "string" ? row.employeeId === filter : filter.in.includes(row.employeeId));
  type RuleWhere = { kind?: string; AND?: Array<{ OR: [unknown, { employees: { some: { employeeId: string | { in: string[] } } } }] }> };

  function multiDb(world: MultiWorld) {
    const calls = { count: 0 };
    const reader = <A extends unknown[], R>(fn: (...args: A) => R) => async (...args: A) => { calls.count += 1; return fn(...args); };
    const client = {
      employeePositionPeriod: { findMany: reader(() => []) },
      employeeCostCenterPeriod: { findMany: reader(() => []) },
      employeeLegacySectorPeriod: { findMany: reader(() => []) },
      employeeEmployerPeriod: { findMany: reader(({ where }: { where: { employeeId: string | { in: string[] } } }) => world.employer.filter(forEmployee(where.employeeId))) },
      positionOrgScopePeriod: { findMany: reader(() => []) },
      doubleHourRule: {
        findMany: reader(({ where }: { where: RuleWhere }) => {
          const listed = where.AND?.[0]?.OR[1].employees.some.employeeId;
          return world.rules.filter((rule) => (!where.kind || rule.kind === where.kind) && (listed === undefined || !rule.employees.length || rule.employees.some(forEmployee(listed))));
        }),
      },
      holidayWorkAssignment: { findMany: reader(() => world.convocations) },
    };
    return { client: client as never, calls };
  }

  const guardia = rule({ id: "guardia", name: "Guardia", weekdays: [6], multiplier: 1.5, employees: [{ employeeId: "emp-3" }] });
  const world: MultiWorld = {
    rules: [{ ...domingos, employees: [] }, { ...feriados, employees: [] }, guardia] as MultiWorld["rules"],
    employer: [
      { ...period("2026-01-01"), employeeId: "emp-1", companies: [{ companyId: "losod" }] },
      { ...period("2026-10-01"), employeeId: "emp-2", companies: [{ companyId: "tropa" }] },
    ],
    convocations: [{ date: HOLIDAY, employeeId: "emp-3" }],
  };
  const datesByEmployee = new Map([
    ["emp-1", [SUN_BEFORE, HOLIDAY, SAT]],
    ["emp-2", [SUN_BEFORE, SUN_AFTER]],
    ["emp-3", [HOLIDAY, SAT]],
  ]);
  const summarize = (evaluations: Map<string, { missingHistory?: { dimensions: string[] }; resolution?: { multiplier: unknown } }>) =>
    Object.fromEntries([...evaluations].map(([key, value]) => [key, value.missingHistory ? `MISSING:${value.missingHistory.dimensions.join("+")}` : Number(value.resolution!.multiplier)]));

  it("da el mismo resultado que el motor por legajo (historia faltante, convocatoria y lista explícita incluidas)", async () => {
    const batch = await evaluateSpecialHourRulesForEmployees(datesByEmployee, multiDb(world).client);
    const expected = {
      "emp-1": { "2026-09-27": 2, "2026-10-12": 1, "2026-09-26": 1 },
      "emp-2": { "2026-09-27": "MISSING:EMPLOYER", "2026-10-04": 1 },
      "emp-3": { "2026-10-12": 2, "2026-09-26": 1.5 },
    };
    expect(Object.fromEntries([...batch].map(([employeeId, evaluations]) => [employeeId, summarize(evaluations)]))).toEqual(expected);
    for (const [employeeId, dates] of datesByEmployee) {
      const single = await evaluateSpecialHourRulesByDate(employeeId, dates, multiDb(world).client);
      expect(summarize(single)).toEqual(expected[employeeId as keyof typeof expected]);
    }
  });

  it("consultas fijas: la misma cantidad para 1 legajo que para 3 (antes, 7 por legajo)", async () => {
    const one = multiDb(world);
    await evaluateSpecialHourRulesForEmployees(new Map([["emp-1", datesByEmployee.get("emp-1")!]]), one.client);
    const three = multiDb(world);
    await evaluateSpecialHourRulesForEmployees(datesByEmployee, three.client);
    expect(three.calls.count).toBe(one.calls.count);
    expect(three.calls.count).toBeLessThanOrEqual(8);
    const emptyRun = multiDb(world);
    expect(await evaluateSpecialHourRulesForEmployees(new Map(), emptyRun.client)).toEqual(new Map());
    expect(emptyRun.calls.count).toBe(0);
  });
});
