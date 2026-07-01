type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

export function createTtlCache<T>(ttlMs: number) {
  const entries = new Map<string, CacheEntry<T>>();

  return {
    get(key: string) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },

    set(key: string, value: T) {
      entries.set(key, {
        expiresAt: Date.now() + ttlMs,
        value,
      });
    },

    clear() {
      entries.clear();
    },
  };
}
