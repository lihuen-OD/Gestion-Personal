import { describe, expect, it } from "vitest";
import { mapAssignmentFromApi, mapWorkRegimeEmployeeAssociationFromApi, mapWorkRegimeFromApi } from "./workRegimeApiService";

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

describe("mapWorkRegimeEmployeeAssociationFromApi — empleados asociados al régimen (Etapa 8G)", () => {
  const apiAssociation = {
    id: "assignment-1",
    employeeId: "employee-1",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    vigencyStatus: "current" as const,
    employee: {
      id: "employee-1",
      legajo: "100",
      cuil: "20-12345678-9",
      firstName: "Ana",
      lastName: "Prueba",
      status: "ACTIVO" as const,
      sector: { id: "sector-1", name: "Campo" },
      costCenter: null,
      companies: [],
    },
  };

  it("mapea vigencyStatus y los datos del empleado asociado sin inventar nada", () => {
    const association = mapWorkRegimeEmployeeAssociationFromApi(apiAssociation);
    expect(association.vigencyStatus).toBe("current");
    expect(association.employee.legajo).toBe("100");
    expect(association.employee.sector).toEqual({ id: "sector-1", name: "Campo" });
  });

  it("effectiveTo ausente se normaliza a null, no a undefined", () => {
    const { effectiveTo: _omitted, ...withoutEffectiveTo } = apiAssociation;
    const association = mapWorkRegimeEmployeeAssociationFromApi(withoutEffectiveTo as typeof apiAssociation);
    expect(association.effectiveTo).toBeNull();
  });
});
