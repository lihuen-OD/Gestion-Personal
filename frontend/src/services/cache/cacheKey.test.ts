import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCacheKey } from "./cacheKey";

const input = { family: "employees", schemaVersion: 1, requestKey: "GET:/employees?page=1" };

async function keyFor(user: Record<string, unknown>) {
  sessionStorage.setItem("losod_user", JSON.stringify(user));
  return buildCacheKey(input);
}

describe("cache identity", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("keeps the same key for the same user and scope", async () => {
    const user = { id: "user-1", role: "Nivel 2", company: "company-1", sector: "sector-1" };
    await expect(keyFor(user)).resolves.toBe(await keyFor(user));
  });

  it.each([
    ["user", { id: "user-2", role: "Nivel 2", company: "company-1", sector: "sector-1" }],
    ["role", { id: "user-1", role: "Nivel 3", company: "company-1", sector: "sector-1" }],
    ["company", { id: "user-1", role: "Nivel 2", company: "company-2", sector: "sector-1" }],
    ["sector", { id: "user-1", role: "Nivel 2", company: "company-1", sector: "sector-2" }],
  ])("changes the key when %s scope changes", async (_label, changed) => {
    const original = await keyFor({ id: "user-1", role: "Nivel 2", company: "company-1", sector: "sector-1" });
    await expect(keyFor(changed)).resolves.not.toBe(original);
  });
});
