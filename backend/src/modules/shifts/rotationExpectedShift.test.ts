import { describe, expect, it } from "vitest";
import { resolveExpectedShift, type ExpectedShiftInput, type FixedAssignment } from "./expectedShiftResolver";
import { evaluateEmployeeWorkday, projectExpectedWorkday, type WorkdayConvocation, type WorkdayShiftAssignment, type WorkdayShiftTemplate } from "./expectedWorkday";
import { PLANTA_EMPLOYEES, PLANTA_TEMPLATES, plantaConfiguration } from "./plantaRotation.fixture";
import { resolveRotationDayPlan, type ExpectedDayPlan, type RotationTemplateRef } from "./rotationPlan";

// R4.2 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.3): integración del
// plan de rotación con el resolver central, compatible con el legacy.
const art = (dateKey: string, hhmm: string) => new Date(`${dateKey}T${hhmm}:00.000-03:00`);
const config = plantaConfiguration();
const planOf = (employeeId: string, dateKey: string) => resolveRotationDayPlan(employeeId, dateKey, config)!;

const JOSE_FRIDAY = planOf(PLANTA_EMPLOYEES.JOSE, "2026-11-06"); // SHIFTS 07–11 + 19–07
const JOHANNA_SATURDAY_A = planOf(PLANTA_EMPLOYEES.JOHANNA, "2026-11-07"); // REST
const conflictPlan: ExpectedDayPlan = { kind: "CONFLICT", dateKey: "2026-11-06", employeeId: PLANTA_EMPLOYEES.JOSE, source: "ROTATION", reason: "MULTIPLE_MEMBERSHIPS", detail: ["membership:a", "membership:b"] };
const missingPlan: ExpectedDayPlan = { kind: "MISSING", dateKey: "2026-11-06", employeeId: PLANTA_EMPLOYEES.JOSE, source: "ROTATION", reason: "NO_DAY_ROW", origin: { rotationId: "r", crewId: "c" } };

const FIXED_TEMPLATE: WorkdayShiftTemplate = { id: "fijo-07-15", startTime: "07:00", endTime: "15:00", crossesMidnight: false, expectedMinutes: 480, status: "ACTIVO" };
const FIXED_ALL_DAYS: FixedAssignment<WorkdayShiftTemplate> & WorkdayShiftAssignment = { status: "HABILITADO", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null, weekdays: [], template: FIXED_TEMPLATE };
const CONVOCATION_TEMPLATE: RotationTemplateRef = { ...PLANTA_TEMPLATES.T0715, id: "guardia-feriado" };
const convocationWith = (template: WorkdayShiftTemplate | null): WorkdayConvocation => ({ template, expectedStartTime: null, expectedEndTime: null });
const CONVOCATION_WORKDAY_TEMPLATE: WorkdayShiftTemplate = { id: "guardia-feriado", startTime: "07:00", endTime: "15:00", crossesMidnight: false, expectedMinutes: 480, status: "ACTIVO" };

type Input = ExpectedShiftInput<WorkdayShiftTemplate, WorkdayConvocation>;
function input(dateKey: string, overrides: Partial<Input> = {}): Input {
  return { dateKey, assignments: [FIXED_ALL_DAYS], dayOff: false, holiday: null, convocation: null, regimeKind: null, ...overrides };
}
const both = (value: Input) => ({ obligation: resolveExpectedShift(value, "WORK_OBLIGATION"), workday: resolveExpectedShift(value, "EXPECTED_WORKDAY") });
const keys = (blocks: Array<{ obligationKey: string }>) => blocks.map((block) => block.obligationKey);

