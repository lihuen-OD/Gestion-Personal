import { describe, expect, it, vi } from "vitest";
import {
  evaluateEmployeeWorkday,
  expectedMinutesForTemplates,
  loadEmployeeWorkdayContext,
  resolveEmployeeHolidayStatus,
  resolveExpectedWorkdays,
  shiftTemplateExpectedMinutes,
  workdayDateKeys,
  type EmployeeWorkdayContext,
  type FeriadoRuleForWorkday,
  type HolidayScopeStatus,
  type WorkdayContextReader,
  type WorkdayConvocation,
  type WorkdayRegimePeriod,
  type WorkdayShiftAssignment,
  type WorkdayShiftTemplate,
} from "./expectedWorkday";
import type { EngineScopeHistory } from "../labor-history/laborHistory.scope";

vi.mock("../labor-history/laborHistory.service", () => ({
  laborHistoryService: { loadEngineScopeHistoryByEmployee: vi.fn() },
}));

// Jornada esperada para la cobertura de Novedades — Etapa 2
// (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §7).
const MONDAY = "2026-11-16";
const SATURDAY = "2026-11-14";
const SUNDAY = "2026-11-22";
const MON_TO_FRI = [1, 2, 3, 4, 5];
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);

function template(overrides: Partial<WorkdayShiftTemplate> = {}): WorkdayShiftTemplate {
  return { id: "tpl-day", startTime: "08:00", endTime: "16:00", crossesMidnight: false, expectedMinutes: 480, status: "ACTIVO", ...overrides };
}

function assignment(overrides: Partial<WorkdayShiftAssignment> = {}): WorkdayShiftAssignment {
  return { status: "HABILITADO", effectiveFrom: day("2026-01-01"), effectiveTo: null, weekdays: MON_TO_FRI, template: template(), ...overrides };
}

function context(overrides: {
  assignments?: WorkdayShiftAssignment[];
  dayOffs?: string[];
  convocations?: Record<string, WorkdayConvocation>;
  regimes?: WorkdayRegimePeriod[];
  holidays?: Record<string, HolidayScopeStatus>;
} = {}): EmployeeWorkdayContext {
  return {
    employeeId: "emp-1",
    assignments: overrides.assignments ?? [],
    dayOffDates: new Set(overrides.dayOffs ?? []),
    convocations: new Map(Object.entries(overrides.convocations ?? {})),
    regimes: overrides.regimes ?? [],
    holidays: new Map(Object.entries(overrides.holidays ?? {})),
  };
}

const regime = (kind: WorkdayRegimePeriod["kind"], from = "2026-01-01", to: string | null = null): WorkdayRegimePeriod => ({ kind, effectiveFrom: day(from), effectiveTo: to ? day(to) : null });
const convocation = (overrides: Partial<WorkdayConvocation> = {}): WorkdayConvocation => ({ template: null, expectedStartTime: null, expectedEndTime: null, ...overrides });

describe("evaluateEmployeeWorkday — jornada normal", () => {
  it("turno L–V, lunes → WORKDAY con los minutos del turno", () => {
    expect(evaluateEmployeeWorkday(context({ assignments: [assignment()] }), MONDAY)).toEqual({
      dateKey: MONDAY,
      obligation: "WORKDAY",
      unresolvedReason: null,
      expectedMinutes: 480,
      shiftTemplateIds: ["tpl-day"],
      isHoliday: false,
      convoked: false,
      source: "SHIFT_PLAN",
      minutesSource: "SHIFT_ASSIGNMENT",
    });
  });

  it("turno L–V, domingo → NO_WORK_OBLIGATION, 0 confirmado", () => {
    expect(evaluateEmployeeWorkday(context({ assignments: [assignment()] }), SUNDAY)).toMatchObject({ obligation: "NO_WORK_OBLIGATION", expectedMinutes: 0, unresolvedReason: null, source: "SHIFT_PLAN" });
  });

  it("turno sin días elegidos (todos los días), domingo → WORKDAY", () => {
    expect(evaluateEmployeeWorkday(context({ assignments: [assignment({ weekdays: [] })] }), SUNDAY)).toMatchObject({ obligation: "WORKDAY", expectedMinutes: 480 });
  });

  it("empleado sin turno (legajo mínimo) → UNRESOLVED / SCHEDULE_MISSING, nunca 8 h", () => {
    expect(evaluateEmployeeWorkday(context(), MONDAY)).toMatchObject({ obligation: "UNRESOLVED", unresolvedReason: "SCHEDULE_MISSING", expectedMinutes: null, source: "NONE" });
  });

  it.each([
    ["vencida antes de la fecha", { effectiveTo: day("2026-11-01") }],
    ["que empieza después de la fecha", { effectiveFrom: day("2026-12-01") }],
    ["deshabilitada", { status: "DESHABILITADO" as const }],
    ["con turno inactivo", { template: template({ status: "INACTIVO" }) }],
  ])("una asignación %s no es planificación vigente → SCHEDULE_MISSING", (_label, overrides) => {
    expect(evaluateEmployeeWorkday(context({ assignments: [assignment(overrides)] }), MONDAY)).toMatchObject({ obligation: "UNRESOLVED", unresolvedReason: "SCHEDULE_MISSING" });
  });

  it("la vigencia es inclusiva en ambos extremos", () => {
    const ctx = context({ assignments: [assignment({ effectiveFrom: day(MONDAY), effectiveTo: day(MONDAY) })] });
    expect(evaluateEmployeeWorkday(ctx, MONDAY)).toMatchObject({ obligation: "WORKDAY" });
  });
});

