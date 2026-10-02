import { describe, expect, it } from "vitest";
import type { EmployeeTimeGridRow } from "../services/api/employeeApiService";
import type { TimeEntry } from "../types";
import {
  applyBreakdownToRows,
  applyNormalEntryToRows,
  groupTimeGridRows,
  hourConceptLoadModeLabel,
  isManualBreakdownEditable,
  normalWorkedDays,
  timeGridRowLabel,
  timeGridRowSubtitle,
  upsertTimeEntry,
} from "./employeeHoursGrid";

const concept = (
  id: string,
  loadMode: EmployeeTimeGridRow["concept"]["loadMode"],
  systemRole: EmployeeTimeGridRow["concept"]["systemRole"],
  workTreatment: EmployeeTimeGridRow["concept"]["workTreatment"] = systemRole ? null : "WITHIN_BASE",
) => ({
  id, code: id, name: id, kind: "OTRO" as const, status: "ACTIVO" as const, loadMode, systemRole, workTreatment, createdAt: "", updatedAt: "",
});

describe("presentación de la grilla por tratamiento (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md)", () => {
  const rows: EmployeeTimeGridRow[] = [
    { concept: concept("normal", null, "NORMAL_BASE"), role: "NORMAL_BASE", enabled: true, minutesByDay: { "1": 480 }, totalMinutes: 480 },
    { concept: concept("sereno", "AUTOMATIC", null), role: "ADDITIONAL", enabled: true, minutesByDay: { "1": 360 }, totalMinutes: 360 },
    { concept: concept("colectivo", "MANUAL", null, "ADDITIVE_TO_WORKED_TOTAL"), role: "ADDITIONAL", enabled: true, minutesByDay: {}, totalMinutes: 0 },
  ];

  it("muestra los modos oficiales sin depender del nombre visible", () => {
    expect(hourConceptLoadModeLabel(rows[1]!.concept.loadMode)).toBe("Automático");
    expect(hourConceptLoadModeLabel(rows[2]!.concept.loadMode)).toBe("Manual");
    expect(hourConceptLoadModeLabel("BOTH")).toBe("Manual y automático");
  });

  it("agrupa por tratamiento: Horas base, dentro de la jornada y horas adicionales (nunca por loadMode)", () => {
    const groups = groupTimeGridRows(rows);
    expect(groups.base?.concept.id).toBe("normal");
    expect(groups.withinBase.map((row) => row.concept.id)).toEqual(["sereno"]);
    expect(groups.additive.map((row) => row.concept.id)).toEqual(["colectivo"]);
    // Un concepto MANUAL dentro de la jornada sigue dentro de la jornada.
    const manualWithin = { ...rows[2]!, concept: concept("correccion", "MANUAL", null, "WITHIN_BASE") };
    expect(groupTimeGridRows([manualWithin]).withinBase).toHaveLength(1);
    expect(normalWorkedDays(rows)).toBe(1);
  });

  it("copy de negocio: 'Horas base' para la base y efecto sobre el total para cada concepto", () => {
    expect(timeGridRowLabel(rows[0]!)).toBe("Horas base");
    expect(timeGridRowSubtitle(rows[0]!)).toBe("Registradas · fichada o carga");
    expect(timeGridRowSubtitle(rows[1]!)).toBe("No suma al total · Automático");
    expect(timeGridRowSubtitle(rows[2]!)).toBe("Suma al total · Manual");
    expect(timeGridRowSubtitle({ ...rows[2]!, enabled: false })).toBe("Suma al total · Manual · No habilitado");
    for (const row of rows) expect(timeGridRowSubtitle(row)).not.toMatch(/WITHIN_BASE|ADDITIVE|NORMAL_BASE|Breakdown/);
  });

  it("habilita edición sólo para conceptos MANUAL o BOTH habilitados", () => {
    expect(isManualBreakdownEditable(rows[0]!)).toBe(false);
    expect(isManualBreakdownEditable(rows[1]!)).toBe(false);
    expect(isManualBreakdownEditable(rows[2]!)).toBe(true);
    expect(isManualBreakdownEditable({ ...rows[2]!, concept: concept("both", "BOTH", null) })).toBe(true);
    expect(isManualBreakdownEditable({ ...rows[2]!, enabled: false })).toBe(false);
  });
});

function entry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: "entry-1",
    employeeId: "employee-1",
    period: "2026-08",
    day: 5,
    type: "Hora normal",
    hours: 8,
    notes: "",
    status: "Aprobado",
    conceptId: "normal",
    ...overrides,
  };
}

