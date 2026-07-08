type CacheMetricName = "hit" | "miss" | "staleHit" | "revalidation" | "eviction" | "invalidate" | "clear";

const counters: Record<CacheMetricName, number> = {
  hit: 0,
  miss: 0,
  staleHit: 0,
  revalidation: 0,
  eviction: 0,
  invalidate: 0,
  clear: 0,
};

export function recordCacheMetric(name: CacheMetricName, count = 1) {
  counters[name] += count;
}

export function getCacheMetrics() {
  const totalReads = counters.hit + counters.miss + counters.staleHit;
  return {
    ...counters,
    totalReads,
    hitRate: totalReads ? Number(((counters.hit + counters.staleHit) / totalReads).toFixed(3)) : 0,
  };
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  Object.defineProperty(window, "__APP_CACHE_STATS__", {
    value: getCacheMetrics,
    configurable: true,
  });
}
