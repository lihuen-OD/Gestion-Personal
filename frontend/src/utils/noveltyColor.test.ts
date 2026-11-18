import { describe, expect, it } from "vitest";
import { mapNoveltyTypeFromApi } from "../services/api/noveltyTypeApiService";
import { dayNoveltyColorClass, NOVELTY_MIXED_CLASS, noveltyColorClass, noveltyUiColorHex, noveltyUiColors, pickNoveltyUiColor } from "./noveltyColor";

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
    // El tipo de la API no admite "neon": sólo puede venir de datos viejos.
    const legacyApiType = { id, code: "LEG", name: "Permiso legacy", uiColor: "neon" } as unknown as Parameters<typeof mapNoveltyTypeFromApi>[0];
    const catalogColor = mapNoveltyTypeFromApi(legacyApiType).uiColor;

    expect(dayNoveltyColorClass({ uiColor: "neon", noveltyTypeId: id })).toBe(`novelty-color-${catalogColor}`);
  });

  it("colores distintos, o un inválido sin tipo único, usan el estilo neutro propio, fuera de la paleta", () => {
    expect(dayNoveltyColorClass({ uiColor: null, noveltyTypeId: null })).toBe(NOVELTY_MIXED_CLASS);
    expect(dayNoveltyColorClass({ uiColor: "neon", noveltyTypeId: null })).toBe(NOVELTY_MIXED_CLASS);
    expect(NOVELTY_MIXED_CLASS).not.toMatch(/^novelty-color-/);
  });
});

describe("paleta de 23 colores", () => {
  it("son 23 colores con hex distinto, en el orden pedido, y conserva los 15 nombres anteriores", () => {
    expect(noveltyUiColors).toHaveLength(23);
    expect(new Set(Object.values(noveltyUiColorHex).map((hex) => hex.toLowerCase())).size).toBe(23);
    expect(noveltyUiColors.slice(0, 3).map((color) => noveltyUiColorHex[color])).toEqual(["#2563EB", "#F97316", "#7C3AED"]);
    for (const legacy of ["blue", "sky", "cyan", "teal", "emerald", "green", "lime", "amber", "orange", "red", "rose", "pink", "violet", "purple", "slate"]) {
      // El color persistido se usa tal cual (nunca el fallback por id).
      expect(noveltyColorClass(legacy, "cualquier-id")).toBe(`novelty-color-${legacy}`);
    }
  });

  it("navy es el color 23, al final, con hex #1E3A8A y su propia clase", () => {
    expect(noveltyUiColors.at(-1)).toBe("navy");
    expect(noveltyUiColors.indexOf("navy")).toBe(22);
    expect(noveltyUiColorHex.navy).toBe("#1E3A8A");
    expect(noveltyColorClass("navy", "cualquier-id")).toBe("novelty-color-navy");
  });
});

describe("pickNoveltyUiColor", () => {
  it("elige el primer color no usado, en el orden de la paleta", () => {
    expect(pickNoveltyUiColor([])).toBe("blue");
    expect(pickNoveltyUiColor(["blue", "orange"])).toBe("violet");
    expect(pickNoveltyUiColor(["orange"])).toBe("blue");
  });

  it("con los 23 en uso permite repetir: el menos usado", () => {
    expect(pickNoveltyUiColor([...noveltyUiColors])).toBe("blue");
    expect(pickNoveltyUiColor([...noveltyUiColors, "blue"])).toBe("orange");
  });

  it("con los 22 colores anteriores en uso, el siguiente es navy", () => {
    expect(pickNoveltyUiColor(noveltyUiColors.filter((color) => color !== "navy"))).toBe("navy");
  });

  it("ignora colores fuera de la paleta", () => {
    expect(pickNoveltyUiColor(["neon", "blue"])).toBe("orange");
  });
});
