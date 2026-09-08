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

// Etapa 14G.8: GET /workforce/closures y GET /workforce/corrections no
// tenían ninguna cache backend. TTL 15s (rango 10-20s ya usado por el resto
// de las listas operativas). A diferencia de `notificationsListCache`
// (14G.6) y `shiftAlertListCache` (14G.5) -- donde el conjunto de write
// paths no era cerrado -- acá SÍ es un conjunto cerrado y enumerable con
// confianza: los únicos 6 lugares de todo el backend que escriben
// `MonthlyTimeClosure`/`TimeCorrectionRequest` son las 6 funciones de este
// mismo archivo (submitClosures/approveClosures/returnClosure/
// createCorrection/approveCorrection/rejectCorrection), confirmado con grep
// exhaustivo. Por eso una sola `clearMonthlyClosuresReadCaches()`, llamada
// desde las 6, cubre el 100% de los write paths reales -- sin ningún hueco
// de invalidación aceptado como riesgo (a diferencia de los 2 casos
// anteriores). Key scopeada por usuario+rol vía `userScopedCacheKey`
// (workforce.controller.ts) -- el querystring de `closures` (`period`) ya
// forma parte de `originalUrl`, así que cada período de cada usuario es una
// entrada distinta; `corrections` no tiene query params, así que su key es
// estable por usuario+rol.
export const closuresCache = createTtlCache<Awaited<ReturnType<typeof workforceService.closures>>>(15_000);
export const correctionsCache = createTtlCache<Awaited<ReturnType<typeof workforceService.corrections>>>(15_000);

export function clearMonthlyClosuresReadCaches() {
  closuresCache.clear();
  correctionsCache.clear();
}
