import { createTtlCache } from "../../shared/cache/ttlCache";
import type { timeEntriesService } from "./timeEntries.service";

export const timeEntriesListCache = createTtlCache<Awaited<ReturnType<typeof timeEntriesService.list>>>(15_000);
export const timeEntriesSummaryCache = createTtlCache<Awaited<ReturnType<typeof timeEntriesService.summary>>>(20_000);
export const timeEntriesPeriodEmployeesCache = createTtlCache<Awaited<ReturnType<typeof timeEntriesService.periodEmployees>>>(20_000);
export const attendanceSummaryCache = createTtlCache<Awaited<ReturnType<typeof timeEntriesService.attendanceSummary>>>(10_000);
// Etapa 14G.2: mismo TTL que timeEntriesSummaryCache (20s) — home-summary es
// un contador tipo "para hacer hoy", misma categoría "operational" que
// summary (PERFORMANCE_STANDARDS.md §2.C: 10-20s backend). Key scopeada por
// usuario+rol vía `userScopedCacheKey` (timeEntries.controller.ts) — nunca
// comparte datos entre usuarios aunque compartan sector/empresa, porque cada
// `req.user.id` es una entrada de cache distinta.
export const homeSummaryCache = createTtlCache<Awaited<ReturnType<typeof timeEntriesService.homeSummary>>>(20_000);

export function clearTimeEntriesReadCaches() {
  timeEntriesListCache.clear();
  timeEntriesSummaryCache.clear();
  timeEntriesPeriodEmployeesCache.clear();
  attendanceSummaryCache.clear();
  homeSummaryCache.clear();
}
