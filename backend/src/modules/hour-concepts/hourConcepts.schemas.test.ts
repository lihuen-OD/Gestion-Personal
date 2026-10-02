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
        createHourConceptSchema.safeParse({ code: `HOR-${loadMode}`, name: "Concepto adicional", kind: "OTRO", loadMode, workTreatment: "WITHIN_BASE" }).success,
      ).toBe(true);
    }
  });

  it("no permite crear ni convertir un concepto genérico en NORMAL", () => {
    expect(
      createHourConceptSchema.safeParse({ code: "NORMAL-2", name: "Otra normal", kind: "NORMAL", loadMode: "MANUAL" }).success,
    ).toBe(false);
    expect(updateHourConceptSchema.safeParse({ kind: "NORMAL" }).success).toBe(false);
  });

  // docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md: la semántica de negocio
  // es explícita y obligatoria — nunca se deduce de loadMode.
  it("exige workTreatment al crear y acepta los dos tratamientos con cualquier loadMode", () => {
    expect(createHourConceptSchema.safeParse({ code: "HOR-020", name: "Sin tratamiento", kind: "OTRO", loadMode: "MANUAL" }).success).toBe(false);
    for (const workTreatment of ["WITHIN_BASE", "ADDITIVE_TO_WORKED_TOTAL"] as const) {
      for (const loadMode of ["MANUAL", "AUTOMATIC", "BOTH"] as const) {
        expect(createHourConceptSchema.safeParse({ code: "HOR-021", name: "Concepto", kind: "OTRO", loadMode, workTreatment }).success).toBe(true);
      }
    }
    expect(updateHourConceptSchema.safeParse({ workTreatment: "OTRO" }).success).toBe(false);
  });

  it("countsAsWorked queda fuera del contrato editable", () => {
    const result = createHourConceptSchema.parse({
      code: "HOR-010", name: "Adicional", kind: "OTRO", loadMode: "MANUAL", workTreatment: "ADDITIVE_TO_WORKED_TOTAL", countsAsWorked: false,
    });
    expect(result).not.toHaveProperty("countsAsWorked");
  });
});
