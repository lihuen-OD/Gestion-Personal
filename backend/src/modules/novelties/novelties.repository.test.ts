import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { noveltiesRepository } from "./novelties.repository";
import type { ListNoveltiesQuery } from "./novelties.schemas";

vi.mock("../../shared/prisma/client", () => {
  const tx = {
    novelty: { create: vi.fn(), findMany: vi.fn() },
  };
  return {
    prisma: {
      novelty: { findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
      $transaction: vi.fn((arg: unknown) =>
        Array.isArray(arg) ? Promise.all(arg as Promise<unknown>[]) : (arg as (tx: unknown) => unknown)(tx),
      ),
      __tx: tx,
    },
  };
});

const mockedPrisma = prisma as unknown as {
  novelty: { findMany: Mock; count: Mock; update: Mock };
  $transaction: Mock;
  __tx: { novelty: { create: Mock; findMany: Mock } };
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

const createInput = {
  employeeIds: ["employee-1"],
  noveltyTypeId: "type-1",
  fromDate: new Date("2026-08-10"),
  toDate: null,
  quantityHours: null,
  quantityDays: null,
  observation: null,
  targetHourConceptId: null,
} as never;

// Etapa 15G.1 — ajuste final (docs/decisions/NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md):
// decisión funcional final — Novedades es justificación administrativa y
// NUNCA crea/modifica TimeEntry. createMany() ya no acepta ningún parámetro
// de "efecto horario" (el mecanismo `applyNoveltyZeroHoursEffect`/
// `novelties.timeEffects.ts` se eliminó por completo del código productivo,
// no sólo se dejó de invocar) — estos tests fijan que la función sólo toca
// el modelo `Novelty`, nunca `TimeEntry`/`MonthlyTimeClosure`, sin importar
// el `status` con el que se crea.
describe("noveltiesRepository.createMany — Etapa 15G.1 (ajuste: sin efecto horario)", () => {
  beforeEach(() => {
    mockedPrisma.__tx.novelty.create.mockResolvedValue({ id: "novelty-1" });
    mockedPrisma.__tx.novelty.findMany.mockResolvedValue([{ id: "novelty-1" }]);
  });

  it.each(["PENDIENTE", "APROBADO"] as const)("crea la(s) Novelty y las devuelve, sin tocar ningún TimeEntry (status %s)", async (status) => {
    const result = await noveltiesRepository.createMany(createInput, status, "user-1");

    expect(result).toEqual([{ id: "novelty-1" }]);
    expect(mockedPrisma.__tx.novelty.create).toHaveBeenCalledTimes(1);
    // El tx mockeado sólo expone `novelty` — si el código intentara tocar
    // `tx.timeEntry`/`tx.monthlyTimeClosure`, fallaría acá con un TypeError
    // (no existen esas claves en el objeto tx de este test), confirmando
    // por construcción que createMany no las usa.
  });

  it("acepta exactamente 3 argumentos (input, status, createdByUserId) — ya no existe un 4to parámetro de efecto horario", () => {
    expect(noveltiesRepository.createMany.length).toBe(3);
  });
});

// Etapa 15G.1 — ajuste final: approve() sólo cambia `status`/auditoría.
// Ya no acepta ningún 3er argumento de "efecto horario" ni abre una
// transacción — es un update directo, igual que antes de que existiera
// cualquier noción de efecto horario en este repositorio.
// Etapa 15G.3 (docs/decisions/NOVELTY_OVERLAP_DUPLICATE_RULES_15G3.md):
// query nueva usada por noveltiesService.create() para detectar novedades
// del mismo tipo/empleado cuyo rango se superponga con el nuevo.
describe("noveltiesRepository.findOverlapping — Etapa 15G.3", () => {
  it("filtra por employeeId in, mismo noveltyTypeId y status distinto de RECHAZADO", async () => {
    mockedPrisma.novelty.findMany.mockResolvedValue([]);

    await noveltiesRepository.findOverlapping(["employee-1", "employee-2"], "type-1", new Date("2026-08-10"), new Date("2026-08-15"));

    const call = mockedPrisma.novelty.findMany.mock.calls[0]![0];
    expect(call.where.employeeId).toEqual({ in: ["employee-1", "employee-2"] });
    expect(call.where.noveltyTypeId).toBe("type-1");
    expect(call.where.status).toEqual({ not: "RECHAZADO" });
  });

  it("la condicion de overlap usa fromDate <= rangeEnd AND (toDate null y fromDate >= nuevo.fromDate, o toDate >= nuevo.fromDate)", async () => {
    mockedPrisma.novelty.findMany.mockResolvedValue([]);

    await noveltiesRepository.findOverlapping(["employee-1"], "type-1", new Date("2026-08-10"), new Date("2026-08-15"));

    const where = mockedPrisma.novelty.findMany.mock.calls[0]![0].where;
    expect(where.fromDate).toEqual({ lte: new Date("2026-08-15") });
    expect(where.OR).toEqual([
      { toDate: null, fromDate: { gte: new Date("2026-08-10") } },
      { toDate: { gte: new Date("2026-08-10") } },
    ]);
  });

  it("cuando el nuevo toDate es null, trata el rango como si terminara en fromDate (rangeEnd = fromDate)", async () => {
    mockedPrisma.novelty.findMany.mockResolvedValue([]);

    await noveltiesRepository.findOverlapping(["employee-1"], "type-1", new Date("2026-08-10"), null);

    const where = mockedPrisma.novelty.findMany.mock.calls[0]![0].where;
    expect(where.fromDate).toEqual({ lte: new Date("2026-08-10") });
  });

  it("selecciona sólo id/fromDate/toDate/legajo -- nunca dni/cuil ni el empleado completo", async () => {
    mockedPrisma.novelty.findMany.mockResolvedValue([]);

    await noveltiesRepository.findOverlapping(["employee-1"], "type-1", new Date("2026-08-10"), null);

    const select = mockedPrisma.novelty.findMany.mock.calls[0]![0].select;
    expect(select).toEqual({ id: true, fromDate: true, toDate: true, employee: { select: { legajo: true } } });
  });
});

describe("noveltiesRepository.approve — Etapa 15G.1 (ajuste: sin efecto horario)", () => {
  it("actualiza sólo status/approvedByUserId/approvedAt, sin transacción ni TimeEntry", async () => {
    mockedPrisma.novelty.update.mockResolvedValue({ id: "novelty-1", status: "APROBADO" });

    const result = await noveltiesRepository.approve("novelty-1", "user-rrhh");

    expect(result).toEqual({ id: "novelty-1", status: "APROBADO" });
    expect(mockedPrisma.novelty.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "novelty-1" },
        data: expect.objectContaining({ status: "APROBADO", approvedByUserId: "user-rrhh" }),
      }),
    );
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("acepta exactamente 2 argumentos (id, approvedByUserId) — ya no existe un 3er parámetro de efecto horario", () => {
    expect(noveltiesRepository.approve.length).toBe(2);
  });
});
