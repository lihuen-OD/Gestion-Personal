import { describe, expect, it, vi } from "vitest";
import { doubleHourRuleScopeWhere } from "./timeEntries.repository";

vi.mock("../../shared/prisma/client", () => ({ prisma: {} }));

/**
 * A7 (docs/decisions/ORG_LOCATION_REORGANIZATION.md §16.4): caracterización
 * del alcance de reglas de horas especiales TAL COMO ESTÁ. A7 no cambia el
 * motor (D-4/D-5 abiertas). Si una decisión futura lo adapta, este test debe
 * cambiar junto con una comparación antes/después que no modifique horas,
 * desgloses ni cierres.
 */
describe("doubleHourRuleScopeWhere — criterio vigente (sin cambios en A7)", () => {
  it("empresa = empresa EMPLEADORA del legajo; sector = sector ANTERIOR del legajo; puesto = puesto asignado", () => {
    expect(doubleHourRuleScopeWhere("emp-1", ["losod"], "sector-anterior", "cc-1", "pos-1")).toEqual([
      { OR: [{ employees: { none: {} } }, { employees: { some: { employeeId: "emp-1" } } }] },
      { OR: [{ companyId: null }, { companyId: { in: ["losod"] } }] },
      { OR: [{ sectorId: null }, { sectorId: "sector-anterior" }] },
      { OR: [{ costCenterId: null }, { costCenterId: "cc-1" }] },
      { OR: [{ positionId: null }, { positionId: "pos-1" }] },
    ]);
  });

  it("un legajo recargado (sin sector anterior, puesto con alcance) sólo recibe reglas SIN sector: el alcance del puesto no se consulta", () => {
    const where = doubleHourRuleScopeWhere("emp-qa", ["losod"], null, "cc-1", "pos-with-scope");
    expect(where).toContainEqual({ sectorId: null });
    expect(JSON.stringify(where)).not.toContain("orgScopes");
  });

  it("una regla por empresa (p. ej. “Domingos”, LOSOD) sigue alcanzando a todo legajo con esa empresa empleadora, tenga o no sector", () => {
    const where = doubleHourRuleScopeWhere("emp-qa", ["losod"], null, null, null);
    expect(where).toContainEqual({ OR: [{ companyId: null }, { companyId: { in: ["losod"] } }] });
  });
});
