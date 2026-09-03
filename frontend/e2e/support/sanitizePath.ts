/**
 * Etapa 14B.3 — misma política de sanitización que
 * `backend/src/shared/observability/logSanitizer.ts` (Etapa 14B.2), reimplementada
 * acá porque frontend y backend son paquetes npm separados (no se comparte código
 * fuente entre ambos). Si se toca una, revisar la otra.
 *
 * Nunca se conserva el query string (puede llevar términos de búsqueda u otro
 * texto parcialmente identificatorio) ni un ID real (se normaliza a ":id").
 */

const UUID_SEGMENT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function sanitizeRequestPath(rawUrl: string): string {
  let pathname: string;
  try {
    pathname = new URL(rawUrl).pathname;
  } catch {
    pathname = rawUrl.split("?")[0] || "/";
  }
  if (!pathname) return "/";
  return pathname.replace(UUID_SEGMENT, ":id");
}
