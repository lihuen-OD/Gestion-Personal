import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { invalidateSalaryCategoriesCache, salaryCategoriesRepository } from "./salaryCategories.repository";

// Etapa 14I.3: el módulo `salary-categories` no tenía ningún archivo de test
// hasta esta etapa (confirmado en docs/decisions/
// BACKEND_PERFORMANCE_INFRASTRUCTURE_DIAGNOSTIC_14I1.md). Se agrega cobertura
// mínima al migrar el listCache manual al helper compartido
// (backend/src/shared/cache/repositoryListCache.ts) — ver docs/decisions/
// BACKEND_REPOSITORY_LIST_CACHE_HELPER_14I3.md. La rama CON filtros sigue
// usando `prisma.$transaction([...])` sin cambios (P2, sin caller real que
// pase filtros — ver 14I.1/14I.2) — estos tests confirman que esa rama no se
// tocó, no la corrigen.
vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    salaryCategory: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

const mockedPrisma = prisma as unknown as {
  salaryCategory: { findMany: Mock; count: Mock; findUnique: Mock; create: Mock; update: Mock };
  $transaction: Mock;
};

beforeEach(() => {
  vi.clearAllMocks();
  invalidateSalaryCategoriesCache();
});

describe("salaryCategoriesRepository.findMany — rama con filtros (sin cambios en 14I.3)", () => {
  it("con filtros activos, sigue usando $transaction([findMany, count]) — no se tocó esta rama", async () => {
    mockedPrisma.salaryCategory.findMany.mockResolvedValue([]);
    mockedPrisma.salaryCategory.count.mockResolvedValue(0);

    await salaryCategoriesRepository.findMany({ family: "Administrativo", page: 1, take: 50 } as never);

    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.salaryCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ family: "Administrativo" }), skip: 0, take: 50 }),
    );
  });

  it("arma el where con family/status/search", async () => {
    mockedPrisma.salaryCategory.findMany.mockResolvedValue([]);
    mockedPrisma.salaryCategory.count.mockResolvedValue(0);

    await salaryCategoriesRepository.findMany({ family: "Operativo", status: "ACTIVO", search: "jefe", page: 1, take: 50 } as never);

    const call = mockedPrisma.salaryCategory.findMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({ family: "Operativo", status: "ACTIVO" });
    expect(call.where.OR).toEqual(expect.arrayContaining([{ name: { contains: "jefe", mode: "insensitive" } }]));
  });

  it("con filtros activos, nunca usa el listCache — cada llamada vuelve a pedir a la base", async () => {
    mockedPrisma.salaryCategory.findMany.mockResolvedValue([]);
    mockedPrisma.salaryCategory.count.mockResolvedValue(0);

    await salaryCategoriesRepository.findMany({ status: "ACTIVO", page: 1, take: 50 } as never);
    await salaryCategoriesRepository.findMany({ status: "ACTIVO", page: 1, take: 50 } as never);

    expect(mockedPrisma.salaryCategory.findMany).toHaveBeenCalledTimes(2);
  });
});

describe("salaryCategoriesRepository.findMany — rama sin filtros (listCache vía repositoryListCache), Etapa 14I.3", () => {
  it("sin filtros, no usa $transaction ni pide count — pagina en memoria sobre el listCache", async () => {
    mockedPrisma.salaryCategory.findMany.mockResolvedValue([{ id: "cat-1" }, { id: "cat-2" }]);

    const [page, total] = await salaryCategoriesRepository.findMany({ page: 1, take: 50 } as never);

    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedPrisma.salaryCategory.count).not.toHaveBeenCalled();
    expect(mockedPrisma.salaryCategory.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
    expect(mockedPrisma.salaryCategory.findMany).toHaveBeenCalledTimes(1);
    expect(total).toBe(2);
    expect(page).toHaveLength(2);
  });

  it("una segunda llamada sin filtros dentro del TTL reutiliza el listCache — no vuelve a pegarle a la base", async () => {
    mockedPrisma.salaryCategory.findMany.mockResolvedValue([{ id: "cat-1" }]);

    await salaryCategoriesRepository.findMany({ page: 1, take: 50 } as never);
    await salaryCategoriesRepository.findMany({ page: 1, take: 50 } as never);

    expect(mockedPrisma.salaryCategory.findMany).toHaveBeenCalledTimes(1);
  });

  it("pagina en memoria sobre la data cacheada (skip/take de la query, no de la consulta a la base)", async () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({ id: `cat-${index}` }));
    mockedPrisma.salaryCategory.findMany.mockResolvedValue(rows);

    const [page, total] = await salaryCategoriesRepository.findMany({ page: 2, take: 2 } as never);

    expect(page).toEqual(rows.slice(2, 4));
    expect(total).toBe(5);
  });

  it("respeta el orderBy existente: status asc, order asc, name asc", async () => {
    mockedPrisma.salaryCategory.findMany.mockResolvedValue([]);

    await salaryCategoriesRepository.findMany({ page: 1, take: 50 } as never);

    const call = mockedPrisma.salaryCategory.findMany.mock.calls[0]![0];
    expect(call.orderBy).toEqual([{ status: "asc" }, { order: "asc" }, { name: "asc" }]);
  });

  it("invalidateSalaryCategoriesCache() limpia el listCache — la siguiente llamada vuelve a pedir a la base", async () => {
    mockedPrisma.salaryCategory.findMany.mockResolvedValueOnce([{ id: "cat-1" }]).mockResolvedValueOnce([{ id: "cat-2" }]);

    await salaryCategoriesRepository.findMany({ page: 1, take: 50 } as never);
    invalidateSalaryCategoriesCache();
    const [page] = await salaryCategoriesRepository.findMany({ page: 1, take: 50 } as never);

    expect(mockedPrisma.salaryCategory.findMany).toHaveBeenCalledTimes(2);
    expect(page).toEqual([{ id: "cat-2" }]);
  });
});

describe("salaryCategoriesRepository.findById/create/update", () => {
  it("findById delega en findUnique por id", async () => {
    mockedPrisma.salaryCategory.findUnique.mockResolvedValue({ id: "cat-1" });

    await salaryCategoriesRepository.findById("cat-1");

    expect(mockedPrisma.salaryCategory.findUnique).toHaveBeenCalledWith({ where: { id: "cat-1" } });
  });

  it("create mapea sólo los campos definidos", async () => {
    mockedPrisma.salaryCategory.create.mockResolvedValue({ id: "cat-1" });

    await salaryCategoriesRepository.create({ name: "Jefe", family: "Operativo", order: 1, status: "ACTIVO" } as never);

    expect(mockedPrisma.salaryCategory.create).toHaveBeenCalledWith({
      data: { name: "Jefe", family: "Operativo", order: 1, status: "ACTIVO" },
    });
  });

  it("update no toca campos ausentes del input", async () => {
    mockedPrisma.salaryCategory.update.mockResolvedValue({ id: "cat-1" });

    await salaryCategoriesRepository.update("cat-1", { name: "Nuevo nombre" } as never);

    expect(mockedPrisma.salaryCategory.update).toHaveBeenCalledWith({ where: { id: "cat-1" }, data: { name: "Nuevo nombre" } });
  });
});
