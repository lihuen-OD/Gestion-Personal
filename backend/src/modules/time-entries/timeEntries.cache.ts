import { createTtlCache } from "../../shared/cache/ttlCache";
import type { timeEntriesService } from "./timeEntries.service";

export const timeEntriesListCache = createTtlCache<Awaited<ReturnType<typeof timeEntriesService.list>>>(15_000);
export const timeEntriesSummaryCache = createTtlCache<Awaited<ReturnType<typeof timeEntriesService.summary>>>(20_000);
export const timeEntriesPeriodEmployeesCache = createTtlCache<Awaited<ReturnType<typeof timeEntriesService.periodEmployees>>>(20_000);

export function clearTimeEntriesReadCaches() {
  timeEntriesListCache.clear();
  timeEntriesSummaryCache.clear();
  timeEntriesPeriodEmployeesCache.clear();
}
