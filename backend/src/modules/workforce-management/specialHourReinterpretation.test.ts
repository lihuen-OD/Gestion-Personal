import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { accountDay, toAccountingBaseEntry, toAccountingBreakdown } from "../time-entries/workedTimeAccounting";
import { evaluateSpecialHourRulesForEmployees } from "../time-entries/timeEntries.repository";
import { buildActiveDatesByRule, resolveWinningRules, ruleMatchesDate } from "./doubleHourRuleMatching";
import { rebuildClosureSnapshots } from "./closureSnapshot";
import { affectedWindow, reinterpretSpecialHours, reinterpretSpecialHoursOnDates, type RuleCalendar } from "./specialHourReinterpretation";

// Etapa 5: el recálculo de cobertura de novedades se prueba en
// noveltyCoverageRecalculation.test.ts y en la integración PostgreSQL.
import { rebuildNoveltyCoverageSnapshots, recalculateNoveltyCoverage, emptyNoveltyCoverageRecalculation } from "../novelties/noveltyCoverageRecalculation";
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


/**
 * docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §15: una regla de Hora
 * Especial reinterpreta las horas ya cargadas. El resultado depende sólo del
 * estado vigente de la regla y de los minutos reales, nunca del orden en que
 * se cargaron las horas y se configuró la regla.
 *
 * El motor de reglas se reemplaza por uno en memoria que usa EXACTAMENTE las
 * mismas piezas de matching (ruleMatchesDate/buildActiveDatesByRule/
 * resolveWinningRules); el alcance con historia (D-5) ya está cubierto en
 * timeEntries.repository.test.ts y laborHistory.scope.test.ts, y acá se
 * modela como lista de empleados alcanzados más un conjunto de
 * legajo + fecha sin historia suficiente. La contabilidad es la real
 * (workedTimeAccounting).
 */

vi.mock("../../shared/prisma/client", () => ({ prisma: {} }));
vi.mock("../time-entries/timeEntries.repository", () => ({
  evaluateSpecialHourRulesForEmployees: vi.fn(),
  SpecialHourScopeHistoryMissingError: class extends Error {
    code = "SPECIAL_HOUR_SCOPE_HISTORY_MISSING";
    constructor(public readonly missing: { employeeId: string; date: string }) { super(`missing ${missing.employeeId} ${missing.date}`); }
  },
}));
vi.mock("./closureSnapshot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./closureSnapshot")>();
  return { ...actual, rebuildClosureSnapshots: vi.fn() };
});

type Rule = RuleCalendar & { name: string; kind: string; multiplier: number; priority: number; status: "ACTIVO" | "INACTIVO"; employeeIds: string[] };
type Convocation = { employeeId: string; date: Date; status: "ACTIVA" | "CANCELADA" };
type Entry = { id: string; employeeId: string; date: Date; day: number; period: string; hours: number; totalMinutes: number; actualMinutes: number; status: string; appliedMultiplier: number };
type Breakdown = { id: string; employeeId: string; date: Date; day: number; period: string; hourConceptId: string; minutes: number; status: string; appliedMultiplier: number; treatment: "WITHIN_BASE" | "ADDITIVE_TO_WORKED_TOTAL" };
type Segment = { id: string; employeeId: string; date: Date; minutes: number; isSpecial: boolean };
type Application = { timeSegmentId: string; doubleHourRuleId: string; multiplierApplied: number; isWinner: boolean; wasConflicting: boolean };
type Closure = { id: string; employeeId: string; period: string; status: string; snapshot: unknown };

const JUAN = "employee-juan";
const ANA = "employee-ana";
const PEDRO = "employee-pedro";
const OCT_3 = new Date("2026-10-03T00:00:00.000Z"); // sábado
const OCT_4 = new Date("2026-10-04T00:00:00.000Z"); // domingo

// `missingHistory`: claves "legajo|YYYY-MM-DD" sin historia suficiente (D-5).
let world: { rules: Rule[]; convocations: Convocation[]; entries: Entry[]; breakdowns: Breakdown[]; segments: Segment[]; applications: Application[]; closures: Closure[]; missingHistory: Set<string> };
const emptyWorld = (): typeof world => ({ rules: [], convocations: [], entries: [], breakdowns: [], segments: [], applications: [], closures: [], missingHistory: new Set() });

function feriado(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "rule-feriado", name: "Feriado 3 de octubre", kind: "FERIADO", recurrenceType: "FECHA", fromDate: OCT_3, toDate: OCT_3, weekdays: [],
    dates: [{ date: OCT_3, isActive: true }], multiplier: 2, priority: 0, status: "ACTIVO", employeeIds: [],
    ...overrides,
  };
}

// Motor en memoria: reglas ACTIVAS, vigentes, del alcance del empleado,
// matcheadas por calendario y resueltas por prioridad (las piezas reales de
// doubleHourRuleMatching). FERIADO incluido: la convocatoria no interviene
// (WORKED_TIME_ACCOUNTING_MODEL.md §20). `world.convocations` existe sólo para
// probar que su presencia no cambia nada.
function engine(employeeId: string, dates: Date[]) {
  const result = new Map<string, { multiplier: number; matchedRules: Rule[]; winners: Rule[]; conflicting: boolean }>();
  const active = world.rules.filter((rule) => rule.status === "ACTIVO");
  const inScope = active.filter((rule) => !rule.employeeIds.length || rule.employeeIds.includes(employeeId));
  const activeDates = buildActiveDatesByRule(active);
  for (const date of dates) {
    const vigentOn = (rules: Rule[]) => rules.filter((rule) => rule.fromDate <= date && (!rule.toDate || rule.toDate >= date));
    const matchedRules = vigentOn(inScope).filter((rule) => ruleMatchesDate(rule, date, activeDates));
    const { winners, multiplier, conflicting } = resolveWinningRules(matchedRules);
    result.set(date.toISOString().slice(0, 10), { multiplier, matchedRules, winners, conflicting });
  }
  return result;
}

