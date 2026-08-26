import { describe, expect, it } from "vitest";
import { doubleRuleSchema, updateDoubleRuleSchema } from "./workforce.schemas";

describe("doubleRuleSchema — Etapa 8B", () => {
  const base = { name: "Domingo", recurrenceType: "SEMANAL" as const, fromDate: "2026-01-01", reason: "Domingo" };

  it("no exige employeeIds (regla general)", () => {
    expect(doubleRuleSchema.safeParse(base).success).toBe(true);
  });

  it("FECHA sin dates: falla con el mensaje esperado en el campo dates", () => {
    const result = doubleRuleSchema.safeParse({ ...base, recurrenceType: "FECHA" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "dates")).toBe(true);
    }
  });

  it("FECHA con dates: pasa", () => {
    const result = doubleRuleSchema.safeParse({ ...base, recurrenceType: "FECHA", dates: [{ date: "2026-12-25" }] });
    expect(result.success).toBe(true);
  });
});

describe("updateDoubleRuleSchema — Etapa 8C (cierre de hueco)", () => {
  it("payload vacío: falla (nada para actualizar)", () => {
    expect(updateDoubleRuleSchema.safeParse({}).success).toBe(false);
  });

  it("cambia sólo priority: pasa sin exigir el resto de los campos", () => {
    expect(updateDoubleRuleSchema.safeParse({ priority: 5 }).success).toBe(true);
  });

  it("cambia recurrenceType a FECHA sin mandar dates: falla (antes de 8C esto pasaba y dejaba la regla sin ninguna fecha que pudiera matchear)", () => {
    const result = updateDoubleRuleSchema.safeParse({ recurrenceType: "FECHA" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "dates")).toBe(true);
    }
  });

  it("cambia recurrenceType a FECHA con dates: pasa", () => {
    const result = updateDoubleRuleSchema.safeParse({ recurrenceType: "FECHA", dates: [{ date: "2026-12-25" }] });
    expect(result.success).toBe(true);
  });
});
