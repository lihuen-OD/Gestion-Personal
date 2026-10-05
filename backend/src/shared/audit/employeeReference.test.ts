import { describe, expect, it, vi } from "vitest";
import { formatEmployeeReference, loadEmployeeReferences, UNIDENTIFIED_EMPLOYEE_REFERENCE } from "./employeeReference";
import { describeRequestPath, containsTechnicalId, maskTechnicalIds } from "./technicalIds";

const employeeUuid = "016dc01c-655d-4474-8319-67f1b8108c93";

describe("formatEmployeeReference", () => {
  it("Apellido, Nombre · Legajo N", () => {
    expect(formatEmployeeReference({ legajo: "30", firstName: "Juan", lastName: "Pérez" })).toBe("Pérez, Juan · Legajo 30");
  });

  it("con legajo pero sin nombre: Legajo N", () => {
    expect(formatEmployeeReference({ legajo: "30" })).toBe("Legajo 30");
    expect(formatEmployeeReference({ legajo: "30", firstName: " ", lastName: null })).toBe("Legajo 30");
  });

  it("con nombre pero sin legajo: Apellido, Nombre (o la parte disponible)", () => {
    expect(formatEmployeeReference({ firstName: "Juan", lastName: "Pérez" })).toBe("Pérez, Juan");
    expect(formatEmployeeReference({ lastName: "Pérez" })).toBe("Pérez");
  });

  it("sin identidad humana: frase neutra, nunca un id", () => {
    expect(formatEmployeeReference(null)).toBe(UNIDENTIFIED_EMPLOYEE_REFERENCE);
    expect(formatEmployeeReference({ id: employeeUuid } as never)).toBe(UNIDENTIFIED_EMPLOYEE_REFERENCE);
  });
});

describe("loadEmployeeReferences", () => {
  it("resuelve un lote en una sola consulta (deduplicada) y cae en la frase neutra para ids desconocidos", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: employeeUuid, legajo: "30", firstName: "Juan", lastName: "Pérez" }]);

    const referenceOf = await loadEmployeeReferences({ employee: { findMany } } as never, [employeeUuid, employeeUuid, "otro"]);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: [employeeUuid, "otro"] } },
      select: { id: true, legajo: true, firstName: true, lastName: true },
    });
    expect(referenceOf(employeeUuid)).toBe("Pérez, Juan · Legajo 30");
    expect(referenceOf("otro")).toBe(UNIDENTIFIED_EMPLOYEE_REFERENCE);
  });

  it("sin ids no consulta", async () => {
    const findMany = vi.fn();
    await loadEmployeeReferences({ employee: { findMany } } as never, []);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("technicalIds", () => {
  it("detecta y enmascara UUIDs en texto y rutas", () => {
    expect(containsTechnicalId(`para el legajo ${employeeUuid}.`)).toBe(true);
    expect(containsTechnicalId("para Pérez, Juan · Legajo 30.")).toBe(false);
    expect(maskTechnicalIds(`legajo ${employeeUuid.toUpperCase()}`)).toBe("legajo —");
    expect(describeRequestPath(`/api/employees/${employeeUuid}/overview`)).toBe("/api/employees/:id/overview");
  });
});
