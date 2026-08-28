import { describe, expect, it } from "vitest";
import { matchesFilters } from "./WorkRegimesPage";
import type { WorkRegime, WorkRegimeFilters } from "../types/workRegime.types";

const emptyFilters: WorkRegimeFilters = { search: "", kind: "", status: "" };

function regime(overrides: Partial<WorkRegime> = {}): WorkRegime {
  return {
    id: "regime-1",
    code: "CAMPANA",
    name: "Campaña",
    kind: "TURNO_FLEXIBLE",
    alertOnOutOfShift: false,
    openShiftOverflowAction: "ALERT_ONLY",
    extendedShiftAlertMinutes: null,
    description: "Régimen de cosecha con jornadas variables",
    status: "ACTIVO",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("WorkRegimesPage.matchesFilters", () => {
  it("sin filtros activos, cualquier régimen matchea", () => {
    expect(matchesFilters(regime(), emptyFilters)).toBe(true);
  });

  it("la búsqueda libre matchea por code, name o description", () => {
    expect(matchesFilters(regime(), { ...emptyFilters, search: "campana" })).toBe(true);
    expect(matchesFilters(regime(), { ...emptyFilters, search: "cosecha" })).toBe(true);
    expect(matchesFilters(regime(), { ...emptyFilters, search: "algo que no aparece" })).toBe(false);
  });

  it("filtra por kind exacto", () => {
    expect(matchesFilters(regime({ kind: "SIN_TURNO" }), { ...emptyFilters, kind: "TURNO_FLEXIBLE" })).toBe(false);
    expect(matchesFilters(regime({ kind: "TURNO_FLEXIBLE" }), { ...emptyFilters, kind: "TURNO_FLEXIBLE" })).toBe(true);
  });

  it("filtra por status exacto", () => {
    expect(matchesFilters(regime({ status: "INACTIVO" }), { ...emptyFilters, status: "ACTIVO" })).toBe(false);
    expect(matchesFilters(regime({ status: "ACTIVO" }), { ...emptyFilters, status: "ACTIVO" })).toBe(true);
  });

  it("un régimen sin descripción no rompe la búsqueda libre", () => {
    expect(matchesFilters(regime({ description: null }), { ...emptyFilters, search: "campana" })).toBe(true);
  });
});
