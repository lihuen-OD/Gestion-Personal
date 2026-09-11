import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { documentCategoriesRepository, invalidateDocumentCategoriesCache } from "./documentCategories.repository";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    documentCategory: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

const mockedPrisma = prisma as unknown as {
  documentCategory: { findMany: Mock; count: Mock; findUnique: Mock; create: Mock; update: Mock };
  $transaction: Mock;
};

beforeEach(() => {
  vi.clearAllMocks();
  invalidateDocumentCategoriesCache();
});

// Etapa 14H.6: no existía ningún test para este repositorio hasta esta
// etapa — agregado al corregir el $transaction de la rama filtrada (mismo
// antipatrón ya corregido en hourConcepts.repository.ts en 14H.5). La rama
// sin filtros usa el listCache en memoria (2min TTL, sin $transaction, sin
// cambios esta etapa) — se cubren ambas ramas para dejar documentado que
// sólo una tenía el problema.
describe("documentCategoriesRepository.findMany — rama filtrada, Etapa 14H.6", () => {
  it("con filtros activos, pagina con Promise.all([findMany, count]) — sin $transaction", async () => {
    mockedPrisma.documentCategory.findMany.mockResolvedValue([]);
    mockedPrisma.documentCategory.count.mockResolvedValue(0);

    await documentCategoriesRepository.findMany({ status: "ACTIVO", scope: "NOVEDAD", page: 1, take: 50 } as never);

    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedPrisma.documentCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "ACTIVO" }), skip: 0, take: 50 }),
    );
    expect(mockedPrisma.documentCategory.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "ACTIVO" }) }),
    );
  });

  it("arma el where con kind/scope/status/mandatory/expires/search", async () => {
    mockedPrisma.documentCategory.findMany.mockResolvedValue([]);
    mockedPrisma.documentCategory.count.mockResolvedValue(0);

    await documentCategoriesRepository.findMany({
      kind: "LEGAL",
      scope: "NOVEDAD",
      status: "ACTIVO",
      mandatory: true,
      expires: false,
      search: "dni",
      page: 1,
      take: 50,
    } as never);

    const call = mockedPrisma.documentCategory.findMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({
      kind: "LEGAL",
      status: "ACTIVO",
      scopes: { array_contains: "NOVEDAD" },
      rules: { path: ["expires"], equals: false },
    });
    expect(call.where.OR).toEqual(expect.arrayContaining([{ code: { contains: "dni", mode: "insensitive" } }]));
  });
});

describe("documentCategoriesRepository.findMany — rama sin filtros (listCache), sin cambios en 14H.6", () => {
  it("sin filtros, no usa $transaction ni pide count — pagina en memoria sobre el listCache", async () => {
    mockedPrisma.documentCategory.findMany.mockResolvedValue([{ id: "cat-1" }, { id: "cat-2" }]);

    const [page, total] = await documentCategoriesRepository.findMany({ page: 1, take: 50 } as never);

    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedPrisma.documentCategory.count).not.toHaveBeenCalled();
    expect(mockedPrisma.documentCategory.findMany).toHaveBeenCalledTimes(1);
    expect(total).toBe(2);
    expect(page).toHaveLength(2);
  });

  it("una segunda llamada sin filtros dentro del TTL reutiliza el listCache — no vuelve a pegarle a la base", async () => {
    mockedPrisma.documentCategory.findMany.mockResolvedValue([{ id: "cat-1" }]);

    await documentCategoriesRepository.findMany({ page: 1, take: 50 } as never);
    await documentCategoriesRepository.findMany({ page: 1, take: 50 } as never);

    expect(mockedPrisma.documentCategory.findMany).toHaveBeenCalledTimes(1);
  });

  // Etapa 14I.10 — diagnóstico de la doble capa de cache controller+
  // repository: `documentCategoriesReadCache` (controller, key =
  // `req.originalUrl`) trata `?page=1` y `?page=2` como 2 entradas DISTINTAS
  // (2 cache-miss), pero ambas caen acá en la misma rama "sin filtros" —
  // este test confirma que el `listCache` de repositorio SÍ las sirve a las
  // dos desde una única lectura real a la base (evidencia de que la doble
  // capa no es puramente redundante, ver docs/decisions/
  // DOUBLE_LAYER_CACHE_DIAGNOSTIC_14I10.md).
  it("páginas distintas de la MISMA lista sin filtros comparten el listCache — una sola lectura real a la base para ambas", async () => {
    mockedPrisma.documentCategory.findMany.mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({ id: `cat-${i}` })));

    await documentCategoriesRepository.findMany({ page: 1, take: 2 } as never);
    await documentCategoriesRepository.findMany({ page: 2, take: 2 } as never);

    expect(mockedPrisma.documentCategory.findMany).toHaveBeenCalledTimes(1);
  });
});
