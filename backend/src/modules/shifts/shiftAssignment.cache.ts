import { createTtlCache } from "../../shared/cache/ttlCache";
import type { shiftAssignmentService } from "./shiftAssignment.service";

// Etapa 14H.3: GET /shifts/assignments/summary no tenía ninguna cache backend
// (a diferencia de shiftTemplates/doubleRules, ver workforce.cache.ts) — el
// journey 14H.1/14H.2 detectó 2 requests duplicadas (StrictMode) al entrar a
// Turnos, cada una real (391-1134ms, agregación `groupBy` sin antipatrón de
// query, sólo latencia real de Neon). Mismo patrón que shiftTemplatesCache/
// doubleRulesCache (Etapa 9C): TTL 30s (dato "de configuración leído en cada
// carga de pantalla", no operativo de alta frecuencia). Key scopeada por
// usuario+rol vía `userScopedCacheKey` (shiftAssignment.controller.ts) —
// `summary()` usa `employeeAccessWhere(user)`, así que dos roles distintos
// (ej. RRHH vs Supervisión) pueden ver conteos distintos y nunca deben
// compartir la misma entrada de cache. Write paths verificados exhaustivos
// (grep de `prisma.shiftAssignment.` en todo backend/src): sólo
// create/reEnable/update/remove, las 5 llamadas dentro de
// shiftAssignment.repository.ts, alcanzadas únicamente por
// shiftAssignmentService.assign/update/remove (shiftAssignment.controller.ts).
const CACHE_TTL_MS = 30_000;

export const shiftAssignmentSummaryCache = createTtlCache<Awaited<ReturnType<typeof shiftAssignmentService.summary>>>(CACHE_TTL_MS);

export function clearShiftAssignmentSummaryCache() {
  shiftAssignmentSummaryCache.clear();
}
