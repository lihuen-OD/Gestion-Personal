import { describe, expect, it } from "vitest";
import { mapEmployeeFromApi } from "./employeeApiService";

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
