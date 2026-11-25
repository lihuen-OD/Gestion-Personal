/**
 * Etapa R2 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §22): resolver central
 * del turno esperado. Verifica el resultado estructurado de cada política y la
 * paridad con los consumidores migrados (las expectativas de comportamiento
 * end-to-end viven en shiftBehavior.characterization.test.ts y no cambian).
 */
import { describe, expect, it } from "vitest";
import {
  activeRegimeKindOn,
  applicableFixedAssignments,
  entryReferenceCandidates,
  fixedAssignmentsInVigency,
  isShiftAssignmentApplicableOnDate,
  pickEarliestFixedCandidate,
  resolveExpectedShift,
  type ExpectedShiftInput,
  type FixedAssignment,
} from "./expectedShiftResolver";
import { evaluateEmployeeWorkday, type EmployeeWorkdayContext, type WorkdayConvocation, type WorkdayShiftTemplate } from "./expectedWorkday";
import { matchShiftForEmployee, type ShiftTemplateRef } from "./workShiftEvaluation.service";

const MONDAY = "2026-11-16";
const SATURDAY = "2026-11-21";
const MONDAY_DATE = new Date(`${MONDAY}T00:00:00.000Z`);
const art = (dateKey: string, hhmm: string) => new Date(`${dateKey}T${hhmm}:00.000-03:00`);

type Template = WorkdayShiftTemplate & Pick<ShiftTemplateRef, "code">;
function template(id: string, startTime: string, endTime: string, overrides: Partial<Template> = {}): Template {
  return { id, code: id.toUpperCase(), startTime, endTime, crossesMidnight: endTime <= startTime, expectedMinutes: null, status: "ACTIVO", ...overrides };
}
const OFICINA = template("oficina", "06:30", "15:00", { expectedMinutes: 510 });
const MANANA = template("manana", "07:00", "17:00", { expectedMinutes: 600 });
const TARDE = template("tarde", "17:00", "03:00", { expectedMinutes: 600 });
const NOCHE = template("noche", "23:00", "07:00", { expectedMinutes: 480 });
const INTERMEDIO = template("intermedio", "12:00", "20:00", { expectedMinutes: 480 });

function fixed(shift: Template, overrides: Partial<FixedAssignment<Template>> = {}): FixedAssignment<Template> {
  return { status: "HABILITADO", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null, weekdays: [1, 2, 3, 4, 5], template: shift, ...overrides };
}

function input(overrides: Partial<ExpectedShiftInput<Template, WorkdayConvocation>> = {}): ExpectedShiftInput<Template, WorkdayConvocation> {
  return { dateKey: MONDAY, assignments: [fixed(OFICINA)], dayOff: false, holiday: null, convocation: null, regimeKind: null, ...overrides };
}
const CONVOCATION: WorkdayConvocation = { template: null, expectedStartTime: null, expectedEndTime: null };

const both = (overrides: Partial<ExpectedShiftInput<Template, WorkdayConvocation>> = {}) => ({
  obligation: resolveExpectedShift(input(overrides), "WORK_OBLIGATION"),
  workday: resolveExpectedShift(input(overrides), "EXPECTED_WORKDAY"),
});

