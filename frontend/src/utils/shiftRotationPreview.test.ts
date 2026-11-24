import { describe, expect, it } from "vitest";
import { previewBlock, previewCell, previewRow } from "../test/shiftRotationPreviewFixtures";
import { blockSpanText, cycleWeekByDate, dayHeader, defaultPreviewStart, previewCellLabel, previewCellView, previewDates, previewLabels, previewRange } from "./shiftRotationPreview";

describe("rango", () => {
  it("de 1 a 6 semanas, nunca más de 42 días, y arranca el lunes de la semana actual", () => {
    expect(previewRange("2026-11-23", 2)).toEqual({ from: "2026-11-23", to: "2026-12-06", days: 14 });
    expect(previewRange("2026-11-23", 6)).toEqual({ from: "2026-11-23", to: "2027-01-03", days: 42 });
    expect(previewRange("2026-11-23", 8).days).toBe(42);
    expect(defaultPreviewStart("2026-11-24")).toBe("2026-11-23");
    expect(previewDates("2026-12-30", 3)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
    expect(dayHeader("2026-11-27")).toMatchObject({ short: "Vie", date: "27/11", full: "viernes 27/11/2026" });
  });
});

describe("semanas del ciclo (dato del backend)", () => {
  it("toma la letra devuelta, marca el inicio de cada tramo (lunes o cambio) y cuando varía entre personas", () => {
    const dates = ["2026-11-27", "2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01"];
    const rows = [
      previewRow("1", "A", "a", "1", [previewCell(dates[0]!, { week: "A" }), previewCell(dates[1]!, { week: "A" }), previewCell(dates[2]!, { week: "A" }), previewCell(dates[3]!, { week: "B" }), previewCell(dates[4]!, { week: "B" })]),
      previewRow("2", "B", "b", "2", [previewCell(dates[0]!, { week: null }), previewCell(dates[1]!, { week: "A" }), previewCell(dates[2]!, { week: "A" }), previewCell(dates[3]!, { week: "B" }), previewCell(dates[4]!, { week: "A" })]),
    ];
    expect(cycleWeekByDate(dates, rows)).toEqual([
      { label: "A", varies: false, start: true },
      { label: "A", varies: false, start: false },
      { label: "A", varies: false, start: false },
      { label: "B", varies: false, start: true },
      { label: null, varies: true, start: true },
    ]);
  });
});

describe("celda", () => {
  it("doble bloque con nocturno: ambos bloques en orden, el nocturno sólo en su día", () => {
    const view = previewCellView(previewCell("2026-11-27", { blocks: [previewBlock("2026-11-27", "P-1907", "19:00", "07:00", 1), previewBlock("2026-11-27", "P-0711", "07:00", "11:00", 0)] }));
    expect(view.blocks.map((block) => block.template.code)).toEqual(["P-0711", "P-1907"]);
    expect(view.kind).toBe("SHIFTS");
    expect(blockSpanText(previewBlock("2026-11-27", "P-1907", "19:00", "07:00"))).toBe("vie 27/11 19:00 → sáb 28/11 07:00");
  });

  it("distingue descanso, sin configurar, conflicto, turno fijo y sin programación", () => {
    expect(previewCellView(previewCell("2026-11-27", { kind: "REST" })).kind).toBe("REST");
    expect(previewCellView(previewCell("2026-11-27", { kind: "MISSING" })).kind).toBe("MISSING");
    expect(previewCellView(previewCell("2026-11-27", { kind: "CONFLICT" })).kind).toBe("CONFLICT");
    expect(previewCellView(previewCell("2026-11-27", { kind: "FIXED_ASSIGNMENT", week: null, blocks: [previewBlock("2026-11-27", "F-01", "07:00", "15:00", 0, "FIXED_ASSIGNMENT")] })).kind).toBe("FIXED");
    expect(previewCellView(previewCell("2026-11-27", { kind: "NONE", week: null })).kind).toBe("NONE");
  });

  it("un franco o feriado no oculta las advertencias del backend y atenúa los bloques sin obligación", () => {
    const cell = previewCell("2026-11-27", {
      kind: "MISSING",
      facts: { dayOff: true, holidayScope: "IN_SCOPE", convoked: false, regimeKind: "TURNO_OBLIGATORIO" },
      warnings: [{ code: "ROTATION_PLAN_MISSING", severity: "ERROR", message: "Falta completar la configuración de la rotación para esta fecha." }, { code: "EXPECTED_WORKDAY_UNRESOLVED", severity: "WARNING", message: "x" }],
    });
    expect(previewCellView(cell)).toMatchObject({ tags: ["Franco", "Feriado"], errors: 1, warnings: 1 });
    const suppressed = previewCellView(previewCell("2026-11-28", { blocks: [previewBlock("2026-11-28", "P-0715", "07:00", "15:00")], effective: { obligation: "NO_OBLIGATION", source: "DAY_OFF", reason: "DAY_OFF", blocks: [] }, facts: { dayOff: true, holidayScope: null, convoked: false, regimeKind: null } }));
    expect(suppressed).toMatchObject({ suppressed: true, tags: ["Franco"] });
  });

  it("la etiqueta accesible describe persona, día, semana, horario y avisos", () => {
    const row = previewRow("1", "Gómez", "José", "19", []);
    const cell = previewCell("2026-11-27", { blocks: [previewBlock("2026-11-27", "P-1907", "19:00", "07:00")], warnings: [{ code: "TRANSITION_OVERLAP", severity: "ERROR", message: "x" }] });
    expect(previewCellLabel(row, cell, previewCellView(cell))).toBe("Gómez, José, viernes 27/11/2026, semana A: P-1907 de 19:00 a 07:00 del día siguiente (1 error). Ver detalle.");
  });
});

describe("textos del detalle", () => {
  it("traduce los valores del contrato y nunca muestra un código desconocido", () => {
    expect(previewLabels.reason("ROTATION_REST_DAY")).toBe("Descanso según la grilla.");
    expect(previewLabels.planIssue("NO_VERSION_IN_EFFECT")).toBe("Ninguna versión de la grilla rige en esa fecha.");
    expect(previewLabels.reason("SOMETHING_NEW")).toBe("Otro motivo");
    expect(previewLabels.source("SOMETHING_NEW")).toBe("Otro origen");
    expect(previewLabels.holiday(null)).toBe("No es feriado");
    expect(previewLabels.regime("SIN_TURNO")).toBe("Sin turno obligatorio");
    expect(previewLabels.regime(null)).toBe("Sin régimen asignado");
  });
});
