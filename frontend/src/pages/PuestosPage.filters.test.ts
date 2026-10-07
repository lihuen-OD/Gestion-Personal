import { describe, expect, it } from "vitest";
import { matches, options } from "./PuestosPage";
import type { Position, PositionFilters } from "../types/position.types";
import type { OrgStructureCatalog } from "../types/orgStructure.types";

const emptyFilters: PositionFilters = { search: "", scopeLevel: "", scopeNodeId: "", scopeMode: "WITHIN", salaryRangeCategory: "", status: "" };
const position = (overrides: Partial<Position> = {}): Position => ({ id: "p1", code: "PUE-1", name: "Director", lastUpdatedAt: "2026-10-07", status: "ACTIVO", mission: "", responsibilities: [], internalRelations: [], externalRelations: [], competencies: [], workConditions: { modality: "PRESENCIAL", workload: "", workplace: "", relationType: "" }, performanceIndicators: [], evaluationCriteria: [], history: [], createdAt: "", updatedAt: "", orgScopes: [{ level: "COMPANY", nodeId: "c1", name: "LOSOD" }], ...overrides });

describe("PuestosPage", () => {
  it("busca por nombres de alcances", () => {
    expect(matches(position(), { ...emptyFilters, search: "losod" })).toBe(true);
    expect(matches(position(), { ...emptyFilters, search: "brasitas" })).toBe(false);
  });
  it("expone sólo nodos activos del árbol objetivo", () => {
    const catalog: OrgStructureCatalog = {
      companies: [{ id: "c1", code: "C1", name: "LOSOD", legalName: "", cuit: "", status: "ACTIVO" }],
      businessUnits: [{ id: "bu1", code: "BU1", name: "Servicios", companyId: "c1", status: "ACTIVO" }],
      sectors: [{ id: "legacy", code: "S0", name: "Anterior", status: "ACTIVO" }, { id: "s1", code: "S1", name: "Operaciones", businessUnitId: "bu1", status: "ACTIVO" }],
      areas: [], zones: [], establishments: [], costCenters: [],
    };
    const result = options([], catalog);
    expect(result.scopeNodes.COMPANY).toEqual([{ id: "c1", name: "LOSOD" }]);
    expect(result.scopeNodes.SECTOR).toEqual([{ id: "s1", name: "Operaciones" }]);
  });
  it("mantiene categorías salariales independientes del alcance", () => {
    expect(options([position({ salaryCategoryNames: ["A", "B"] })], undefined).salaryRangeCategory).toEqual(["A", "B"]);
  });
});
