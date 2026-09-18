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
    // Etapa 15M.15: el where pasó de propiedades planas a un `AND` de
    // condiciones -- necesario para poder combinar el `OR` de `search` con
    // el `OR` nuevo de intersección de período sin que una de las dos
    // claves `OR` pise a la otra en el mismo objeto. Mismo resultado lógico
    // (todo sigue combinado con AND), sólo cambia la representación.
    expect(findManyWhere.AND).toEqual(
      expect.arrayContaining([
        { employee: employeeAccessWhere },
        { employeeId: "11111111-1111-1111-1111-111111111111" },
        { status: "PENDIENTE" },
      ]),
    );
  });

  it("arma el where con búsqueda libre (search) sobre empleado y tipo de novedad", async () => {
    mockedPrisma.novelty.findMany.mockResolvedValue([]);
    mockedPrisma.novelty.count.mockResolvedValue(0);

    await noveltiesRepository.findMany(baseQuery({ search: "juan" }), {});

    const where = mockedPrisma.novelty.findMany.mock.calls[0]![0].where;
    const searchCondition = where.AND.find((condition: { OR?: unknown[] }) => Array.isArray(condition.OR));
    expect(searchCondition.OR).toEqual(
      expect.arrayContaining([{ employee: { firstName: { contains: "juan", mode: "insensitive" } } }]),
    );
  });

  // Etapa 15M.15: intersección de período -- mismo criterio de negocio que
  // `noveltyCoversDay` (docs/PROJECT_UI_CONTEXT.md "Novedades por período").
  describe("filtro por período (Etapa 15M.15)", () => {
    async function whereForPeriod(period: string) {
      // mockClear (no clearAllMocks): varios tests llaman esto más de una vez
      // para comparar dos períodos -- sin limpiar el historial de calls acá,
      // mock.calls[0] siempre hubiera devuelto la primera invocación del
      // test, no la más reciente.
      mockedPrisma.novelty.findMany.mockClear();
      mockedPrisma.novelty.count.mockClear();
      mockedPrisma.novelty.findMany.mockResolvedValue([]);
      mockedPrisma.novelty.count.mockResolvedValue(0);
      await noveltiesRepository.findMany(baseQuery({ period } as Partial<ListNoveltiesQuery>), {});
      const where = mockedPrisma.novelty.findMany.mock.calls[0]![0].where;
      return where.AND.find((condition: { OR?: unknown[] }) => Array.isArray(condition.OR) && condition.OR.length === 3);
    }

    it("Caso A: agrega una condición de intersección con los límites UTC del mes pedido", async () => {
      const periodCondition = await whereForPeriod("2026-09");
      expect(periodCondition.OR).toEqual([
        { fromDate: { lt: new Date(Date.UTC(2026, 9, 1)) }, toDate: { not: null, gte: new Date(Date.UTC(2026, 8, 1)) } },
        { fromDate: { lt: new Date(Date.UTC(2026, 9, 1)) }, toDate: null, noveltyType: { allowsDateRange: true } },
        {
          fromDate: { gte: new Date(Date.UTC(2026, 8, 1)), lt: new Date(Date.UTC(2026, 9, 1)) },
          toDate: null,
          noveltyType: { allowsDateRange: false },
        },
      ]);
    });

    it("Caso I: diciembre → enero usa el año correcto en ambos límites", async () => {
      const periodCondition = await whereForPeriod("2026-12");
      expect(periodCondition.OR[0]).toEqual({
        fromDate: { lt: new Date(Date.UTC(2027, 0, 1)) },
        toDate: { not: null, gte: new Date(Date.UTC(2026, 11, 1)) },
      });
    });

    // Etapa 15M.15: evalúa la condición Prisma generada (no un modelo
    // paralelo hecho a mano) contra novedades candidatas concretas -- así
    // los casos A/B/C/E del pedido verifican el WHERE que de verdad se le
    // manda a la base, no una reimplementación de la regla sólo para el test.
    function matchesGeneratedWhere(
      periodCondition: { OR: Array<Record<string, unknown>> },
      novelty: { fromDate: Date; toDate: Date | null; allowsDateRange: boolean },
    ) {
      const matchesDateCond = (value: Date | null, cond: unknown) => {
        if (!cond || typeof cond !== "object") return true;
        const c = cond as { gte?: Date; lt?: Date; not?: null };
        if ("not" in c && c.not === null && value === null) return false;
        if (c.gte && (!value || value < c.gte)) return false;
        if (c.lt && (!value || value >= c.lt)) return false;
        return true;
      };
      return periodCondition.OR.some((branch) => {
        if (branch.toDate === null && novelty.toDate !== null) return false;
        if (branch.toDate && typeof branch.toDate === "object" && novelty.toDate === null) return false;
        const noveltyTypeCond = branch.noveltyType as { allowsDateRange?: boolean } | undefined;
        if (noveltyTypeCond && noveltyTypeCond.allowsDateRange !== novelty.allowsDateRange) return false;
        return matchesDateCond(novelty.fromDate, branch.fromDate) && matchesDateCond(novelty.toDate, branch.toDate);
      });
    }

    it("Caso A: novedad de un único día (17/09) aparece en septiembre, no en agosto ni octubre", async () => {
      const novelty = { fromDate: new Date(Date.UTC(2026, 8, 17)), toDate: null, allowsDateRange: false };
      expect(matchesGeneratedWhere(await whereForPeriod("2026-09"), novelty)).toBe(true);
      expect(matchesGeneratedWhere(await whereForPeriod("2026-08"), novelty)).toBe(false);
      expect(matchesGeneratedWhere(await whereForPeriod("2026-10"), novelty)).toBe(false);
    });

    it("Caso B: rango 28/09 → 03/10 aparece en septiembre y en octubre", async () => {
      const novelty = { fromDate: new Date(Date.UTC(2026, 8, 28)), toDate: new Date(Date.UTC(2026, 9, 3)), allowsDateRange: true };
      expect(matchesGeneratedWhere(await whereForPeriod("2026-09"), novelty)).toBe(true);
      expect(matchesGeneratedWhere(await whereForPeriod("2026-10"), novelty)).toBe(true);
      expect(matchesGeneratedWhere(await whereForPeriod("2026-08"), novelty)).toBe(false);
      expect(matchesGeneratedWhere(await whereForPeriod("2026-11"), novelty)).toBe(false);
    });

    it("Caso C: novedad fuera del período (todo julio) no aparece en septiembre", async () => {
      const novelty = { fromDate: new Date(Date.UTC(2026, 6, 1)), toDate: new Date(Date.UTC(2026, 6, 31)), allowsDateRange: true };
      expect(matchesGeneratedWhere(await whereForPeriod("2026-09"), novelty)).toBe(false);
    });

    // Nota: "Caso E" en el pedido (Etapa 15M.15 §26) es el empty state del
    // frontend con 0 resultados -- distinto de este caso, que es la
    // semántica de vigencia abierta (§5) al nivel del motor de intersección.
    it("vigente abierta: fromDate=15/07, toDate=null, tipo con allowsDateRange sigue apareciendo en meses posteriores", async () => {
      const novelty = { fromDate: new Date(Date.UTC(2026, 6, 15)), toDate: null, allowsDateRange: true };
      expect(matchesGeneratedWhere(await whereForPeriod("2026-07"), novelty)).toBe(true);
      expect(matchesGeneratedWhere(await whereForPeriod("2026-09"), novelty)).toBe(true);
      expect(matchesGeneratedWhere(await whereForPeriod("2026-06"), novelty)).toBe(false);
    });

    it("bisiesto: rango 27/02 → 01/03/2028 interseca febrero (29 días) y marzo", async () => {
      const novelty = { fromDate: new Date(Date.UTC(2028, 1, 27)), toDate: new Date(Date.UTC(2028, 2, 1)), allowsDateRange: true };
      expect(matchesGeneratedWhere(await whereForPeriod("2028-02"), novelty)).toBe(true);
      expect(matchesGeneratedWhere(await whereForPeriod("2028-03"), novelty)).toBe(true);
    });

    it("sin período no agrega ninguna condición de intersección", async () => {
      mockedPrisma.novelty.findMany.mockResolvedValue([]);
      mockedPrisma.novelty.count.mockResolvedValue(0);
      await noveltiesRepository.findMany(baseQuery(), {});
      const where = mockedPrisma.novelty.findMany.mock.calls[0]![0].where;
      const periodCondition = where.AND.find((condition: { OR?: unknown[] }) => Array.isArray(condition.OR) && condition.OR.length === 3);
      expect(periodCondition).toBeUndefined();
    });
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
