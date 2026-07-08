import { describe, expect, it } from "vitest";
import { createLruMemoryCache } from "./lruMemoryCache";

describe("createLruMemoryCache", () => {
  it("evicts the least recently used entry when the limit is exceeded", () => {
    const cache = createLruMemoryCache(2);
    cache.set({ key: "a", family: "org-structure", schemaVersion: 1, expiresAt: 1, updatedAt: 1, value: "A" });
    cache.set({ key: "b", family: "org-structure", schemaVersion: 1, expiresAt: 1, updatedAt: 1, value: "B" });
    cache.get("a");
    cache.set({ key: "c", family: "org-structure", schemaVersion: 1, expiresAt: 1, updatedAt: 1, value: "C" });

    expect(cache.get("a")?.value).toBe("A");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")?.value).toBe("C");
  });
});