// Igual que una carga nueva: el multiplicador sale del motor vigente al escribir.
function loadHours(employeeId: string, date: Date, hours: number, id = `entry-${employeeId}-${date.toISOString().slice(0, 10)}`) {
  const multiplier = engine(employeeId, [date]).get(date.toISOString().slice(0, 10))!.multiplier;
  world.entries.push({ id, employeeId, date, day: date.getUTCDate(), period: "2026-10", hours, totalMinutes: hours * 60, actualMinutes: hours * 60, status: "APROBADO", appliedMultiplier: multiplier });
}

function loadConcept(employeeId: string, date: Date, hourConceptId: string, minutes: number, treatment: Breakdown["treatment"]) {
  const multiplier = engine(employeeId, [date]).get(date.toISOString().slice(0, 10))!.multiplier;
  world.breakdowns.push({ id: `bd-${hourConceptId}-${employeeId}`, employeeId, date, day: date.getUTCDate(), period: "2026-10", hourConceptId, minutes, status: "APROBADO", appliedMultiplier: multiplier, treatment });
}

const inWindow = (date: Date, where?: { gte?: Date; lte?: Date }) => (!where?.gte || date >= where.gte) && (!where?.lte || date <= where.lte);
const idsIn = (where: { id: { in: string[] } }) => new Set(where.id.in);

function fakeDb() {
  return {
    timeEntry: {
      findMany: vi.fn(async ({ where }) => world.entries.filter((row) => inWindow(row.date, where.date)).map((row) => ({ ...row }))),
      updateMany: vi.fn(async ({ where, data }) => { for (const row of world.entries) if (idsIn(where).has(row.id)) row.appliedMultiplier = data.appliedMultiplier; }),
    },
    hourConceptBreakdown: {
      findMany: vi.fn(async ({ where }) => world.breakdowns.filter((row) => inWindow(row.date, where.date)).map((row) => ({ ...row }))),
      updateMany: vi.fn(async ({ where, data }) => { for (const row of world.breakdowns) if (idsIn(where).has(row.id)) row.appliedMultiplier = data.appliedMultiplier; }),
    },
    timeSegment: {
      findMany: vi.fn(async ({ where }) => world.segments.filter((row) => inWindow(row.date, where.date)).map((row) => ({
        ...row, specialHourRuleApplications: world.applications.filter((application) => application.timeSegmentId === row.id),
      }))),
      updateMany: vi.fn(async ({ where, data }) => { for (const row of world.segments) if (idsIn(where).has(row.id)) row.isSpecial = data.isSpecial; }),
    },
    specialHourRuleApplication: {
      deleteMany: vi.fn(async ({ where }) => { world.applications = world.applications.filter((row) => !where.timeSegmentId.in.includes(row.timeSegmentId)); }),
      createMany: vi.fn(async ({ data }) => { world.applications.push(...data.map((row: Application) => ({ ...row, multiplierApplied: Number(row.multiplierApplied) }))); }),
    },
    monthlyTimeClosure: {
      findMany: vi.fn(async ({ where }) => world.closures.filter((row) => where.employeeId.in.includes(row.employeeId) && where.period.in.includes(row.period))),
    },
    // D-5: advisory lock del closurePeriodGuard.
    $executeRaw: vi.fn(async () => 0),
  };
}

let db: ReturnType<typeof fakeDb>;
const reinterpret = (before: Rule | null, after: Rule | null) =>
  reinterpretSpecialHours(db as unknown as PrismaTransactionClient, { before, after }, { doubleHourRuleId: "rule-feriado", doubleHourRuleName: "Feriado 3 de octubre" });

// Contabilidad real del día (horas base APROBADO + desgloses ≠ RECHAZADO).
function dayAccounting(employeeId: string, date: Date) {
  const day = date.getUTCDate();
  const base = world.entries.filter((row) => row.employeeId === employeeId && row.day === day).map(toAccountingBaseEntry);
  const breakdowns = world.breakdowns
    .filter((row) => row.employeeId === employeeId && row.day === day)
    .map((row) => toAccountingBreakdown({ ...row, hourConcept: { workTreatment: row.treatment } }));
  return accountDay(day, base, breakdowns);
}
const hours = (minutes: number) => minutes / 60;

beforeEach(() => {
  vi.clearAllMocks();
  world = emptyWorld();
  db = fakeDb();
  const evaluate = (employeeId: string, dates: Date[]) => new Map([...engine(employeeId, dates)].map(([key, resolution]) => [
    key,
    world.missingHistory.has(`${employeeId}|${key}`)
      ? { missingHistory: { employeeId, date: key, period: key.slice(0, 7), dimensions: ["EMPLOYER"], ruleId: "rule-x", ruleName: "Regla" } }
      : { resolution },
  ]));
  (evaluateSpecialHourRulesForEmployees as unknown as Mock).mockImplementation(async (datesByEmployee: Map<string, Date[]>) =>
    new Map([...datesByEmployee].map(([employeeId, dates]) => [employeeId, evaluate(employeeId, dates)])));
  (rebuildClosureSnapshots as unknown as Mock).mockImplementation(async (_db, closures: Closure[]) =>
    closures.map((closure) => ({ id: closure.id, employeeId: closure.employeeId, period: closure.period, before: closure.snapshot, after: { recalculated: true } })));
});

