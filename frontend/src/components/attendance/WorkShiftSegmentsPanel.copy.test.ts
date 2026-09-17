import { describe, expect, it } from "vitest";
import source from "./WorkShiftSegmentsPanel.tsx?raw";

describe("WorkShiftSegmentsPanel — sin lenguaje del modelo legacy de prioridad (Etapa 6R)", () => {
  it("no describe los tramos como competencia por prioridad", () => {
    expect(source.toLowerCase()).not.toContain("prioridad");
    expect(source).not.toContain("priority");
  });

  it("aclara que los tramos son evidencia técnica y no afectan Hora normal ni el total", () => {
    expect(source).toContain("evidencia técnica");
    expect(source).toContain("no modifican Hora normal ni el total trabajado");
  });

  it("explica que un tramo sin regla adicional es Hora normal y no requiere revisión", () => {
    expect(source).toContain("Los tramos sin regla adicional son Hora normal y no requieren revisión");
    expect(source).not.toContain("sin concepto compatible");
  });
});
