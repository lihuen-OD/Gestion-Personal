import { describe, expect, it } from "vitest";
import { createHourConceptSchema, updateHourConceptSchema } from "./hourConcepts.schemas";

describe("schemas de conceptos horarios adicionales", () => {
  it("exige loadMode al crear un concepto adicional", () => {
    const result = createHourConceptSchema.safeParse({
      code: "HOR-003",
      name: "Camioneta",
      kind: "TRANSPORTE",
    });

    expect(result.success).toBe(false);
  });

  it("acepta los tres modos oficiales", () => {
    for (const loadMode of ["MANUAL", "AUTOMATIC", "BOTH"] as const) {
      expect(
        createHourConceptSchema.safeParse({ code: `HOR-${loadMode}`, name: "Concepto adicional", kind: "OTRO", loadMode }).success,
      ).toBe(true);
    }
  });

  it("no permite crear ni convertir un concepto genérico en NORMAL", () => {
    expect(
      createHourConceptSchema.safeParse({ code: "NORMAL-2", name: "Otra normal", kind: "NORMAL", loadMode: "MANUAL" }).success,
    ).toBe(false);
    expect(updateHourConceptSchema.safeParse({ kind: "NORMAL" }).success).toBe(false);
  });
});
