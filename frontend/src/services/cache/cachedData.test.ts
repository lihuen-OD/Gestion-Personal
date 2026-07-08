import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedData, clearAllAppCaches, invalidateCacheFamily } from "./cachedData";
import type { CachePolicy } from "./cachePolicy";

const policy: CachePolicy = {
  family: "org-structure",
  ttlMs: 1_000,
  persist: false,
  sensitive: false,
  schemaVersion: 99,
};

function request<T>(requestKey: string, fetcher: () => Promise<T>) {
  return cachedData({
    requestKey,
    policy,
    fetcher,
    validate: () => true,
  });
}

describe("cachedData", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-08T10:00:00.000Z"));
    await clearAllAppCaches("test setup");
  });

  afterEach(async () => {
    await clearAllAppCaches("test teardown");
    vi.useRealTimers();
  });

  it("fetches and stores data on cache miss", async () => {
    const fetcher = vi.fn().mockResolvedValue({ value: "fresh" });

    await expect(request("miss", fetcher)).resolves.toEqual({ value: "fresh" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns cached data on cache hit", async () => {
    const fetcher = vi.fn().mockResolvedValue({ value: "fresh" });

    await request("hit", fetcher);
    await expect(request("hit", fetcher)).resolves.toEqual({ value: "fresh" });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns stale data immediately and revalidates in the background after TTL", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ value: "old" })
      .mockResolvedValueOnce({ value: "new" });

    await request("stale", fetcher);
    vi.advanceTimersByTime(1_001);

    await expect(request("stale", fetcher)).resolves.toEqual({ value: "old" });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await expect(request("stale", fetcher)).resolves.toEqual({ value: "new" });
  });

  it("invalidates entries manually by family", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ value: "before" })
      .mockResolvedValueOnce({ value: "after" });

    await request("invalidate", fetcher);
    await invalidateCacheFamily("org-structure", "unit test");
    await expect(request("invalidate", fetcher)).resolves.toEqual({ value: "after" });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("falls back to stale data when revalidation fails offline", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ value: "cached" })
      .mockRejectedValueOnce(new Error("network offline"));

    await request("offline", fetcher);
    vi.advanceTimersByTime(1_001);

    await expect(request("offline", fetcher)).resolves.toEqual({ value: "cached" });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });
});

