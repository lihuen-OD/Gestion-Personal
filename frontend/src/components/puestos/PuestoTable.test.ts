import { describe, expect, it } from "vitest";
import { positionLocationCells } from "./PuestoTable";
import type { Position } from "../../types/position.types";

/**
 * Limpieza final de Position (2026-08-18): PuestoTable muestra la ubicacion
 * derivada via sectorId (derivedBusinessUnitName/derivedEstablishmentName/
 * derivedAreaName/derivedSectorName) — no hay ninguna columna string legado
 * a la que volver, esas columnas ya no existen en el esquema.
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

describe("PuestoTable.positionLocationCells", () => {
  it("muestra los 4 niveles derivados via sectorId cuando el puesto tiene backfill", () => {
    const cells = positionLocationCells(position({
      derivedBusinessUnitName: "Administracion",
      derivedEstablishmentName: "Casa Central",
      derivedAreaName: "Administracion General",
      derivedSectorName: "RRHH",
    }));

    expect(cells).toEqual({
      businessUnit: "Administracion",
      establishment: "Casa Central",
      area: "Administracion General",
      sector: "RRHH",
    });
  });

  it("devuelve null (no un string legado) para un puesto sin sectorId backfillado todavia", () => {
    const cells = positionLocationCells(position());

    expect(cells).toEqual({ businessUnit: null, establishment: null, area: null, sector: null });
  });
});
