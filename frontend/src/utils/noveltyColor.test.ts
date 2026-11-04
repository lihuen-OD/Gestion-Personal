import { describe, expect, it } from "vitest";
import { mapNoveltyTypeFromApi } from "../services/api/noveltyTypeApiService";
import { dayNoveltyColorClass, NOVELTY_MIXED_CLASS } from "./noveltyColor";

// Marca de novedad de un día de la grilla mensual: el backend manda uiColor y
// noveltyTypeId sólo si los comparten todas las novedades del día.
describe("dayNoveltyColorClass", () => {
  it("un solo tipo con color válido usa ese color", () => {
    expect(dayNoveltyColorClass({ uiColor: "teal", noveltyTypeId: "nt-vacaciones" })).toBe("novelty-color-teal");
  });

  it("varios tipos con el mismo color válido usan ese color", () => {
    expect(dayNoveltyColorClass({ uiColor: "amber", noveltyTypeId: null })).toBe("novelty-color-amber");
  });

  it("un violeta configurado sigue siendo violeta: no es el fallback de nada", () => {
    expect(dayNoveltyColorClass({ uiColor: "purple", noveltyTypeId: "nt-capacitacion" })).toBe("novelty-color-purple");
    expect(dayNoveltyColorClass({ uiColor: null, noveltyTypeId: null })).not.toBe("novelty-color-purple");
  });

  it("un color histórico inválido de un solo tipo se resuelve igual que en el catálogo (fallback por id)", () => {
    const id = "53598fbf-bdc1-44d6-9167-1e9f8fa52bd4";
    // El tipo de la API ya no admite "magenta": sólo puede venir de datos viejos.
    const legacyApiType = { id, code: "LEG", name: "Permiso legacy", uiColor: "magenta" } as unknown as Parameters<typeof mapNoveltyTypeFromApi>[0];
    const catalogColor = mapNoveltyTypeFromApi(legacyApiType).uiColor;

    expect(dayNoveltyColorClass({ uiColor: "magenta", noveltyTypeId: id })).toBe(`novelty-color-${catalogColor}`);
  });

  it("colores distintos, o un inválido sin tipo único, usan el estilo neutro propio, fuera de la paleta", () => {
    expect(dayNoveltyColorClass({ uiColor: null, noveltyTypeId: null })).toBe(NOVELTY_MIXED_CLASS);
    expect(dayNoveltyColorClass({ uiColor: "magenta", noveltyTypeId: null })).toBe(NOVELTY_MIXED_CLASS);
    expect(NOVELTY_MIXED_CLASS).not.toMatch(/^novelty-color-/);
  });
});