describe("bloque de asignaciones fijas", () => {
  it("vigencia: effectiveFrom/effectiveTo inclusivos; ausentes = sin restricción", () => {
    expect(isShiftAssignmentApplicableOnDate({ effectiveFrom: MONDAY_DATE, effectiveTo: MONDAY_DATE }, MONDAY_DATE)).toBe(true);
    expect(isShiftAssignmentApplicableOnDate({ effectiveFrom: new Date("2026-11-17T00:00:00.000Z") }, MONDAY_DATE)).toBe(false);
    expect(isShiftAssignmentApplicableOnDate({ effectiveTo: new Date("2026-11-15T00:00:00.000Z") }, MONDAY_DATE)).toBe(false);
    expect(isShiftAssignmentApplicableOnDate({}, MONDAY_DATE)).toBe(true);
  });

  it("weekdays: 0=domingo..6=sábado; vacío = todos", () => {
    expect(isShiftAssignmentApplicableOnDate({ weekdays: [1] }, MONDAY_DATE)).toBe(true);
    expect(isShiftAssignmentApplicableOnDate({ weekdays: [0, 6] }, MONDAY_DATE)).toBe(false);
    expect(isShiftAssignmentApplicableOnDate({ weekdays: [] }, MONDAY_DATE)).toBe(true);
  });

  it("estado: sólo HABILITADO con plantilla ACTIVO (sin status = la consulta ya filtró); conserva el orden de lectura", () => {
    const rows = [
      fixed(TARDE),
      fixed(MANANA, { status: "DESHABILITADO" }),
      fixed(INTERMEDIO, { template: { ...INTERMEDIO, status: "INACTIVO" } }),
      { status: "HABILITADO" as const, template: { id: "sin-status", startTime: "08:00" } },
      fixed(OFICINA),
    ];
    expect(applicableFixedAssignments(rows as FixedAssignment<object>[], MONDAY_DATE).map((row) => (row.template as { id: string }).id)).toEqual(["tarde", "sin-status", "oficina"]);
  });

  it("vigente pero fuera de día: cuenta como planificación vigente, no como aplicable", () => {
    const rows = [fixed(OFICINA)];
    const saturday = new Date(`${SATURDAY}T00:00:00.000Z`);
    expect(fixedAssignmentsInVigency(rows, saturday)).toHaveLength(1);
    expect(applicableFixedAssignments(rows, saturday)).toHaveLength(0);
  });

  it("régimen vigente: el de effectiveFrom más reciente", () => {
    const regimes = [
      { kind: "TURNO_OBLIGATORIO" as const, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null },
      { kind: "SIN_TURNO" as const, effectiveFrom: new Date("2026-11-01T00:00:00.000Z"), effectiveTo: null },
      { kind: "TURNO_FLEXIBLE" as const, effectiveFrom: new Date("2026-12-01T00:00:00.000Z"), effectiveTo: null },
    ];
    expect(activeRegimeKindOn(regimes, MONDAY_DATE)).toBe("SIN_TURNO");
    expect(activeRegimeKindOn([], MONDAY_DATE)).toBeNull();
  });
});

