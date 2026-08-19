import { describe, expect, it } from "vitest";
import { mapHourConceptEmployeeAssociationFromApi } from "./hourConceptApiService";

describe("mapHourConceptEmployeeAssociationFromApi — empleados habilitados para el concepto (Etapa 8G)", () => {
  it("mapea employeeId y los datos del empleado habilitado", () => {
    const association = mapHourConceptEmployeeAssociationFromApi({
      employeeId: "employee-1",
      employee: {
        id: "employee-1",
        legajo: "100",
        cuil: "20-12345678-9",
        firstName: "Ana",
        lastName: "Prueba",
        status: "ACTIVO",
        sector: null,
        costCenter: { id: "cc-1", name: "Administración" },
        companies: [{ id: "company-1", name: "OD" }],
      },
    });

    expect(association).toEqual({
      employeeId: "employee-1",
      employee: {
        id: "employee-1",
        legajo: "100",
        cuil: "20-12345678-9",
        firstName: "Ana",
        lastName: "Prueba",
        status: "ACTIVO",
        sector: null,
        costCenter: { id: "cc-1", name: "Administración" },
        companies: [{ id: "company-1", name: "OD" }],
      },
    });
  });
});
