import { describe, expect, it } from "vitest";
import { createShiftAssignmentSchema, shiftAssignmentWeekdaysSchema, updateShiftAssignmentSchema } from "./shiftAssignment.schemas";

const baseCreate = { employeeIds: ["11111111-1111-1111-1111-111111111111"], shiftTemplateId: "22222222-2222-2222-2222-222222222222" };

describe("createShiftAssignmentSchema — vigencia y weekdays (Etapa 8I)", () => {
  it("acepta effectiveFrom válido, sin effectiveTo (asignación abierta)", () => {
    const result = createShiftAssignmentSchema.safeParse({ ...baseCreate, effectiveFrom: "2026-01-01" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.effectiveTo).toBeUndefined();
  });

  it("acepta effectiveTo vacío (no enviado) sin rechazar el payload", () => {
    const result = createShiftAssignmentSchema.safeParse({ ...baseCreate, effectiveFrom: "2026-01-01", effectiveTo: null });
    expect(result.success).toBe(true);
  });

  it("rechaza effectiveTo menor que effectiveFrom", () => {
    const result = createShiftAssignmentSchema.safeParse({ ...baseCreate, effectiveFrom: "2026-06-01", effectiveTo: "2026-01-01" });
    expect(result.success).toBe(false);
  });

  it("acepta effectiveTo igual a effectiveFrom (rango de un solo día)", () => {
    const result = createShiftAssignmentSchema.safeParse({ ...baseCreate, effectiveFrom: "2026-01-01", effectiveTo: "2026-01-01" });
    expect(result.success).toBe(true);
  });

  it("rechaza sin effectiveFrom (obligatorio)", () => {
    const result = createShiftAssignmentSchema.safeParse(baseCreate);
    expect(result.success).toBe(false);
  });

  it("acepta weekdays válidos (0=domingo..6=sábado)", () => {
    const result = createShiftAssignmentSchema.safeParse({ ...baseCreate, effectiveFrom: "2026-01-01", weekdays: [1, 2, 3, 4, 5] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.weekdays).toEqual([1, 2, 3, 4, 5]);
  });

  it("sin weekdays, default a [] (todos los días)", () => {
    const result = createShiftAssignmentSchema.safeParse({ ...baseCreate, effectiveFrom: "2026-01-01" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.weekdays).toEqual([]);
  });

  it("rechaza weekdays fuera de rango (7 no existe, es 0-6)", () => {
    expect(createShiftAssignmentSchema.safeParse({ ...baseCreate, effectiveFrom: "2026-01-01", weekdays: [7] }).success).toBe(false);
  });

  it("rechaza weekdays negativos", () => {
    expect(createShiftAssignmentSchema.safeParse({ ...baseCreate, effectiveFrom: "2026-01-01", weekdays: [-1] }).success).toBe(false);
  });

  it("rechaza weekdays duplicados", () => {
    expect(createShiftAssignmentSchema.safeParse({ ...baseCreate, effectiveFrom: "2026-01-01", weekdays: [1, 1] }).success).toBe(false);
  });
});

describe("updateShiftAssignmentSchema — vigencia y weekdays opcionales", () => {
  it("acepta actualizar solo weekdays", () => {
    expect(updateShiftAssignmentSchema.safeParse({ weekdays: [0, 6] }).success).toBe(true);
  });

  it("acepta actualizar solo effectiveTo (cerrar vigencia)", () => {
    expect(updateShiftAssignmentSchema.safeParse({ effectiveTo: "2026-12-31" }).success).toBe(true);
  });

  it("rechaza effectiveTo menor que effectiveFrom cuando ambos vienen en el mismo payload", () => {
    expect(updateShiftAssignmentSchema.safeParse({ effectiveFrom: "2026-06-01", effectiveTo: "2026-01-01" }).success).toBe(false);
  });

  it("rechaza weekdays duplicados también en update", () => {
    expect(updateShiftAssignmentSchema.safeParse({ weekdays: [3, 3] }).success).toBe(false);
  });

  it("sigue rechazando un payload completamente vacío", () => {
    expect(updateShiftAssignmentSchema.safeParse({}).success).toBe(false);
  });
});

describe("shiftAssignmentWeekdaysSchema", () => {
  it("acepta array vacío", () => {
    expect(shiftAssignmentWeekdaysSchema.safeParse([]).success).toBe(true);
  });

  it("acepta los 7 días sin duplicados", () => {
    expect(shiftAssignmentWeekdaysSchema.safeParse([0, 1, 2, 3, 4, 5, 6]).success).toBe(true);
  });

  it("rechaza más de 7 elementos (con solo 7 valores posibles, 0-6, esto implica un duplicado)", () => {
    expect(shiftAssignmentWeekdaysSchema.safeParse([0, 1, 2, 3, 4, 5, 6, 0]).success).toBe(false);
  });
});
