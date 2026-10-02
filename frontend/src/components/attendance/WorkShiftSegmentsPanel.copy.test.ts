import { describe, expect, it } from "vitest";
import source from "./WorkShiftSegmentsPanel.tsx?raw";

describe("WorkShiftSegmentsPanel — sin lenguaje del modelo legacy de prioridad (Etapa 6R)", () => {
  it("no describe los tramos como competencia por prioridad", () => {
    expect(source.toLowerCase()).not.toContain("prioridad");
    expect(source).not.toContain("priority");
  });

  // docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md: un concepto dentro de la
  // jornada clasifica horas base, no suma al total trabajado.
  it("aclara que los tramos son evidencia técnica y que un concepto dentro de la jornada no suma al total", () => {
    expect(source).toContain("evidencia técnica");
    expect(source).toContain("no suma horas al total trabajado");
    expect(source).not.toContain("no modifican Hora normal");
  });

  it("explica que un tramo sin regla adicional queda como horas normales y no requiere revisión", () => {
    expect(source).toContain("Los tramos sin regla adicional quedan como horas normales y no requieren revisión");
    expect(source).not.toContain("sin concepto compatible");
  });
});
