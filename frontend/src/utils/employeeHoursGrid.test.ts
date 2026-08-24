import { describe, expect, it } from "vitest";
import type { EmployeeTimeGridRow } from "../services/api/employeeApiService";
import { additionalBreakdownHours, hourConceptLoadModeLabel, isManualBreakdownEditable, normalWorkedDays } from "./employeeHoursGrid";

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