describe("compatibilidad: sin plan de rotación el resolver es el legacy", () => {
  it("rotationPlan ausente o null: fijos como hoy, dayPlan null y sin bloques", () => {
    for (const rotationPlan of [undefined, null]) {
      const { obligation, workday } = both(input("2026-11-06", { rotationPlan }));
      expect(obligation).toMatchObject({ obligation: "SHIFT", source: "FIXED_ASSIGNMENT", fixedCandidates: [FIXED_TEMPLATE], dayPlan: null, blocks: [] });
      expect(workday).toMatchObject({ obligation: "SHIFT", source: "FIXED_ASSIGNMENT", fixedCandidates: [FIXED_TEMPLATE], dayPlan: null, blocks: [] });
    }
  });

  it("Juanjo (no miembro: plan null) el sábado sigue sin obligación por su turno fijo L–V", () => {
    const juanjo = { ...FIXED_ALL_DAYS, weekdays: [1, 2, 3, 4, 5] };
    expect(resolveRotationDayPlan(PLANTA_EMPLOYEES.JUANJO, "2026-11-07", config)).toBeNull();
    const { obligation, workday } = both(input("2026-11-07", { assignments: [juanjo], rotationPlan: resolveRotationDayPlan(PLANTA_EMPLOYEES.JUANJO, "2026-11-07", config) }));
    expect(obligation).toMatchObject({ obligation: "NO_OBLIGATION", reason: "NO_APPLICABLE_ASSIGNMENT", dayPlan: null });
    expect(workday).toMatchObject({ obligation: "NO_OBLIGATION", source: "FIXED_ASSIGNMENT", reason: "PLAN_EXCLUDES_DAY" });
  });
});

describe("camino de rotación", () => {
  it("SHIFTS: obligación con los bloques del plan; la rotación reemplaza a los fijos (fixedCandidates vacío)", () => {
    const { obligation, workday } = both(input("2026-11-06", { rotationPlan: JOSE_FRIDAY }));
    for (const resolution of [obligation, workday]) {
      expect(resolution).toMatchObject({ obligation: "SHIFT", source: "ROTATION", reason: null, fixedCandidates: [], dayPlan: JOSE_FRIDAY });
      expect(keys(resolution.blocks)).toEqual(keys(JOSE_FRIDAY.kind === "SHIFTS" ? JOSE_FRIDAY.blocks : []));
    }
  });

  it("REST: sin obligación en ambas políticas (aunque tenga un turno fijo que aplicaría)", () => {
    const { obligation, workday } = both(input("2026-11-07", { rotationPlan: JOHANNA_SATURDAY_A }));
    expect(obligation).toMatchObject({ obligation: "NO_OBLIGATION", source: "ROTATION", reason: "ROTATION_REST_DAY", blocks: [], fixedCandidates: [] });
    expect(workday).toMatchObject({ obligation: "NO_OBLIGATION", source: "ROTATION", reason: "ROTATION_REST_DAY" });
  });

  it("MISSING: sin obligación para alertas, no resuelto para Novedades (nunca descanso)", () => {
    const { obligation, workday } = both(input("2026-11-06", { rotationPlan: missingPlan }));
    expect(obligation).toMatchObject({ obligation: "NO_OBLIGATION", source: "ROTATION", reason: "ROTATION_DAY_MISSING", dayPlan: missingPlan });
    expect(workday).toMatchObject({ obligation: "UNRESOLVED", source: "ROTATION", reason: "ROTATION_DAY_MISSING" });
  });

  it("CONFLICT: ninguna obligación ni bloques, con motivo propio y el plan (detalle) conservado", () => {
    const { obligation, workday } = both(input("2026-11-06", { rotationPlan: conflictPlan }));
    expect(obligation).toMatchObject({ obligation: "NO_OBLIGATION", source: "ROTATION", reason: "ROTATION_CONFIG_CONFLICT", blocks: [], dayPlan: conflictPlan });
    expect(workday).toMatchObject({ obligation: "UNRESOLVED", source: "ROTATION", reason: "ROTATION_CONFIG_CONFLICT", dayPlan: conflictPlan });
  });

  it("franco y SIN_TURNO ganan sobre la rotación", () => {
    expect(both(input("2026-11-06", { rotationPlan: JOSE_FRIDAY, dayOff: true })).obligation).toMatchObject({ obligation: "NO_OBLIGATION", source: "DAY_OFF", blocks: [] });
    expect(both(input("2026-11-06", { rotationPlan: JOSE_FRIDAY, dayOff: true })).workday).toMatchObject({ obligation: "NO_OBLIGATION", source: "DAY_OFF" });
    expect(both(input("2026-11-06", { rotationPlan: JOSE_FRIDAY, regimeKind: "SIN_TURNO" })).obligation).toMatchObject({ obligation: "NO_OBLIGATION", source: "REGIME" });
    expect(both(input("2026-11-06", { rotationPlan: JOSE_FRIDAY, regimeKind: "SIN_TURNO" })).workday).toMatchObject({ obligation: "UNRESOLVED", source: "REGIME" });
  });
});