describe("Hora Especial reinterpreta las horas ya cargadas (orden indistinto)", () => {
  it("CASO A — 8 h cargadas en día normal, después se crea el feriado x2 → real 8, equivalencia 16", async () => {
    loadHours(JUAN, OCT_3, 8);
    expect(hours(dayAccounting(JUAN, OCT_3).settlement.totalMinutes)).toBe(8);

    world.rules.push(feriado());
    const result = await reinterpret(null, feriado());

    expect(hours(dayAccounting(JUAN, OCT_3).totalWorkedMinutes)).toBe(8);
    expect(hours(dayAccounting(JUAN, OCT_3).settlement.totalMinutes)).toBe(16);
    expect(result).toMatchObject({ timeEntries: 1, employees: 1, periods: ["2026-10"] });
  });

  it("CASO B — el feriado x2 ya existe y después se cargan 8 h → real 8, equivalencia 16", async () => {
    world.rules.push(feriado());
    loadHours(JUAN, OCT_3, 8);

    expect(hours(dayAccounting(JUAN, OCT_3).totalWorkedMinutes)).toBe(8);
    expect(hours(dayAccounting(JUAN, OCT_3).settlement.totalMinutes)).toBe(16);
  });

  it("A ≡ B — cargar primero y crear el feriado después da EXACTAMENTE lo mismo que tenerlo configurado antes", async () => {
    // Orden 1: horas → feriado.
    loadHours(JUAN, OCT_3, 8);
    loadConcept(JUAN, OCT_3, "sereno", 180, "WITHIN_BASE");
    loadConcept(JUAN, OCT_3, "colectivo", 60, "ADDITIVE_TO_WORKED_TOTAL");
    world.rules.push(feriado());
    await reinterpret(null, feriado());
    const loadedFirst = { accounting: dayAccounting(JUAN, OCT_3), entries: structuredClone(world.entries), breakdowns: structuredClone(world.breakdowns) };

    // Orden 2: feriado → horas.
    world = { ...emptyWorld(), rules: [feriado()] };
    db = fakeDb();
    loadHours(JUAN, OCT_3, 8);
    loadConcept(JUAN, OCT_3, "sereno", 180, "WITHIN_BASE");
    loadConcept(JUAN, OCT_3, "colectivo", 60, "ADDITIVE_TO_WORKED_TOTAL");

    expect(dayAccounting(JUAN, OCT_3)).toEqual(loadedFirst.accounting);
    expect(world.entries).toEqual(loadedFirst.entries);
    expect(world.breakdowns).toEqual(loadedFirst.breakdowns);
  });

  it("CASO C — 8 h con x2, se quita el feriado → equivalencia vuelve a 8, sin borrar ni recrear la carga", async () => {
    world.rules.push(feriado());
    loadHours(JUAN, OCT_3, 8);
    const entryId = world.entries[0]!.id;

    world.rules = [];
    await reinterpret(feriado(), null);

    expect(world.entries).toHaveLength(1);
    expect(world.entries[0]!.id).toBe(entryId);
    expect(hours(dayAccounting(JUAN, OCT_3).settlement.totalMinutes)).toBe(8);
  });

  it("CASO D — 8 h con x2, la regla pasa a x1.5 → equivalencia 12", async () => {
    world.rules.push(feriado());
    loadHours(JUAN, OCT_3, 8);

    world.rules = [feriado({ multiplier: 1.5 })];
    await reinterpret(feriado(), feriado({ multiplier: 1.5 }));

    expect(hours(dayAccounting(JUAN, OCT_3).settlement.totalMinutes)).toBe(12);
  });

  it("desactivar la regla (status INACTIVO) también vuelve la equivalencia a 8", async () => {
    world.rules.push(feriado());
    loadHours(JUAN, OCT_3, 8);

    world.rules = [feriado({ status: "INACTIVO" })];
    await reinterpret(feriado(), feriado({ status: "INACTIVO" }));

    expect(hours(dayAccounting(JUAN, OCT_3).settlement.totalMinutes)).toBe(8);
  });

  it("CASO E — base 8 + Sereno 3 (dentro de la jornada) + Colectivo 1 (adicional), feriado x2 creado después → residual 5, total 9, equivalencia 18", async () => {
    loadHours(JUAN, OCT_3, 8);
    loadConcept(JUAN, OCT_3, "sereno", 180, "WITHIN_BASE");
    loadConcept(JUAN, OCT_3, "colectivo", 60, "ADDITIVE_TO_WORKED_TOTAL");
    expect(hours(dayAccounting(JUAN, OCT_3).settlement.totalMinutes)).toBe(9);

    world.rules.push(feriado());
    const result = await reinterpret(null, feriado());
    const day = dayAccounting(JUAN, OCT_3);

    expect(hours(day.normalResidualMinutes)).toBe(5);
    expect(day.concepts).toEqual(expect.arrayContaining([
      { hourConceptId: "sereno", treatment: "WITHIN_BASE", realMinutes: 180, settlementMinutes: 360 },
      { hourConceptId: "colectivo", treatment: "ADDITIVE_TO_WORKED_TOTAL", realMinutes: 60, settlementMinutes: 120 },
    ]));
    expect(hours(day.totalWorkedMinutes)).toBe(9);
    expect(day.settlement).toEqual({ normalMinutes: 600, withinBaseMinutes: 360, additiveMinutes: 120, noveltyMinutes: 0, totalMinutes: 1080 });
    expect(result).toMatchObject({ timeEntries: 1, breakdowns: 2 });
  });

  it("CASO F — mismo caso, se quita el feriado → equivalencia vuelve a 9", async () => {
    world.rules.push(feriado());
    loadHours(JUAN, OCT_3, 8);
    loadConcept(JUAN, OCT_3, "sereno", 180, "WITHIN_BASE");
    loadConcept(JUAN, OCT_3, "colectivo", 60, "ADDITIVE_TO_WORKED_TOTAL");
    expect(hours(dayAccounting(JUAN, OCT_3).settlement.totalMinutes)).toBe(18);

    world.rules = [];
    await reinterpret(feriado(), null);

    expect(hours(dayAccounting(JUAN, OCT_3).settlement.totalMinutes)).toBe(9);
    expect(hours(dayAccounting(JUAN, OCT_3).totalWorkedMinutes)).toBe(9);
  });

  // D-5 (ORG_LOCATION_REORGANIZATION.md §18.1): un período enviado o aprobado
  // queda protegido — ni sus filas ni su snapshot se modifican; se informa
  // cuánto diferiría. Un cierre DEVUELTO (reabierto por RRHH) sí se recalcula.
  it("CASO G — período ENVIADO/APROBADO protegido: filas y snapshot intactos, diferencia informada; DEVUELTO se recalcula", async () => {
    loadHours(JUAN, OCT_3, 8);
    loadHours(ANA, OCT_3, 8);
    loadHours(PEDRO, OCT_3, 8);
    world.closures.push(
      { id: "closure-juan", employeeId: JUAN, period: "2026-10", status: "APROBADO", snapshot: { accounting: { settlement: { totalMinutes: 480 } } } },
      { id: "closure-ana", employeeId: ANA, period: "2026-10", status: "ENVIADO", snapshot: { accounting: {} } },
      { id: "closure-pedro", employeeId: PEDRO, period: "2026-10", status: "DEVUELTO", snapshot: { accounting: {} } },
    );

    world.rules.push(feriado());
    const result = await reinterpret(null, feriado());

    expect(world.entries.find((row) => row.employeeId === JUAN)!.appliedMultiplier).toBe(1);
    expect(world.entries.find((row) => row.employeeId === ANA)!.appliedMultiplier).toBe(1);
    expect(world.entries.find((row) => row.employeeId === PEDRO)!.appliedMultiplier).toBe(2);
    const [, closures, recalculation] = (rebuildClosureSnapshots as unknown as Mock).mock.calls[0]!;
    expect(closures.map((closure: Closure) => closure.id)).toEqual(["closure-pedro"]);
    expect(recalculation).toEqual({ reason: "SPECIAL_HOUR_RULE_CHANGED", doubleHourRuleId: "rule-feriado", doubleHourRuleName: "Feriado 3 de octubre" });
    expect(result.protectedPeriods).toEqual([
      { employeeId: ANA, period: "2026-10", status: "ENVIADO", timeEntries: 1, breakdowns: 0, segments: 0, missingHistory: 0 },
      { employeeId: JUAN, period: "2026-10", status: "APROBADO", timeEntries: 1, breakdowns: 0, segments: 0, missingHistory: 0 },
    ].sort((a, b) => `${a.employeeId}:${a.period}`.localeCompare(`${b.employeeId}:${b.period}`)));
    expect(world.closures.map((closure) => closure.status)).toEqual(["APROBADO", "ENVIADO", "DEVUELTO"]);
    expect(db.$executeRaw).toHaveBeenCalled();
  });

  it("CASO H — varios empleados, la regla alcanza sólo a algunos → sólo ésos se recalculan", async () => {
    loadHours(JUAN, OCT_3, 8);
    loadHours(ANA, OCT_3, 8);

    const scoped = feriado({ employeeIds: [JUAN] });
    world.rules.push(scoped);
    const result = await reinterpret(null, scoped);

    expect(hours(dayAccounting(JUAN, OCT_3).settlement.totalMinutes)).toBe(16);
    expect(hours(dayAccounting(ANA, OCT_3).settlement.totalMinutes)).toBe(8);
    expect(result).toMatchObject({ timeEntries: 1, employees: 1 });
  });

  it("cambiar el alcance (Juan → Ana) recalcula a los dos: Juan vuelve a x1 y Ana pasa a x2", async () => {
    world.rules.push(feriado({ employeeIds: [JUAN] }));
    loadHours(JUAN, OCT_3, 8);
    loadHours(ANA, OCT_3, 8);

    world.rules = [feriado({ employeeIds: [ANA] })];
    await reinterpret(feriado({ employeeIds: [JUAN] }), feriado({ employeeIds: [ANA] }));

    expect(hours(dayAccounting(JUAN, OCT_3).settlement.totalMinutes)).toBe(8);
    expect(hours(dayAccounting(ANA, OCT_3).settlement.totalMinutes)).toBe(16);
  });

  it("mover el feriado de fecha (03/10 → 04/10) revierte la fecha vieja y aplica la nueva", async () => {
    world.rules.push(feriado());
    loadHours(JUAN, OCT_3, 8);
    loadHours(JUAN, OCT_4, 8);

    const moved = feriado({ fromDate: OCT_4, toDate: OCT_4, dates: [{ date: OCT_4, isActive: true }] });
    world.rules = [moved];
    await reinterpret(feriado(), moved);

    expect(hours(dayAccounting(JUAN, OCT_3).settlement.totalMinutes)).toBe(8);
    expect(hours(dayAccounting(JUAN, OCT_4).settlement.totalMinutes)).toBe(16);
  });

  it("cruce de medianoche: jornada sábado → domingo con la regla sólo el domingo → sólo el tramo del domingo cambia", async () => {
    loadHours(JUAN, OCT_3, 2); // sábado 22:00-24:00
    loadHours(JUAN, OCT_4, 3); // domingo 00:00-03:00
    const domingo = feriado({ id: "rule-domingo", kind: "DOMINGO", recurrenceType: "SEMANAL", fromDate: new Date("2026-01-01T00:00:00.000Z"), toDate: null, weekdays: [0], dates: [] });

    world.rules.push(domingo);
    await reinterpret(null, domingo);

    expect(world.entries.map((row) => [row.day, row.appliedMultiplier])).toEqual([[3, 1], [4, 2]]);
    expect(hours(dayAccounting(JUAN, OCT_3).settlement.totalMinutes) + hours(dayAccounting(JUAN, OCT_4).settlement.totalMinutes)).toBe(2 + 6);
  });

  it("nunca muta minutos reales, estado, fecha ni concepto — sólo appliedMultiplier", async () => {
    loadHours(JUAN, OCT_3, 8);
    loadConcept(JUAN, OCT_3, "sereno", 180, "WITHIN_BASE");
    const before = structuredClone({ entries: world.entries, breakdowns: world.breakdowns });

    world.rules.push(feriado());
    await reinterpret(null, feriado());

    const strip = <T extends { appliedMultiplier: number }>(rows: T[]) => rows.map(({ appliedMultiplier: _ignored, ...rest }) => rest);
    expect(strip(world.entries)).toEqual(strip(before.entries));
    expect(strip(world.breakdowns)).toEqual(strip(before.breakdowns));
    expect(db.timeEntry.updateMany).toHaveBeenCalledWith({ where: { id: { in: [world.entries[0]!.id] } }, data: { appliedMultiplier: 2 } });
  });

  it("sin liquidación duplicada: reinterpretar dos veces es idempotente (la segunda no cambia nada)", async () => {
    loadHours(JUAN, OCT_3, 8);
    world.rules.push(feriado());
    await reinterpret(null, feriado());
    const afterFirst = structuredClone(world.entries);

    const second = await reinterpret(feriado(), feriado());

    expect(second).toMatchObject({ timeEntries: 0, breakdowns: 0, segments: 0, rebuiltClosures: [] });
    expect(world.entries).toEqual(afterFirst);
    expect(hours(dayAccounting(JUAN, OCT_3).settlement.totalMinutes)).toBe(16);
  });

  it("reconstruye la traza por tramo (SpecialHourRuleApplication + isSpecial) y la retira al quitar la regla", async () => {
    loadHours(JUAN, OCT_3, 8);
    world.segments.push({ id: "segment-1", employeeId: JUAN, date: OCT_3, minutes: 480, isSpecial: false });

    world.rules.push(feriado());
    await reinterpret(null, feriado());
    expect(world.applications).toEqual([{ timeSegmentId: "segment-1", doubleHourRuleId: "rule-feriado", multiplierApplied: 2, isWinner: true, wasConflicting: false }]);
    expect(world.segments[0]).toMatchObject({ isSpecial: true, minutes: 480 });

    world.rules = [];
    await reinterpret(feriado(), null);
    expect(world.applications).toEqual([]);
    expect(world.segments[0]).toMatchObject({ isSpecial: false, minutes: 480 });
  });

  it("no toca fechas fuera del calendario de la regla (antes o después del cambio)", async () => {
    loadHours(JUAN, new Date("2026-10-02T00:00:00.000Z"), 8);
    world.rules.push(feriado());

    const result = await reinterpret(null, feriado());

    expect(result.timeEntries).toBe(0);
    expect(evaluateSpecialHourRulesForEmployees).toHaveBeenCalledWith(new Map(), db);
  });
});

// docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §20 (reemplaza §16): la regla
// FERIADO define cuánto vale trabajar el día según SU alcance, para quien
// trabaje, convocado o no. La convocatoria sólo define la obligación de
// asistir: nunca cambia el multiplicador ni dispara una reinterpretación.
describe("FERIADO §20: el multiplicador sale del alcance de la regla, nunca de la convocatoria", () => {
  const OCT_5 = new Date("2026-10-05T00:00:00.000Z"); // lunes
  const L31 = "employee-31";
  const L30 = "employee-30";
  const feriado5 = () => feriado({ id: "rule-feriados", name: "Feriados", fromDate: OCT_5, toDate: OCT_5, dates: [{ date: OCT_5, isActive: true }] });
  const convoke = (employeeId: string, status: Convocation["status"] = "ACTIVA") => {
    world.convocations = [...world.convocations.filter((item) => item.employeeId !== employeeId), { employeeId, date: OCT_5, status }];
  };
  const minutes = (employeeId: string) => dayAccounting(employeeId, OCT_5);
  const reinterpretDate = () => reinterpretSpecialHoursOnDates(db as unknown as PrismaTransactionClient, [OCT_5], { reason: "SPECIAL_HOUR_RECONCILIATION" });

  it("el caso real L31: 2 h 26 min en un feriado x2 global → liquidación 4 h 52 min, haya o no convocatoria", async () => {
    world.rules.push(feriado5());
    loadHours(L31, OCT_5, 146 / 60);
    expect(minutes(L31).totalWorkedMinutes).toBe(146);
    expect(minutes(L31).settlement.totalMinutes).toBe(292);
    convoke(L31);
    loadHours(L30, OCT_5, 146 / 60);
    expect(minutes(L30).settlement.totalMinutes).toBe(292);
  });

  it("no convocado alcanzado por la regla cobra x2 aunque la fecha tenga otros convocados", async () => {
    world.rules.push(feriado5());
    convoke(L31);
    loadHours(L31, OCT_5, 8);
    loadHours(L30, OCT_5, 8);
    expect(hours(minutes(L31).settlement.totalMinutes)).toBe(16);
    expect(hours(minutes(L30).settlement.totalMinutes)).toBe(16);
  });

  it("convocado fuera del alcance de la regla cobra x1: la convocatoria no lo alcanza", async () => {
    world.rules.push({ ...feriado5(), employeeIds: [L30] });
    convoke(L31);
    loadHours(L31, OCT_5, 8);
    loadHours(L30, OCT_5, 8);
    expect(hours(minutes(L31).settlement.totalMinutes)).toBe(8);
    expect(hours(minutes(L30).settlement.totalMinutes)).toBe(16);
  });

  it("agregar, cancelar o quitar convocatorias no cambia ninguna carga al reinterpretar la fecha", async () => {
    world.rules.push(feriado5());
    loadHours(L31, OCT_5, 8);
    loadHours(L30, OCT_5, 8);
    const before = structuredClone(world.entries);

    convoke(L31);
    expect((await reinterpretDate()).timeEntries).toBe(0);
    convoke(L31, "CANCELADA");
    convoke(L30);
    expect((await reinterpretDate()).timeEntries).toBe(0);
    world.convocations = [];
    expect((await reinterpretDate()).timeEntries).toBe(0);
    expect(world.entries).toEqual(before);
  });

  it("base 8 + Sereno 3 (dentro) + Colectivo 1 (adicional) en feriado x2 sin convocatoria → residual 5, total 9, equivalencia 18", async () => {
    world.rules.push(feriado5());
    loadHours(L31, OCT_5, 8);
    loadConcept(L31, OCT_5, "sereno", 180, "WITHIN_BASE");
    loadConcept(L31, OCT_5, "colectivo", 60, "ADDITIVE_TO_WORKED_TOTAL");

    expect(hours(minutes(L31).normalResidualMinutes)).toBe(5);
    expect(hours(minutes(L31).totalWorkedMinutes)).toBe(9);
    expect(minutes(L31).settlement).toEqual({ normalMinutes: 600, withinBaseMinutes: 360, additiveMinutes: 120, noveltyMinutes: 0, totalMinutes: 1080 });
  });

  it("historia previa a §20 (no convocado guardado x1 en un feriado global) se corrige al reinterpretar, salvo período APROBADO", async () => {
    world.rules.push(feriado5());
    world.entries.push({ id: "entry-30", employeeId: L30, date: OCT_5, day: 5, period: "2026-10", hours: 8, totalMinutes: 480, actualMinutes: 480, status: "APROBADO", appliedMultiplier: 1 });
    world.entries.push({ id: "entry-31", employeeId: L31, date: OCT_5, day: 5, period: "2026-10", hours: 8, totalMinutes: 480, actualMinutes: 480, status: "APROBADO", appliedMultiplier: 1 });
    world.closures.push({ id: "closure-31", employeeId: L31, period: "2026-10", status: "APROBADO", snapshot: { accounting: {} } });

    const result = await reinterpretDate();

    expect(result.changes.timeEntries).toEqual([{ id: "entry-30", employeeId: L30, date: "2026-10-05", from: 1, to: 2 }]);
    expect(world.entries.find((row) => row.id === "entry-31")!.appliedMultiplier).toBe(1);
    expect(result.protectedPeriods).toEqual([{ employeeId: L31, period: "2026-10", status: "APROBADO", timeEntries: 1, breakdowns: 0, segments: 0, missingHistory: 0 }]);
  });
});

