type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type CacheStats = {
  hits: number;
  misses: number;
  evictions: number;
  sets: number;
};

export function createTtlCache<T>(ttlMs: number, options: { maxEntries?: number } = {}) {
  const entries = new Map<string, CacheEntry<T>>();
  const maxEntries = options.maxEntries || 200;
  const stats: CacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    sets: 0,
  };

  function touch(key: string, entry: CacheEntry<T>) {
    entries.delete(key);
    entries.set(key, entry);
  }

  function evictIfNeeded() {
    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value as string | undefined;
      if (!oldestKey) return;
      entries.delete(oldestKey);
      stats.evictions += 1;
    }
  }

  return {
    get(key: string) {
      const entry = entries.get(key);
      if (!entry) {
        stats.misses += 1;
        return undefined;
      }
      if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        stats.misses += 1;
        return undefined;
      }
      stats.hits += 1;
      touch(key, entry);
      return entry.value;
    },

    set(key: string, value: T) {
      entries.set(key, {
        expiresAt: Date.now() + ttlMs,
        value,
      });
      stats.sets += 1;
      evictIfNeeded();
    },

    clear() {
      entries.clear();
    },

    stats() {
      const reads = stats.hits + stats.misses;
      return {
        ...stats,
        entries: entries.size,
        hitRate: reads ? Number((stats.hits / reads).toFixed(3)) : 0,
      };
    },
  };
}
