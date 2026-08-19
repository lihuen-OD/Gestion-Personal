import { describe, expect, it } from "vitest";
import { associatedEmployeesQuery, mapAssociatedEmployeeFromApi } from "./associatedEmployeeMapper";

const apiEmployee = {
  id: "employee-1",
  legajo: "100",
  cuil: "20-12345678-9",
  firstName: "Ana",
  lastName: "Prueba",
  status: "ACTIVO" as const,
  sector: { id: "sector-1", name: "Campo" },
  costCenter: null,
  companies: [{ id: "company-1", name: "OD" }],
};

describe("mapAssociatedEmployeeFromApi", () => {
  it("mapea todos los campos sin transformarlos (passthrough)", () => {
    expect(mapAssociatedEmployeeFromApi(apiEmployee)).toEqual(apiEmployee);
  });

  it("sector/costCenter null no rompen el mapeo", () => {
    const mapped = mapAssociatedEmployeeFromApi({ ...apiEmployee, sector: null, costCenter: null });
    expect(mapped.sector).toBeNull();
    expect(mapped.costCenter).toBeNull();
  });
});

describe("associatedEmployeesQuery — filtros reales, no traer todo para filtrar en frontend", () => {
  it("siempre manda page/take (default 1/50 si no se pasan)", () => {
    expect(associatedEmployeesQuery()).toBe("?page=1&take=50");
  });

  it("envía sectorId cuando se filtra por sector", () => {
    expect(associatedEmployeesQuery({ sectorId: "sector-1" })).toContain("sectorId=sector-1");
  });

  it("envía costCenterId cuando se filtra por centro de costo", () => {
    expect(associatedEmployeesQuery({ costCenterId: "cc-1" })).toContain("costCenterId=cc-1");
  });

  it("envía companyId cuando se filtra por empresa", () => {
    expect(associatedEmployeesQuery({ companyId: "company-1" })).toContain("companyId=company-1");
  });

  it("envía search recortado (trim)", () => {
    expect(associatedEmployeesQuery({ search: "  perez  " })).toContain("search=perez");
  });

  it("sin filtros opcionales, no agrega esos query params", () => {
    const query = associatedEmployeesQuery({});
    expect(query).not.toContain("sectorId=");
    expect(query).not.toContain("costCenterId=");
    expect(query).not.toContain("companyId=");
    expect(query).not.toContain("search=");
  });

  it("extraParams (status/date) se agregan solo cuando tienen valor", () => {
    expect(associatedEmployeesQuery({}, { status: "current" })).toContain("status=current");
    expect(associatedEmployeesQuery({}, { status: undefined })).not.toContain("status=");
  });

  it("respeta page/take explícitos (paginación real, no frontend)", () => {
    expect(associatedEmployeesQuery({ page: 3, take: 20 })).toBe("?page=3&take=20");
  });
});
