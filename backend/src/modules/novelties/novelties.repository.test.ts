import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { noveltiesRepository } from "./novelties.repository";
import type { ListNoveltiesQuery } from "./novelties.schemas";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    novelty: { findMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

const mockedPrisma = prisma as unknown as {
  novelty: { findMany: Mock; count: Mock };
  $transaction: Mock;
};

function baseQuery(overrides: Partial<ListNoveltiesQuery> = {}): ListNoveltiesQuery {
  return { page: 1, take: 100, ...overrides } as ListNoveltiesQuery;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// Etapa 14I.2: findMany no tenía ningún test dedicado hasta esta etapa —
// agregado al corregir el $transaction que hasta ahora usaba SIEMPRE (único
// camino de findMany, sin rama alternativa). Caller real confirmado:
// NoveltiesPage.tsx, EmployeeHoursPage.tsx (noveltyApiService.getAll) — ver
// docs/decisions/BACKEND_TRANSACTION_CLEANUP_P0_14I2.md.
describe("noveltiesRepository.findMany — Etapa 14I.2", () => {
  it("pagina con Promise.all([findMany, count]) — sin $transaction", async () => {
    mockedPrisma.novelty.findMany.mockResolvedValue([{ id: "nov-1" }]);
    mockedPrisma.novelty.count.mockResolvedValue(1);

    const [items, total] = await noveltiesRepository.findMany(baseQuery({ page: 2, take: 10 }), {});

    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedPrisma.novelty.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
    expect(mockedPrisma.novelty.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.any(Object) }));
    expect(items).toEqual([{ id: "nov-1" }]);
    expect(total).toBe(1);
  });

  it("findMany y count reciben exactamente el mismo where (incluye employeeAccessWhere y filtros)", async () => {
    mockedPrisma.novelty.findMany.mockResolvedValue([]);
    mockedPrisma.novelty.count.mockResolvedValue(0);
    const employeeAccessWhere = { sectorId: { in: ["sector-1"] } };

    await noveltiesRepository.findMany(baseQuery({ employeeId: "11111111-1111-1111-1111-111111111111", status: "PENDIENTE" }), employeeAccessWhere);

    const findManyWhere = mockedPrisma.novelty.findMany.mock.calls[0]![0].where;
    const countWhere = mockedPrisma.novelty.count.mock.calls[0]![0].where;
    expect(findManyWhere).toEqual(countWhere);
    expect(findManyWhere).toMatchObject({
      employee: employeeAccessWhere,
      employeeId: "11111111-1111-1111-1111-111111111111",
      status: "PENDIENTE",
    });
  });

  it("arma el where con búsqueda libre (search) sobre empleado y tipo de novedad", async () => {
    mockedPrisma.novelty.findMany.mockResolvedValue([]);
    mockedPrisma.novelty.count.mockResolvedValue(0);

    await noveltiesRepository.findMany(baseQuery({ search: "juan" }), {});

    const where = mockedPrisma.novelty.findMany.mock.calls[0]![0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([{ employee: { firstName: { contains: "juan", mode: "insensitive" } } }]),
    );
  });

  it("respeta el orderBy y el include existentes (shape de respuesta sin cambios)", async () => {
    mockedPrisma.novelty.findMany.mockResolvedValue([]);
    mockedPrisma.novelty.count.mockResolvedValue(0);

    await noveltiesRepository.findMany(baseQuery(), {});

    const call = mockedPrisma.novelty.findMany.mock.calls[0]![0];
    expect(call.orderBy).toEqual([{ fromDate: "desc" }, { createdAt: "desc" }]);
    expect(call.include).toBeDefined();
    expect(call.include.employee).toBeDefined();
    expect(call.include.noveltyType).toBeDefined();
  });
});
