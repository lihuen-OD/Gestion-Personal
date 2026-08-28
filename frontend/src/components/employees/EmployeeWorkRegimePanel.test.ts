import { describe, expect, it } from "vitest";
import { assignmentRowStatus } from "./EmployeeWorkRegimePanel";
import type { EmployeeWorkRegimeAssignment } from "../../types/workRegime.types";

const baseWorkRegime = {
  id: "regime-1",
  code: "CAMPANA",
  name: "Campaña",
  kind: "TURNO_FLEXIBLE" as const,
  alertOnOutOfShift: false,
  openShiftOverflowAction: "ALERT_ONLY" as const,
  extendedShiftAlertMinutes: null,
  description: null,
  status: "ACTIVO" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function assignment(overrides: Partial<EmployeeWorkRegimeAssignment> = {}): EmployeeWorkRegimeAssignment {
  return {
    id: "assignment-1",
    employeeId: "employee-1",
    workRegimeId: "regime-1",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    assignedByUserId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    workRegime: baseWorkRegime,
    ...overrides,
  };
}

const TODAY = "2026-06-15";

describe("assignmentRowStatus — estado visual del historial (vigente / futuro / histórico)", () => {
  it("la asignación cuyo id coincide con la vigente actual es 'vigente', aunque su effectiveFrom sea pasado", () => {
    const current = assignment({ id: "assignment-current", effectiveFrom: "2026-01-01T00:00:00.000Z" });
    expect(assignmentRowStatus(current, "assignment-current", TODAY)).toBe("vigente");
  });

  it("una asignación que arranca después de hoy es 'futuro'", () => {
    const future = assignment({ id: "assignment-future", effectiveFrom: "2026-09-01T00:00:00.000Z" });
    expect(assignmentRowStatus(future, "assignment-current", TODAY)).toBe("futuro");
  });

  it("una asignación pasada, cerrada, que no es la vigente actual, es 'histórico'", () => {
    const past = assignment({ id: "assignment-past", effectiveFrom: "2025-01-01T00:00:00.000Z", effectiveTo: "2025-12-31T00:00:00.000Z" });
    expect(assignmentRowStatus(past, "assignment-current", TODAY)).toBe("histórico");
  });

  it("sin ninguna asignación vigente (currentId null), una con effectiveFrom pasado es 'histórico', no 'vigente'", () => {
    const past = assignment({ id: "assignment-past", effectiveFrom: "2025-01-01T00:00:00.000Z" });
    expect(assignmentRowStatus(past, null, TODAY)).toBe("histórico");
  });
});
