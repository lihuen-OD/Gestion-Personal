import { describe, expect, it } from "vitest";
import { auditFieldChanges } from "./auditApiService";

describe("auditFieldChanges", () => {
  it("extracts persisted employee changes for the section history", () => {
    expect(auditFieldChanges(
      { firstName: "Prueba", civilStatus: "Soltero", address: { city: "Luján" } },
      { firstName: "Prueba", civilStatus: "Casado", address: { city: "Open Door" } },
    )).toEqual([
      { field: "civilStatus", label: "Estado civil", previous: "Soltero", next: "Casado" },
      { field: "address.city", label: "Localidad", previous: "Luján", next: "Open Door" },
    ]);
  });

  it("does not create rows for unchanged values", () => {
    expect(auditFieldChanges(
      { gender: "Masculino", nationality: "Argentina" },
      { gender: "Masculino", nationality: "Argentina" },
    )).toEqual([]);
  });
});
