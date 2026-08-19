import { describe, expect, it } from "vitest";
import { mapAssignmentFromApi, mapWorkRegimeFromApi } from "./workRegimeApiService";

const apiRegime = {
  id: "regime-1",
  code: "CAMPANA",
  name: "Campaña",
  kind: "TURNO_FLEXIBLE" as const,
  alertOnOutOfShift: false,
  openShiftOverflowAction: "ALERT_ONLY" as const,
  description: null,
  status: "ACTIVO" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("mapWorkRegimeFromApi", () => {
  it("preserves every field from the backend response", () => {
    const regime = mapWorkRegimeFromApi(apiRegime);
    expect(regime).toEqual({
      id: "regime-1",
      code: "CAMPANA",
      name: "Campaña",
      kind: "TURNO_FLEXIBLE",
      alertOnOutOfShift: false,
      openShiftOverflowAction: "ALERT_ONLY",
      description: null,
      status: "ACTIVO",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("defaults a missing description to null instead of undefined", () => {
    const { description: _omitted, ...withoutDescription } = apiRegime;
    const regime = mapWorkRegimeFromApi(withoutDescription as typeof apiRegime);
    expect(regime.description).toBeNull();
  });
});

describe("mapAssignmentFromApi", () => {
  it("maps a closed assignment (effectiveTo set) including the nested work regime", () => {
    const assignment = mapAssignmentFromApi({
      id: "assignment-1",
      employeeId: "employee-1",
      workRegimeId: "regime-1",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2026-06-30T00:00:00.000Z",
      assignedByUserId: "user-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      workRegime: apiRegime,
    });

    expect(assignment.effectiveTo).toBe("2026-06-30T00:00:00.000Z");
    expect(assignment.workRegime.code).toBe("CAMPANA");
  });

  it("maps an open-ended assignment (no effectiveTo) to null, not undefined", () => {
    const assignment = mapAssignmentFromApi({
      id: "assignment-2",
      employeeId: "employee-1",
      workRegimeId: "regime-1",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      workRegime: apiRegime,
    });

    expect(assignment.effectiveTo).toBeNull();
    expect(assignment.assignedByUserId).toBeNull();
  });
});
