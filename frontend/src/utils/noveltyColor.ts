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
