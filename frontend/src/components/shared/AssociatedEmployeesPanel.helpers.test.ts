import { describe, expect, it } from "vitest";
import {
  buildAssociatedEmployeesRequest,
  employeeCompanyNames,
  employeeStatusLabel,
  formatVigencyDate,
  vigencyLabel,
  vigencyTone,
} from "./AssociatedEmployeesPanel.helpers";
import type { AssociatedEmployee } from "../../types/associatedEmployee.types";

function employee(overrides: Partial<AssociatedEmployee> = {}): AssociatedEmployee {
  return {
    id: "employee-1",
    legajo: "100",
    cuil: "20-12345678-9",
    firstName: "Ana",
    lastName: "Prueba",
    status: "ACTIVO",
    sector: null,
    costCenter: null,
    companies: [],
    ...overrides,
  };
}

describe("vigencyLabel/vigencyTone — vigente/histórico/futuro", () => {
  it("current -> Vigente / success", () => {
    expect(vigencyLabel("current")).toBe("Vigente");
    expect(vigencyTone("current")).toBe("success");
  });

  it("future -> Futura / warning", () => {
    expect(vigencyLabel("future")).toBe("Futura");
    expect(vigencyTone("future")).toBe("warning");
  });

  it("historical -> Histórica / neutral", () => {
    expect(vigencyLabel("historical")).toBe("Histórica");
    expect(vigencyTone("historical")).toBe("neutral");
  });
});

describe("formatVigencyDate — fechas nulas y formato dd/mm/yyyy", () => {
  it("formatea una fecha calendario a dd/mm/yyyy", () => {
    expect(formatVigencyDate("2026-08-19T00:00:00.000Z")).toBe("19/08/2026");
  });

  it("fecha null -> '-' (nunca rompe, effectiveTo abierto es un caso real)", () => {
    expect(formatVigencyDate(null)).toBe("-");
  });
});

describe("employeeStatusLabel — no muestra enums crudos", () => {
  it("ACTIVO -> Activo", () => {
    expect(employeeStatusLabel("ACTIVO")).toBe("Activo");
  });

  it("INACTIVO -> Inactivo", () => {
    expect(employeeStatusLabel("INACTIVO")).toBe("Inactivo");
  });
});

describe("employeeCompanyNames — datos opcionales que no rompen la vista", () => {
  it("sin empresas asociadas, muestra '-' en vez de una lista vacía", () => {
    expect(employeeCompanyNames(employee({ companies: [] }))).toBe("-");
  });

  it("con una empresa, muestra su nombre", () => {
    expect(employeeCompanyNames(employee({ companies: [{ id: "c1", name: "OD" }] }))).toBe("OD");
  });

  it("con varias empresas, las une con coma", () => {
    expect(
      employeeCompanyNames(employee({ companies: [{ id: "c1", name: "OD" }, { id: "c2", name: "OD Norte" }] })),
    ).toBe("OD, OD Norte");
  });
});

describe("buildAssociatedEmployeesRequest — filtros -> request real", () => {
  it("mapea sector/centro de costo/empresa seleccionados a sus ids", () => {
    const request = buildAssociatedEmployeesRequest({
      search: "",
      sectorId: "sector-1",
      costCenterId: "cc-1",
      companyId: "company-1",
      page: 1,
      take: 20,
    });
    expect(request).toEqual({ search: undefined, sectorId: "sector-1", costCenterId: "cc-1", companyId: "company-1", page: 1, take: 20 });
  });

  it("recorta (trim) la búsqueda y la omite si queda vacía", () => {
    expect(buildAssociatedEmployeesRequest({ search: "   ", page: 1, take: 20 }).search).toBeUndefined();
    expect(buildAssociatedEmployeesRequest({ search: "  perez  ", page: 1, take: 20 }).search).toBe("perez");
  });

  it("limpiar un filtro (string vacío, como 'Todos') no manda su id — igual que companyId en legajos", () => {
    const request = buildAssociatedEmployeesRequest({ search: "", sectorId: "", costCenterId: "", companyId: "", page: 1, take: 20 });
    expect(request.sectorId).toBeUndefined();
    expect(request.costCenterId).toBeUndefined();
    expect(request.companyId).toBeUndefined();
  });

  it("pagina siempre con page/take explícitos", () => {
    const request = buildAssociatedEmployeesRequest({ search: "", page: 3, take: 10 });
    expect(request.page).toBe(3);
    expect(request.take).toBe(10);
  });
});
