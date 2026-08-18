import { describe, expect, it } from "vitest";
import { positionAllowedValues } from "./EmployeeLaborFields";
import type { Position } from "../../types/position.types";

/**
 * Limpieza final de Position (2026-08-18): la tarjeta de validacion local de
 * respaldo en Legajos (SalaryRangeValidationCard) debe leer la cadena
 * derivada real (derivedBusinessUnitName/derivedEstablishmentName/
 * derivedSectorName), no los strings/JSON legado — que ya no existen en el
 * tipo Position ni en el esquema.
 */
function position(overrides: Partial<Position> = {}): Position {
  return {
    id: "pos-1",
    code: "PUE-100",
    name: "Puesto Test",
    lastUpdatedAt: "2026-08-01",
    status: "ACTIVO",
    mission: "",
    responsibilities: [],
    internalRelations: [],
    externalRelations: [],
    competencies: [],
    workConditions: { modality: "PRESENCIAL", workload: "", workplace: "", relationType: "", observations: "" },
    performanceIndicators: [],
    evaluationCriteria: [],
    history: [],
    createdAt: "2026-08-01",
    updatedAt: "2026-08-01",
    ...overrides,
  };
}

describe("EmployeeLaborFields.positionAllowedValues", () => {
  it("usa los derivados reales para unidad de negocio, establecimiento y sector", () => {
    const withChain = position({
      derivedBusinessUnitName: "Administracion",
      derivedEstablishmentName: "Casa Central",
      derivedSectorName: "RRHH",
    });

    expect(positionAllowedValues(withChain, "businessUnit")).toEqual(["Administracion"]);
    expect(positionAllowedValues(withChain, "establishment")).toEqual(["Casa Central"]);
    expect(positionAllowedValues(withChain, "sector")).toEqual(["RRHH"]);
  });

  it("devuelve lista vacia (no un string legado) cuando el puesto todavia no tiene sectorId backfillado", () => {
    const withoutChain = position();

    expect(positionAllowedValues(withoutChain, "businessUnit")).toEqual([]);
    expect(positionAllowedValues(withoutChain, "establishment")).toEqual([]);
    expect(positionAllowedValues(withoutChain, "sector")).toEqual([]);
  });

  it("devuelve lista vacia cuando no hay puesto seleccionado", () => {
    expect(positionAllowedValues(undefined, "sector")).toEqual([]);
  });
});
