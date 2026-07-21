import { describe, expect, it } from "vitest";
import { resolveCurrentLaborPeriod } from "./employeeStatusService";
import type { LaborMovement } from "../types";

function movement(type: "ALTA" | "BAJA", effectiveFrom: string, reason: string): LaborMovement {
  return {
    id: `${type}-${effectiveFrom}`,
    type,
    effectiveFrom,
    reason,
    observation: "",
    createdAt: `${effectiveFrom}T12:00:00.000Z`,
    createdByUserId: "test-user",
    createdByUserName: "Prueba",
  };
}

describe("resolveCurrentLaborPeriod", () => {
  it("does not carry a previous termination into a rehire period", () => {
    const result = resolveCurrentLaborPeriod([
      movement("ALTA", "2026-07-21", "Reingreso"),
      movement("BAJA", "2026-07-01", "Renuncia"),
      movement("ALTA", "2026-06-19", "Alta inicial"),
    ]);

    expect(result).toEqual({
      startDate: "2026-07-21",
      endDate: undefined,
      exitReason: undefined,
    });
  });

  it("uses the termination that belongs to the latest employment period", () => {
    const result = resolveCurrentLaborPeriod([
      movement("BAJA", "2026-08-31", "Fin de contrato"),
      movement("ALTA", "2026-07-21", "Reingreso"),
      movement("BAJA", "2026-07-01", "Renuncia"),
      movement("ALTA", "2026-06-19", "Alta inicial"),
    ]);

    expect(result).toEqual({
      startDate: "2026-07-21",
      endDate: "2026-08-31",
      exitReason: "Fin de contrato",
    });
  });
});
