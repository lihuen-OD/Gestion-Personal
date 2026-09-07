import { createTtlCache } from "../../shared/cache/ttlCache";
import type { shiftAlertService } from "./shiftAlert.service";

// Etapa 14G.5: GET /shifts/alerts no tenía ninguna cache backend (a
// diferencia del resto de las listas operativas del módulo de Gestión
// horaria -- time-entries ya tiene 6, ver timeEntries.cache.ts). TTL 15s,
// mismo rango 10-20s ya usado por sus hermanas operativas
// (timeEntriesListCache/attendanceObservationsCache). Key scopeada por
// usuario+rol vía `userScopedCacheKey` (shiftAlert.controller.ts) -- el
// querystring completo (type, severity, status, search, before, take) ya
// forma parte de `originalUrl`, así que cada combinación de filtros de cada
// usuario es una entrada de cache distinta, nunca compartida entre usuarios
// ni entre scopes.
export const shiftAlertListCache = createTtlCache<Awaited<ReturnType<typeof shiftAlertService.list>>>(15_000);

export function clearShiftAlertReadCaches() {
  shiftAlertListCache.clear();
}
