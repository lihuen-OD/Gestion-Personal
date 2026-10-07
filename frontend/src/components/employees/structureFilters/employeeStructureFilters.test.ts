import { describe, expect, it } from "vitest";
import type { OrgStructureCatalog } from "../../../types/orgStructure.types";
import type { Employee } from "../../../types";
import { organizationChartMockService } from "../../../services/organizationChartMockService";
import { emptyStructureFilters, establishmentFilterOptions, isReloadPending, legacySectorOptions, scopeFilterPending, scopeNodeOptions, structureFilterParams } from "./employeeStructureFilters";

const catalog = {
  companies: [{ id: "c1", name: "Los O'Dwyer", status: "ACTIVO" }],
  businessUnits: [{ id: "bu1", name: "Agro", companyId: "c1", status: "ACTIVO" }],
  sectors: [
    { id: "s-new", name: "Agricultura", businessUnitId: "bu1", status: "ACTIVO" },
    { id: "s-old", name: "Responsable de finanzas", areaId: "a-old", pendingReload: true, status: "ACTIVO" },
    { id: "s-off", name: "Sector inactivo", businessUnitId: "bu1", status: "INACTIVO" },
  ],
  areas: [],
  zones: [{ id: "z1", name: "Zona Norte", status: "ACTIVO" }, { id: "z2", name: "Zona Sur", status: "ACTIVO" }],
  establishments: [
    { id: "e1", name: "Campo La Esperanza", zoneId: "z1", status: "ACTIVO" },
    { id: "e2", name: "Planta Sur", zoneId: "z2", status: "ACTIVO" },
    { id: "e-old", name: "Administracion Central", companyId: "c1", status: "ACTIVO" },
  ],
  costCenters: [],
} as unknown as OrgStructureCatalog;

describe("structureFilterParams", () => {
  it("el alcance sólo viaja con nivel, nodo y modo (sin modo por defecto, D-7)", () => {
    const partial = { ...emptyStructureFilters, scopeLevel: "SECTOR" as const, scopeNodeId: "s-new" };
    expect(structureFilterParams(partial)).toEqual({});
    expect(scopeFilterPending(partial)).toBe(true);
    expect(structureFilterParams({ ...partial, scopeMode: "COVERS" })).toEqual({ scopeLevel: "SECTOR", scopeNodeId: "s-new", scopeMode: "COVERS" });
  });

  it("la fecha de vigencia sólo acompaña a una zona o establecimiento; el sector anterior viaja como sectorId", () => {
    expect(structureFilterParams({ ...emptyStructureFilters, locationDate: "2027-02-01" })).toEqual({});
    expect(structureFilterParams({ ...emptyStructureFilters, locationZoneId: "z1", locationDate: "2027-02-01", legacySectorId: "s-old", reloadStatus: "PENDING" }))
      .toEqual({ locationZoneId: "z1", locationDate: "2027-02-01", sectorId: "s-old", reloadStatus: "PENDING" });
  });
});

describe("opciones de catálogo", () => {
  it("nodos de alcance: sólo del árbol nuevo y activos, rotulados con su ruta", () => {
    expect(scopeNodeOptions(catalog, "SECTOR")).toEqual([{ id: "s-new", label: "Los O'Dwyer › Agro › Agricultura" }]);
  });

  it("sector anterior: sólo sectores del modelo anterior", () => {
    expect(legacySectorOptions(catalog).map((item) => item.id)).toEqual(["s-old"]);
  });

  it("establecimientos: sólo con zona; filtrados por zona si se eligió una", () => {
    expect(establishmentFilterOptions(catalog, "").map((item) => item.id)).toEqual(["e1", "e2"]);
    expect(establishmentFilterOptions(catalog, "z2").map((item) => item.id)).toEqual(["e2"]);
  });
});

describe("isReloadPending — mismo criterio que el backend", () => {
  it("pendiente sin puesto con alcance o sin ubicación vigente/futura; completa con ambos", () => {
    expect(isReloadPending({ positionId: "p", positionScopeCount: 2, openWorkLocationCount: 1 })).toBe(false);
    expect(isReloadPending({ positionId: "p", positionScopeCount: 0, openWorkLocationCount: 1 })).toBe(true);
    expect(isReloadPending({ positionId: "p", positionScopeCount: 1, openWorkLocationCount: 0 })).toBe(true);
    expect(isReloadPending({ positionId: undefined, positionScopeCount: undefined, openWorkLocationCount: 3 })).toBe(true);
  });

  it("sin el dato no adivina", () => {
    expect(isReloadPending({ positionId: "p", positionScopeCount: undefined, openWorkLocationCount: 1 })).toBeUndefined();
    expect(isReloadPending({ positionId: "p", positionScopeCount: 1, openWorkLocationCount: undefined })).toBeUndefined();
  });
});

describe("organizationChartMockService — alcance de acceso (A7)", () => {
  it("no recorta por sector en el cliente: el acceso de Nivel 2 lo aplica el backend por responsable de carga", () => {
    const employees = [{ id: "1", firstName: "Ana", lastName: "QA", sector: "Responsable de finanzas" }, { id: "2", firstName: "Leo", lastName: "QA", sector: "" }] as unknown as Employee[];
    expect(organizationChartMockService.getEmployeesFrom(employees).map((employee) => employee.id)).toEqual(["1", "2"]);
  });
});
