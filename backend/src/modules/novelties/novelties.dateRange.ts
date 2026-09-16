export function noveltyCoversDay(
  novelty: { fromDate: Date; toDate: Date | null },
  noveltyType: { allowsDateRange: boolean },
  day: Date,
) {
  if (novelty.fromDate > day) return false;
  if (novelty.toDate) return novelty.toDate >= day;
  return noveltyType.allowsDateRange || novelty.fromDate.getTime() === day.getTime();
}
