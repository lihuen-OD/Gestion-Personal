// Etapa 15L.2C (docs/decisions/NOVELTY_TYPE_CONSUMER_MIGRATION_15L2C.md):
// migrado a allowsDateRange -- antes leía allowsDateTo (legacy, sigue
// existiendo y sincronizado 1:1 por noveltyTypes.sync.ts desde 15L.2A).
export function noveltyCoversDay(
  novelty: { fromDate: Date; toDate: Date | null },
  noveltyType: { allowsDateRange: boolean },
  day: Date,
) {
  if (novelty.fromDate > day) return false;
  if (novelty.toDate) return novelty.toDate >= day;
  return noveltyType.allowsDateRange || novelty.fromDate.getTime() === day.getTime();
}