describe("feriados y convocatorias en el camino de rotación", () => {
  const holiday = { holiday: "IN_SCOPE" as const };

  it("feriado sin convocatoria: sin obligación aunque el plan tenga bloques", () => {
    const { obligation, workday } = both(input("2026-11-06", { ...holiday, rotationPlan: JOSE_FRIDAY }));
    expect(obligation).toMatchObject({ obligation: "NO_OBLIGATION", source: "HOLIDAY_NOT_CONVOKED", blocks: [] });
    expect(workday).toMatchObject({ obligation: "NO_OBLIGATION", source: "HOLIDAY_NOT_CONVOKED" });
  });

  it("convocatoria con plantilla PREVALECE sobre un día REST: un bloque de la convocatoria", () => {
    const { obligation, workday } = both(input("2026-11-07", { ...holiday, rotationPlan: JOHANNA_SATURDAY_A, convocation: convocationWith(CONVOCATION_WORKDAY_TEMPLATE), convocationTemplate: CONVOCATION_TEMPLATE }));
    for (const resolution of [obligation, workday]) {
      expect(resolution).toMatchObject({ obligation: "SHIFT", source: "HOLIDAY_CONVOCATION", convoked: true, dayPlan: JOHANNA_SATURDAY_A });
      expect(resolution.blocks).toEqual([
        expect.objectContaining({ source: "HOLIDAY_CONVOCATION", template: CONVOCATION_TEMPLATE, scheduledStartAt: art("2026-11-07", "07:00"), scheduledEndAt: art("2026-11-07", "15:00"), origin: null }),
      ]);
    }
  });

  it("convocatoria con plantilla reemplaza los bloques de un día SHIFTS", () => {
    const { obligation } = both(input("2026-11-06", { ...holiday, rotationPlan: JOSE_FRIDAY, convocation: convocationWith(CONVOCATION_WORKDAY_TEMPLATE), convocationTemplate: CONVOCATION_TEMPLATE }));
    expect(obligation.blocks.map((block) => block.template.id)).toEqual(["guardia-feriado"]);
  });

  it("convocatoria SIN plantilla: bloques del plan si es SHIFTS; sin obligación (y motivo propio) si es REST o MISSING", () => {
    const shifts = both(input("2026-11-06", { ...holiday, rotationPlan: JOSE_FRIDAY, convocation: convocationWith(null) }));
    expect(shifts.obligation).toMatchObject({ obligation: "SHIFT", source: "HOLIDAY_CONVOCATION" });
    expect(shifts.obligation.blocks).toHaveLength(2);
    for (const rotationPlan of [JOHANNA_SATURDAY_A, missingPlan]) {
      expect(both(input("2026-11-07", { ...holiday, rotationPlan, convocation: convocationWith(null) })).obligation).toMatchObject({ obligation: "NO_OBLIGATION", source: "HOLIDAY_CONVOCATION", reason: "HOLIDAY_CONVOCATION_WITHOUT_SCHEDULE" });
    }
  });

  it("una plantilla de convocatoria INACTIVA no prevalece: se comporta como convocatoria sin plantilla", () => {
    const inactive: RotationTemplateRef = { ...CONVOCATION_TEMPLATE, status: "INACTIVO" };
    expect(both(input("2026-11-07", { ...holiday, rotationPlan: JOHANNA_SATURDAY_A, convocation: convocationWith(null), convocationTemplate: inactive })).obligation).toMatchObject({ obligation: "NO_OBLIGATION", reason: "HOLIDAY_CONVOCATION_WITHOUT_SCHEDULE" });
  });

  it("el franco gana incluso sobre la convocatoria con plantilla", () => {
    const { obligation, workday } = both(input("2026-11-07", { ...holiday, dayOff: true, rotationPlan: JOHANNA_SATURDAY_A, convocation: convocationWith(CONVOCATION_WORKDAY_TEMPLATE), convocationTemplate: CONVOCATION_TEMPLATE }));
    expect(obligation).toMatchObject({ obligation: "NO_OBLIGATION", source: "DAY_OFF", blocks: [] });
    expect(workday).toMatchObject({ obligation: "NO_OBLIGATION", source: "DAY_OFF" });
  });

  it("CONFLICT + convocatoria con plantilla: la convocatoria decide la obligación, pero el CONFLICT sigue visible con su motivo y detalle", () => {
    const { obligation, workday } = both(input("2026-11-06", { ...holiday, rotationPlan: conflictPlan, convocation: convocationWith(CONVOCATION_WORKDAY_TEMPLATE), convocationTemplate: CONVOCATION_TEMPLATE }));
    expect(obligation).toMatchObject({ obligation: "SHIFT", source: "HOLIDAY_CONVOCATION", dayPlan: { kind: "CONFLICT", reason: "MULTIPLE_MEMBERSHIPS", detail: ["membership:a", "membership:b"] } });
    expect(obligation.blocks.map((block) => block.source)).toEqual(["HOLIDAY_CONVOCATION"]);
    expect(projectExpectedWorkday(workday)).toMatchObject({ obligation: "WORKDAY", expectedMinutes: 480, planIssue: { kind: "CONFLICT", reason: "MULTIPLE_MEMBERSHIPS", detail: ["membership:a", "membership:b"] } });
  });

  it("CONFLICT + convocatoria sin plantilla: sin obligación con motivo de conflicto (no se oculta como convocatoria sin horario)", () => {
    expect(both(input("2026-11-06", { ...holiday, rotationPlan: conflictPlan, convocation: convocationWith(null) })).obligation).toMatchObject({ obligation: "NO_OBLIGATION", reason: "ROTATION_CONFIG_CONFLICT", dayPlan: conflictPlan });
  });
});