describe("evaluateEmployeeWorkday — regímenes", () => {
  it("TURNO_FLEXIBLE con asignación aplicable → WORKDAY", () => {
    expect(evaluateEmployeeWorkday(context({ assignments: [assignment()], regimes: [regime("TURNO_FLEXIBLE")] }), MONDAY)).toMatchObject({ obligation: "WORKDAY", expectedMinutes: 480 });
  });

  it("TURNO_FLEXIBLE sin asignación aplicable ese día → UNRESOLVED / FLEXIBLE_REGIME_NO_ASSIGNMENT (nunca 0 confirmado)", () => {
    expect(evaluateEmployeeWorkday(context({ assignments: [assignment()], regimes: [regime("TURNO_FLEXIBLE")] }), SUNDAY)).toMatchObject({
      obligation: "UNRESOLVED",
      unresolvedReason: "FLEXIBLE_REGIME_NO_ASSIGNMENT",
      expectedMinutes: null,
      source: "WORK_REGIME",
    });
  });

  it("TURNO_FLEXIBLE sin ninguna asignación → FLEXIBLE_REGIME_NO_ASSIGNMENT", () => {
    expect(evaluateEmployeeWorkday(context({ regimes: [regime("TURNO_FLEXIBLE")] }), MONDAY)).toMatchObject({ unresolvedReason: "FLEXIBLE_REGIME_NO_ASSIGNMENT" });
  });

  it.each([
    ["sin asignaciones", []],
    ["aun con un turno aplicable ese día (configuración contradictoria)", [assignment()]],
  ])("SIN_TURNO %s → UNRESOLVED / REGIME_WITHOUT_SCHEDULE, nunca 0 confirmado por el nombre del régimen", (_label, assignments) => {
    const result = evaluateEmployeeWorkday(context({ assignments, regimes: [regime("SIN_TURNO")] }), MONDAY);
    expect(result).toMatchObject({ obligation: "UNRESOLVED", unresolvedReason: "REGIME_WITHOUT_SCHEDULE", expectedMinutes: null });
  });

  it("TURNO_OBLIGATORIO con turno aplicable → WORKDAY", () => {
    expect(evaluateEmployeeWorkday(context({ assignments: [assignment()], regimes: [regime("TURNO_OBLIGATORIO")] }), MONDAY)).toMatchObject({ obligation: "WORKDAY" });
  });

  it("TURNO_OBLIGATORIO, turno L–V, domingo → NO_WORK_OBLIGATION", () => {
    expect(evaluateEmployeeWorkday(context({ assignments: [assignment()], regimes: [regime("TURNO_OBLIGATORIO")] }), SUNDAY)).toMatchObject({ obligation: "NO_WORK_OBLIGATION", expectedMinutes: 0 });
  });

  it("TURNO_OBLIGATORIO sin planificación vigente → UNRESOLVED / SCHEDULE_MISSING", () => {
    expect(evaluateEmployeeWorkday(context({ regimes: [regime("TURNO_OBLIGATORIO")] }), MONDAY)).toMatchObject({ obligation: "UNRESOLVED", unresolvedReason: "SCHEDULE_MISSING" });
  });

  it("usa el régimen vigente en la fecha: SIN_TURNO vencido no aplica", () => {
    const ctx = context({ assignments: [assignment()], regimes: [regime("SIN_TURNO", "2026-01-01", "2026-10-31"), regime("TURNO_OBLIGATORIO", "2026-11-01")] });
    expect(evaluateEmployeeWorkday(ctx, MONDAY)).toMatchObject({ obligation: "WORKDAY" });
    expect(evaluateEmployeeWorkday(ctx, "2026-10-26")).toMatchObject({ unresolvedReason: "REGIME_WITHOUT_SCHEDULE" });
  });
});

