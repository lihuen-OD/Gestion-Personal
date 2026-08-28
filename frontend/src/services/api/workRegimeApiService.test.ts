import { describe, expect, it } from "vitest";
import {
  extendedShiftAlertHoursToMinutes,
  extendedShiftAlertMinutesToHours,
  mapAssignmentFromApi,
  mapWorkRegimeEmployeeAssociationFromApi,
  mapWorkRegimeFromApi,
} from "./workRegimeApiService";

const apiRegime = {
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
      extendedShiftAlertMinutes: null,
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

  it("Etapa 10D — preserva extendedShiftAlertMinutes cuando el backend lo manda", () => {
    const regime = mapWorkRegimeFromApi({ ...apiRegime, extendedShiftAlertMinutes: 900 });
    expect(regime.extendedShiftAlertMinutes).toBe(900);
  });

  it("Etapa 10D — extendedShiftAlertMinutes ausente se normaliza a null, no a undefined", () => {
    const { extendedShiftAlertMinutes: _omitted, ...withoutField } = apiRegime;
    const regime = mapWorkRegimeFromApi(withoutField as typeof apiRegime);
    expect(regime.extendedShiftAlertMinutes).toBeNull();
  });
});

describe("extendedShiftAlertMinutesToHours / extendedShiftAlertHoursToMinutes — Etapa 10D (UI en horas, backend en minutos)", () => {
  it("convierte minutos a horas enteras (redondeando)", () => {
    expect(extendedShiftAlertMinutesToHours(900)).toBe(15);
    expect(extendedShiftAlertMinutesToHours(90)).toBe(2); // redondea 1.5 -> 2
  });

  it("null se muestra como campo vacío en la UI, nunca como 0", () => {
    expect(extendedShiftAlertMinutesToHours(null)).toBe("");
  });

  it("0 minutos se muestra como 0 horas, no como vacío (0 explícito != sin configurar)", () => {
    expect(extendedShiftAlertMinutesToHours(0)).toBe(0);
  });

  it("convierte horas a minutos al guardar", () => {
    expect(extendedShiftAlertHoursToMinutes(15)).toBe(900);
    expect(extendedShiftAlertHoursToMinutes(0)).toBe(0);
  });

  it("campo vacío se guarda como null, nunca se coacciona a 0", () => {
    expect(extendedShiftAlertHoursToMinutes("")).toBeNull();
  });

  it("round-trip: convertir minutos a horas y de vuelta a minutos no pierde el valor (para horas enteras)", () => {
    const originalMinutes = 720;
    const hours = extendedShiftAlertMinutesToHours(originalMinutes);
    expect(extendedShiftAlertHoursToMinutes(hours)).toBe(originalMinutes);
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
