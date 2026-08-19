import { describe, expect, it } from "vitest";
import { employeeListRequest, mapEmployeeFromApi } from "./employeeApiService";

describe("mapEmployeeFromApi transport", () => {
  it("keeps transport locality separate from the home address city", () => {
    const employee = mapEmployeeFromApi({
      id: "employee-1",
      legajo: "100",
      cuil: "20-12345678-9",
      dni: "12345678",
      firstName: "Ana",
      lastName: "Prueba",
      status: "ACTIVO",
      address: { city: "Luján" },
      transport: {
        usesCompanyTransport: true,
        locality: "Open Door",
        observation: "Sube en la plaza",
      },
    });

    expect(employee.city).toBe("Luján");
    expect(employee.transportLocality).toBe("Open Door");
    expect(employee.transportNotes).toBe("Sube en la plaza");
  });
});

describe("employeeListRequest filtros sectorId/costCenterId (Etapa 8F)", () => {
  it("envía sectorId como query param cuando se filtra por sector", () => {
    const { path } = employeeListRequest({ sectorId: "sector-1" });
    expect(path).toContain("sectorId=sector-1");
  });

  it("envía costCenterId como query param cuando se filtra por centro de costo", () => {
    const { path } = employeeListRequest({ costCenterId: "cc-1" });
    expect(path).toContain("costCenterId=cc-1");
  });

  it("puede combinar sectorId y costCenterId sin pisarse entre sí", () => {
    const { path } = employeeListRequest({ sectorId: "sector-1", costCenterId: "cc-1" });
    expect(path).toContain("sectorId=sector-1");
    expect(path).toContain("costCenterId=cc-1");
  });

  it("sin sectorId/costCenterId (filtros no aplicados), no agrega esos query params", () => {
    const { path } = employeeListRequest({});
    expect(path).not.toContain("sectorId=");
    expect(path).not.toContain("costCenterId=");
  });

  it("limpiar el filtro (string vacío, como al elegir 'Todos') elimina el query param, igual que companyId", () => {
    const { path } = employeeListRequest({ sectorId: "", costCenterId: "" });
    expect(path).not.toContain("sectorId=");
    expect(path).not.toContain("costCenterId=");
  });
});
