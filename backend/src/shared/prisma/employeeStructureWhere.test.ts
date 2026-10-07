import { describe, expect, it } from "vitest";
import { employeeStructureWhere, reloadPendingWhere } from "./employeeStructureWhere";
import { orgScopeRowWhere } from "./orgScopeWhere";
import { listEmployeesQuerySchema } from "../../modules/employees/employees.schemas";

const day = (key: string) => new Date(`${key}T00:00:00.000Z`);

describe("orgScopeRowWhere — WITHIN vs COVERS (ADR §3.4)", () => {
  it("WITHIN de una empresa incluye alcances en la empresa y en sus descendientes", () => {
    expect(orgScopeRowWhere("COMPANY", "c1", "WITHIN")).toEqual({ OR: [
      { companyId: "c1" },
      { businessUnit: { companyId: "c1" } },
      { sector: { businessUnit: { companyId: "c1" } } },
      { area: { sector: { businessUnit: { companyId: "c1" } } } },
    ] });
  });

  it("COVERS de una empresa sólo matchea el alcance en esa misma empresa (no tiene ancestros)", () => {
    expect(orgScopeRowWhere("COMPANY", "c1", "COVERS")).toEqual({ OR: [{ companyId: "c1" }] });
  });

  it("COVERS de un sector incluye alcances en su UN o su empresa (quien lo abarca), nunca descendientes", () => {
    expect(orgScopeRowWhere("SECTOR", "s1", "COVERS")).toEqual({ OR: [
      { sectorId: "s1" },
      { businessUnit: { sectors: { some: { id: "s1" } } } },
      { company: { businessUnits: { some: { sectors: { some: { id: "s1" } } } } } },
    ] });
    expect(JSON.stringify(orgScopeRowWhere("SECTOR", "s1", "COVERS"))).not.toContain("areaId");
  });
});

describe("employeeStructureWhere — sin duplicados, vigencias y recarga", () => {
  it("sin filtros no agrega cláusulas", () => {
    expect(employeeStructureWhere({}, "2026-10-07")).toEqual([]);
  });

  it("alcance: se expresa con some sobre los alcances del PUESTO (una persona con varios alcances aparece una vez)", () => {
    expect(employeeStructureWhere({ scopeLevel: "SECTOR", scopeNodeId: "s1", scopeMode: "WITHIN" }, "2026-10-07")).toEqual([
      { position: { orgScopes: { some: orgScopeRowWhere("SECTOR", "s1", "WITHIN") } } },
    ]);
  });

  it("alcance incompleto (sin modo) no filtra: el modo no tiene valor por defecto (D-7)", () => {
    expect(employeeStructureWhere({ scopeLevel: "SECTOR", scopeNodeId: "s1" }, "2026-10-07")).toEqual([]);
  });

  it("ubicación: vigente HOY por defecto, con zona y establecimiento dentro de la misma asignación", () => {
    expect(employeeStructureWhere({ locationZoneId: "z1", locationEstablishmentId: "e1" }, "2026-10-07")).toEqual([
      { workLocations: { some: { AND: [
        { effectiveFrom: { lte: day("2026-10-07") }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: day("2026-10-07") } }] },
        { zoneId: "z1" },
        { establishments: { some: { establishmentId: "e1" } } },
      ] } } },
    ]);
  });

  it("ubicación a otra fecha usa esa fecha calendario, sin huso horario", () => {
    const [clause] = employeeStructureWhere({ locationZoneId: "z1", locationDate: "2027-02-01" }, "2026-10-07");
    expect(JSON.stringify(clause)).toContain("2027-02-01T00:00:00.000Z");
  });

  it("pendiente de recarga: sin puesto, puesto sin alcance o sin ubicación vigente/futura; completa = negación", () => {
    expect(reloadPendingWhere("2026-10-07")).toEqual({ OR: [
      { positionId: null },
      { position: { orgScopes: { none: {} } } },
      { workLocations: { none: { OR: [{ effectiveTo: null }, { effectiveTo: { gte: day("2026-10-07") } }] } } },
    ] });
    expect(employeeStructureWhere({ reloadStatus: "COMPLETE" }, "2026-10-07")).toEqual([{ NOT: reloadPendingWhere("2026-10-07") }]);
  });
});

describe("listEmployeesQuerySchema — parámetros de estructura", () => {
  it("exige nivel, nodo y modo juntos", () => {
    expect(listEmployeesQuerySchema.safeParse({ scopeLevel: "SECTOR", scopeNodeId: "11111111-1111-4111-8111-111111111111" }).success).toBe(false);
    expect(listEmployeesQuerySchema.safeParse({ scopeLevel: "SECTOR", scopeNodeId: "11111111-1111-4111-8111-111111111111", scopeMode: "COVERS" }).success).toBe(true);
  });

  it("fecha de vigencia sólo con zona o establecimiento, y fecha calendario válida", () => {
    expect(listEmployeesQuerySchema.safeParse({ locationDate: "2026-10-07" }).success).toBe(false);
    expect(listEmployeesQuerySchema.safeParse({ locationZoneId: "11111111-1111-4111-8111-111111111111", locationDate: "2026-02-30" }).success).toBe(false);
    expect(listEmployeesQuerySchema.safeParse({ locationZoneId: "11111111-1111-4111-8111-111111111111", locationDate: "2026-10-07" }).success).toBe(true);
  });
});
