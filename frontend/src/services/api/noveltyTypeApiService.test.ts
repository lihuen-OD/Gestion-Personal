import { describe, expect, it } from "vitest";
import { mapNoveltyTypeFromApi, mapNoveltyTypeToApi, type ApiNoveltyType } from "./noveltyTypeApiService";

// Etapa 7 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §14): leer y volver a
// enviar un tipo sin cambios conserva toda su configuración (incluida
// requiresObservation, que antes el frontend no leía ni enviaba).
const base: ApiNoveltyType = {
  id: "nt", code: "NOV-001", name: "Tipo", uiColor: "blue", kind: "AUSENCIA", status: "ACTIVO", description: "Descripción", notes: null,
  exportsToFinnegans: false, requiresApproval: true, requiresDocumentation: false, allowsHours: false, timeEntryBehavior: "NO_BLOQUEA",
  allowsDateRange: true, finnegansValueUnit: null, finnegansRequiresValidity: false, finnegansCode: null, finnegansName: null,
  allowedLoadRoles: ["Nivel 1 - RRHH"], approvalRoles: ["Nivel 1 - RRHH"],
  coverageMode: "NONE", coverageFixedMinutes: null, coverageDayRule: "EVERY_DAY", coverageWeekdays: [], coverageOnDayOff: null, coverageOnHoliday: null,
  coverageAppliesSpecialHours: false, coverageCountsTowardTotal: false, realWorkCompatibility: "COMPATIBLE", requiresObservation: false,
  createdAt: "", updatedAt: "",
};

const rows: Record<string, ApiNoveltyType> = {
  "Trámite bancario": { ...base, allowsDateRange: false, coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 240, coverageOnDayOff: "NO_COVERAGE", coverageOnHoliday: "NO_COVERAGE", coverageCountsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" },
  Vacaciones: { ...base, coverageMode: "EXPECTED_SCHEDULE", coverageDayRule: "WORK_OBLIGATION", coverageAppliesSpecialHours: true, coverageCountsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" },
  Maternidad: { ...base, coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 480, coverageDayRule: "SELECTED_WEEKDAYS", coverageWeekdays: [1, 2, 3, 4, 5], coverageOnDayOff: "COVER", coverageOnHoliday: "ONLY_IF_CONVOKED", coverageCountsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" },
  "Llegada tarde": { ...base, allowsDateRange: false, allowsHours: true, coverageMode: "MANUAL_MINUTES" },
  "Falta sin aviso": { ...base, realWorkCompatibility: "INCOMPATIBLE", requiresObservation: true },
};

describe("noveltyTypeApiService — round-trip de configuración", () => {
  for (const [name, row] of Object.entries(rows)) {
    it(`${name}: leer y reenviar sin cambios produce el mismo payload`, () => {
      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...persisted } = { ...row, name };
      expect(mapNoveltyTypeToApi(mapNoveltyTypeFromApi({ ...row, name }))).toEqual(persisted);
    });
  }

  it("requiresObservation se lee y se envía", () => {
    const item = mapNoveltyTypeFromApi({ ...base, requiresObservation: true });
    expect(item.rules.requiresObservation).toBe(true);
    expect(mapNoveltyTypeToApi({ ...item, rules: { ...item.rules, requiresObservation: false } }).requiresObservation).toBe(false);
  });
});
