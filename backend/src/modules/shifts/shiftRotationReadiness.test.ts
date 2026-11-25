import { describe, expect, it } from "vitest";
import { argentinaCalendarDate } from "../../shared/datetime/argentinaTime";
import {
  PLANTA_CREWS,
  PLANTA_EMPLOYEES,
  PLANTA_TEMPLATES,
  plantaConfiguration,
  plantaRotation,
} from "./plantaRotation.fixture";
import {
  assessRotation,
  fixedIntervalsOn,
  healthOf,
  rotationIntervalsOn,
  transitionCheck,
  uncoveredRanges,
  type MembershipFacts,
} from "./shiftRotationReadiness";

const GROUP_ID = "group-planta";

function member(employeeId: string, crewId: string): MembershipFacts {
  return {
    id: `member-${employeeId}`,
    employeeId,
    crewId,
    effectiveFrom: "2026-11-02",
    effectiveTo: null,
    employeeLabel: `${employeeId} · Legajo TEST`,
    employeeActive: true,
  };
}

function assessment(overrides: {
  rotation?: ReturnType<typeof plantaRotation>;
  memberships?: MembershipFacts[];
  fixedAssignments?: Array<{ employeeId: string; templateCode: string; status: "HABILITADO" | "DESHABILITADO"; effectiveFrom: string; effectiveTo: string | null }>;
  regimes?: Array<{ employeeId: string; kind: string; effectiveFrom: string; effectiveTo: string | null }>;
} = {}) {
  const rotation = overrides.rotation ?? plantaRotation();
  return assessRotation({
    rotation: { ...rotation, shiftGroupId: GROUP_ID },
    crewNames: new Map(rotation.crews.map((crew) => [crew.id, crew.code])),
    memberships: overrides.memberships ?? [member(PLANTA_EMPLOYEES.JOSE, PLANTA_CREWS.JOSE)],
    fixedAssignments: overrides.fixedAssignments ?? [],
    regimes: overrides.regimes ?? [],
    templates: new Map(Object.values(PLANTA_TEMPLATES).map((template) => [template.id, { ...template, shiftGroupId: GROUP_ID }])),
    todayKey: "2026-11-02",
  });
}

const fixed = (employeeId: string, dateKey: string, template: typeof PLANTA_TEMPLATES.T0311) => [{
  status: "HABILITADO" as const,
  effectiveFrom: argentinaCalendarDate(dateKey),
  effectiveTo: null,
  weekdays: [],
  template,
}];

describe("diagnóstico de preparación de rotaciones", () => {
  it("acepta la grilla real de Planta y reporta salud OK", () => {
    const issues = assessment();
    expect(issues).toEqual([]);
    expect(healthOf(issues)).toBe("OK");
  });

  it("vuelve bloqueante una celda faltante para un equipo con miembros", () => {
    const rotation = plantaRotation();
    rotation.versions[0]!.days = rotation.versions[0]!.days.filter((day) => !(
      day.crewId === PLANTA_CREWS.JOSE && day.cycleWeekIndex === 0 && day.weekday === 5
    ));
    const issues = assessment({ rotation });
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "GRID_INCOMPLETE", severity: "ERROR", crewId: PLANTA_CREWS.JOSE }),
    ]));
    expect(healthOf(issues)).toBe("ERROR");
  });

  it("detecta turno fijo y SIN_TURNO superpuestos a una membresía", () => {
    const issues = assessment({
      fixedAssignments: [{ employeeId: PLANTA_EMPLOYEES.JOSE, templateCode: "FIJO", status: "HABILITADO", effectiveFrom: "2026-11-10", effectiveTo: null }],
      regimes: [{ employeeId: PLANTA_EMPLOYEES.JOSE, kind: "SIN_TURNO", effectiveFrom: "2026-11-20", effectiveTo: null }],
    });
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["FIXED_ASSIGNMENT_OVERLAP", "SIN_TURNO_OVERLAP"]));
  });

  it("calcula todos los huecos inclusivos entre versiones", () => {
    expect(uncoveredRanges("2026-11-01", "2026-11-20", [
      { effectiveFrom: "2026-11-03", effectiveTo: "2026-11-08" },
      { effectiveFrom: "2026-11-10", effectiveTo: "2026-11-15" },
    ])).toEqual([
      { from: "2026-11-01", to: "2026-11-02" },
      { from: "2026-11-09", to: "2026-11-09" },
      { from: "2026-11-16", to: "2026-11-20" },
    ]);
  });
});

describe("transiciones nocturnas", () => {
  it("José: el bloque del viernes 19–07 se superpone con un fijo 03–11 y sólo toca uno 07–15", () => {
    const config = plantaConfiguration();
    const outgoing = rotationIntervalsOn(config, PLANTA_EMPLOYEES.JOSE, "2026-11-06");
    const overlap = fixedIntervalsOn(fixed(PLANTA_EMPLOYEES.JOSE, "2026-11-07", PLANTA_TEMPLATES.T0311), PLANTA_EMPLOYEES.JOSE, "2026-11-07");
    const touching = fixedIntervalsOn(fixed(PLANTA_EMPLOYEES.JOSE, "2026-11-07", PLANTA_TEMPLATES.T0715), PLANTA_EMPLOYEES.JOSE, "2026-11-07");
    expect(transitionCheck(outgoing, overlap).overlaps).toHaveLength(1);
    expect(transitionCheck(outgoing, touching)).toMatchObject({ overlaps: [], restMinutes: 0 });
  });

  it("Carlos: el jueves 17–03 se superpone con un fijo 02–10 y toca uno 03–11", () => {
    const config = plantaConfiguration();
    const outgoing = rotationIntervalsOn(config, PLANTA_EMPLOYEES.CARLOS, "2026-11-05");
    const atTwo = { ...PLANTA_TEMPLATES.T0311, id: "02-10", code: "02-10", startTime: "02:00", endTime: "10:00" };
    const overlap = fixedIntervalsOn(fixed(PLANTA_EMPLOYEES.CARLOS, "2026-11-06", atTwo), PLANTA_EMPLOYEES.CARLOS, "2026-11-06");
    const touching = fixedIntervalsOn(fixed(PLANTA_EMPLOYEES.CARLOS, "2026-11-06", PLANTA_TEMPLATES.T0311), PLANTA_EMPLOYEES.CARLOS, "2026-11-06");
    expect(transitionCheck(outgoing, overlap).overlaps).toHaveLength(1);
    expect(transitionCheck(outgoing, touching)).toMatchObject({ overlaps: [], restMinutes: 0 });
  });
});