describe("resolveExpectedShift — casos", () => {
  it("1. turno fijo único: SHIFT FIXED_ASSIGNMENT con un candidato, en ambas políticas", () => {
    const { obligation, workday } = both();
    for (const resolution of [obligation, workday]) {
      expect(resolution).toMatchObject({ obligation: "SHIFT", source: "FIXED_ASSIGNMENT", reason: null, isHoliday: false, convoked: false, convocation: null });
      expect(resolution.fixedCandidates).toEqual([OFICINA]);
    }
  });

  it("2. sin turno: alertas sin obligación; Novedades no resuelto (falta planificación)", () => {
    const { obligation, workday } = both({ assignments: [] });
    expect(obligation).toMatchObject({ obligation: "NO_OBLIGATION", source: "NONE", reason: "NO_APPLICABLE_ASSIGNMENT", fixedCandidates: [] });
    expect(workday).toMatchObject({ obligation: "UNRESOLVED", source: "NONE", reason: "SCHEDULE_MISSING" });
  });

  it("2b. planificación vigente que excluye el día (sábado): alertas sin obligación; Novedades 0 confirmado", () => {
    const { obligation, workday } = both({ dateKey: SATURDAY });
    expect(obligation).toMatchObject({ obligation: "NO_OBLIGATION", reason: "NO_APPLICABLE_ASSIGNMENT" });
    expect(workday).toMatchObject({ obligation: "NO_OBLIGATION", source: "FIXED_ASSIGNMENT", reason: "PLAN_EXCLUDES_DAY" });
  });

  it("3. SIN_TURNO: alertas sin obligación; Novedades no resuelto", () => {
    const { obligation, workday } = both({ regimeKind: "SIN_TURNO" });
    expect(obligation).toMatchObject({ obligation: "NO_OBLIGATION", source: "REGIME", reason: "REGIME_SIN_TURNO" });
    expect(workday).toMatchObject({ obligation: "UNRESOLVED", source: "REGIME", reason: "REGIME_SIN_TURNO" });
  });

  it("3b. TURNO_FLEXIBLE: con asignación aplicable obliga; sin ella, Novedades no resuelto y alertas sin obligación", () => {
    expect(both({ regimeKind: "TURNO_FLEXIBLE" }).obligation).toMatchObject({ obligation: "SHIFT" });
    const saturday = both({ regimeKind: "TURNO_FLEXIBLE", dateKey: SATURDAY });
    expect(saturday.obligation).toMatchObject({ obligation: "NO_OBLIGATION", reason: "NO_APPLICABLE_ASSIGNMENT" });
    expect(saturday.workday).toMatchObject({ obligation: "UNRESOLVED", source: "REGIME", reason: "FLEXIBLE_REGIME_NO_ASSIGNMENT" });
  });

  it("4. franco: sin obligación en ambas, aunque haya feriado convocado o SIN_TURNO", () => {
    for (const overrides of [{}, { holiday: "IN_SCOPE" as const, convocation: CONVOCATION }, { regimeKind: "SIN_TURNO" as const }]) {
      const { obligation, workday } = both({ dayOff: true, ...overrides });
      expect(obligation.obligation).toBe("NO_OBLIGATION");
      expect(workday).toMatchObject({ obligation: "NO_OBLIGATION", source: "DAY_OFF", reason: "DAY_OFF" });
    }
    // Precedencia de alertas tal cual el código: SIN_TURNO se evalúa antes que el franco.
    expect(both({ dayOff: true, regimeKind: "SIN_TURNO" }).obligation.reason).toBe("REGIME_SIN_TURNO");
  });

  it("5. feriado sin convocatoria: sin obligación; Novedades distingue alcance", () => {
    const { obligation, workday } = both({ holiday: "IN_SCOPE" });
    expect(obligation).toMatchObject({ obligation: "NO_OBLIGATION", source: "HOLIDAY_NOT_CONVOKED", isHoliday: true, convoked: false });
    expect(workday).toMatchObject({ obligation: "NO_OBLIGATION", source: "HOLIDAY_NOT_CONVOKED", isHoliday: true });
    expect(both({ holiday: "SCOPE_HISTORY_MISSING" }).workday).toMatchObject({ obligation: "UNRESOLVED", source: "HOLIDAY_SCOPE", reason: "HOLIDAY_SCOPE_HISTORY_MISSING" });
    // P7: fuera de alcance, Novedades lo trata como día normal.
    expect(both({ holiday: "OUT_OF_SCOPE" }).workday).toMatchObject({ obligation: "SHIFT", source: "FIXED_ASSIGNMENT", isHoliday: false });
  });

  it("6. feriado con convocatoria: SHIFT HOLIDAY_CONVOCATION; alertas con los candidatos habituales, sin asignación aplicable no obligan (P8)", () => {
    const { obligation, workday } = both({ holiday: "IN_SCOPE", convocation: CONVOCATION });
    expect(obligation).toMatchObject({ obligation: "SHIFT", source: "HOLIDAY_CONVOCATION", convoked: true, fixedCandidates: [OFICINA] });
    expect(workday).toMatchObject({ obligation: "SHIFT", source: "HOLIDAY_CONVOCATION", convoked: true, isHoliday: true, convocation: CONVOCATION });
    const withoutAssignment = both({ holiday: "IN_SCOPE", convocation: CONVOCATION, assignments: [] });
    expect(withoutAssignment.obligation).toMatchObject({ obligation: "NO_OBLIGATION", reason: "NO_APPLICABLE_ASSIGNMENT" });
    expect(withoutAssignment.workday).toMatchObject({ obligation: "SHIFT", source: "HOLIDAY_CONVOCATION", fixedCandidates: [] });
    // Convocatoria sin feriado no aporta nada.
    expect(both({ convocation: CONVOCATION }).workday).toMatchObject({ source: "FIXED_ASSIGNMENT", convoked: false, convocation: null });
  });

  it("7 y 14. dos asignaciones aplicables disjuntas: el resolver NO elige — conserva ambos candidatos en orden de lectura", () => {
    const { obligation, workday } = both({ assignments: [fixed(TARDE), fixed(MANANA)] });
    expect(obligation.fixedCandidates).toEqual([TARDE, MANANA]);
    expect(workday.fixedCandidates).toEqual([TARDE, MANANA]);
  });

  it("8. vigencias alternadas: sólo la vigente es candidata", () => {
    const rows = [fixed(MANANA, { effectiveTo: new Date("2026-11-15T00:00:00.000Z") }), fixed(TARDE, { effectiveFrom: MONDAY_DATE })];
    expect(both({ assignments: rows }).obligation.fixedCandidates).toEqual([TARDE]);
  });

  it("9. weekdays disjuntos: cada día su turno", () => {
    const rows = [fixed(MANANA), fixed(TARDE, { weekdays: [0, 6] })];
    expect(both({ assignments: rows }).obligation.fixedCandidates).toEqual([MANANA]);
    expect(both({ assignments: rows, dateKey: SATURDAY }).obligation.fixedCandidates).toEqual([TARDE]);
  });

  it("10. cross-midnight: el inicio programado es de la fecha operativa", () => {
    expect(pickEarliestFixedCandidate(MONDAY, [NOCHE])).toEqual({ template: NOCHE, scheduledStartAt: art(MONDAY, "23:00") });
    expect(pickEarliestFixedCandidate(MONDAY, [TARDE])).toEqual({ template: TARDE, scheduledStartAt: art(MONDAY, "17:00") });
  });

  it("11. asignación DESHABILITADA: no es candidata de la obligación ni de Novedades", () => {
    const { obligation, workday } = both({ assignments: [fixed(OFICINA, { status: "DESHABILITADO" })] });
    expect(obligation).toMatchObject({ obligation: "NO_OBLIGATION", fixedCandidates: [] });
    expect(workday).toMatchObject({ obligation: "UNRESOLVED", reason: "SCHEDULE_MISSING" });
  });

  it("12. plantilla INACTIVO: no es candidata", () => {
    const { obligation, workday } = both({ assignments: [fixed(OFICINA, { template: { ...OFICINA, status: "INACTIVO" } })] });
    expect(obligation.fixedCandidates).toEqual([]);
    expect(workday).toMatchObject({ obligation: "UNRESOLVED", reason: "SCHEDULE_MISSING" });
  });
});

