import { describe, expect, it } from "vitest";
import type { EmployeeTimeGridRow } from "../services/api/employeeApiService";
import type { TimeEntry } from "../types";
import {
  additionalBreakdownHours,
  applyBreakdownToRows,
  applyNormalEntryToRows,
  hourConceptLoadModeLabel,
  isManualBreakdownEditable,
  normalWorkedDays,
  totalWorkedMinutesFromRows,
  upsertTimeEntry,
} from "./employeeHoursGrid";

const concept = (id: string, loadMode: EmployeeTimeGridRow["concept"]["loadMode"], systemRole: EmployeeTimeGridRow["concept"]["systemRole"]) => ({
  id, code: id, name: id, kind: "OTRO" as const, status: "ACTIVO" as const, loadMode, systemRole, createdAt: "", updatedAt: "",
});

describe("presentación de grilla aditiva", () => {
  const rows: EmployeeTimeGridRow[] = [
    { concept: concept("normal", null, "NORMAL_BASE"), role: "NORMAL_BASE", minutesByDay: { "1": 480 }, totalMinutes: 480 },
    { concept: concept("sereno", "AUTOMATIC", null), role: "ADDITIONAL", minutesByDay: { "1": 360 }, totalMinutes: 360 },
    { concept: concept("colectivo", "MANUAL", null), role: "ADDITIONAL", minutesByDay: {}, totalMinutes: 0 },
  ];

  it("muestra los modos oficiales sin depender del nombre visible", () => {
    expect(hourConceptLoadModeLabel(rows[1]!.concept.loadMode)).toBe("Automático");
    expect(hourConceptLoadModeLabel(rows[2]!.concept.loadMode)).toBe("Manual");
    expect(hourConceptLoadModeLabel("BOTH")).toBe("Manual y automático");
  });

  it("mantiene separados total base y desgloses", () => {
    expect(rows[0]!.totalMinutes / 60).toBe(8);
    expect(additionalBreakdownHours(rows)).toBe(6);
    expect(normalWorkedDays(rows)).toBe(1);
  });

  it("habilita edición sólo para adicionales MANUAL o BOTH", () => {
    expect(isManualBreakdownEditable(rows[0]!)).toBe(false);
    expect(isManualBreakdownEditable(rows[1]!)).toBe(false);
    expect(isManualBreakdownEditable(rows[2]!)).toBe(true);
    expect(isManualBreakdownEditable({ ...rows[2]!, concept: concept("both", "BOTH", null) })).toBe(true);
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

describe("applyNormalEntryToRows — la celda y el total de Hora normal se actualizan sin refetch (Etapa 6L.4)", () => {
  const rows: EmployeeTimeGridRow[] = [
    { concept: concept("normal", null, "NORMAL_BASE"), role: "NORMAL_BASE", minutesByDay: { "1": 480 }, totalMinutes: 480 },
    { concept: concept("colectivo", "MANUAL", null), role: "ADDITIONAL", minutesByDay: {}, totalMinutes: 0 },
  ];

  it("un entry Aprobado suma sus minutos al día y al total", () => {
    const result = applyNormalEntryToRows(rows, entry({ day: 10, hours: 8, status: "Aprobado" }));
    const normalRow = result.find((row) => row.role === "NORMAL_BASE")!;
    expect(normalRow.minutesByDay["10"]).toBe(480);
    expect(normalRow.totalMinutes).toBe(960);
    expect(totalWorkedMinutesFromRows(result)).toBe(960);
  });

  it("un entry En revisión también cuenta (mismo criterio que el backend)", () => {
    const result = applyNormalEntryToRows(rows, entry({ day: 10, hours: 6, status: "En revisión" }));
    expect(result.find((row) => row.role === "NORMAL_BASE")!.minutesByDay["10"]).toBe(360);
  });

  it("un entry Borrador no cuenta para el total (igual que buildAdditiveTimeGrid en backend)", () => {
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

describe("applyBreakdownToRows — el desglose manual se actualiza sin tocar Hora normal ni el total (Etapa 6L.4)", () => {
  const rows: EmployeeTimeGridRow[] = [
    { concept: concept("normal", null, "NORMAL_BASE"), role: "NORMAL_BASE", minutesByDay: { "1": 480 }, totalMinutes: 480 },
    { concept: concept("colectivo", "MANUAL", null), role: "ADDITIONAL", minutesByDay: {}, totalMinutes: 0 },
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

  it("nunca toca la fila NORMAL_BASE ni totalWorkedMinutesFromRows", () => {
    const result = applyBreakdownToRows(rows, "colectivo", 12, 120);
    expect(result.find((row) => row.role === "NORMAL_BASE")).toEqual(rows[0]);
    expect(totalWorkedMinutesFromRows(result)).toBe(480);
  });
});
