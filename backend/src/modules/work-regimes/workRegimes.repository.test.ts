import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { classifyWorkRegimeVigency, findActiveEmployeeWorkRegime, workRegimesRepository } from "./workRegimes.repository";

/**
 * Regla de vigencia (etapa de logica de Regimen de Trabajo, 2026-08-18):
 * vigente si effectiveFrom <= fecha y (effectiveTo es null o effectiveTo >= fecha).
 * Si hay mas de una fila vigente, gana la de effectiveFrom mas reciente. Estos
 * tests verifican que el repository le pida exactamente esa forma a Prisma
 * (el desempate por "mas reciente" lo resuelve la base via orderBy + take
 * implicito de findFirst, no logica en memoria).
 */
vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    employeeWorkRegime: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    workRegime: { findMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

const mockedPrisma = prisma as unknown as {
  employeeWorkRegime: { findFirst: Mock; findMany: Mock; count: Mock };
  workRegime: { findMany: Mock; count: Mock };
  $transaction: Mock;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findActiveEmployeeWorkRegime", () => {
  it("filtra por effectiveFrom <= fecha y effectiveTo null o >= fecha", async () => {
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);
    const referenceDate = new Date("2026-08-18T00:00:00.000Z");

    await findActiveEmployeeWorkRegime("employee-1", referenceDate);

    expect(mockedPrisma.employeeWorkRegime.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          employeeId: "employee-1",
          effectiveFrom: { lte: referenceDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: referenceDate } }],
        },
        orderBy: { effectiveFrom: "desc" },
      }),
    );
  });

  it("pide la fila mas reciente (orderBy effectiveFrom desc) para desambiguar dos vigentes", async () => {
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

    await findActiveEmployeeWorkRegime("employee-1", new Date("2026-08-18T00:00:00.000Z"));

    const call = mockedPrisma.employeeWorkRegime.findFirst.mock.calls.at(0)?.[0];
    expect(call?.orderBy).toEqual({ effectiveFrom: "desc" });
  });

  it("si no hay ninguna fila vigente para la fecha, devuelve null", async () => {
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

    const result = await findActiveEmployeeWorkRegime("employee-1", new Date("2026-08-18T00:00:00.000Z"));

    expect(result).toBeNull();
  });
});

describe("findOverlappingAssignment — detección de solapamiento de vigencias", () => {
  it("rango nuevo con effectiveTo: exige existing.effectiveFrom <= nuevo.effectiveTo", async () => {
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

    await workRegimesRepository.findOverlappingAssignment("employee-1", new Date("2026-01-01"), new Date("2026-06-30"));

    const call = mockedPrisma.employeeWorkRegime.findFirst.mock.calls.at(0)?.[0];
    expect(call?.where.AND[0]).toEqual({ effectiveFrom: { lte: new Date("2026-06-30") } });
    expect(call?.where.AND[1]).toEqual({ OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date("2026-01-01") } }] });
  });

  it("rango nuevo abierto (sin effectiveTo): no restringe por el lado de arriba, cualquier existente que empiece antes ya solapa", async () => {
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

    await workRegimesRepository.findOverlappingAssignment("employee-1", new Date("2026-01-01"), null);

    const call = mockedPrisma.employeeWorkRegime.findFirst.mock.calls.at(0)?.[0];
    expect(call?.where.AND[0]).toEqual({});
  });

  it("con excludeId, no compara contra sí misma (edición de una asignación existente)", async () => {
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

    await workRegimesRepository.findOverlappingAssignment("employee-1", new Date("2026-01-01"), null, "assignment-1");

    const call = mockedPrisma.employeeWorkRegime.findFirst.mock.calls.at(0)?.[0];
    expect(call?.where.id).toEqual({ not: "assignment-1" });
  });

  it("sin excludeId, no agrega ningún filtro por id", async () => {
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

    await workRegimesRepository.findOverlappingAssignment("employee-1", new Date("2026-01-01"), null);

    const call = mockedPrisma.employeeWorkRegime.findFirst.mock.calls.at(0)?.[0];
    expect(call?.where.id).toBeUndefined();
  });
});