describe("evaluateEmployeeWorkday — francos", () => {
  it("turno aplicable + franco → DAY_OFF, 0 confirmado", () => {
    expect(evaluateEmployeeWorkday(context({ assignments: [assignment()], dayOffs: [MONDAY] }), MONDAY)).toMatchObject({ obligation: "DAY_OFF", expectedMinutes: 0, source: "EMPLOYEE_DAY_OFF" });
  });

  it("feriado con convocatoria + franco → DAY_OFF (el franco gana)", () => {
    const ctx = context({ assignments: [assignment()], dayOffs: [MONDAY], holidays: { [MONDAY]: "IN_SCOPE" }, convocations: { [MONDAY]: convocation() } });
    expect(evaluateEmployeeWorkday(ctx, MONDAY)).toMatchObject({ obligation: "DAY_OFF", expectedMinutes: 0 });
  });

  it("franco de un legajo sin turno o SIN_TURNO → DAY_OFF (evidencia explícita, no revisión)", () => {
    expect(evaluateEmployeeWorkday(context({ dayOffs: [MONDAY], regimes: [regime("SIN_TURNO")] }), MONDAY)).toMatchObject({ obligation: "DAY_OFF" });
  });
});

describe("evaluateEmployeeWorkday — feriados", () => {
  it("feriado no convocado → HOLIDAY_NOT_CONVOKED, 0 confirmado", () => {
    expect(evaluateEmployeeWorkday(context({ assignments: [assignment()], holidays: { [MONDAY]: "IN_SCOPE" } }), MONDAY)).toMatchObject({
      obligation: "HOLIDAY_NOT_CONVOKED",
      expectedMinutes: 0,
      isHoliday: true,
      convoked: false,
      source: "HOLIDAY_RULE",
    });
  });

  it("feriado no convocado de un legajo SIN_TURNO → HOLIDAY_NOT_CONVOKED (la convocatoria es la evidencia)", () => {
    expect(evaluateEmployeeWorkday(context({ regimes: [regime("SIN_TURNO")], holidays: { [MONDAY]: "IN_SCOPE" } }), MONDAY)).toMatchObject({ obligation: "HOLIDAY_NOT_CONVOKED" });
  });

  it("feriado convocado con turno de la convocatoria → WORKDAY con los minutos de ese turno", () => {
    const ctx = context({ holidays: { [MONDAY]: "IN_SCOPE" }, convocations: { [MONDAY]: convocation({ template: template({ id: "tpl-holiday", startTime: "09:00", endTime: "13:00", expectedMinutes: 240 }) }) } });
    expect(evaluateEmployeeWorkday(ctx, MONDAY)).toMatchObject({
      obligation: "WORKDAY",
      expectedMinutes: 240,
      shiftTemplateIds: ["tpl-holiday"],
      isHoliday: true,
      convoked: true,
      source: "HOLIDAY_CONVOCATION",
      minutesSource: "CONVOCATION_SHIFT_TEMPLATE",
    });
  });

  it("feriado convocado sin turno en la convocatoria → usa la asignación aplicable", () => {
    const ctx = context({ assignments: [assignment()], holidays: { [MONDAY]: "IN_SCOPE" }, convocations: { [MONDAY]: convocation() } });
    expect(evaluateEmployeeWorkday(ctx, MONDAY)).toMatchObject({ obligation: "WORKDAY", expectedMinutes: 480, minutesSource: "SHIFT_ASSIGNMENT" });
  });

  it("feriado convocado sólo con horario explícito → WORKDAY con esos minutos (también cruzando medianoche)", () => {
    const daytime = context({ holidays: { [SUNDAY]: "IN_SCOPE" }, convocations: { [SUNDAY]: convocation({ expectedStartTime: "06:00", expectedEndTime: "12:30" }) } });
    const night = context({ holidays: { [SUNDAY]: "IN_SCOPE" }, convocations: { [SUNDAY]: convocation({ expectedStartTime: "22:00", expectedEndTime: "06:00" }) } });
    expect(evaluateEmployeeWorkday(daytime, SUNDAY)).toMatchObject({ obligation: "WORKDAY", expectedMinutes: 390, minutesSource: "CONVOCATION_TIMES" });
    expect(evaluateEmployeeWorkday(night, SUNDAY)).toMatchObject({ obligation: "WORKDAY", expectedMinutes: 480 });
  });

  it.each([
    ["sin turno ni horario", convocation()],
    ["con sólo el inicio", convocation({ expectedStartTime: "08:00" })],
    ["con un horario inválido", convocation({ expectedStartTime: "08:00", expectedEndTime: "25:00" })],
    ["con un turno inactivo y sin horario", convocation({ template: template({ status: "INACTIVO" }) })],
  ])("feriado convocado %s → UNRESOLVED / EXPECTED_MINUTES_UNKNOWN, nunca 8 h", (_label, item) => {
    const ctx = context({ holidays: { [SUNDAY]: "IN_SCOPE" }, convocations: { [SUNDAY]: item } });
    expect(evaluateEmployeeWorkday(ctx, SUNDAY)).toMatchObject({ obligation: "UNRESOLVED", unresolvedReason: "EXPECTED_MINUTES_UNKNOWN", expectedMinutes: null, convoked: true });
  });

  it("convocado gana sobre SIN_TURNO", () => {
    const ctx = context({ regimes: [regime("SIN_TURNO")], holidays: { [MONDAY]: "IN_SCOPE" }, convocations: { [MONDAY]: convocation({ expectedStartTime: "08:00", expectedEndTime: "12:00" }) } });
    expect(evaluateEmployeeWorkday(ctx, MONDAY)).toMatchObject({ obligation: "WORKDAY", expectedMinutes: 240 });
  });

  it("convocado a un FERIADO cuyo alcance no lo incluye → igual es feriado convocado (§16: la convocatoria decide)", () => {
    const ctx = context({ assignments: [assignment()], holidays: { [MONDAY]: "OUT_OF_SCOPE" }, convocations: { [MONDAY]: convocation() } });
    expect(evaluateEmployeeWorkday(ctx, MONDAY)).toMatchObject({ obligation: "WORKDAY", isHoliday: true, convoked: true, source: "HOLIDAY_CONVOCATION" });
  });

  it("FERIADO cuyo alcance no incluye al legajo y sin convocatoria → día normal según su turno", () => {
    const ctx = context({ assignments: [assignment()], holidays: { [MONDAY]: "OUT_OF_SCOPE" } });
    expect(evaluateEmployeeWorkday(ctx, MONDAY)).toMatchObject({ obligation: "WORKDAY", isHoliday: false, source: "SHIFT_PLAN" });
  });

  it("una convocatoria en una fecha sin regla FERIADO se ignora (no aporta nada sin feriado)", () => {
    const ctx = context({ assignments: [assignment()], convocations: { [SUNDAY]: convocation({ expectedStartTime: "08:00", expectedEndTime: "12:00" }) } });
    expect(evaluateEmployeeWorkday(ctx, SUNDAY)).toMatchObject({ obligation: "NO_WORK_OBLIGATION", convoked: false, isHoliday: false });
  });

  it("FERIADO con alcance que depende de historia faltante y sin convocatoria → UNRESOLVED / HOLIDAY_SCOPE_HISTORY_MISSING", () => {
    const ctx = context({ assignments: [assignment()], holidays: { [MONDAY]: "SCOPE_HISTORY_MISSING" } });
    expect(evaluateEmployeeWorkday(ctx, MONDAY)).toMatchObject({ obligation: "UNRESOLVED", unresolvedReason: "HOLIDAY_SCOPE_HISTORY_MISSING", expectedMinutes: null });
  });
});

