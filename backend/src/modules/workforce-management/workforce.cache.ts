import { createTtlCache } from "../../shared/cache/ttlCache";
import type { workforceService } from "./workforce.service";

// Etapa 9C: shiftTemplates()/doubleRules() son datos de configuración (RRHH
// los edita ocasionalmente) leídos en cada carga de sus pantallas — mismo
// patrón ya usado en dashboard/time-entries/novelties/audit/documents
// (backend/src/shared/cache/ttlCache.ts). Write paths verificados exhaustivos
// (grep de `.shiftTemplate.`/`.doubleHourRule.` en todo backend/src): sólo
// create/update/remove de cada uno, los 3 en workforce.service.ts, sin
// mutadores externos. No cachea calendarPreview() (endpoint distinto, ya
// tiene su propio refresh-tras-mutación en el frontend) ni el motor de
// horas (timeEntries.repository.ts consulta Prisma directo, nunca pasa por
// acá) — ninguno de los dos queda con datos stale por este cache.
const CACHE_TTL_MS = 30_000;

export const shiftTemplatesCache = createTtlCache<Awaited<ReturnType<typeof workforceService.shiftTemplates>>>(CACHE_TTL_MS);
export const doubleRulesCache = createTtlCache<Awaited<ReturnType<typeof workforceService.doubleRules>>>(CACHE_TTL_MS);

export function clearShiftTemplatesReadCache() {
  shiftTemplatesCache.clear();
}

export function clearDoubleRulesReadCache() {
  doubleRulesCache.clear();
}

// Etapa 14G.6: GET /workforce/notifications no tenía ninguna cache backend.
// TTL corto (10s, en el extremo más chico del rango 10-20s ya usado por el
// resto de las listas operativas) a propósito: los write paths de
// SystemNotification no son un conjunto cerrado (ver comentario en
// workforce.service.ts, notifications()), así que se acota la ventana de
// inconsistencia de "no ver una notificación nueva todavía" al mínimo
// razonable. Key scopeada por usuario+rol vía `userScopedCacheKey`
// (workforce.controller.ts) -- el querystring completo (status/page/take) ya
// forma parte de `originalUrl`, así que cada combinación de filtros de cada
// usuario es una entrada de cache distinta, nunca compartida entre usuarios.
export const notificationsListCache = createTtlCache<Awaited<ReturnType<typeof workforceService.notifications>>>(10_000);

export function clearNotificationsListCache() {
  notificationsListCache.clear();
}
