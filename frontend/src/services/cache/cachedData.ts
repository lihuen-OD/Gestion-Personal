import { buildCacheKey } from "./cacheKey";
import { auditCacheEvent, emitCacheEvent } from "./cacheEvents";
import type { CacheFamily, CachePolicy } from "./cachePolicy";
import { recordCacheMetric } from "./cacheMetrics";
import { indexedDbCacheStore } from "./indexedDbCacheStore";
import { createLruMemoryCache, type MemoryCacheEntry } from "./lruMemoryCache";

const memoryCache = createLruMemoryCache(100);
const pendingRevalidations = new Map<string, Promise<unknown>>();

type CachedRequestInput<T> = {
  requestKey: string;
  policy: CachePolicy;
  fetcher: () => Promise<T>;
  validate: (value: T) => boolean;
};

function isFresh(entry: MemoryCacheEntry) {
  return entry.expiresAt > Date.now();
}

async function readCached<T>(key: string, policy: CachePolicy) {
  const memoryEntry = memoryCache.get<T>(key);
  if (memoryEntry?.schemaVersion === policy.schemaVersion) return memoryEntry;

  if (!policy.persist) return undefined;
  const persistedEntry = await indexedDbCacheStore.get<T>(key);
  if (!persistedEntry || persistedEntry.schemaVersion !== policy.schemaVersion) return undefined;
  memoryCache.set(persistedEntry);
  return persistedEntry;
}

async function writeCached<T>(key: string, policy: CachePolicy, value: T) {
  const entry: MemoryCacheEntry<T> = {
    key,
    family: policy.family,
    schemaVersion: policy.schemaVersion,
    expiresAt: Date.now() + policy.ttlMs,
    updatedAt: Date.now(),
    value,
  };
  memoryCache.set(entry);
  if (policy.persist && !policy.sensitive) {
    await indexedDbCacheStore.set(entry);
  }
  emitCacheEvent("updated", { family: policy.family, reason: "revalidation" });
}

function revalidate<T>(key: string, input: CachedRequestInput<T>) {
  const existing = pendingRevalidations.get(key);
  if (existing) return existing as Promise<T>;

  recordCacheMetric("revalidation");
  const request = input.fetcher()
    .then(async (value) => {
      if (!input.validate(value)) throw new Error(`Invalid cache payload for ${input.policy.family}`);
      await writeCached(key, input.policy, value);
      return value;
    })
    .finally(() => pendingRevalidations.delete(key));

  pendingRevalidations.set(key, request);
  return request;
}

export async function cachedData<T>(input: CachedRequestInput<T>) {
  const key = await buildCacheKey({
    family: input.policy.family,
    schemaVersion: input.policy.schemaVersion,
    requestKey: input.requestKey,
  });
  const cached = await readCached<T>(key, input.policy);

  if (cached && isFresh(cached)) {
    recordCacheMetric("hit");
    return cached.value;
  }

  if (cached) {
    recordCacheMetric("staleHit");
    revalidate(key, input).catch(() => undefined);
    return cached.value;
  }

  recordCacheMetric("miss");
  try {
    return await revalidate(key, input);
  } catch (error) {
    const fallback = await readCached<T>(key, input.policy);
    if (fallback) return fallback.value;
    throw error;
  }
}

export async function invalidateCacheFamily(family: CacheFamily, reason: string) {
  memoryCache.invalidateFamily(family);
  await indexedDbCacheStore.invalidateFamily(family);
  recordCacheMetric("invalidate");
  auditCacheEvent("invalidated", { family, reason });
  emitCacheEvent("invalidated", { family, reason });
}

export async function clearAllAppCaches(reason: string) {
  memoryCache.clear();
  await indexedDbCacheStore.clear();
  recordCacheMetric("clear");
  auditCacheEvent("cleared", { reason });
  emitCacheEvent("cleared", { reason });
}

