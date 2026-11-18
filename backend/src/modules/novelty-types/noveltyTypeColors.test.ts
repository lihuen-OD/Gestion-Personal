import { describe, expect, it } from "vitest";
import { pickNoveltyUiColor } from "./noveltyTypeColors";
import { createNoveltyTypeSchema, NOVELTY_UI_COLORS, noveltyColorSchema } from "./noveltyTypes.schemas";

describe("paleta de Tipos de Novedad", () => {
  it("tiene 23 colores distintos y conserva los 15 nombres anteriores", () => {
    expect(NOVELTY_UI_COLORS).toHaveLength(23);
    expect(new Set(NOVELTY_UI_COLORS).size).toBe(23);
    for (const legacy of ["blue", "sky", "cyan", "teal", "emerald", "green", "lime", "amber", "orange", "red", "rose", "pink", "violet", "purple", "slate"]) {
      expect(noveltyColorSchema.safeParse(legacy).success).toBe(true);
    }
    expect(noveltyColorSchema.safeParse("#2563EB").success).toBe(false);
  });

  it("acepta 'navy' como color 23, al final de la paleta, sin mover los 22 anteriores", () => {
    expect(NOVELTY_UI_COLORS.at(-1)).toBe("navy");
    expect(NOVELTY_UI_COLORS.indexOf("navy")).toBe(22);
    expect(NOVELTY_UI_COLORS.slice(0, 22)).toEqual([
      "blue", "orange", "violet", "emerald", "red", "cyan", "fuchsia", "yellow", "pine", "pink", "indigo",
      "lime", "brown", "sky", "tangerine", "purple", "green", "rose", "slate", "amber", "magenta", "teal",
    ]);
    expect(noveltyColorSchema.safeParse("navy").success).toBe(true);
    expect(createNoveltyTypeSchema.parse({ name: "Tipo nuevo", kind: "OTRO", uiColor: "navy" }).uiColor).toBe("navy");
  });

  it("el alta sin color no fija uno por defecto: lo elige el repositorio", () => {
    const parsed = createNoveltyTypeSchema.parse({ name: "Tipo nuevo", kind: "OTRO" });
    expect(parsed.uiColor).toBeUndefined();
  });
});

describe("pickNoveltyUiColor", () => {
  it("sin tipos, el primero de la paleta", () => {
    expect(pickNoveltyUiColor([])).toBe("blue");
  });

  it("el primero no usado, en el orden de la paleta (nunca por nombre ni código)", () => {
    expect(pickNoveltyUiColor(["blue", "orange"])).toBe("violet");
    expect(pickNoveltyUiColor(["violet", "blue"])).toBe("orange");
  });

  it("con los 23 en uso, permite repetir: elige el menos usado", () => {
    const all = [...NOVELTY_UI_COLORS];
    expect(pickNoveltyUiColor(all)).toBe("blue");
    expect(pickNoveltyUiColor([...all, "blue", "orange"])).toBe("violet");
  });

  it("con los 22 colores anteriores en uso, asigna navy (el único libre)", () => {
    const previous = NOVELTY_UI_COLORS.filter((color) => color !== "navy");
    expect(pickNoveltyUiColor(previous)).toBe("navy");
    expect(pickNoveltyUiColor([...previous, "navy"])).toBe("blue");
  });

  it("ignora colores históricos fuera de la paleta", () => {
    expect(pickNoveltyUiColor(["indigo-old", "blue"])).toBe("orange");
  });
});