// Eliminar definitivamente una regla (workforceService.removeDoubleRule): en la
// misma transacción se retira su traza, se borra la regla y se reinterpreta con
// after: null. Acá se simula ese borrado tal cual (la regla y su traza
// desaparecen del mundo) y se corre el mismo motor: las horas quedan como si la
// regla nunca hubiera existido, resueltas por las reglas que quedan.
describe("Eliminar definitivamente una regla reinterpreta como si nunca hubiera existido", () => {
  const OCT_5 = new Date("2026-10-05T00:00:00.000Z");
  const feriados = () => feriado({ id: "rule-feriados", name: "Feriados", fromDate: OCT_5, toDate: OCT_5, dates: [{ date: OCT_5, isActive: true }] });
  const jornadaEspecial = () => feriado({ id: "rule-jornada", name: "Jornada especial", kind: "JORNADA_ESPECIAL", fromDate: OCT_5, toDate: OCT_5, dates: [{ date: OCT_5, isActive: true }], multiplier: 1.5 });
  async function deleteRule(rule: Rule) {
    world.rules = world.rules.filter((item) => item.id !== rule.id);
    world.applications = world.applications.filter((item) => item.doubleHourRuleId !== rule.id);
    return reinterpret(rule, null);
  }

  it("§8 — base 8 + Prueba 02 3 h (dentro) + Colectivo 1 h (adicional) con feriado x2: normales 10/Prueba 6/Colectivo 2 → al eliminarlo 5/3/1, total real 9 intacto", async () => {
    world.rules.push(feriados());
    loadHours(JUAN, OCT_5, 8);
    loadConcept(JUAN, OCT_5, "prueba-02", 180, "WITHIN_BASE");
    loadConcept(JUAN, OCT_5, "colectivo", 60, "ADDITIVE_TO_WORKED_TOTAL");
    const minutesBefore = { entries: world.entries.map((row) => row.totalMinutes), breakdowns: world.breakdowns.map((row) => row.minutes) };
    expect(dayAccounting(JUAN, OCT_5).settlement).toMatchObject({ normalMinutes: 600, withinBaseMinutes: 360, additiveMinutes: 120 });

    const result = await deleteRule(feriados());
    const day = dayAccounting(JUAN, OCT_5);

    expect(day.settlement).toMatchObject({ normalMinutes: 300, withinBaseMinutes: 180, additiveMinutes: 60, noveltyMinutes: 0, totalMinutes: 540 });
    expect(day.concepts).toEqual(expect.arrayContaining([
      { hourConceptId: "prueba-02", treatment: "WITHIN_BASE", realMinutes: 180, settlementMinutes: 180 },
      { hourConceptId: "colectivo", treatment: "ADDITIVE_TO_WORKED_TOTAL", realMinutes: 60, settlementMinutes: 60 },
    ]));
    expect(hours(day.totalWorkedMinutes)).toBe(9);
    expect({ entries: world.entries.map((row) => row.totalMinutes), breakdowns: world.breakdowns.map((row) => row.minutes) }).toEqual(minutesBefore);
    expect(result).toMatchObject({ timeEntries: 1, breakdowns: 2 });
  });

  it("reglas superpuestas: Feriado x2 + Jornada especial x1.5 el mismo día → eliminar el feriado deja x1.5 (no x1), con la traza de la que queda", async () => {
    world.rules = [{ ...feriados(), priority: 10 }, jornadaEspecial()]; // el feriado gana por prioridad
    loadHours(JUAN, OCT_5, 8);
    world.segments.push({ id: "segment-5", employeeId: JUAN, date: OCT_5, minutes: 480, isSpecial: false });
    await reinterpret(null, world.rules[0]!);
    expect(world.entries[0]!.appliedMultiplier).toBe(2);

    await deleteRule(world.rules[0]!);

    expect(world.entries[0]!.appliedMultiplier).toBe(1.5);
    expect(hours(dayAccounting(JUAN, OCT_5).settlement.totalMinutes)).toBe(12);
    expect(world.applications).toEqual([{ timeSegmentId: "segment-5", doubleHourRuleId: "rule-jornada", multiplierApplied: 1.5, isWinner: true, wasConflicting: false }]);
    expect(world.segments[0]).toMatchObject({ isSpecial: true, minutes: 480 });
  });

  it("feriado con convocatoria: eliminarlo quita el multiplicador; la convocatoria sigue existiendo y no da multiplicador por sí sola", async () => {
    world.rules.push(feriados());
    world.convocations.push({ employeeId: JUAN, date: OCT_5, status: "ACTIVA" });
    loadHours(JUAN, OCT_5, 8);
    world.segments.push({ id: "segment-5", employeeId: JUAN, date: OCT_5, minutes: 480, isSpecial: false });
    await reinterpret(null, feriados());
    expect(hours(dayAccounting(JUAN, OCT_5).settlement.totalMinutes)).toBe(16);

    await deleteRule(feriados());

    expect(world.convocations).toEqual([{ employeeId: JUAN, date: OCT_5, status: "ACTIVA" }]);
    expect(world.entries[0]!.appliedMultiplier).toBe(1);
    expect(hours(dayAccounting(JUAN, OCT_5).totalWorkedMinutes)).toBe(8);
    expect(hours(dayAccounting(JUAN, OCT_5).settlement.totalMinutes)).toBe(8);
    expect(world.applications).toEqual([]);
    expect(world.segments[0]).toMatchObject({ isSpecial: false, minutes: 480 });
  });

  it("feriado ya finalizado con cierre APROBADO: eliminar la regla no toca ese período (D-5)", async () => {
    world.rules.push(feriados());
    loadHours(JUAN, OCT_5, 8);
    world.entries[0]!.appliedMultiplier = 2;
    world.closures.push({ id: "closure-juan", employeeId: JUAN, period: "2026-10", status: "APROBADO", snapshot: { accounting: { settlement: { totalMinutes: 960 } } } });

    const result = await deleteRule(feriados());

    expect(result.rebuiltClosures).toHaveLength(0);
    expect(world.entries[0]!.appliedMultiplier).toBe(2);
    expect(result.protectedPeriods[0]).toMatchObject({ employeeId: JUAN, status: "APROBADO", timeEntries: 1 });
    expect(world.closures[0]!.status).toBe("APROBADO");
  });

  // Preview de eliminación de “Feriados” en development (2026-10-13): 17 legajos
  // alcanzados × 7 consultas del motor por legajo ≈ 134 viajes secuenciales
  // dentro de la transacción revertida → superaba su timeout de 30 s y la
  // consulta siguiente fallaba con P2028 (500).
  it("feriado con muchos legajos: el motor evalúa a todos en UNA llamada y el período protegido se sigue informando", async () => {
    world.rules.push(feriados());
    for (const employeeId of [JUAN, ANA, PEDRO]) {
      loadHours(employeeId, OCT_5, 8);
      world.entries.at(-1)!.appliedMultiplier = 2;
    }
    world.closures.push({ id: "closure-pedro", employeeId: PEDRO, period: "2026-10", status: "APROBADO", snapshot: { accounting: {} } });

    const result = await deleteRule(feriados());

    expect(evaluateSpecialHourRulesForEmployees).toHaveBeenCalledTimes(1);
    expect([...(evaluateSpecialHourRulesForEmployees as unknown as Mock).mock.calls[0]![0].keys()].sort()).toEqual([ANA, JUAN, PEDRO].sort());
    expect(result).toMatchObject({ timeEntries: 2, employees: 2 });
    expect(result.protectedPeriods).toEqual([{ employeeId: PEDRO, period: "2026-10", status: "APROBADO", timeEntries: 1, breakdowns: 0, segments: 0, missingHistory: 0 }]);
    expect(world.entries.map((row) => [row.employeeId, row.appliedMultiplier])).toEqual([[JUAN, 1], [ANA, 1], [PEDRO, 2]]);
  });

  it("una regla ya INACTIVA no tenía efecto: eliminarla no cambia ninguna hora", async () => {
    world.rules.push(feriados());
    loadHours(JUAN, OCT_5, 8);
    world.rules = [{ ...feriados(), status: "INACTIVO" }];
    await reinterpret(feriados(), world.rules[0]!);
    expect(world.entries[0]!.appliedMultiplier).toBe(1);

    const result = await deleteRule(world.rules[0]!);

    expect(result.timeEntries).toBe(0);
    expect(world.entries[0]!.appliedMultiplier).toBe(1);
  });
});

