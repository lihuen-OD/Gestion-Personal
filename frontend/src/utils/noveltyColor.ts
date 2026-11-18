import type { NoveltyUiColor } from "../types/noveltyType.types";

// Paleta fija de 23 colores (decisión del usuario, 2026-11-16; "navy" agregado
// al final el 2026-11-17), en el orden en que se muestran y se asignan. Misma lista que el backend
// (novelty-types/noveltyTypes.schemas.ts). Los 15 nombres anteriores son 15
// de estos 23: el color persistido de cada tipo se conserva. El hex es la
// fuente de los tonos de styles.css (fondo, borde y texto derivados).
export const noveltyUiColorHex = {
  blue: "#2563EB",
  orange: "#F97316",
  violet: "#7C3AED",
  emerald: "#059669",
  red: "#DC2626",
  cyan: "#0891B2",
  fuchsia: "#C026D3",
  yellow: "#CA8A04",
  pine: "#0F766E",
  pink: "#DB2777",
  indigo: "#4338CA",
  lime: "#65A30D",
  brown: "#92400E",
  sky: "#0284C7",
  tangerine: "#EA580C",
  purple: "#9333EA",
  green: "#15803D",
  rose: "#9F1239",
  slate: "#475569",
  amber: "#D97706",
  magenta: "#A21CAF",
  teal: "#0D9488",
  navy: "#1E3A8A",
} as const satisfies Record<NoveltyUiColor, string>;

export const noveltyUiColors = Object.keys(noveltyUiColorHex) as NoveltyUiColor[];

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

/**
 * Color para un Tipo nuevo: el primero de la paleta que ningún tipo usa; si
 * están todos en uso, el menos repetido. Nunca depende del nombre ni del
 * código, y la paleta no limita la cantidad de tipos. Mismo criterio que el
 * backend (novelty-types/noveltyTypeColors.ts).
 */
export function pickNoveltyUiColor(usedColors: readonly string[]): NoveltyUiColor {
  const counts = new Map<string, number>(noveltyUiColors.map((color) => [color, 0]));
  for (const color of usedColors) if (counts.has(color)) counts.set(color, counts.get(color)! + 1);
  let best = noveltyUiColors[0]!;
  for (const color of noveltyUiColors) if (counts.get(color)! < counts.get(best)!) best = color;
  return best;
}
