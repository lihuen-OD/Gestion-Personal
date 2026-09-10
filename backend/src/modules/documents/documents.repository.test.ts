import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { documentsRepository } from "./documents.repository";
import type { ListDocumentsQuery } from "./documents.schemas";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    employeeDocument: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

const mockedPrisma = prisma as unknown as {
  employeeDocument: { findMany: Mock; count: Mock; findFirst: Mock };
  $transaction: Mock;
};

function baseQuery(overrides: Partial<ListDocumentsQuery> = {}): ListDocumentsQuery {
  return { page: 1, take: 200, ...overrides } as ListDocumentsQuery;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// Etapa 14I.2: findMany no tenía ningún test dedicado hasta esta etapa —
// agregado al corregir el $transaction que usaba SIEMPRE (único camino de
// findMany, sin rama alternativa). Caller real confirmado: DocumentsPage.tsx.
// No se toca storage/Google Drive (findById/download quedan sin cambios,
// no forman parte de esta etapa). Ver docs/decisions/
// BACKEND_TRANSACTION_CLEANUP_P0_14I2.md.
describe("documentsRepository.findMany — Etapa 14I.2", () => {
  it("pagina con Promise.all([findMany, count]) — sin $transaction", async () => {
    mockedPrisma.employeeDocument.findMany.mockResolvedValue([{ id: "doc-1" }]);
    mockedPrisma.employeeDocument.count.mockResolvedValue(1);

    const [items, total] = await documentsRepository.findMany(baseQuery({ page: 2, take: 10 }), {});

    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedPrisma.employeeDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
    expect(mockedPrisma.employeeDocument.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.any(Object) }));
    expect(items).toEqual([{ id: "doc-1" }]);
    expect(total).toBe(1);
  });

  it("findMany y count reciben exactamente el mismo where (incluye employeeAccessWhere y filtros)", async () => {
    mockedPrisma.employeeDocument.findMany.mockResolvedValue([]);
    mockedPrisma.employeeDocument.count.mockResolvedValue(0);
    const employeeAccessWhere = { sectorId: { in: ["sector-1"] } };

    await documentsRepository.findMany(baseQuery({ categoryId: "11111111-1111-1111-1111-111111111111", status: "VIGENTE" }), employeeAccessWhere);

    const findManyWhere = mockedPrisma.employeeDocument.findMany.mock.calls[0]![0].where;
    const countWhere = mockedPrisma.employeeDocument.count.mock.calls[0]![0].where;
    expect(findManyWhere).toEqual(countWhere);
    expect(findManyWhere).toMatchObject({
      employee: employeeAccessWhere,
      categoryId: "11111111-1111-1111-1111-111111111111",
      status: "VIGENTE",
    });
  });

  it("mantiene el include de listado (categoría/empleado/novedad) y el orderBy existentes", async () => {
    mockedPrisma.employeeDocument.findMany.mockResolvedValue([]);
    mockedPrisma.employeeDocument.count.mockResolvedValue(0);

    await documentsRepository.findMany(baseQuery(), {});

    const call = mockedPrisma.employeeDocument.findMany.mock.calls[0]![0];
    expect(call.orderBy).toEqual([{ createdAt: "desc" }, { employee: { lastName: "asc" } }]);
    expect(call.include.category).toBeDefined();
    expect(call.include.employee).toBeDefined();
    expect(call.include.novelty).toBeDefined();
  });

  it("arma el where con búsqueda libre sobre nombre de archivo/categoría/empleado", async () => {
    mockedPrisma.employeeDocument.findMany.mockResolvedValue([]);
    mockedPrisma.employeeDocument.count.mockResolvedValue(0);

    await documentsRepository.findMany(baseQuery({ search: "contrato" }), {});

    const where = mockedPrisma.employeeDocument.findMany.mock.calls[0]![0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([{ fileName: { contains: "contrato", mode: "insensitive" } }]),
    );
  });
});