describe("expectedMinutes de un turno", () => {
  it("usa ShiftTemplate.expectedMinutes guardado", () => {
    expect(shiftTemplateExpectedMinutes(template({ expectedMinutes: 450 }))).toBe(450);
  });

  it("si es null, lo deriva con la misma fórmula del alta (computeExpectedMinutes)", () => {
    expect(shiftTemplateExpectedMinutes(template({ expectedMinutes: null, startTime: "08:30", endTime: "17:15" }))).toBe(525);
  });

  it("cruce de medianoche: 22:00 → 06:00 = 480, atribuidos a la fecha del inicio", () => {
    const night = template({ id: "tpl-night", startTime: "22:00", endTime: "06:00", crossesMidnight: true, expectedMinutes: null });
    expect(shiftTemplateExpectedMinutes(night)).toBe(480);
    expect(evaluateEmployeeWorkday(context({ assignments: [assignment({ template: night })] }), MONDAY)).toMatchObject({ obligation: "WORKDAY", expectedMinutes: 480 });
  });

  it("horario inválido y sin minutos guardados → desconocido (nunca inventa)", () => {
    expect(shiftTemplateExpectedMinutes(template({ expectedMinutes: null, startTime: "8", endTime: "16:00" }))).toBeNull();
    const ctx = context({ assignments: [assignment({ template: template({ expectedMinutes: null, startTime: "x", endTime: "16:00" }) })] });
    expect(evaluateEmployeeWorkday(ctx, MONDAY)).toMatchObject({ obligation: "UNRESOLVED", unresolvedReason: "EXPECTED_MINUTES_UNKNOWN" });
  });

  it("minutos guardados en 0 o negativos no son una jornada válida", () => {
    expect(shiftTemplateExpectedMinutes(template({ expectedMinutes: 0 }))).toBeNull();
  });
});