describe("upsertTimeEntry — actualización local tras guardar (Etapa 6L.4)", () => {
  it("agrega una entrada nueva si el id no existe todavía", () => {
    const result = upsertTimeEntry([], entry());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "entry-1", hours: 8 });
  });

  it("reemplaza la entrada existente por id sin duplicarla", () => {
    const existing = [entry({ id: "entry-1", hours: 4 }), entry({ id: "entry-2", day: 6 })];
    const result = upsertTimeEntry(existing, entry({ id: "entry-1", hours: 8 }));
    expect(result).toHaveLength(2);
    expect(result.find((item) => item.id === "entry-1")?.hours).toBe(8);
  });
});

describe("applyNormalEntryToRows — la celda de Horas base se actualiza sin refetch (Etapa 6L.4)", () => {
  const rows: EmployeeTimeGridRow[] = [
    { concept: concept("normal", null, "NORMAL_BASE"), role: "NORMAL_BASE", enabled: true, minutesByDay: { "1": 480 }, totalMinutes: 480 },
    { concept: concept("colectivo", "MANUAL", null, "ADDITIVE_TO_WORKED_TOTAL"), role: "ADDITIONAL", enabled: true, minutesByDay: {}, totalMinutes: 0 },
  ];

  it("un entry Aprobado suma sus minutos al día y al total", () => {
    const result = applyNormalEntryToRows(rows, entry({ day: 10, hours: 8, status: "Aprobado" }));
    const normalRow = result.find((row) => row.role === "NORMAL_BASE")!;
    expect(normalRow.minutesByDay["10"]).toBe(480);
    expect(normalRow.totalMinutes).toBe(960);
  });

  it("un entry En revisión también cuenta (mismo criterio que el backend)", () => {
    const result = applyNormalEntryToRows(rows, entry({ day: 10, hours: 6, status: "En revisión" }));
    expect(result.find((row) => row.role === "NORMAL_BASE")!.minutesByDay["10"]).toBe(360);
  });

  it("un entry Borrador no cuenta (igual que buildEmployeeTimeGrid en backend)", () => {
    const result = applyNormalEntryToRows(rows, entry({ day: 10, hours: 8, status: "Borrador" }));
    const normalRow = result.find((row) => row.role === "NORMAL_BASE")!;
    expect(normalRow.minutesByDay["10"]).toBeUndefined();
    expect(normalRow.totalMinutes).toBe(480);
  });

  it("no modifica las filas de conceptos adicionales", () => {
    const result = applyNormalEntryToRows(rows, entry({ day: 10, hours: 8 }));
    expect(result.find((row) => row.role === "ADDITIONAL")).toEqual(rows[1]);
  });
});

describe("applyBreakdownToRows — la carga manual de un concepto actualiza sólo su fila (Etapa 6L.4)", () => {
  const rows: EmployeeTimeGridRow[] = [
    { concept: concept("normal", null, "NORMAL_BASE"), role: "NORMAL_BASE", enabled: true, minutesByDay: { "1": 480 }, totalMinutes: 480 },
    { concept: concept("colectivo", "MANUAL", null, "ADDITIVE_TO_WORKED_TOTAL"), role: "ADDITIONAL", enabled: true, minutesByDay: {}, totalMinutes: 0 },
  ];

  it("agrega minutos al día del concepto adicional correspondiente", () => {
    const result = applyBreakdownToRows(rows, "colectivo", 12, 120);
    const row = result.find((item) => item.concept.id === "colectivo")!;
    expect(row.minutesByDay["12"]).toBe(120);
    expect(row.totalMinutes).toBe(120);
  });

  it("minutos en 0 elimina el día (coincide con la semántica de borrado del backend)", () => {
    const withDay = applyBreakdownToRows(rows, "colectivo", 12, 120);
    const cleared = applyBreakdownToRows(withDay, "colectivo", 12, 0);
    const row = cleared.find((item) => item.concept.id === "colectivo")!;
    expect(row.minutesByDay["12"]).toBeUndefined();
    expect(row.totalMinutes).toBe(0);
  });

  it("nunca toca la fila de Horas base (los totales llegan del backend)", () => {
    const result = applyBreakdownToRows(rows, "colectivo", 12, 120);
    expect(result.find((row) => row.role === "NORMAL_BASE")).toEqual(rows[0]);
  });
});
