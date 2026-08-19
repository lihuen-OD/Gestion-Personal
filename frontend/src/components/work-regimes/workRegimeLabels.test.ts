import { describe, expect, it } from "vitest";
import {
  openShiftOverflowActionLabel,
  openShiftOverflowActionOptions,
  workRegimeKindLabel,
  workRegimeKindOptions,
  workRegimeStatusTone,
} from "./workRegimeLabels";

describe("workRegimeKindLabel — textos humanos, no enum crudo", () => {
  it("traduce cada valor de WorkRegimeKind a un texto legible", () => {
    expect(workRegimeKindLabel("TURNO_OBLIGATORIO")).toBe("Turno obligatorio");
    expect(workRegimeKindLabel("TURNO_FLEXIBLE")).toBe("Turno flexible");
    expect(workRegimeKindLabel("SIN_TURNO")).toBe("Sin turno obligatorio");
  });

  it("cubre exactamente los mismos valores que workRegimeKindOptions", () => {
    for (const kind of workRegimeKindOptions) {
      expect(workRegimeKindLabel(kind)).not.toBe(kind);
    }
  });
});

describe("openShiftOverflowActionLabel", () => {
  it("traduce ROLLOVER y ALERT_ONLY a texto humano", () => {
    expect(openShiftOverflowActionLabel("ROLLOVER")).toBe("Cierre automático");
    expect(openShiftOverflowActionLabel("ALERT_ONLY")).toBe("Solo alerta / revisión RRHH");
  });

  it("cubre exactamente los mismos valores que openShiftOverflowActionOptions", () => {
    for (const action of openShiftOverflowActionOptions) {
      expect(openShiftOverflowActionLabel(action)).not.toBe(action);
    }
  });
});

describe("workRegimeStatusTone — mapeo a badge visual", () => {
  it("ACTIVO -> success", () => {
    expect(workRegimeStatusTone("ACTIVO")).toBe("success");
  });

  it("INACTIVO -> neutral", () => {
    expect(workRegimeStatusTone("INACTIVO")).toBe("neutral");
  });
});
