import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { usersRepository, userSelect } from "./users.repository";
import type { ListUsersQuery } from "./users.schemas";

// Etapa 14I.2: el módulo `users` no tenía ningún archivo de test hasta esta
// etapa (backend/src/modules/users no tenía .repository/.service/.controller
// .test.ts). Se agrega cobertura mínima del repositorio, sin tocar auth ni
// contraseñas reales — ver docs/decisions/BACKEND_TRANSACTION_CLEANUP_P0_14I2.md.
vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    user: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

const mockedPrisma = prisma as unknown as {
  user: { findMany: Mock; count: Mock; findUnique: Mock };
  $transaction: Mock;
};

function baseQuery(overrides: Partial<ListUsersQuery> = {}): ListUsersQuery {
  return { page: 1, take: 100, ...overrides } as ListUsersQuery;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usersRepository.findMany — Etapa 14I.2", () => {
  it("pagina con Promise.all([findMany, count]) — sin $transaction", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([{ id: "user-1", supervisionsAsSupervisor: [], supervisionsAsSupervised: [] }]);
    mockedPrisma.user.count.mockResolvedValue(1);

    const [items, total] = await usersRepository.findMany(baseQuery({ page: 2, take: 10 }));

    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
    expect(mockedPrisma.user.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.any(Object) }));
    expect(items).toEqual([{ id: "user-1", supervisedUsers: [], supervisorUsers: [] }]);
    expect(total).toBe(1);
  });

  it("findMany y count reciben exactamente el mismo where (filtros por rol/estado/búsqueda)", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([]);
    mockedPrisma.user.count.mockResolvedValue(0);

    await usersRepository.findMany(baseQuery({ role: "NIVEL_1_RRHH", status: "ACTIVO", search: "ana" }));

    const findManyWhere = mockedPrisma.user.findMany.mock.calls[0]![0].where;
    const countWhere = mockedPrisma.user.count.mock.calls[0]![0].where;
    expect(findManyWhere).toEqual(countWhere);
    expect(findManyWhere).toMatchObject({ role: "NIVEL_1_RRHH", status: "ACTIVO" });
    expect(findManyWhere.OR).toEqual(
      expect.arrayContaining([{ name: { contains: "ana", mode: "insensitive" } }]),
    );
  });

  it("usa el select liviano (userSelect), nunca trae passwordHash", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([]);
    mockedPrisma.user.count.mockResolvedValue(0);

    await usersRepository.findMany(baseQuery());

    const call = mockedPrisma.user.findMany.mock.calls[0]![0];
    expect(call.select).toEqual(userSelect);
    expect(call.select.passwordHash).toBeUndefined();
    expect(call.orderBy).toEqual([{ status: "asc" }, { name: "asc" }]);
  });

  it("sin filtros: where queda vacío, paginación por defecto respetada", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([]);
    mockedPrisma.user.count.mockResolvedValue(0);

    await usersRepository.findMany(baseQuery());

    const call = mockedPrisma.user.findMany.mock.calls[0]![0];
    expect(call.where).toEqual({});
    expect(call.skip).toBe(0);
    expect(call.take).toBe(100);
  });
});

describe("usersRepository — relaciones de supervisión Nivel 2 → Nivel 3", () => {
  it("aplana a supervisedUsers/supervisorUsers sin exponer la forma interna", async () => {
    const ana = { id: "n3-a", name: "CARGA PLANTA", email: "planta@example.com", role: "NIVEL_3_CARGA_HORARIA", status: "ACTIVO" };
    const jefe = { id: "n2-a", name: "ENCARGADO PLANTA", email: "jefe@example.com", role: "NIVEL_2_SUPERVISION", status: "ACTIVO" };
    mockedPrisma.user.findUnique.mockResolvedValue({ id: "u-1", supervisionsAsSupervisor: [{ supervised: ana }], supervisionsAsSupervised: [{ supervisor: jefe }] });

    const user = await usersRepository.findById("u-1");

    expect(user).toEqual({ id: "u-1", supervisedUsers: [ana], supervisorUsers: [jefe] });
    expect(user).not.toHaveProperty("supervisionsAsSupervisor");
  });
});
