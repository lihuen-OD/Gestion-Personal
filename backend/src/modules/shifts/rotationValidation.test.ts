import { describe, expect, it } from "vitest";
import { PLANTA_CREWS, PLANTA_TEMPLATES, plantaDays, plantaRotation, plantaVersion } from "./plantaRotation.fixture";
import type { RotationDaySnapshot, RotationTemplateRef, RotationVersionSnapshot } from "./rotationPlan";
import { validateRotationGrid, type RotationGridIssue } from "./rotationValidation";

// R4.2 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.3): validación pura de
// grillas. La especificación real de Planta (§25) es válida; cada defecto se
// detecta con su código.
const TEMPLATES = new Map<string, RotationTemplateRef>(Object.values(PLANTA_TEMPLATES).map((template) => [template.id, template]));
const rotation = plantaRotation();
const validate = (version: RotationVersionSnapshot, templates: ReadonlyMap<string, RotationTemplateRef> = TEMPLATES) => validateRotationGrid({ rotation, version, templates });
const codes = (issues: RotationGridIssue[]) => issues.map((issue) => issue.code);

/** Reemplaza las plantillas de una celda (vacío = descanso). */
function withCell(crewId: string, cycleWeekIndex: number, weekday: number, templates: RotationTemplateRef[]): RotationDaySnapshot[] {
  return plantaDays().map((day) =>
    day.crewId === crewId && day.cycleWeekIndex === cycleWeekIndex && day.weekday === weekday
      ? { ...day, kind: templates.length ? "SHIFT" : "REST", blocks: templates.map((template, blockIndex) => ({ blockIndex, template })) }
      : day,
  );
}

