import { describe, expect, it } from "vitest";
import source from "./HourConceptRulesPanel.tsx?raw";

describe("HourConceptRulesPanel — modelo aditivo 6E", () => {
  it("no muestra ni envía prioridad", () => {
    expect(source.toLowerCase()).not.toContain("prioridad");
    expect(source).not.toContain("priority");
  });

  it("explica que un concepto MANUAL no usa reglas automáticas", () => {
    expect(source).toContain('loadMode === "MANUAL"');
    expect(source).toContain("se carga manualmente desde la grilla futura");
  });

  it("mantiene desde, hasta, cruce de medianoche y estado", () => {
    expect(source).toContain("Hora desde");
    expect(source).toContain("Hora hasta");
    expect(source).toContain("Cruza medianoche");
    expect(source).toContain("Estado");
  });
});
