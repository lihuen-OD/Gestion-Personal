import { describe, expect, it } from "vitest";
import type { ShiftRotationCrew, ShiftRotationDay, ShiftRotationVersionSummary } from "../services/api/shiftRotationApiService";
import {
  blockCrossesMidnight,
  blockDescription,
  buildGridModel,
  defaultVersionId,
  GRID_WEEKDAYS,
  gridIssueSummary,
  validateCrewForm,
  versionOptionLabel,
  versionTimeline,
} from "./shiftRotationGrid";

const DAY = { code: "P-0719", name: "Planta día", startTime: "07:00", endTime: "19:00" };
const NIGHT = { code: "P-1907", name: "Planta noche", startTime: "19:00", endTime: "07:00" };

function crew(id: string, code: string, sortOrder: number, status: "ACTIVO" | "INACTIVO" = "ACTIVO"): ShiftRotationCrew {
  return { id, code, name: `Equipo ${code}`, sortOrder, status, openMemberCount: 0, everHadMembers: false };
}
function day(crewId: string, cycleWeekIndex: number, weekday: number, blocks: Array<typeof DAY> = []): ShiftRotationDay {
  return {
    id: `${crewId}-${cycleWeekIndex}-${weekday}`, crewId, crew: null, cycleWeekIndex, weekLabel: "", weekday, weekdayName: null,
    kind: blocks.length ? "SHIFT" : "REST",
    blocks: blocks.map((template, blockIndex) => ({ blockIndex, shiftTemplateId: template.code, template })),
  };
}
function summary(id: string, effectiveFrom: string, effectiveTo: string | null, inEffectToday: boolean): ShiftRotationVersionSummary {
  return { id, effectiveFrom, effectiveTo, cycleLengthWeeks: 2, anchorWeekStart: effectiveFrom, locked: false, inEffectToday, dayCount: 14, updatedAt: "" };
}

describe("días y bloques", () => {
  it("las columnas van de lunes a domingo con el weekday del backend (0 = domingo)", () => {
    expect(GRID_WEEKDAYS.map((item) => item.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(GRID_WEEKDAYS.map((item) => item.short)).toEqual(["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]);
  });

  it("termina al día siguiente cuando la salida es menor o igual que la entrada (criterio del backend)", () => {
    expect(blockCrossesMidnight(NIGHT)).toBe(true);
    expect(blockCrossesMidnight(DAY)).toBe(false);
    expect(blockCrossesMidnight({ startTime: "07:00", endTime: "07:00" })).toBe(true);
  });

  it("describe cada bloque sin ambigüedades, incluido el doble bloque", () => {
    const night = { blockIndex: 0, shiftTemplateId: "n", template: NIGHT };
    expect(blockDescription(night, { index: 0, total: 1 })).toBe("Planta noche (P-1907), de 19:00 a 07:00 del día siguiente");
    expect(blockDescription({ ...night, template: DAY }, { index: 1, total: 2 })).toBe("Bloque 2 de 2: Planta día (P-0719), de 07:00 a 19:00");
  });
});

describe("modelo de la grilla", () => {
  it("ordena equipos, arma una fila por semana y distingue turno, doble bloque, descanso y sin configurar", () => {
    const crews = [crew("b", "B", 20), crew("a", "A", 10), crew("x", "X", 30, "INACTIVO")];
    const sections = buildGridModel(
      {
        cycleLengthWeeks: 2,
        days: [day("a", 0, 1, [DAY]), day("a", 0, 5, [NIGHT, DAY]), day("a", 1, 0), day("b", 0, 1, [NIGHT])],
        issues: [
          { code: "DAY_MISSING", severity: "WARNING", crewId: "a", cycleWeekIndex: 0, weekday: 2, message: "Falta" },
          { code: "BLOCKS_OVERLAP", severity: "ERROR", crewId: "a", cycleWeekIndex: 0, weekday: 5, message: "los bloques del 2026-11-06 se superponen" },
        ],
      },
      crews,
    );
    // El inactivo sin días no aparece; el orden es el del equipo.
    expect(sections.map((section) => [section.name, section.code])).toEqual([["Equipo A", "A"], ["Equipo B", "B"]]);
    const weekA = sections[0]!.weeks[0]!;
    expect(sections[0]!.weeks.map((week) => week.label)).toEqual(["A", "B"]);
    expect(weekA.cells[0]!.cell.kind).toBe("SHIFT");
    expect(weekA.cells[1]!.cell).toEqual({ kind: "MISSING", issues: [] });
    const friday = weekA.cells[4]!.cell;
    expect(friday.kind === "SHIFT" && friday.blocks.map((block) => block.template.code)).toEqual(["P-1907", "P-0719"]);
    expect(friday.issues).toEqual(["Los bloques del 06/11/2026 se superponen"]);
    expect(sections[0]!.weeks[1]!.cells[6]!.cell.kind).toBe("REST");
  });

  it("muestra un equipo inactivo si todavía tiene días en la versión", () => {
    const sections = buildGridModel({ cycleLengthWeeks: 1, days: [day("x", 0, 1)], issues: [] }, [crew("x", "X", 0, "INACTIVO")]);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.inactive).toBe(true);
  });

  it("resume los días faltantes por equipo y lista el resto de los problemas", () => {
    const result = gridIssueSummary(
      [
        { code: "DAY_MISSING", severity: "WARNING", crewId: "a", message: "x" },
        { code: "DAY_MISSING", severity: "WARNING", crewId: "a", message: "y" },
        { code: "TEMPLATE_INACTIVE", severity: "ERROR", message: "El turno P-01 del lunes está inactivo." },
      ],
      [crew("a", "A", 0)],
    );
    expect(result).toEqual({ errors: ["El turno P-01 del lunes está inactivo."], warnings: ["Equipo A (equipo A): 2 días sin configurar."] });
  });
});

describe("versiones", () => {
  const versions = [summary("old", "2026-10-01", "2026-11-01", false), summary("now", "2026-11-02", "2026-12-06", true), summary("next", "2026-12-07", null, false)];

  it("clasifica y nombra cada versión", () => {
    expect(versions.map((version) => versionTimeline(version, "2026-11-24"))).toEqual(["PAST", "CURRENT", "FUTURE"]);
    expect(versionOptionLabel(versions[0]!, "2026-11-24")).toBe("Anterior · del 01/10/2026 al 01/11/2026");
    expect(versionOptionLabel(versions[2]!, "2026-11-24")).toBe("Futura · desde el 07/12/2026");
  });

  it("elige la vigente, si no la próxima, si no la más reciente", () => {
    expect(defaultVersionId(versions, "2026-11-24")).toBe("now");
    expect(defaultVersionId([versions[0]!, versions[2]!], "2026-11-24")).toBe("next");
    expect(defaultVersionId([versions[0]!], "2026-11-24")).toBe("old");
    expect(defaultVersionId([], "2026-11-24")).toBeNull();
  });
});

describe("formulario de equipo", () => {
  it("valida código sólo en el alta, nombre y orden", () => {
    expect(validateCrewForm({ code: "", name: "A", sortOrder: "x" }, { creating: true })).toEqual({
      code: "Ingresá un código.",
      name: "Ingresá un nombre de al menos 2 caracteres.",
      sortOrder: "Ingresá un número entero entre 0 y 9999.",
    });
    expect(validateCrewForm({ code: "X".repeat(21), name: "Equipo", sortOrder: "10" }, { creating: true })).toEqual({ code: "El código no puede superar los 20 caracteres." });
    expect(validateCrewForm({ code: "", name: "Equipo A", sortOrder: "10" }, { creating: false })).toEqual({});
  });
});
