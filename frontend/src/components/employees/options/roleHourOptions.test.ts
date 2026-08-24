import { describe, expect, it } from "vitest";
import { assignableHourConcepts } from "./roleHourOptions";
import type { HourConcept } from "../../../types/hourConcept.types";

function concept(overrides: Partial<HourConcept>): HourConcept {
  return { id: "concept-1", code: "HOR-001", name: "Concepto", kind: "OTRO", status: "ACTIVO", loadMode: "MANUAL", systemRole: null, createdAt: "", updatedAt: "", ...overrides };
}

describe("assignableHourConcepts — catálogo del legajo 6F", () => {
  it("excluye Normal sin depender del nombre visible", () => {
    const normal = concept({ id: "normal", name: "Nombre cambiado", kind: "NORMAL", loadMode: null, systemRole: "NORMAL_BASE" });
    expect(assignableHourConcepts([normal])).toEqual([]);
  });

  it("excluye inactivos y conceptos sin loadMode", () => {
    expect(assignableHourConcepts([
      concept({ id: "inactive", status: "INACTIVO" }),
      concept({ id: "legacy", loadMode: null }),
    ])).toEqual([]);
  });

  it("incluye Manual, Automatic y Both con su modo", () => {
    const concepts = [
      concept({ id: "colectivo", name: "Colectivo", loadMode: "MANUAL" }),
      concept({ id: "sereno", name: "Sereno", loadMode: "AUTOMATIC" }),
      concept({ id: "both", name: "Mixto", loadMode: "BOTH" }),
    ];
    expect(assignableHourConcepts(concepts).map((item) => item.loadMode)).toEqual(["MANUAL", "AUTOMATIC", "BOTH"]);
  });
});
