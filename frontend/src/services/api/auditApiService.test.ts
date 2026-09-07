import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";
import { clearAllAppCaches } from "../cache";
import { auditApiService, auditFieldChanges } from "./auditApiService";

vi.mock("./apiClient", () => ({ apiRequest: vi.fn() }));

describe("auditFieldChanges", () => {
  it("extracts persisted employee changes for the section history", () => {
    expect(auditFieldChanges(
      { firstName: "Prueba", civilStatus: "Soltero", address: { city: "Luján" } },
      { firstName: "Prueba", civilStatus: "Casado", address: { city: "Open Door" } },
    )).toEqual([
      { field: "civilStatus", label: "Estado civil", previous: "Soltero", next: "Casado" },
      { field: "address.city", label: "Localidad", previous: "Luján", next: "Open Door" },
    ]);
  });

  it("does not create rows for unchanged values", () => {
    expect(auditFieldChanges(
      { gender: "Masculino", nationality: "Argentina" },
      { gender: "Masculino", nationality: "Argentina" },
    )).toEqual([]);
  });
});

// Etapa 14F.2: antes de esta etapa, auditApiService.list llamaba apiRequest
// directo sin ningún dedupe/cache frontend — en StrictMode (DashboardPage
// monta el effect dos veces) esto generaba 2 requests idénticos a
// /audit?take=5 por mount, confirmado en el journey de 14F.1. El backend ya
// cachea 15s (auditListCache) pero eso no evita el duplicado del lado del
// cliente. Ver docs/decisions/INITIAL_APP_LANDING_OPTIMIZATION_14F2.md.
describe("auditApiService.list/getAll — dedupe/cache frontend (Etapa 14F.2)", () => {
  function response(count: number) {
    return {
      data: Array.from({ length: count }, (_, index) => ({
        id: `audit-${index}`,
        action: "CREATE",
        entity: "Employee",
        entityId: null,
        description: "-",
        createdAt: "2026-09-07T10:00:00.000Z",
        user: { name: "Ana", role: "Nivel 1 - RRHH" },
      })),
      meta: { total: count, page: 1, pageSize: count, hasMore: false },
    };
  }

  beforeEach(async () => {
    // mockReset (no clearAllMocks): evita que un valor
    // mockResolvedValueOnce/mockRejectedValueOnce sin consumir en un test se
    // filtre al siguiente (clearAllMocks no vacía esa cola).
    vi.mocked(apiRequest).mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T10:00:00.000Z"));
    await clearAllAppCaches("test setup");
  });

  afterEach(async () => {
    await clearAllAppCaches("test teardown");
    vi.useRealTimers();
  });

  it("dos llamadas concurrentes con el mismo take generan un solo request real", async () => {
    vi.mocked(apiRequest).mockResolvedValue(response(5));

    const [a, b] = await Promise.all([auditApiService.getAll({ take: 5 }), auditApiService.getAll({ take: 5 })]);

    expect(a).toHaveLength(5);
    expect(b).toHaveLength(5);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("take=5 y take=10 usan cache keys distintas — no comparten resultado", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce(response(5)).mockResolvedValueOnce(response(10));

    await expect(auditApiService.getAll({ take: 5 })).resolves.toHaveLength(5);
    await expect(auditApiService.getAll({ take: 10 })).resolves.toHaveLength(10);

    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("una segunda llamada con los mismos filtros dentro del TTL usa cache", async () => {
    vi.mocked(apiRequest).mockResolvedValue(response(5));

    await auditApiService.getAll({ take: 5 });
    await auditApiService.getAll({ take: 5 });

    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("un error no queda cacheado permanentemente — la siguiente llamada reintenta", async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error("network error")).mockResolvedValueOnce(response(5));

    await expect(auditApiService.getAll({ take: 5 })).rejects.toThrow("network error");
    await expect(auditApiService.getAll({ take: 5 })).resolves.toHaveLength(5);

    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("mantiene el shape de respuesta (items + meta) en auditApiService.list", async () => {
    vi.mocked(apiRequest).mockResolvedValue(response(2));

    const result = await auditApiService.list({ take: 2 });

    expect(result.meta).toEqual({ total: 2, page: 1, pageSize: 2, hasMore: false });
    expect(result.items[0]).toMatchObject({ id: "audit-0", action: "Alta", entity: "Employee" });
  });

  it("no arma la cache key con datos sensibles — sólo path+query, sin tokens", async () => {
    vi.mocked(apiRequest).mockResolvedValue(response(1));

    await auditApiService.getAll({ take: 1 });

    const [calledPath] = vi.mocked(apiRequest).mock.calls[0]!;
    expect(calledPath).toBe("/audit?page=1&take=1");
    expect(calledPath).not.toContain("token");
    expect(calledPath).not.toContain("Authorization");
  });
});