describe("selección legacy por consumidor", () => {
  it("obligación: inicio más temprano; empate exacto → el primero leído", () => {
    expect(pickEarliestFixedCandidate(MONDAY, [TARDE, MANANA])?.template).toBe(MANANA);
    const otraManana = template("otra", "07:00", "12:00");
    expect(pickEarliestFixedCandidate(MONDAY, [otraManana, MANANA])?.template).toBe(otraManana);
    expect(pickEarliestFixedCandidate(MONDAY, [MANANA, otraManana])?.template).toBe(MANANA);
    expect(pickEarliestFixedCandidate(MONDAY, [])).toBeNull();
  });

  it("13. entrada: habilitadas primero, después deshabilitadas, en orden de lectura; sólo plantillas ACTIVO", () => {
    const candidates = entryReferenceCandidates({
      referenceDate: MONDAY_DATE,
      assignments: [
        { shiftTemplateId: "tarde", status: "DESHABILITADO", weekdays: [1] },
        { shiftTemplateId: "manana", status: "HABILITADO" },
        { shiftTemplateId: "intermedio", status: "HABILITADO" },
        { shiftTemplateId: "oficina", status: "HABILITADO", weekdays: [6] },
      ],
      activeTemplates: [MANANA, TARDE, OFICINA],
    });
    expect(candidates.map((candidate) => [candidate.template.id, candidate.enabled])).toEqual([
      ["manana", true],
      ["tarde", false],
    ]);
  });
});