describe("affectedWindow", () => {
  it("une el calendario de antes y después; una regla sin fin deja la ventana abierta", () => {
    expect(affectedWindow([feriado(), feriado({ fromDate: OCT_4, toDate: OCT_4, dates: [{ date: OCT_4, isActive: true }] })])).toEqual({ from: OCT_3, to: OCT_4 });
    expect(affectedWindow([feriado({ recurrenceType: "SEMANAL", toDate: null, weekdays: [0], dates: [] })])).toEqual({ from: OCT_3, to: null });
    expect(affectedWindow([])).toBeNull();
  });
});

describe("D-5 — historia laboral insuficiente (ORG_LOCATION_REORGANIZATION.md §19)", () => {
  it("si una fila que se reescribiría no tiene historia, rechaza el cambio completo sin escrituras parciales", async () => {
    loadHours(JUAN, OCT_3, 8);
    loadHours(ANA, OCT_3, 8);
    world.missingHistory.add(`${ANA}|2026-10-03`);
    world.rules.push(feriado());

    await expect(reinterpret(null, feriado())).rejects.toMatchObject({ code: "SPECIAL_HOUR_SCOPE_HISTORY_MISSING" });

    expect(world.entries.map((row) => row.appliedMultiplier)).toEqual([1, 1]);
    expect(db.timeEntry.updateMany).not.toHaveBeenCalled();
    expect(db.specialHourRuleApplication.createMany).not.toHaveBeenCalled();
    expect(rebuildClosureSnapshots).not.toHaveBeenCalled();
  });

  it("en un período protegido no rechaza ni escribe: informa cuántas filas no se pudieron evaluar", async () => {
    loadHours(JUAN, OCT_3, 8);
    world.closures.push({ id: "closure-juan", employeeId: JUAN, period: "2026-10", status: "APROBADO", snapshot: { accounting: {} } });
    world.missingHistory.add(`${JUAN}|2026-10-03`);
    world.rules.push(feriado());

    const result = await reinterpret(null, feriado());

    expect(result.protectedPeriods).toEqual([{ employeeId: JUAN, period: "2026-10", status: "APROBADO", timeEntries: 0, breakdowns: 0, segments: 0, missingHistory: 1 }]);
    expect(world.entries[0]!.appliedMultiplier).toBe(1);
    expect(world.closures[0]!.status).toBe("APROBADO");
  });
});

