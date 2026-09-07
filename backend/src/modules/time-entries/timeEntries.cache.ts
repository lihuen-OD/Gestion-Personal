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
// Etapa 14G.3: TTL 15s — mismo rango 10-20s que sus hermanas de este mismo
// archivo (attendanceSummaryCache 10s, timeEntriesListCache 15s). A
// diferencia de attendanceSummary (refrescada por un poll de 60s en
// AttendancePage.tsx), observations NO tiene ningún poll automático — sólo
// se refetchea por una acción real del usuario (cambiar fecha/tipo/
// búsqueda, que ya cambia `req.originalUrl` y por lo tanto la key) o tras
// resolver una observación (que invalida vía clearTimeEntriesReadCaches()).
// Key scopeada por `userScopedCacheKey` (userId:role:originalUrl) — el
// querystring completo (fecha, tipo, búsqueda, reviewStatus, before, take)
// ya forma parte de `originalUrl`, así que cada combinación de filtros de
// cada usuario tiene su propia entrada, nunca compartida entre usuarios ni
// entre distintos filtros del mismo usuario.
export const attendanceObservationsCache = createTtlCache<Awaited<ReturnType<typeof timeEntriesService.attendanceObservations>>>(15_000);

export function clearTimeEntriesReadCaches() {
  timeEntriesListCache.clear();
  timeEntriesSummaryCache.clear();
  timeEntriesPeriodEmployeesCache.clear();
  attendanceSummaryCache.clear();
  homeSummaryCache.clear();
  attendanceObservationsCache.clear();
}
