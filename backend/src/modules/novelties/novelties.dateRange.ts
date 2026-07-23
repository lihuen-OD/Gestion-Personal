export function noveltyCoversDay(
  novelty: { fromDate: Date; toDate: Date | null },
  noveltyType: { allowsDateTo: boolean },
  day: Date,
) {
  if (novelty.fromDate > day) return false;
  if (novelty.toDate) return novelty.toDate >= day;
  return noveltyType.allowsDateTo || novelty.fromDate.getTime() === day.getTime();
}
