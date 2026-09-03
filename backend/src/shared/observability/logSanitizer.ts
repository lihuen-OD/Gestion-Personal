/**
 * Etapa 14B.2 — sanitización de paths para el logging de performance.
 *
 * Reglas (ver docs/decisions/PERFORMANCE_LOGGING_14B2.md):
 * - Nunca se loguea el query string. No hay un allowlist de params "seguros"
 *   mantenido acá — algunos filtros (ej. `search=`) pueden llevar nombres de
 *   empleados u otro texto parcialmente identificatorio, así que se descarta
 *   el query string completo en vez de intentar filtrarlo campo por campo.
 * - Los IDs reales (UUID) se normalizan a `:id` para no inflar la cardinalidad
 *   de los logs/agregados y para no dejar identificadores reales sueltos en
 *   líneas de log que puedan terminar en un sistema de agregación con más
 *   retención o acceso más amplio que la base de datos misma.
 */

const UUID_SEGMENT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function sanitizeRequestPath(rawUrl: string): string {
  const pathname = rawUrl.split("?")[0];
  if (!pathname) return "/";
  return pathname.replace(UUID_SEGMENT, ":id");
}
