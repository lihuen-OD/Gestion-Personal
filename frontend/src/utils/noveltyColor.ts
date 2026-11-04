import type { NoveltyUiColor } from "../types/noveltyType.types";

export const noveltyUiColors = [
  "blue",
  "sky",
  "cyan",
  "teal",
  "emerald",
  "green",
  "lime",
  "amber",
  "orange",
  "red",
  "rose",
  "pink",
  "violet",
  "purple",
  "slate",
] as const satisfies readonly NoveltyUiColor[];

const noveltyColorSet = new Set<string>(noveltyUiColors);

export function fallbackNoveltyUiColor(seed: string): NoveltyUiColor {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash + seed.charCodeAt(index) * (index + 1)) % noveltyUiColors.length;
  }
  return noveltyUiColors[hash];
}

export function resolveNoveltyUiColor(color: string | undefined, seed: string): NoveltyUiColor {
  return color && noveltyColorSet.has(color) ? color as NoveltyUiColor : fallbackNoveltyUiColor(seed);
}

export function noveltyColorClass(color: string | undefined, seed: string) {
  return `novelty-color-${resolveNoveltyUiColor(color, seed)}`;
}

// Fuera de la paleta del catálogo a propósito: ningún tipo puede configurarse
// así, y no se confunde con una novedad realmente violeta o gris.
export const NOVELTY_MIXED_CLASS = "novelty-mixed";

/**
 * Marca de un día de la grilla mensual, que puede juntar varias novedades
 * (el backend manda color y tipo sólo si son compartidos). Un solo tipo:
 * mismo criterio que el catálogo, incluido el fallback por id de un color
 * histórico inválido. Varios tipos del mismo color válido: ese color.
 * Colores distintos o no atribuibles a un tipo: estilo neutro propio.
 */
export function dayNoveltyColorClass(novelty: { uiColor?: string | null; noveltyTypeId?: string | null }) {
  if (novelty.uiColor && novelty.noveltyTypeId) return noveltyColorClass(novelty.uiColor, novelty.noveltyTypeId);
  if (novelty.uiColor && noveltyColorSet.has(novelty.uiColor)) return `novelty-color-${novelty.uiColor}`;
  return NOVELTY_MIXED_CLASS;
}
