import { describe, expect, it } from "vitest";
import { scopeRedundancyMessage } from "./PuestoIdentificationTab";
import type { OrgStructureCatalog } from "../../types/orgStructure.types";

const catalog: OrgStructureCatalog = {
  companies: [{ id: "c1", code: "C1", name: "LOSOD", legalName: "", cuit: "", status: "ACTIVO" }],
  businessUnits: [{ id: "bu1", code: "BU1", name: "Servicios", companyId: "c1", status: "ACTIVO" }],
  sectors: [{ id: "s1", code: "S1", name: "Operaciones", businessUnitId: "bu1", status: "ACTIVO" }],
  areas: [{ id: "a1", code: "A1", name: "Turno día", sectorId: "s1", status: "ACTIVO" }],
  zones: [], establishments: [], costCenters: [],
};

describe("scopeRedundancyMessage", () => {
  it("rechaza un descendiente ya incluido por un ancestro", () => {
    expect(scopeRedundancyMessage(catalog, [{ level: "COMPANY", nodeId: "c1", name: "LOSOD" }], { level: "AREA", nodeId: "a1", name: "Turno día" })).toContain("ya está incluido por “LOSOD”");
  });
  it("rechaza un ancestro que volvería redundante un alcance existente", () => {
    expect(scopeRedundancyMessage(catalog, [{ level: "SECTOR", nodeId: "s1", name: "Operaciones" }], { level: "BUSINESS_UNIT", nodeId: "bu1", name: "Servicios" })).toContain("haría redundante “Operaciones”");
  });
  it("permite alcances independientes", () => {
    expect(scopeRedundancyMessage(catalog, [{ level: "AREA", nodeId: "a1", name: "Turno día" }], { level: "COMPANY", nodeId: "c2", name: "Tropa" })).toBe("");
  });
});
