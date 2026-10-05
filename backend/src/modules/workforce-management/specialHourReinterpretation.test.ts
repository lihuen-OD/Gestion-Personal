import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { accountDay, toAccountingBaseEntry, toAccountingBreakdown } from "../time-entries/workedTimeAccounting";
import { resolveSpecialHourRulesByDate } from "../time-entries/timeEntries.repository";
import { buildActiveDatesByRule, resolveWinningRules, ruleMatchesDate } from "./doubleHourRuleMatching";
import { rebuildClosureSnapshots } from "./closureSnapshot";
import { affectedWindow, reinterpretSpecialHours, type RuleCalendar } from "./specialHourReinterpretation";

/**
 * docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §15: una regla de Hora
 * Especial reinterpreta las horas ya cargadas. El resultado depende sólo del
 * estado vigente de la regla y de los minutos reales, nunca del orden en que
 * se cargaron las horas y se configuró la regla.
 *
 * El motor de reglas se reemplaza por uno en memoria que usa EXACTAMENTE las
 * mismas piezas de matching (ruleMatchesDate/buildActiveDatesByRule/
 * resolveWinningRules); el alcance por SQL (doubleHourRuleScopeWhere) ya está
 * cubierto en timeEntries.repository.test.ts y acá se modela como lista de
 * empleados alcanzados. La contabilidad es la real (workedTimeAccounting).
 */

vi.mock("../../shared/prisma/client", () => ({ prisma: {} }));
vi.mock("../time-entries/timeEntries.repository", () => ({ resolveSpecialHourRulesByDate: vi.fn() }));
vi.mock("./closureSnapshot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./closureSnapshot")>();
  return { ...actual, rebuildClosureSnapshots: vi.fn() };
});

type Rule = RuleCalendar & { name: string; multiplier: number; priority: number; status: "ACTIVO" | "INACTIVO"; employeeIds: string[] };
type Entry = { id: string; employeeId: string; date: Date; day: number; period: string; hours: number; totalMinutes: number; actualMinutes: number; status: string; appliedMultiplier: number };
type Breakdown = { id: string; employeeId: string; date: Date; day: number; period: string; hourConceptId: string; minutes: number; status: string; appliedMultiplier: number; treatment: "WITHIN_BASE" | "ADDITIVE_TO_WORKED_TOTAL" };
type Segment = { id: string; employeeId: string; date: Date; minutes: number; isSpecial: boolean };
type Application = { timeSegmentId: string; doubleHourRuleId: string; multiplierApplied: number; isWinner: boolean; wasConflicting: boolean };
type Closure = { id: string; employeeId: string; period: string; status: string; snapshot: unknown };

const JUAN = "employee-juan";
const ANA = "employee-ana";
const OCT_3 = new Date("2026-10-03T00:00:00.000Z"); // sábado
const OCT_4 = new Date("2026-10-04T00:00:00.000Z"); // domingo

let world: { rules: Rule[]; entries: Entry[]; breakdowns: Breakdown[]; segments: Segment[]; applications: Application[]; closures: Closure[] };

function feriado(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "rule-feriado", name: "Feriado 3 de octubre", recurrenceType: "FECHA", fromDate: OCT_3, toDate: OCT_3, weekdays: [],
    dates: [{ date: OCT_3, isActive: true }], multiplier: 2, priority: 0, status: "ACTIVO", employeeIds: [],
    ...overrides,
  };
}

// Motor en memoria: reglas ACTIVAS, vigentes, del alcance del empleado,
// matcheadas por calendario y resueltas por prioridad (las piezas reales).
function engine(employeeId: string, dates: Date[]) {
  const result = new Map<string, { multiplier: number; matchedRules: Rule[]; winners: Rule[]; conflicting: boolean }>();
  const inScope = world.rules.filter((rule) => rule.status === "ACTIVO" && (!rule.employeeIds.length || rule.employeeIds.includes(employeeId)));
  const activeDates = buildActiveDatesByRule(inScope);
  for (const date of dates) {
    const vigent = inScope.filter((rule) => rule.fromDate <= date && (!rule.toDate || rule.toDate >= date));
    const matchedRules = vigent.filter((rule) => ruleMatchesDate(rule, date, activeDates));
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
  world = { rules: [], entries: [], breakdowns: [], segments: [], applications: [], closures: [] };
  db = fakeDb();
  (resolveSpecialHourRulesByDate as unknown as Mock).mockImplementation(async (employeeId: string, dates: Date[]) => engine(employeeId, dates));
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
    world = { rules: [feriado()], entries: [], breakdowns: [], segments: [], applications: [], closures: [] };
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
    expect(day.settlement).toEqual({ normalMinutes: 600, withinBaseMinutes: 360, additiveMinutes: 120, totalMinutes: 1080 });
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

  it("CASO G — período con cierre: el snapshot se recalcula con la regla nueva, sin cambiar el estado del cierre", async () => {
    loadHours(JUAN, OCT_3, 8);
    loadHours(ANA, OCT_4, 8);
    world.closures.push(
      { id: "closure-juan", employeeId: JUAN, period: "2026-10", status: "APROBADO", snapshot: { accounting: { settlement: { totalMinutes: 480 } } } },
      { id: "closure-ana", employeeId: ANA, period: "2026-10", status: "ENVIADO", snapshot: { accounting: {} } },
    );

    world.rules.push(feriado());
    const result = await reinterpret(null, feriado());

    expect(rebuildClosureSnapshots).toHaveBeenCalledTimes(1);
    const [, closures, recalculation] = (rebuildClosureSnapshots as unknown as Mock).mock.calls[0]!;
    expect(closures.map((closure: Closure) => closure.id)).toEqual(["closure-juan"]); // Ana no tenía horas el 03/10
    expect(recalculation).toEqual({ reason: "SPECIAL_HOUR_RULE_CHANGED", doubleHourRuleId: "rule-feriado", doubleHourRuleName: "Feriado 3 de octubre" });
    expect(result.rebuiltClosures.map((closure) => closure.id)).toEqual(["closure-juan"]);
    expect(world.closures.map((closure) => closure.status)).toEqual(["APROBADO", "ENVIADO"]);
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
    const domingo = feriado({ id: "rule-domingo", recurrenceType: "SEMANAL", fromDate: new Date("2026-01-01T00:00:00.000Z"), toDate: null, weekdays: [0], dates: [] });

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
    expect(resolveSpecialHourRulesByDate).not.toHaveBeenCalled();
  });
});

describe("affectedWindow", () => {
  it("une el calendario de antes y después; una regla sin fin deja la ventana abierta", () => {
    expect(affectedWindow([feriado(), feriado({ fromDate: OCT_4, toDate: OCT_4, dates: [{ date: OCT_4, isActive: true }] })])).toEqual({ from: OCT_3, to: OCT_4 });
    expect(affectedWindow([feriado({ recurrenceType: "SEMANAL", toDate: null, weekdays: [0], dates: [] })])).toEqual({ from: OCT_3, to: null });
    expect(affectedWindow([])).toBeNull();
  });
});
