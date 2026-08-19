import { describe, expect, it } from "vitest";
import { visibleEmployeeResults } from "./EmployeeRemoteSelector";
import type { Employee } from "../../types";

function employee(id: string): Employee {
  return { id, firstName: `Nombre${id}`, lastName: `Apellido${id}` } as Employee;
}

describe("visibleEmployeeResults — asimetría del selector de empleados en turnos (Etapa 8F)", () => {
  it("sin excludeIds (uso actual de NoveltyModal/DocumentUploadModal/WorkScheduleSettingsPage), devuelve todos los resultados sin filtrar", () => {
    const results = [employee("1"), employee("2")];
    expect(visibleEmployeeResults(results)).toBe(results);
  });

  it("los empleados ya asignados (HABILITADO) no aparecen en el selector", () => {
    const results = [employee("1"), employee("2"), employee("3")];
    const excludeIds = new Set(["2"]);
    const visible = visibleEmployeeResults(results, excludeIds);
    expect(visible.map((item) => item.id)).toEqual(["1", "3"]);
  });

  it("los empleados todavía no asignados sí aparecen", () => {
    const results = [employee("1"), employee("2")];
    const visible = visibleEmployeeResults(results, new Set(["not-in-results"]));
    expect(visible.map((item) => item.id)).toEqual(["1", "2"]);
  });

  it("excludeIds vacío no oculta a nadie", () => {
    const results = [employee("1"), employee("2")];
    expect(visibleEmployeeResults(results, new Set())).toEqual(results);
  });
});
