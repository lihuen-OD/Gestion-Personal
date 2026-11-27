import { describe, expect, it } from "vitest";
import { expectedShiftPreviewQuerySchema } from "./shiftExpectedPreview.schemas";

const ROTATION = "11111111-1111-4111-8111-111111111111";

describe("expectedShiftPreviewQuerySchema", () => {
  it("normaliza paginación y acepta exactamente 42 días", () => {
    expect(expectedShiftPreviewQuerySchema.parse({ rotationId: ROTATION, from: "2026-11-01", to: "2026-12-12" })).toEqual({
      rotationId: ROTATION,
      from: "2026-11-01",
      to: "2026-12-12",
      page: 1,
      take: 25,
    });
  });

  it("rechaza rango invertido, 43 días, fechas inexistentes y take mayor a 100", () => {
    expect(expectedShiftPreviewQuerySchema.safeParse({ rotationId: ROTATION, from: "2026-11-02", to: "2026-11-01" }).success).toBe(false);
    expect(expectedShiftPreviewQuerySchema.safeParse({ rotationId: ROTATION, from: "2026-11-01", to: "2026-12-13" }).success).toBe(false);
    expect(expectedShiftPreviewQuerySchema.safeParse({ rotationId: ROTATION, from: "2026-02-30", to: "2026-03-01" }).success).toBe(false);
    expect(expectedShiftPreviewQuerySchema.safeParse({ rotationId: ROTATION, from: "2026-11-01", to: "2026-11-02", take: 101 }).success).toBe(false);
  });
});
