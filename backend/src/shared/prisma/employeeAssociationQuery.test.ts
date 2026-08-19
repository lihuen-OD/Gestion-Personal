import { describe, expect, it } from "vitest";
import { buildEmployeeAssociationWhere, mapAssociatedEmployee } from "./employeeAssociationQuery";

describe("buildEmployeeAssociationWhere", () => {
  it("sin filtros, devuelve un where vacío", () => {
    expect(buildEmployeeAssociationWhere({})).toEqual({});
  });

  it("sectorId/costCenterId se pasan como columna directa (igual que employees.repository.ts)", () => {
    expect(buildEmployeeAssociationWhere({ sectorId: "sector-1", costCenterId: "cc-1" })).toEqual({
      sectorId: "sector-1",
      costCenterId: "cc-1",
    });
  });

  it("companyId se traduce a companies.some.companyId (Employee no tiene columna companyId propia)", () => {
    expect(buildEmployeeAssociationWhere({ companyId: "company-1" })).toEqual({
      companies: { some: { companyId: "company-1" } },
    });
  });

  it("search arma un OR insensible a mayúsculas sobre legajo/cuil/firstName/lastName", () => {
    expect(buildEmployeeAssociationWhere({ search: "perez" })).toEqual({
      OR: [
        { legajo: { contains: "perez", mode: "insensitive" } },
        { cuil: { contains: "perez", mode: "insensitive" } },
        { firstName: { contains: "perez", mode: "insensitive" } },
        { lastName: { contains: "perez", mode: "insensitive" } },
      ],
    });
  });

  it("search se recorta (trim) antes de armar el filtro", () => {
    const withSpaces = buildEmployeeAssociationWhere({ search: "  perez  " });
    const trimmed = buildEmployeeAssociationWhere({ search: "perez" });
    expect(withSpaces).toEqual(trimmed);
  });

  it("search vacío (solo espacios) no agrega ningún filtro OR", () => {
    expect(buildEmployeeAssociationWhere({ search: "   " })).toEqual({});
  });
});

describe("mapAssociatedEmployee", () => {
  it("aplana companies de [{ company: {...} }] a [{...}]", () => {
    const mapped = mapAssociatedEmployee({
      id: "employee-1",
      legajo: "100",
      cuil: "20-12345678-9",
      firstName: "Ana",
      lastName: "Prueba",
      status: "ACTIVO",
      sector: { id: "sector-1", name: "Campo" },
      costCenter: null,
      companies: [{ company: { id: "company-1", name: "OD" } }, { company: { id: "company-2", name: "OD Norte" } }],
    } as never);

    expect(mapped.companies).toEqual([
      { id: "company-1", name: "OD" },
      { id: "company-2", name: "OD Norte" },
    ]);
  });

  it("sector/costCenter ausentes (null) no rompen el mapeo", () => {
    const mapped = mapAssociatedEmployee({
      id: "employee-1",
      legajo: "100",
      cuil: "20-12345678-9",
      firstName: "Ana",
      lastName: "Prueba",
      status: "ACTIVO",
      sector: null,
      costCenter: null,
      companies: [],
    } as never);

    expect(mapped.sector).toBeNull();
    expect(mapped.costCenter).toBeNull();
    expect(mapped.companies).toEqual([]);
  });
});
