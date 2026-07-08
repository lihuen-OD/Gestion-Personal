import type { CacheFamily } from "./cachePolicy";
import { recordCacheMetric } from "./cacheMetrics";

export type MemoryCacheEntry<T = unknown> = {
  key: string;
  family: CacheFamily;
  schemaVersion: number;
  expiresAt: number;
  updatedAt: number;
  value: T;
};

export function createLruMemoryCache(maxEntries = 100) {
  const entries = new Map<string, MemoryCacheEntry>();

  function touch(key: string, entry: MemoryCacheEntry) {
    entries.delete(key);
    entries.set(key, entry);
  }

  function evictIfNeeded() {
    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value as string | undefined;
      if (!oldestKey) return;
      entries.delete(oldestKey);
      recordCacheMetric("eviction");
    }
  }

  return {
    get<T>(key: string) {
      const entry = entries.get(key) as MemoryCacheEntry<T> | undefined;
      if (!entry) return undefined;
      touch(key, entry);
      return entry;
    },

    set<T>(entry: MemoryCacheEntry<T>) {
      entries.set(entry.key, entry);
      evictIfNeeded();
    },

    delete(key: string) {
      entries.delete(key);
    },

    invalidateFamily(family: CacheFamily) {
      for (const [key, entry] of entries) {
        if (entry.family === family) entries.delete(key);
      }
    },

    clear() {
      entries.clear();
    },

    size() {
      return entries.size;
    },
  };
}

