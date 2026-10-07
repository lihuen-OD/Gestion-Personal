import { describe, expect, it } from "vitest";
import type { OrgStructureCatalog } from "../../types/orgStructure.types";
import { isAssignablePosition } from "../employees/options/positionOptions";
import type { Position } from "../../types/position.types";
import { orgScopePathNames } from "./orgScopePath";

const catalog = {
  companies: [{ id: "c1", name: "Los O'Dwyer" }, { id: "c2", name: "Tropa" }],
  businessUnits: [{ id: "bu1", name: "Agro", companyId: "c1" }],
  sectors: [{ id: "s1", name: "Agricultura", businessUnitId: "bu1" }],
  areas: [{ id: "a1", name: "Siembra", sectorId: "s1" }],
  zones: [], establishments: [], costCenters: [],
} as unknown as OrgStructureCatalog;

describe("orgScopePathNames — ruta organizacional de un alcance", () => {
  it("arma la ruta completa desde la empresa hasta el nodo", () => {
    expect(orgScopePathNames(catalog, { level: "COMPANY", nodeId: "c2" })).toEqual(["Tropa"]);
    expect(orgScopePathNames(catalog, { level: "SECTOR", nodeId: "s1" })).toEqual(["Los O'Dwyer", "Agro", "Agricultura"]);
    expect(orgScopePathNames(catalog, { level: "AREA", nodeId: "a1" })).toEqual(["Los O'Dwyer", "Agro", "Agricultura", "Siembra"]);
  });

  it("un nodo desconocido no inventa ruta", () => {
    expect(orgScopePathNames(catalog, { level: "AREA", nodeId: "missing" })).toEqual([]);
  });
});

describe("isAssignablePosition — requisitos para asignar un puesto nuevo (A6)", () => {
  const position = (overrides: Partial<Position>) => ({ id: "p", name: "Puesto", status: "ACTIVO", orgScopes: [{ level: "COMPANY", nodeId: "c1", name: "Los O'Dwyer" }], ...overrides }) as Position;

  it("activo y con alcance", () => expect(isAssignablePosition(position({}))).toBe(true));
  it("pendiente de recarga (sin alcance) no se ofrece", () => expect(isAssignablePosition(position({ orgScopes: [], sectorId: "legacy", pendingScopeReload: true }))).toBe(false));
  it("inactivo no se ofrece", () => expect(isAssignablePosition(position({ status: "INACTIVO" }))).toBe(false));
});