describe("expectedMinutesForTemplates — varias asignaciones el mismo día (P3)", () => {
  const shift = (id: string, startTime: string, endTime: string, expectedMinutes: number | null = null) =>
    template({ id, startTime, endTime, crossesMidnight: endTime <= startTime, expectedMinutes });

  it("turno partido 08:00–12:00 + 14:00–18:00 → 480", () => {
    expect(expectedMinutesForTemplates([shift("a", "08:00", "12:00", 240), shift("b", "14:00", "18:00", 240)])).toEqual({ minutes: 480 });
  });

  it("08:00–16:00 + 12:00–20:00 → nunca 960 ni una unión inventada: SHIFT_ASSIGNMENTS_OVERLAP", () => {
    expect(expectedMinutesForTemplates([shift("a", "08:00", "16:00", 480), shift("b", "12:00", "20:00", 480)])).toEqual({ unresolved: "SHIFT_ASSIGNMENTS_OVERLAP" });
  });

  it("turnos que sólo se tocan en el borde (12:00) no se superponen → suman", () => {
    expect(expectedMinutesForTemplates([shift("a", "08:00", "12:00"), shift("b", "12:00", "16:00")])).toEqual({ minutes: 480 });
  });

  it("dos turnos con el mismo horario (rotativo sin días configurados) → superpuestos", () => {
    expect(expectedMinutesForTemplates([shift("a", "06:00", "14:00"), shift("b", "06:00", "14:00")])).toEqual({ unresolved: "SHIFT_ASSIGNMENTS_OVERLAP" });
  });

  it("turno nocturno + turno de la mañana siguiente del mismo día operativo (06:00–14:00 + 22:00–06:00) no se superponen → 960", () => {
    expect(expectedMinutesForTemplates([shift("a", "06:00", "14:00"), shift("b", "22:00", "06:00")])).toEqual({ minutes: 960 });
  });

  it("turno nocturno 20:00–04:00 + 02:00–06:00 del mismo día: el segundo empieza antes, no se superponen dentro del día", () => {
    expect(expectedMinutesForTemplates([shift("a", "20:00", "04:00"), shift("b", "02:00", "06:00")])).toEqual({ minutes: 720 });
  });

  it("tres turnos con uno superpuesto → SHIFT_ASSIGNMENTS_OVERLAP", () => {
    expect(expectedMinutesForTemplates([shift("a", "06:00", "10:00"), shift("b", "14:00", "18:00"), shift("c", "09:00", "11:00")])).toEqual({ unresolved: "SHIFT_ASSIGNMENTS_OVERLAP" });
  });

  it("un turno con horario inválido entre varios → EXPECTED_MINUTES_UNKNOWN", () => {
    expect(expectedMinutesForTemplates([shift("a", "08:00", "12:00"), template({ id: "b", startTime: "bad", endTime: "18:00", expectedMinutes: 240 })])).toEqual({ unresolved: "EXPECTED_MINUTES_UNKNOWN" });
  });

  it("en el resolver: turno partido → WORKDAY 480 con ambos turnos; superpuestos → UNRESOLVED con los turnos involucrados", () => {
    const split = context({ assignments: [assignment({ template: shift("a", "08:00", "12:00", 240) }), assignment({ template: shift("b", "14:00", "18:00", 240) })] });
    const overlapping = context({ assignments: [assignment({ template: shift("a", "08:00", "16:00", 480) }), assignment({ template: shift("b", "12:00", "20:00", 480) })] });
    expect(evaluateEmployeeWorkday(split, MONDAY)).toMatchObject({ obligation: "WORKDAY", expectedMinutes: 480, shiftTemplateIds: ["a", "b"] });
    expect(evaluateEmployeeWorkday(overlapping, MONDAY)).toMatchObject({ obligation: "UNRESOLVED", unresolvedReason: "SHIFT_ASSIGNMENTS_OVERLAP", expectedMinutes: null, shiftTemplateIds: ["a", "b"] });
  });

  it("rotativo con días disjuntos (L–V mañana, S–D tarde) → cada día usa sólo su turno", () => {
    const ctx = context({
      assignments: [
        assignment({ weekdays: MON_TO_FRI, template: shift("morning", "06:00", "14:00", 480) }),
        assignment({ weekdays: [0, 6], template: shift("weekend", "14:00", "20:00", 360) }),
      ],
    });
    expect(evaluateEmployeeWorkday(ctx, MONDAY)).toMatchObject({ expectedMinutes: 480, shiftTemplateIds: ["morning"] });
    expect(evaluateEmployeeWorkday(ctx, SATURDAY)).toMatchObject({ expectedMinutes: 360, shiftTemplateIds: ["weekend"] });
  });

  it("rotativo con vigencias alternadas (V1) → sólo la asignación vigente aplica", () => {
    const ctx = context({
      assignments: [
        assignment({ effectiveFrom: day("2026-11-01"), effectiveTo: day("2026-11-15"), template: shift("first", "06:00", "14:00", 480) }),
        assignment({ effectiveFrom: day("2026-11-16"), effectiveTo: null, template: shift("second", "14:00", "22:00", 480) }),
      ],
    });
    expect(evaluateEmployeeWorkday(ctx, MONDAY)).toMatchObject({ obligation: "WORKDAY", shiftTemplateIds: ["second"] });
  });
});