describe("WorkRegime.findMany — filtros por status/kind/search", () => {
  it("arma el where con kind/status/search y pagina con $transaction([findMany, count])", async () => {
    mockedPrisma.workRegime.findMany.mockResolvedValue([]);
    mockedPrisma.workRegime.count.mockResolvedValue(0);

    await workRegimesRepository.findMany({ kind: "TURNO_FLEXIBLE", status: "ACTIVO", search: "campaña", page: 2, take: 10 } as never);

    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.workRegime.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          kind: "TURNO_FLEXIBLE",
          status: "ACTIVO",
          OR: [{ code: { contains: "campaña", mode: "insensitive" } }, { name: { contains: "campaña", mode: "insensitive" } }],
        },
        skip: 10,
        take: 10,
      }),
    );
    expect(mockedPrisma.workRegime.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ kind: "TURNO_FLEXIBLE" }) }));
  });

  it("sin filtros, el where queda vacío (lista completa paginada)", async () => {
    mockedPrisma.workRegime.findMany.mockResolvedValue([]);
    mockedPrisma.workRegime.count.mockResolvedValue(0);

    await workRegimesRepository.findMany({ page: 1, take: 100 } as never);

    expect(mockedPrisma.workRegime.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});

describe("classifyWorkRegimeVigency (Etapa 8G)", () => {
  const referenceDate = new Date("2026-08-18T00:00:00.000Z");

  it("effectiveFrom en el futuro -> future, sin importar effectiveTo", () => {
    expect(classifyWorkRegimeVigency(new Date("2026-09-01"), null, referenceDate)).toBe("future");
    expect(classifyWorkRegimeVigency(new Date("2026-09-01"), new Date("2026-12-01"), referenceDate)).toBe("future");
  });

  it("effectiveTo pasado (antes de la fecha de referencia) -> historical", () => {
    expect(classifyWorkRegimeVigency(new Date("2026-01-01"), new Date("2026-06-30"), referenceDate)).toBe("historical");
  });

  it("effectiveFrom <= referencia y effectiveTo null (sin fin) -> current", () => {
    expect(classifyWorkRegimeVigency(new Date("2026-01-01"), null, referenceDate)).toBe("current");
  });

  it("effectiveFrom <= referencia y effectiveTo >= referencia -> current", () => {
    expect(classifyWorkRegimeVigency(new Date("2026-01-01"), new Date("2026-12-31"), referenceDate)).toBe("current");
  });

  it("effectiveFrom == referencia exacta -> current, no future", () => {
    expect(classifyWorkRegimeVigency(referenceDate, null, referenceDate)).toBe("current");
  });
});

describe("WorkRegime.findEmployees — empleados asociados al régimen (Etapa 8G)", () => {
  beforeEach(() => {
    mockedPrisma.employeeWorkRegime.findMany.mockResolvedValue([]);
    mockedPrisma.employeeWorkRegime.count.mockResolvedValue(0);
  });

  const referenceDate = new Date("2026-08-18T00:00:00.000Z");

  it("filtra por workRegimeId y pagina con $transaction([findMany, count])", async () => {
    await workRegimesRepository.findEmployees("regime-1", { status: "all", page: 2, take: 10 } as never, referenceDate, {});

    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
    const call = mockedPrisma.employeeWorkRegime.findMany.mock.calls.at(0)?.[0];
    expect(call.where.workRegimeId).toBe("regime-1");
    expect(call.skip).toBe(10);
    expect(call.take).toBe(10);
  });

  it("status=current arma el where de vigencia (effectiveFrom <= fecha, effectiveTo null o >= fecha)", async () => {
    await workRegimesRepository.findEmployees("regime-1", { status: "current", page: 1, take: 50 } as never, referenceDate, {});

    const call = mockedPrisma.employeeWorkRegime.findMany.mock.calls.at(0)?.[0];
    expect(call.where.effectiveFrom).toEqual({ lte: referenceDate });
    expect(call.where.OR).toEqual([{ effectiveTo: null }, { effectiveTo: { gte: referenceDate } }]);
  });

  it("status=future arma el where effectiveFrom > fecha", async () => {
    await workRegimesRepository.findEmployees("regime-1", { status: "future", page: 1, take: 50 } as never, referenceDate, {});

    const call = mockedPrisma.employeeWorkRegime.findMany.mock.calls.at(0)?.[0];
    expect(call.where.effectiveFrom).toEqual({ gt: referenceDate });
  });

  it("status=historical arma el where effectiveTo < fecha", async () => {
    await workRegimesRepository.findEmployees("regime-1", { status: "historical", page: 1, take: 50 } as never, referenceDate, {});

    const call = mockedPrisma.employeeWorkRegime.findMany.mock.calls.at(0)?.[0];
    expect(call.where.effectiveTo).toEqual({ lt: referenceDate });
  });

  it("status=all no agrega ninguna condición de vigencia adicional", async () => {
    await workRegimesRepository.findEmployees("regime-1", { status: "all", page: 1, take: 50 } as never, referenceDate, {});

    const call = mockedPrisma.employeeWorkRegime.findMany.mock.calls.at(0)?.[0];
    expect(call.where.effectiveFrom).toBeUndefined();
    expect(call.where.effectiveTo).toBeUndefined();
    expect(call.where.OR).toBeUndefined();
  });

  it("combina filtros de empleado (sectorId/costCenterId/companyId/search) y accessWhere bajo employee.AND", async () => {
    const accessWhere = { id: "__NO_ACCESS__" };
    await workRegimesRepository.findEmployees(
      "regime-1",
      { status: "all", sectorId: "sector-1", costCenterId: "cc-1", companyId: "company-1", search: "perez", page: 1, take: 50 } as never,
      referenceDate,
      accessWhere,
    );

    const call = mockedPrisma.employeeWorkRegime.findMany.mock.calls.at(0)?.[0];
    expect(call.where.employee.AND[1]).toBe(accessWhere);
    expect(call.where.employee.AND[0]).toEqual(
      expect.objectContaining({
        sectorId: "sector-1",
        costCenterId: "cc-1",
        companies: { some: { companyId: "company-1" } },
      }),
    );
  });

  it("ordena de forma estable: apellido, nombre, effectiveFrom desc, id como desempate final", async () => {
    await workRegimesRepository.findEmployees("regime-1", { status: "all", page: 1, take: 50 } as never, referenceDate, {});

    const call = mockedPrisma.employeeWorkRegime.findMany.mock.calls.at(0)?.[0];
    expect(call.orderBy).toEqual([
      { employee: { lastName: "asc" } },
      { employee: { firstName: "asc" } },
      { effectiveFrom: "desc" },
      { id: "asc" },
    ]);
  });
});
