import type { Prisma } from "@prisma/client";

/**
 * Fechas de una novedad (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §6.3):
 * `toDate` nulo es SIEMPRE un único día, `fromDate`, para cualquier tipo.
 * `allowsDateRange` dice que el tipo PUEDE abarcar varias fechas, nunca que un
 * `toDate` vacío sea un rango abierto. Única definición para todo lector.
 */
export function noveltyCoversDay(novelty: { fromDate: Date; toDate: Date | null }, day: Date) {
  return novelty.fromDate <= day && (novelty.toDate ?? novelty.fromDate) >= day;
}

/** `where` de Prisma: novedades cuyo [fromDate, toDate ?? fromDate] toca [start, end). */
export function noveltyOverlapsRangeWhere(start: Date, end: Date): Prisma.NoveltyWhereInput {
  return {
    fromDate: { lt: end },
    OR: [{ toDate: { gte: start } }, { toDate: null, fromDate: { gte: start } }],
  };
}
