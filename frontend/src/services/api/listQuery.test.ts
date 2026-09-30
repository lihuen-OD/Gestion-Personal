import { describe, expect, it, vi } from "vitest";
import { appendSortParams, collectAllPages, ListTooLargeError, MAX_COLLECTED_PAGES } from "./listQuery";

describe("appendSortParams", () => {
  it("sin orden elegido no manda nada (el backend aplica su orden de negocio default)", () => {
    const params = new URLSearchParams({ page: "1" });
    appendSortParams(params, null);
    expect(params.toString()).toBe("page=1");
  });

  it("manda sortBy/sortOrder del orden elegido", () => {
    const params = new URLSearchParams({ page: "1" });
    appendSortParams(params, { key: "lastName", direction: "desc" });
    expect(params.toString()).toBe("page=1&sortBy=lastName&sortOrder=desc");
  });
});

describe("collectAllPages — listado completo explícito, sin truncado silencioso", () => {
  it("sigue meta.hasMore página por página y conserva los filtros del path", async () => {
    const fetchPage = vi.fn(async (path: string) => {
      const page = Number(new URL(path, "http://x").searchParams.get("page"));
      return { data: [`fila-${page}`], meta: { hasMore: page < 3 } };
    });

    const rows = await collectAllPages("/users?take=200&status=ACTIVO", fetchPage);

    expect(rows).toEqual(["fila-1", "fila-2", "fila-3"]);
    expect(fetchPage.mock.calls.map(([path]) => path)).toEqual([
      "/users?take=200&status=ACTIVO&page=1",
      "/users?take=200&status=ACTIVO&page=2",
      "/users?take=200&status=ACTIVO&page=3",
    ]);
  });

  it("un endpoint sin meta se trata como una sola página", async () => {
    const fetchPage = vi.fn(async () => ({ data: [1, 2] }));
    await expect(collectAllPages("/catalogo", fetchPage)).resolves.toEqual([1, 2]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("si el catálogo supera el tope de páginas falla de forma visible en vez de devolver una lista recortada", async () => {
    const fetchPage = vi.fn(async () => ({ data: [1], meta: { hasMore: true } }));
    await expect(collectAllPages("/users?take=200", fetchPage)).rejects.toBeInstanceOf(ListTooLargeError);
    expect(fetchPage).toHaveBeenCalledTimes(MAX_COLLECTED_PAGES);
  });
});
