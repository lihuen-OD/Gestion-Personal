import { describe, expect, it, vi, beforeEach } from "vitest";
import { createRepositoryListCache } from "./repositoryListCache";

describe("createRepositoryListCache — Etapa 14I.3", () => {
  const TTL = 120_000;
  const T0 = 1_700_000_000_000;

  it("primera llamada: ejecuta el loader y devuelve su valor exacto (misma referencia)", async () => {
    const cache = createRepositoryListCache<string[]>(TTL);
    const value = ["a", "b"];
    const loader = vi.fn().mockResolvedValue(value);

    const result = await cache.getOrLoad(loader, T0);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(result).toBe(value);
  });

  it("cache hit dentro del TTL: no vuelve a invocar el loader", async () => {
    const cache = createRepositoryListCache<number[]>(TTL);
    const loader = vi.fn().mockResolvedValue([1, 2, 3]);

    await cache.getOrLoad(loader, T0);
    const second = await cache.getOrLoad(loader, T0 + TTL - 1);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(second).toEqual([1, 2, 3]);
  });

  it("cache miss al expirar el TTL: vuelve a invocar el loader en el instante exacto de expiración (now >= expiresAt)", async () => {
    const cache = createRepositoryListCache<number[]>(TTL);
    const loader = vi.fn().mockResolvedValueOnce([1]).mockResolvedValueOnce([2]);

    const first = await cache.getOrLoad(loader, T0);
    const second = await cache.getOrLoad(loader, T0 + TTL);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(first).toEqual([1]);
    expect(second).toEqual([2]);
  });

  it("clear() invalida — la siguiente llamada vuelve a invocar el loader aunque el TTL no haya vencido", async () => {
    const cache = createRepositoryListCache<number[]>(TTL);
    const loader = vi.fn().mockResolvedValueOnce([1]).mockResolvedValueOnce([2]);

    await cache.getOrLoad(loader, T0);
    cache.clear();
    const afterClear = await cache.getOrLoad(loader, T0 + 1);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(afterClear).toEqual([2]);
  });

  it("llamadas concurrentes con hit ya resuelto: preservan el valor exacto sin re-invocar el loader", async () => {
    const cache = createRepositoryListCache<{ id: string }[]>(TTL);
    const value = [{ id: "row-1" }];
    const loader = vi.fn().mockResolvedValue(value);

    await cache.getOrLoad(loader, T0);
    const [a, b, c] = await Promise.all([
      cache.getOrLoad(loader, T0 + 1),
      cache.getOrLoad(loader, T0 + 2),
      cache.getOrLoad(loader, T0 + 3),
    ]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(a).toBe(value);
    expect(b).toBe(value);
    expect(c).toBe(value);
  });

  it("sin loader que ejecutar (ninguna llamada hecha): clear() no rompe nada", () => {
    const cache = createRepositoryListCache<number[]>(TTL);
    expect(() => cache.clear()).not.toThrow();
  });

  it("dos instancias del helper son independientes entre sí (sin estado compartido global)", async () => {
    const cacheA = createRepositoryListCache<string>(TTL);
    const cacheB = createRepositoryListCache<string>(TTL);
    const loaderA = vi.fn().mockResolvedValue("A");
    const loaderB = vi.fn().mockResolvedValue("B");

    await cacheA.getOrLoad(loaderA, T0);
    cacheA.clear();
    const stillCached = await cacheB.getOrLoad(loaderB, T0);

    expect(loaderB).toHaveBeenCalledTimes(1);
    expect(stillCached).toBe("B");
  });

  it("sin `now` explícito, usa Date.now() real por defecto (uso productivo)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      const cache = createRepositoryListCache<number[]>(TTL);
      const loader = vi.fn().mockResolvedValue([1]);

      await cache.getOrLoad(loader);
      vi.setSystemTime(T0 + TTL - 1);
      await cache.getOrLoad(loader);
      expect(loader).toHaveBeenCalledTimes(1);

      vi.setSystemTime(T0 + TTL);
      await cache.getOrLoad(loader);
      expect(loader).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