describe("proyección de Novedades (expectedWorkday)", () => {
  const project = (value: Input) => projectExpectedWorkday(resolveExpectedShift(value, "EXPECTED_WORKDAY"));

  it("José viernes A: la suma de los dos bloques del plan es válida (960 min), con ambas plantillas", () => {
    expect(project(input("2026-11-06", { rotationPlan: JOSE_FRIDAY }))).toEqual({
      dateKey: "2026-11-06",
      obligation: "WORKDAY",
      unresolvedReason: null,
      expectedMinutes: 960,
      shiftTemplateIds: [PLANTA_TEMPLATES.T0711.id, PLANTA_TEMPLATES.T1907.id],
      isHoliday: false,
      convoked: false,
      source: "SHIFT_ROTATION",
      minutesSource: "ROTATION_BLOCKS",
    });
  });

  it("REST → 0 confirmado; MISSING y CONFLICT → no resuelto (motivo persistible SCHEDULE_MISSING) con el problema en planIssue", () => {
    expect(project(input("2026-11-07", { rotationPlan: JOHANNA_SATURDAY_A }))).toMatchObject({ obligation: "NO_WORK_OBLIGATION", expectedMinutes: 0, source: "SHIFT_ROTATION" });
    expect(project(input("2026-11-07", { rotationPlan: JOHANNA_SATURDAY_A }))).not.toHaveProperty("planIssue");
    expect(project(input("2026-11-06", { rotationPlan: missingPlan }))).toMatchObject({ obligation: "UNRESOLVED", unresolvedReason: "SCHEDULE_MISSING", source: "SHIFT_ROTATION", planIssue: { kind: "MISSING", reason: "NO_DAY_ROW" } });
    expect(project(input("2026-11-06", { rotationPlan: conflictPlan }))).toMatchObject({ obligation: "UNRESOLVED", unresolvedReason: "SCHEDULE_MISSING", planIssue: { kind: "CONFLICT", reason: "MULTIPLE_MEMBERSHIPS", detail: ["membership:a", "membership:b"] } });
  });

  it("feriado convocado sin plantilla en rotación: minutos de los bloques del plan", () => {
    expect(project(input("2026-11-06", { holiday: "IN_SCOPE", rotationPlan: JOSE_FRIDAY, convocation: convocationWith(null) }))).toMatchObject({ obligation: "WORKDAY", expectedMinutes: 960, source: "HOLIDAY_CONVOCATION", minutesSource: "ROTATION_BLOCKS" });
  });

  it("legacy intacto: el contexto de Novedades sin rotación no agrega planIssue ni cambia valores", () => {
    const context = { employeeId: "e", assignments: [FIXED_ALL_DAYS], dayOffDates: new Set<string>(), convocations: new Map(), regimes: [], holidays: new Map() };
    expect(evaluateEmployeeWorkday(context, "2026-11-06")).toEqual({
      dateKey: "2026-11-06",
      obligation: "WORKDAY",
      unresolvedReason: null,
      expectedMinutes: 480,
      shiftTemplateIds: ["fijo-07-15"],
      isHoliday: false,
      convoked: false,
      source: "SHIFT_PLAN",
      minutesSource: "SHIFT_ASSIGNMENT",
    });
  });
});
