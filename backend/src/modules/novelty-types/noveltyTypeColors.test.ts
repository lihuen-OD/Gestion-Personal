import { describe, expect, it } from "vitest";
import { pickNoveltyUiColor } from "./noveltyTypeColors";
import { createNoveltyTypeSchema, NOVELTY_UI_COLORS, noveltyColorSchema } from "./noveltyTypes.schemas";

describe("paleta de Tipos de Novedad", () => {
  it("tiene 22 colores distintos y conserva los 15 nombres anteriores", () => {
    expect(NOVELTY_UI_COLORS).toHaveLength(22);
    expect(new Set(NOVELTY_UI_COLORS).size).toBe(22);
    for (const legacy of ["blue", "sky", "cyan", "teal", "emerald", "green", "lime", "amber", "orange", "red", "rose", "pink", "violet", "purple", "slate"]) {
      expect(noveltyColorSchema.safeParse(legacy).success).toBe(true);
    }
    expect(noveltyColorSchema.safeParse("#2563EB").success).toBe(false);
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

  it("con los 22 en uso, permite repetir: elige el menos usado", () => {
    const all = [...NOVELTY_UI_COLORS];
    expect(pickNoveltyUiColor(all)).toBe("blue");
    expect(pickNoveltyUiColor([...all, "blue", "orange"])).toBe("violet");
  });

  it("ignora colores históricos fuera de la paleta", () => {
    expect(pickNoveltyUiColor(["indigo-old", "blue"])).toBe("orange");
  });
});
