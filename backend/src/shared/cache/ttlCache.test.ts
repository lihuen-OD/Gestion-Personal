import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createTtlCache } from "./ttlCache";

/**
 * Etapa 14I.7 — `ttlCache.ts` es el helper compartido detrás de ~34 caches
 * backend (8 archivos `*.cache.ts` + 7 controllers inline) y nunca había
 * tenido un test propio (a diferencia de `createRepositoryListCache`, que sí
 * tiene el suyo desde 14I.3 — mismo criterio de reloj controlado, adaptado a
 * que acá `get()`/`set()` usan `Date.now()` internamente sin `now`
 * inyectable, así que se controla con `vi.useFakeTimers()`.
 */
describe("createTtlCache — Etapa 14I.7", () => {
  const TTL = 30_000;
  const T0 = 1_700_000_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("get() antes de cualquier set(): devuelve undefined (miss)", () => {
    const cache = createTtlCache<string>(TTL);
    expect(cache.get("k1")).toBeUndefined();
  });

  it("set() + get() dentro del TTL: devuelve exactamente el valor guardado", () => {
    const cache = createTtlCache<{ id: string }>(TTL);
    const value = { id: "v1" };
    cache.set("k1", value);

    expect(cache.get("k1")).toBe(value);
  });

  it("expira después del TTL: get() vuelve a ser miss en el instante exacto (expiresAt <= now)", () => {
    const cache = createTtlCache<string>(TTL);
    cache.set("k1", "v1");

    vi.setSystemTime(T0 + TTL - 1);
    expect(cache.get("k1")).toBe("v1"); // todavía vigente, 1ms antes de expirar

    vi.setSystemTime(T0 + TTL);
    expect(cache.get("k1")).toBeUndefined(); // expira exactamente al llegar al TTL
  });

  it("clear() borra todas las entradas", () => {
    const cache = createTtlCache<string>(TTL);
    cache.set("k1", "v1");
    cache.set("k2", "v2");

    cache.clear();

    expect(cache.get("k1")).toBeUndefined();
    expect(cache.get("k2")).toBeUndefined();
  });

  it("respeta keys distintas: cada key devuelve su propio valor, sin cruzarse", () => {
    const cache = createTtlCache<string>(TTL);
    cache.set("k1", "v1");
    cache.set("k2", "v2");

    expect(cache.get("k1")).toBe("v1");
    expect(cache.get("k2")).toBe("v2");
  });

  it("sobrescribir una key existente actualiza el valor Y reinicia su expiración", () => {
    const cache = createTtlCache<string>(TTL);
    cache.set("k1", "v1");

    vi.setSystemTime(T0 + TTL - 1);
    cache.set("k1", "v2"); // nueva expiración: (T0+TTL-1) + TTL, no la original

    vi.setSystemTime(T0 + TTL); // la entrada ORIGINAL ya habría expirado acá
    expect(cache.get("k1")).toBe("v2"); // pero la sobrescrita sigue vigente
  });

  it("dos instancias del helper no comparten estado entre sí", () => {
    const cacheA = createTtlCache<string>(TTL);
    const cacheB = createTtlCache<string>(TTL);

    cacheA.set("k1", "from-a");

    expect(cacheB.get("k1")).toBeUndefined();
    expect(cacheA.get("k1")).toBe("from-a");
  });

  it("sólo soporta invalidación total: no expone delete/evict de una key puntual, sólo clear() de todas (Etapa 14I.1 §6, design note)", () => {
    const cache = createTtlCache<string>(TTL);
    const cacheAsRecord = cache as unknown as Record<string, unknown>;

    expect(cacheAsRecord.delete).toBeUndefined();
    expect(cacheAsRecord.evict).toBeUndefined();
    expect(cacheAsRecord.remove).toBeUndefined();
    expect(cacheAsRecord.invalidate).toBeUndefined();
    expect(typeof cache.clear).toBe("function");
  });

  it("stats() refleja hits/misses/sets acumulados y hitRate", () => {
    const cache = createTtlCache<string>(TTL);
    cache.set("k1", "v1");
    cache.get("k1"); // hit
    cache.get("k1"); // hit
    cache.get("k2"); // miss

    const stats = cache.stats();

    expect(stats.sets).toBe(1);
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.entries).toBe(1);
    expect(stats.hitRate).toBeCloseTo(2 / 3);
  });

  it("respeta maxEntries: al superar el límite, evict la entrada menos usada recientemente (no la que se acaba de pedir)", () => {
    const cache = createTtlCache<string>(TTL, { maxEntries: 2 });
    cache.set("k1", "v1");
    cache.set("k2", "v2");
    cache.get("k1"); // toca k1: ahora k2 es la más vieja sin uso reciente
    cache.set("k3", "v3"); // supera maxEntries: evict la más vieja (k2)

    expect(cache.get("k2")).toBeUndefined();
    expect(cache.get("k1")).toBe("v1");
    expect(cache.get("k3")).toBe("v3");
    expect(cache.stats().evictions).toBe(1);
  });
});
