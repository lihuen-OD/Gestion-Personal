import { describe, expect, it } from "vitest";
import { clockPhotoPunchSchema } from "./timeEntries.schemas";

function basePunch(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    requestId: "11111111-1111-1111-1111-111111111111",
    employeeId: "22222222-2222-2222-2222-222222222222",
    punchType: "IN",
    photo: "data:image/jpeg;base64,".padEnd(200, "A"),
    faceValidationStatus: "VALID",
    ...overrides,
  };
}

describe("clockPhotoPunchSchema — Etapa 6K, fichador sin selector de concepto", () => {
  it("acepta un ingreso (IN) sin hourConceptId — el backend resuelve Normal canónico internamente", () => {
    const result = clockPhotoPunchSchema.safeParse(basePunch());
    expect(result.success).toBe(true);
  });

  it("acepta una salida (OUT) sin hourConceptId", () => {
    const result = clockPhotoPunchSchema.safeParse(basePunch({ punchType: "OUT" }));
    expect(result.success).toBe(true);
  });

  it("sigue aceptando hourConceptId si un cliente viejo todavía lo manda (validación de negocio la hace resolveShiftConcept, no el schema)", () => {
    const result = clockPhotoPunchSchema.safeParse(basePunch({ hourConceptId: "33333333-3333-3333-3333-333333333333" }));
    expect(result.success).toBe(true);
  });

  it("rechaza hourConceptId con formato inválido", () => {
    const result = clockPhotoPunchSchema.safeParse(basePunch({ hourConceptId: "no-es-un-uuid" }));
    expect(result.success).toBe(false);
  });

  it("sigue exigiendo photo y faceValidationStatus (sin relación con el concepto horario)", () => {
    const result = clockPhotoPunchSchema.safeParse(basePunch({ photo: undefined }));
    expect(result.success).toBe(false);
  });
});
