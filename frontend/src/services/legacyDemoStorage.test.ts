import { describe, expect, it } from "vitest";
import { cleanupLegacyDemoStorage } from "./legacyDemoStorage";

function memoryStorage(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, value); },
    values,
  };
}

describe("cleanupLegacyDemoStorage", () => {
  it("removes only legacy demo domains and is idempotent", () => {
    const storage = memoryStorage({ losod_demo_employees: "[]", losod_geo_cache_x: "geo", losod_user: "user" });
    expect(cleanupLegacyDemoStorage(storage)).toBe(1);
    expect(storage.values.has("losod_demo_employees")).toBe(false);
    expect(storage.values.get("losod_geo_cache_x")).toBe("geo");
    expect(storage.values.get("losod_user")).toBe("user");
    expect(cleanupLegacyDemoStorage(storage)).toBe(0);
  });
});
