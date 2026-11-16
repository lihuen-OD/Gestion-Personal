import { NOVELTY_UI_COLORS } from "./noveltyTypes.schemas";

export type NoveltyUiColor = (typeof NOVELTY_UI_COLORS)[number];

/**
 * Color para un Tipo nuevo: el primero de la paleta que ningún tipo usa; si
 * los 22 están en uso, el menos repetido (primero en el orden de la paleta).
 * Nunca depende del nombre ni del código; la paleta no limita la cantidad de
 * tipos. Mismo criterio que frontend/src/utils/noveltyColor.ts.
 */
export function pickNoveltyUiColor(usedColors: readonly string[]): NoveltyUiColor {
  const counts = new Map<string, number>(NOVELTY_UI_COLORS.map((color) => [color, 0]));
  for (const color of usedColors) if (counts.has(color)) counts.set(color, counts.get(color)! + 1);
  let best: NoveltyUiColor = NOVELTY_UI_COLORS[0];
  for (const color of NOVELTY_UI_COLORS) if (counts.get(color)! < counts.get(best)!) best = color;
  return best;
}