describe("etapa 5 — cobertura de novedades en la misma reinterpretación (NOVELTY_COVERAGE_ENGINE.md §13)", () => {
  beforeEach(() => {
    world = emptyWorld();
    db = fakeDb();
  });

  it("un FERIADO recalcula la cobertura de todo tipo con tiempo en sus fechas, antes de reinterpretar las horas; sólo se rehacen los snapshots que faltan", async () => {
    const rule = feriado();
    world.rules.push(rule);
    world.closures.push({ id: "closure-juan", employeeId: JUAN, period: "2026-10", status: "ABIERTO", snapshot: {} });
    loadHours(JUAN, OCT_3, 8);
    const order: string[] = [];
    vi.mocked(recalculateNoveltyCoverage).mockImplementationOnce(async (_db, _scope, reason) => (order.push("coverage"), { ...emptyNoveltyCoverageRecalculation(reason), changedPairs: [{ employeeId: ANA, period: "2026-10" }] }));
    db.timeEntry.findMany.mockImplementationOnce(async () => (order.push("hours"), world.entries.map((row) => ({ ...row }))));

    const result = await reinterpret(null, { ...rule, kind: "FERIADO" } as never);

    expect(order).toEqual(["coverage", "hours"]);
    const [, scope, reason, options] = vi.mocked(recalculateNoveltyCoverage).mock.calls[0]!;
    expect(scope).toMatchObject({ from: OCT_3, to: OCT_3, onlySpecialHourTypes: false });
    expect(scope.touchesDate!("2026-10-03")).toBe(true);
    expect(scope.touchesDate!("2026-10-04")).toBe(false);
    expect(reason).toEqual({ source: "SPECIAL_HOUR_RULE_CHANGED", label: "cambio de la regla Feriado 3 de octubre" });
    expect(options).toEqual({ rebuildSnapshots: false });
    expect(rebuildNoveltyCoverageSnapshots).toHaveBeenCalledWith(db, [{ employeeId: ANA, period: "2026-10" }], reason, result.rebuiltClosures);
    expect(result.noveltyCoverage).toBeDefined();
  });

  it("una regla que no es FERIADO (domingo ×2 → ×1,5) sólo alcanza a los tipos que aplican multiplicadores", async () => {
    const domingo = feriado({ id: "rule-domingo", name: "Domingo", kind: "DOMINGO" as Rule["kind"], recurrenceType: "SEMANAL" as Rule["recurrenceType"], fromDate: OCT_4, toDate: null, weekdays: [0], dates: [] });
    world.rules.push(domingo);
    await reinterpret({ ...domingo, multiplier: 2 } as never, { ...domingo, multiplier: 1.5 } as never);
    expect(vi.mocked(recalculateNoveltyCoverage).mock.calls[0]![1]).toMatchObject({ from: OCT_4, to: null, onlySpecialHourTypes: true });
  });
});
