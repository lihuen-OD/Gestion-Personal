import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { invalidateNoveltyTypesCache, noveltyTypesRepository } from "./noveltyTypes.repository";
import type { ListNoveltyTypesQuery } from "./noveltyTypes.schemas";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    noveltyType: { findMany: vi.fn(), count: vi.fn(), findUniqueOrThrow: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

const mockedPrisma = prisma as unknown as {
  noveltyType: { findMany: Mock; count: Mock; findUniqueOrThrow: Mock };
  $transaction: Mock;
};

function baseQuery(overrides: Partial<ListNoveltyTypesQuery> = {}): ListNoveltyTypesQuery {
  return { page: 1, take: 100, ...overrides } as ListNoveltyTypesQuery;
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateNoveltyTypesCache();
});

// Etapa 14H.8: findMany no tenía ningún test dedicado hasta esta etapa —
// agregado al corregir el $transaction que usaba la rama con filtros. Ningún
// caller real del frontend ejercita hoy esta rama (confirmado por grep sobre
// noveltyTypeApiService.getAll()), pero el endpoint sigue siendo API pública
// validada (GET /novelty-types?kind=...) — ver noveltyTypes.repository.ts.
describe("noveltyTypesRepository.findMany — Etapa 14H.8", () => {
  it("con al menos un filtro real: pagina con Promise.all([findMany, count]) — sin $transaction", async () => {
    mockedPrisma.noveltyType.findMany.mockResolvedValue([{ id: "nt-1", name: "Ausencia" }]);
    mockedPrisma.noveltyType.count.mockResolvedValue(1);

    const [items, total] = await noveltyTypesRepository.findMany(baseQuery({ page: 2, take: 10, kind: "AUSENCIA" }));

    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedPrisma.noveltyType.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
    expect(mockedPrisma.noveltyType.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.any(Object) }));
    expect(items).toEqual([{ id: "nt-1", name: "Ausencia" }]);
    expect(total).toBe(1);
  });

  it("arma el where con kind/origin/status/exportsToFinnegans/search", async () => {
    mockedPrisma.noveltyType.findMany.mockResolvedValue([]);
    mockedPrisma.noveltyType.count.mockResolvedValue(0);

    await noveltyTypesRepository.findMany(
      baseQuery({ kind: "LICENCIA", origin: "FINNEGANS", status: "ACTIVO", exportsToFinnegans: true, search: "vacaciones" }),
    );

    const call = mockedPrisma.noveltyType.findMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({ kind: "LICENCIA", origin: "FINNEGANS", status: "ACTIVO", exportsToFinnegans: true });
    expect(call.where.OR).toEqual(expect.arrayContaining([{ code: { contains: "vacaciones", mode: "insensitive" } }]));
  });

  it("sin filtros: usa el listCache en memoria, nunca $transaction ni una query de count separada", async () => {
    mockedPrisma.noveltyType.findMany.mockResolvedValue([{ id: "nt-1" }, { id: "nt-2" }]);

    const [items, total] = await noveltyTypesRepository.findMany(baseQuery({ page: 1, take: 25 }));

    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedPrisma.noveltyType.count).not.toHaveBeenCalled();
    expect(items).toEqual([{ id: "nt-1" }, { id: "nt-2" }]);
    expect(total).toBe(2);
  });

  it("sin filtros, segunda llamada dentro del TTL: reusa el listCache sin volver a golpear la base", async () => {
    mockedPrisma.noveltyType.findMany.mockResolvedValue([{ id: "nt-1" }]);

    await noveltyTypesRepository.findMany(baseQuery());
    await noveltyTypesRepository.findMany(baseQuery());

    expect(mockedPrisma.noveltyType.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("noveltyTypesRepository.findById", () => {
  it("usa findUniqueOrThrow con el include completo (finnegansLinks)", async () => {
    mockedPrisma.noveltyType.findUniqueOrThrow.mockResolvedValue({ id: "nt-1" });

    await noveltyTypesRepository.findById("nt-1");

    const call = mockedPrisma.noveltyType.findUniqueOrThrow.mock.calls.at(0)?.[0];
    expect(call).toEqual({ where: { id: "nt-1" }, include: { finnegansLinks: { orderBy: [{ priority: "asc" }, { code: "asc" }] } } });
  });

  it("propaga el rechazo (P2025) cuando el tipo de novedad no existe", async () => {
    mockedPrisma.noveltyType.findUniqueOrThrow.mockRejectedValue(new Error("not found"));

    await expect(noveltyTypesRepository.findById("nt-inexistente")).rejects.toThrow();
  });
});