describe("paridad con los consumidores migrados", () => {
  const refs = (rows: Array<{ id: string; status?: "HABILITADO" | "DESHABILITADO" }>) => rows.map((row) => ({ shiftTemplateId: row.id, status: row.status ?? ("HABILITADO" as const) }));
  const asRef = (shift: Template): ShiftTemplateRef => ({
    ...shift,
    entryToleranceBeforeMinutes: 10,
    entryToleranceAfterMinutes: 10,
    exitToleranceBeforeMinutes: 10,
    exitToleranceAfterMinutes: 10,
    minimumMinutesForCompliance: null,
    maximumInformativeMinutes: 900,
    missingOutAlertAfterMinutes: null,
    absoluteOpenShiftLimitMinutes: 1200,
  });

  it("entrada: matchShiftForEmployee elige entre exactamente los candidatos del resolver (empate exacto depende del orden)", () => {
    const templates = [asRef(MANANA), asRef(TARDE)];
    const match = (order: string[], at: string) => matchShiftForEmployee({ actualAt: art(MONDAY, at), employeeAssignments: refs(order.map((id) => ({ id }))), activeTemplates: templates });
    expect(match(["manana", "tarde"], "11:30").template?.id).toBe("manana");
    expect(match(["manana", "tarde"], "16:55").template?.id).toBe("tarde");
    expect(match(["manana", "tarde"], "12:00").template?.id).toBe("manana");
    expect(match(["tarde", "manana"], "12:00").template?.id).toBe("tarde");
    // Una deshabilitada más cercana gana y queda como DISABLED_FOR_EMPLOYEE.
    const disabled = matchShiftForEmployee({ actualAt: art(MONDAY, "16:55"), employeeAssignments: refs([{ id: "manana" }, { id: "tarde", status: "DESHABILITADO" }]), activeTemplates: templates });
    expect(disabled).toMatchObject({ case: "DISABLED_FOR_EMPLOYEE", template: { id: "tarde" } });
  });

  it("Novedades: evaluateEmployeeWorkday proyecta la resolución (suma de disjuntos, superpuestos UNRESOLVED)", () => {
    const context = (assignments: FixedAssignment<Template>[]): EmployeeWorkdayContext => ({
      employeeId: "e1",
      assignments: assignments.map((row) => ({ status: row.status, effectiveFrom: row.effectiveFrom!, effectiveTo: row.effectiveTo ?? null, weekdays: row.weekdays ?? [], template: row.template })),
      dayOffDates: new Set(),
      convocations: new Map(),
      regimes: [],
      holidays: new Map(),
    });
    expect(evaluateEmployeeWorkday(context([fixed(MANANA), fixed(TARDE)]), MONDAY)).toMatchObject({ obligation: "WORKDAY", expectedMinutes: 1200, source: "SHIFT_PLAN" });
    expect(evaluateEmployeeWorkday(context([fixed(MANANA), fixed(INTERMEDIO)]), MONDAY)).toMatchObject({ obligation: "UNRESOLVED", unresolvedReason: "SHIFT_ASSIGNMENTS_OVERLAP" });
    expect(evaluateEmployeeWorkday(context([fixed(OFICINA)]), MONDAY)).toMatchObject({ obligation: "WORKDAY", expectedMinutes: 510 });
  });

  it("obligación: la selección legacy sobre los candidatos del resolver da el turno de inicio más temprano", () => {
    const resolution = resolveExpectedShift(input({ assignments: [fixed(TARDE), fixed(MANANA)] }), "WORK_OBLIGATION");
    expect(pickEarliestFixedCandidate(MONDAY, resolution.fixedCandidates)).toEqual({ template: MANANA, scheduledStartAt: art(MONDAY, "07:00") });
  });
});