describe("resolveEmployeeHolidayStatus — feriado con el alcance de la regla", () => {
  function feriado(overrides: Partial<FeriadoRuleForWorkday> = {}): FeriadoRuleForWorkday {
    return {
      id: "rule-1",
      name: "Feriados",
      recurrenceType: "FECHA",
      fromDate: day("2026-01-01"),
      toDate: day("2026-12-31"),
      weekdays: [],
      dates: [{ date: day(MONDAY), isActive: true }],
      companyId: null,
      sectorId: null,
      costCenterId: null,
      positionId: null,
      sector: null,
      employees: [],
      ...overrides,
    };
  }
  const emptyHistory = (overrides: Partial<EngineScopeHistory> = {}): EngineScopeHistory => ({ position: [], costCenter: [], legacySector: [], employer: [], scopes: new Map(), ...overrides }) as EngineScopeHistory;
  const resolve = (rules: FeriadoRuleForWorkday[], history: EngineScopeHistory | null = null, dateKeys = [MONDAY, SUNDAY]) =>
    resolveEmployeeHolidayStatus({ employeeId: "emp-1", dateKeys, feriadoRules: rules, history });

  it("regla global FECHA → IN_SCOPE sólo en sus fechas activas", () => {
    expect(resolve([feriado()])).toEqual(new Map([[MONDAY, "IN_SCOPE"]]));
  });

  it("una fecha inactiva de la regla no es feriado", () => {
    expect(resolve([feriado({ dates: [{ date: day(MONDAY), isActive: false }] })]).size).toBe(0);
  });

  it("fuera de la vigencia de la regla no es feriado", () => {
    expect(resolve([feriado({ toDate: day("2026-11-01") })]).size).toBe(0);
  });

  it("lista explícita de legajos que no incluye al legajo → OUT_OF_SCOPE", () => {
    expect(resolve([feriado({ employees: [{ employeeId: "otro" }] })]).get(MONDAY)).toBe("OUT_OF_SCOPE");
    expect(resolve([feriado({ employees: [{ employeeId: "emp-1" }] })]).get(MONDAY)).toBe("IN_SCOPE");
  });

  it("regla por empresa: la empresa empleadora vigente decide", () => {
    const rule = feriado({ companyId: "company-a" });
    const inCompany = emptyHistory({ employer: [{ id: "period", effectiveFrom: "2026-01-01", effectiveTo: null, value: ["company-a"] }] as EngineScopeHistory["employer"] });
    const otherCompany = emptyHistory({ employer: [{ id: "period", effectiveFrom: "2026-01-01", effectiveTo: null, value: ["company-b"] }] as EngineScopeHistory["employer"] });
    expect(resolve([rule], inCompany).get(MONDAY)).toBe("IN_SCOPE");
    expect(resolve([rule], otherCompany).get(MONDAY)).toBe("OUT_OF_SCOPE");
  });

  it("legajo mínimo sin empresa vigente registrada → OUT_OF_SCOPE (historia conocida y vacía)", () => {
    const minimal = emptyHistory({ employer: [{ id: "period", effectiveFrom: "2026-01-01", effectiveTo: null, value: [] }] as EngineScopeHistory["employer"] });
    expect(resolve([feriado({ companyId: "company-a" })], minimal).get(MONDAY)).toBe("OUT_OF_SCOPE");
  });

  it("regla con alcance y fecha sin historia registrada → SCOPE_HISTORY_MISSING", () => {
    const afterMonday = emptyHistory({ employer: [{ id: "period", effectiveFrom: "2026-11-20", effectiveTo: null, value: ["company-a"] }] as EngineScopeHistory["employer"] });
    expect(resolve([feriado({ companyId: "company-a" })], afterMonday).get(MONDAY)).toBe("SCOPE_HISTORY_MISSING");
  });

  it("una regla global en la misma fecha gana sobre otra con historia faltante", () => {
    expect(resolve([feriado({ id: "scoped", companyId: "company-a" }), feriado({ id: "global" })], emptyHistory()).get(MONDAY)).toBe("IN_SCOPE");
  });

  it("regla SEMANAL / RANGO también por calendario", () => {
    expect(resolve([feriado({ recurrenceType: "SEMANAL", weekdays: [0], dates: [] })]).get(SUNDAY)).toBe("IN_SCOPE");
    expect(resolve([feriado({ recurrenceType: "RANGO", fromDate: day(SUNDAY), toDate: day(SUNDAY), dates: [] })]).get(MONDAY)).toBeUndefined();
  });
});