describe("validateRotationGrid", () => {
  it("la especificación real de Planta no tiene problemas (grilla completa, sin superposiciones ni en los cruces de semana y ciclo)", () => {
    expect(validate(plantaVersion())).toEqual([]);
  });

  it("bloques que sólo se tocan (jueves 17–03 y viernes 03–11) no se superponen: el fin es exclusivo", () => {
    expect(validate(plantaVersion({ days: withCell(PLANTA_CREWS.CARLOS_WALTER, 0, 5, [PLANTA_TEMPLATES.T0311]) }))).toEqual([]);
  });

  it("superposición en el mismo día → BLOCKS_OVERLAP SAME_DAY", () => {
    const issues = validate(plantaVersion({ days: withCell(PLANTA_CREWS.JOSE, 0, 5, [PLANTA_TEMPLATES.T0715, PLANTA_TEMPLATES.T0711]) }));
    expect(issues).toEqual([expect.objectContaining({ code: "BLOCKS_OVERLAP", relation: "SAME_DAY", crewId: PLANTA_CREWS.JOSE, cycleWeekIndex: 0, weekday: 5 })]);
  });

  it("cruce incompatible entre días consecutivos (Juanchi B: jueves 19–07 y viernes 03–11) → NEXT_DAY", () => {
    const days = withCell(PLANTA_CREWS.JUANCHI, 1, 4, [PLANTA_TEMPLATES.T1907]).map((day) =>
      day.crewId === PLANTA_CREWS.JUANCHI && day.cycleWeekIndex === 1 && day.weekday === 5 ? { ...day, blocks: [{ blockIndex: 0, template: PLANTA_TEMPLATES.T0311 }] } : day,
    );
    expect(validate(plantaVersion({ days }))).toEqual([
      expect.objectContaining({ code: "BLOCKS_OVERLAP", relation: "NEXT_DAY", cycleWeekIndex: 1, weekday: 5, related: { cycleWeekIndex: 1, weekday: 4, blockIndex: 0 } }),
    ]);
  });

  it("superposición entre semanas (José: domingo A 19–07 → lunes B 03–11) → WEEK_BOUNDARY", () => {
    const issues = validate(plantaVersion({ days: withCell(PLANTA_CREWS.JOSE, 1, 1, [PLANTA_TEMPLATES.T0311]) }));
    expect(issues).toEqual([expect.objectContaining({ code: "BLOCKS_OVERLAP", relation: "WEEK_BOUNDARY", cycleWeekIndex: 1, weekday: 1, related: { cycleWeekIndex: 0, weekday: 0, blockIndex: 0 } })]);
  });

  it("superposición al reiniciar el ciclo — el conflicto de los serenos (domingo B 19–07 → lunes A 03–11) → CYCLE_WRAP", () => {
    const issues = validate(plantaVersion({ days: withCell(PLANTA_CREWS.JUANCHI, 0, 1, [PLANTA_TEMPLATES.T0311]) }));
    expect(issues).toEqual([expect.objectContaining({ code: "BLOCKS_OVERLAP", relation: "CYCLE_WRAP", cycleWeekIndex: 0, weekday: 1, related: { cycleWeekIndex: 1, weekday: 0, blockIndex: 0 } })]);
    expect(issues[0]!.message).toContain("al reiniciar el ciclo");
  });

  it("día SHIFT sin bloques, REST con bloques y orden de bloque repetido", () => {
    const days = plantaDays();
    const target = (day: RotationDaySnapshot) => day.crewId === PLANTA_CREWS.JOSE && day.cycleWeekIndex === 0;
    expect(codes(validate(plantaVersion({ days: days.map((day) => (target(day) && day.weekday === 1 ? { ...day, blocks: [] } : day)) })))).toEqual(["SHIFT_DAY_WITHOUT_BLOCKS"]);
    expect(codes(validate(plantaVersion({ days: days.map((day) => (target(day) && day.weekday === 2 ? { ...day, kind: "REST" as const } : day)) })))).toEqual(["REST_DAY_WITH_BLOCKS"]);
    expect(codes(validate(plantaVersion({ days: days.map((day) => (target(day) && day.weekday === 5 ? { ...day, blocks: day.blocks.map((block) => ({ ...block, blockIndex: 0 })) } : day)) })))).toEqual(["BLOCK_INDEX_DUPLICATED"]);
  });

  it("equipo ajeno a la rotación, semana fuera del ciclo, día duplicado y día de semana inválido", () => {
    const days = plantaDays();
    const extra = (overrides: Partial<RotationDaySnapshot>): RotationDaySnapshot => ({ id: "extra", crewId: PLANTA_CREWS.JOSE, cycleWeekIndex: 0, weekday: 1, kind: "REST", blocks: [], ...overrides });
    expect(codes(validate(plantaVersion({ days: [...days, extra({ crewId: "crew-ajeno", cycleWeekIndex: 0, weekday: 1 })] })))).toEqual(["CREW_NOT_IN_ROTATION"]);
    expect(codes(validate(plantaVersion({ days: [...days, extra({ cycleWeekIndex: 2 })] })))).toEqual(["WEEK_OUT_OF_CYCLE"]);
    expect(codes(validate(plantaVersion({ days: [...days, extra({})] })))).toEqual(["DUPLICATE_DAY"]);
    expect(codes(validate(plantaVersion({ days: [...days, extra({ weekday: 7 })] })))).toEqual(["INVALID_WEEKDAY"]);
  });

  it("plantilla inexistente, inactiva u horario inválido", () => {
    const ghost: RotationTemplateRef = { ...PLANTA_TEMPLATES.T0715, id: "fantasma" };
    expect(codes(validate(plantaVersion({ days: withCell(PLANTA_CREWS.JOHANNA, 0, 1, [ghost]) })))).toEqual(["TEMPLATE_NOT_FOUND"]);
    const inactive = new Map(TEMPLATES).set(PLANTA_TEMPLATES.T0711.id, { ...PLANTA_TEMPLATES.T0711, status: "INACTIVO" });
    expect(codes(validate(plantaVersion(), inactive))).toEqual(["TEMPLATE_INACTIVE"]);
    const invalid = new Map(TEMPLATES).set(PLANTA_TEMPLATES.T0711.id, { ...PLANTA_TEMPLATES.T0711, startTime: "7:00" });
    expect(codes(validate(plantaVersion(), invalid))).toEqual(["TEMPLATE_INVALID_TIMES"]);
  });

  it("ancla que no es lunes y longitud de ciclo inválida", () => {
    expect(codes(validate(plantaVersion({ anchorWeekStart: "2026-11-03" })))).toEqual(["INVALID_ANCHOR"]);
    expect(codes(validate(plantaVersion({ cycleLengthWeeks: 13 })))).toEqual(["INVALID_CYCLE_LENGTH"]);
  });

  it("grilla incompleta → DAY_MISSING como advertencia por cada celda faltante de un equipo activo", () => {
    const days = plantaDays().filter((day) => !(day.crewId === PLANTA_CREWS.JOHANNA && day.cycleWeekIndex === 1 && (day.weekday === 6 || day.weekday === 0)));
    const issues = validate(plantaVersion({ days }));
    expect(issues).toEqual([
      expect.objectContaining({ code: "DAY_MISSING", severity: "WARNING", crewId: PLANTA_CREWS.JOHANNA, cycleWeekIndex: 1, weekday: 0 }),
      expect.objectContaining({ code: "DAY_MISSING", severity: "WARNING", crewId: PLANTA_CREWS.JOHANNA, cycleWeekIndex: 1, weekday: 6 }),
    ]);
    // Un ciclo de 3 semanas con la grilla de 2: la semana C entera falta para cada equipo (5 equipos × 7 días).
    expect(validate(plantaVersion({ cycleLengthWeeks: 3 })).filter((issue) => issue.code === "DAY_MISSING")).toHaveLength(35);
  });
});
