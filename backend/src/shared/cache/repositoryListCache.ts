/**
 * Etapa 14I.3: extrae la "Forma B" de cache que 5 repositorios (positions,
 * hour-concepts, novelty-types, document-categories, salary-categories)
 * copiaban a mano, letra por letra: una única entrada en memoria (sin key,
 * sin scope de usuario — catálogos globales), TTL fijo, invalidación total
 * explícita. No reemplaza `createTtlCache` (backend/src/shared/cache/
 * ttlCache.ts) — ese es multi-key, pensado para responses de controller
 * (`req.originalUrl`/`id` como key); este es de una sola entrada, pensado
 * para la rama "sin filtros" de un repositorio. Deliberadamente mínimo (sin
 * `shouldCache` interno, sin `get`/`set` separados): en los 5 usos reales,
 * la decisión de "cachear o no" ya la toma el repositorio ANTES de llamar
 * acá (rama `hasActiveFilters`) — agregar esa lógica adentro del helper
 * sería una abstracción sin caller real. Ver docs/decisions/
 * BACKEND_REPOSITORY_LIST_CACHE_HELPER_14I3.md.
 */
export function createRepositoryListCache<T>(ttlMs: number) {
  let entry: { value: T; expiresAt: number } | null = null;

  return {
    /**
     * Devuelve el valor cacheado si sigue vigente; si no hay entrada o venció,
     * ejecuta `loader()` una sola vez, guarda el resultado y lo devuelve.
     * `now` es inyectable (default `Date.now()`) sólo para tests con reloj
     * controlado — nunca lo pasa ningún caller productivo.
     */
    async getOrLoad(loader: () => Promise<T>, now: number = Date.now()): Promise<T> {
      if (!entry || now >= entry.expiresAt) {
        const value = await loader();
        entry = { value, expiresAt: now + ttlMs };
      }
      return entry.value;
    },

    /** Invalidación total — misma semántica que los `listCache = null` que reemplaza. */
    clear() {
      entry = null;
    },
  };
}
