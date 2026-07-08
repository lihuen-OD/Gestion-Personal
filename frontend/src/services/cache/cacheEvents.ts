import type { CacheFamily } from "./cachePolicy";

type CacheEventName = "updated" | "invalidated" | "cleared";

type CacheEvent = {
  family?: CacheFamily;
  reason: string;
};

type Listener = (event: CacheEvent) => void;

const listeners = new Map<CacheEventName, Set<Listener>>();

export function subscribeCacheEvent(name: CacheEventName, listener: Listener) {
  const bucket = listeners.get(name) || new Set<Listener>();
  bucket.add(listener);
  listeners.set(name, bucket);
  return () => {
    bucket.delete(listener);
  };
}

export function emitCacheEvent(name: CacheEventName, event: CacheEvent) {
  listeners.get(name)?.forEach((listener) => listener(event));
}

export function auditCacheEvent(name: CacheEventName, event: CacheEvent) {
  if (!import.meta.env.DEV) return;
  const family = event.family ? ` family=${event.family}` : "";
  console.info(`[cache] ${name}${family} reason=${event.reason}`);
}

