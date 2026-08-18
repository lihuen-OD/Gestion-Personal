import { describe, expect, it } from "vitest";
import { matches, options } from "./PuestosPage";
import type { Position, PositionFilters } from "../types/position.types";
import type { OrgStructureCatalog } from "../types/orgStructure.types";

/**
 * Limpieza final de Position (2026-08-18): PuestosPage filtra por sectorId
 * real y por los ids derivados de la cadena sector -> area -> establishment
 * -> businessUnit. Los strings legado (areaDepartment/sector/businessUnitName(s)/
 * establishmentName(s)/sectorNames/salaryRangeCategories) ya no existen en
 * el esquema ni en el tipo Position — no hay fallback que probar.
 */
const emptyFilters: PositionFilters = {
  search: "",
  businessUnitId: "",
  establishmentId: "",
  areaId: "",
  sectorId: "",
  salaryRangeCategory: "",
  status: "",
};

function position(overrides: Partial<Position> = {}): Position {
  return {
    id: "pos-1",
    code: "PUE-100",
    name: "Puesto Test",
    lastUpdatedAt: "2026-08-01",
    status: "ACTIVO",
    mission: "",
    responsibilities: [],
    internalRelations: [],
    externalRelations: [],
    competencies: [],
    workConditions: { modality: "PRESENCIAL", workload: "", workplace: "", relationType: "", observations: "" },
    performanceIndicators: [],
    evaluationCriteria: [],
    history: [],
    createdAt: "2026-08-01",
    updatedAt: "2026-08-01",
    ...overrides,
  };
}

describe("PuestosPage.matches", () => {
  it("filtra por sectorId real", () => {
    const withRealSector = position({ sectorId: "sec-1" });
    const withOtherSector = position({ sectorId: "sec-2" });

    expect(matches(withRealSector, { ...emptyFilters, sectorId: "sec-1" })).toBe(true);
    expect(matches(withOtherSector, { ...emptyFilters, sectorId: "sec-1" })).toBe(false);
  });

  it("filtra por establishmentId derivado (via sector->area->establishment)", () => {
    const match = position({ derivedEstablishmentId: "est-1" });
    const noMatch = position({ derivedEstablishmentId: "est-2" });

    expect(matches(match, { ...emptyFilters, establishmentId: "est-1" })).toBe(true);
    expect(matches(noMatch, { ...emptyFilters, establishmentId: "est-1" })).toBe(false);
  });

  it("un puesto sin backfill (sin sectorId ni derivados) no matchea ningun filtro por id", () => {
    const withoutSector = position();

    expect(matches(withoutSector, { ...emptyFilters, sectorId: "sec-1" })).toBe(false);
    expect(matches(withoutSector, { ...emptyFilters, areaId: "area-1" })).toBe(false);
  });

  it("la busqueda libre usa los campos derivados", () => {
    const withDerived = position({ derivedSectorName: "Ventas Real" });

    expect(matches(withDerived, { ...emptyFilters, search: "ventas real" })).toBe(true);
    expect(matches(withDerived, { ...emptyFilters, search: "algo que no aparece" })).toBe(false);
  });

  it("sin filtros activos, cualquier puesto matchea", () => {
    expect(matches(position(), emptyFilters)).toBe(true);
  });
});

describe("PuestosPage.options", () => {
  function catalog(): OrgStructureCatalog {
    return {
      companies: [],
      businessUnits: [
        { id: "bu-1", code: "UN-1", name: "Unidad Activa", companyId: "comp-1", status: "ACTIVO" },
        { id: "bu-2", code: "UN-2", name: "Unidad Inactiva", companyId: "comp-1", status: "INACTIVO" },
      ],
      establishments: [],
      areas: [],
      sectors: [
        { id: "sec-1", code: "SEC-1", name: "Ventas", status: "ACTIVO" },
      ],
      costCenters: [],
    };
  }

  it("las opciones de Unidad de negocio/Sector vienen del catalogo real, filtradas a ACTIVO", () => {
    const result = options([], catalog());

    expect(result.businessUnitId).toEqual([{ id: "bu-1", name: "Unidad Activa" }]);
    expect(result.sectorId).toEqual([{ id: "sec-1", name: "Ventas" }]);
  });

  it("sin catalogo cargado todavia, devuelve listas vacias en vez de romper", () => {
    const result = options([], undefined);

    expect(result.businessUnitId).toEqual([]);
    expect(result.establishmentId).toEqual([]);
    expect(result.areaId).toEqual([]);
    expect(result.sectorId).toEqual([]);
  });

  it("las opciones de rango salarial vienen de la relacion real PositionSalaryCategory (salaryCategoryNames)", () => {
    const items = [position({ salaryCategoryNames: ["Administrativo A", "Administrativo B"] }), position({ id: "pos-2", salaryCategoryNames: ["Administrativo A"] })];

    expect(options(items, undefined).salaryRangeCategory).toEqual(["Administrativo A", "Administrativo B"]);
  });
});