describe("loadEmployeeWorkdayContext — consultas fijas, sin N+1", () => {
  function fakeDb(rows: { feriadoRules?: Array<Record<string, unknown>> } = {}) {
    const db = {
      shiftAssignment: {
        findMany: vi.fn().mockResolvedValue([
          { employeeId: "emp-1", status: "HABILITADO", effectiveFrom: day("2026-01-01"), effectiveTo: null, weekdays: MON_TO_FRI, shiftTemplate: template() },
        ]),
      },
      employeeDayOff: { findMany: vi.fn().mockResolvedValue([{ employeeId: "emp-2", date: day(MONDAY) }]) },
      holidayWorkAssignment: { findMany: vi.fn().mockResolvedValue([]) },
      employeeWorkRegime: { findMany: vi.fn().mockResolvedValue([{ employeeId: "emp-3", effectiveFrom: day("2026-01-01"), effectiveTo: null, workRegime: { kind: "SIN_TURNO" } }]) },
      doubleHourRule: { findMany: vi.fn().mockResolvedValue(rows.feriadoRules ?? []) },
    };
    return db as unknown as WorkdayContextReader & typeof db;
  }

  it("una consulta por tabla para todos los legajos y todo el rango, sin historia si ningún FERIADO tiene alcance", async () => {
    const { laborHistoryService } = await import("../labor-history/laborHistory.service");
    const db = fakeDb();

    const result = await resolveExpectedWorkdays(["emp-1", "emp-2", "emp-3", "emp-4"], day("2026-11-01"), day("2026-11-30"), db);

    for (const delegate of [db.shiftAssignment, db.employeeDayOff, db.holidayWorkAssignment, db.employeeWorkRegime, db.doubleHourRule]) {
      expect(delegate.findMany).toHaveBeenCalledTimes(1);
    }
    expect(laborHistoryService.loadEngineScopeHistoryByEmployee).not.toHaveBeenCalled();
    expect(result.get("emp-1")!.get(MONDAY)).toMatchObject({ obligation: "WORKDAY", expectedMinutes: 480 });
    expect(result.get("emp-2")!.get(MONDAY)).toMatchObject({ obligation: "DAY_OFF" });
    expect(result.get("emp-3")!.get(MONDAY)).toMatchObject({ unresolvedReason: "REGIME_WITHOUT_SCHEDULE" });
    expect(result.get("emp-4")!.get(MONDAY)).toMatchObject({ unresolvedReason: "SCHEDULE_MISSING" });
    expect(result.get("emp-1")!.size).toBe(30);
  });

  it("filtra por legajos, vigencia y estado en la propia consulta", async () => {
    const db = fakeDb();
    await loadEmployeeWorkdayContext(["emp-1", "emp-1"], day("2026-11-01"), day("2026-11-30"), db);

    expect(db.shiftAssignment.findMany.mock.calls[0]![0].where).toMatchObject({ employeeId: { in: ["emp-1"] }, status: "HABILITADO" });
    expect(db.employeeDayOff.findMany.mock.calls[0]![0].where).toMatchObject({ status: "ACTIVO" });
    expect(db.holidayWorkAssignment.findMany.mock.calls[0]![0].where).toMatchObject({ status: "ACTIVA" });
    expect(db.doubleHourRule.findMany.mock.calls[0]![0].where).toMatchObject({ kind: "FERIADO", status: "ACTIVO" });
  });

  it("carga la historia laboral una sola vez para todos si algún FERIADO restringe alcance", async () => {
    const { laborHistoryService } = await import("../labor-history/laborHistory.service");
    vi.mocked(laborHistoryService.loadEngineScopeHistoryByEmployee).mockResolvedValue(new Map());
    const db = fakeDb({
      feriadoRules: [{ id: "r", name: "Feriado planta", recurrenceType: "FECHA", fromDate: day("2026-01-01"), toDate: null, weekdays: [], companyId: "company-a", sectorId: null, costCenterId: null, positionId: null, dates: [{ date: day(MONDAY), isActive: true }], sector: null, employees: [] }],
    });

    const result = await resolveExpectedWorkdays(["emp-1", "emp-2"], day("2026-11-01"), day("2026-11-30"), db);

    expect(laborHistoryService.loadEngineScopeHistoryByEmployee).toHaveBeenCalledTimes(1);
    expect(laborHistoryService.loadEngineScopeHistoryByEmployee).toHaveBeenCalledWith(db, ["emp-1", "emp-2"], { fromKey: "2026-11-01", toKey: "2026-11-30" });
    // Sin historia registrada para la fecha: nunca se asume que el FERIADO no lo alcanza.
    expect(result.get("emp-1")!.get(MONDAY)).toMatchObject({ unresolvedReason: "HOLIDAY_SCOPE_HISTORY_MISSING" });
  });

  it("sin legajos no consulta nada", async () => {
    const db = fakeDb();
    expect((await loadEmployeeWorkdayContext([], day("2026-11-01"), day("2026-11-30"), db)).size).toBe(0);
    expect(db.shiftAssignment.findMany).not.toHaveBeenCalled();
  });

  it("rechaza un rango invertido o mayor a 400 días", () => {
    expect(() => workdayDateKeys(day("2026-11-30"), day("2026-11-01"))).toThrow();
    expect(() => workdayDateKeys(day("2026-01-01"), day("2027-03-01"))).toThrow();
    expect(workdayDateKeys(day("2026-12-30"), day("2027-01-02"))).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });
});
