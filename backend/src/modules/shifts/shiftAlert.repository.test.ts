import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { shiftAlertRepository } from "./shiftAlert.repository";
import type { ListShiftAlertsQuery } from "./shiftAlert.schemas";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    shiftAlert: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const mockedPrisma = prisma as unknown as {
  shiftAlert: { findMany: Mock; count: Mock; findFirst: Mock; update: Mock };
  $transaction: Mock;
};

function query(overrides: Partial<ListShiftAlertsQuery> = {}): ListShiftAlertsQuery {
  return { status: "PENDIENTE", take: 20, ...overrides } as ListShiftAlertsQuery;
}

const employeeAccessWhere = { sector: { id: "sector-1" } } as unknown as Prisma.EmployeeWhereInput;

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.shiftAlert.findMany.mockResolvedValue([]);
  mockedPrisma.shiftAlert.count.mockResolvedValue(0);
});

// Etapa 14G.5: `prisma.$transaction([...])` (forma array, findMany+count) ->
// `Promise.all([...])` sobre el cliente `prisma` global -- mismo antipatrón
// ya corregido en time-entries (14C.2/14G.2/14G.3). Estos tests fijan que ya
// no se usa `$transaction` y que el contrato (where/include/orderBy/take,
// scope, filtros) se preserva exactamente.
describe("shiftAlertRepository.findMany — Etapa 14G.5, sin $transaction", () => {
  it("no envuelve las 2 queries en $transaction — corren sobre el cliente prisma global (Promise.all real)", async () => {
    await shiftAlertRepository.findMany(query(), employeeAccessWhere);

    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedPrisma.shiftAlert.findMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.shiftAlert.count).toHaveBeenCalledTimes(1);
  });

  it("devuelve items+total combinando findMany y count", async () => {
    const items = [{ id: "alert-1" }];
    mockedPrisma.shiftAlert.findMany.mockResolvedValue(items);
    mockedPrisma.shiftAlert.count.mockResolvedValue(7);

    const result = await shiftAlertRepository.findMany(query(), employeeAccessWhere);

    expect(result).toEqual({ items, total: 7 });
  });

  it("pide take+1 (patrón de cursor para detectar hasMore), ordenado por createdAt desc, id desc", async () => {
    await shiftAlertRepository.findMany(query({ take: 20 }), employeeAccessWhere);

    const call = mockedPrisma.shiftAlert.findMany.mock.calls[0]![0];
    expect(call.take).toBe(21);
    expect(call.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });

  it("incluye employee/workShift con select recortado (no el registro completo)", async () => {
    await shiftAlertRepository.findMany(query(), employeeAccessWhere);

    const call = mockedPrisma.shiftAlert.findMany.mock.calls[0]![0];
    expect(call.include.employee.select).toEqual({ id: true, legajo: true, dni: true, firstName: true, lastName: true, status: true });
    expect(call.include.workShift.select).toMatchObject({ id: true, startAt: true, endAt: true, status: true });
    expect(call.include.workShift.select.shiftTemplate.select).toEqual({ id: true, code: true, name: true });
  });

  it("aplica el scope del usuario (employeeAccessWhere) en el where de findMany y de count", async () => {
    await shiftAlertRepository.findMany(query(), employeeAccessWhere);

    const findManyWhere = mockedPrisma.shiftAlert.findMany.mock.calls[0]![0].where;
    const countWhere = mockedPrisma.shiftAlert.count.mock.calls[0]![0].where;
    expect(findManyWhere.employee.AND).toContain(employeeAccessWhere);
    expect(countWhere.employee.AND).toContain(employeeAccessWhere);
  });

  it("filtros preservados: type/severity/status/employeeId/workShiftId van al where", async () => {
    await shiftAlertRepository.findMany(
      query({ type: "SALIDA_TARDIA", severity: "CRITICA", status: "RESUELTA", employeeId: "employee-1", workShiftId: "shift-1" }),
      employeeAccessWhere,
    );

    const where = mockedPrisma.shiftAlert.findMany.mock.calls[0]![0].where;
    expect(where.type).toBe("SALIDA_TARDIA");
    expect(where.severity).toBe("CRITICA");
    expect(where.status).toBe("RESUELTA");
    expect(where.employeeId).toBe("employee-1");
    expect(where.workShiftId).toBe("shift-1");
  });

  it("status=ALL no filtra por status (trae los 3 estados)", async () => {
    await shiftAlertRepository.findMany(query({ status: "ALL" }), employeeAccessWhere);

    const where = mockedPrisma.shiftAlert.findMany.mock.calls[0]![0].where;
    expect(where.status).toBeUndefined();
  });

  it("search filtra en DB (nombre/apellido/legajo/dni, insensitive) dentro del where de empleado, no en memoria", async () => {
    await shiftAlertRepository.findMany(query({ search: "ana" }), employeeAccessWhere);

    const where = mockedPrisma.shiftAlert.findMany.mock.calls[0]![0].where;
    const searchClause = where.employee.AND.find((clause: Record<string, unknown>) => "OR" in clause) as { OR: Array<Record<string, unknown>> };
    expect(searchClause.OR).toEqual([
      { firstName: { contains: "ana", mode: "insensitive" } },
      { lastName: { contains: "ana", mode: "insensitive" } },
      { legajo: { contains: "ana", mode: "insensitive" } },
      { dni: { contains: "ana", mode: "insensitive" } },
    ]);
  });

  it("before agrega createdAt < before al where de findMany, pero no al where de count (el total es del universo completo de filtros, no de la página)", async () => {
    const before = new Date("2026-08-20T00:00:00.000Z");
    await shiftAlertRepository.findMany(query({ before }), employeeAccessWhere);

    const findManyWhere = mockedPrisma.shiftAlert.findMany.mock.calls[0]![0].where;
    const countWhere = mockedPrisma.shiftAlert.count.mock.calls[0]![0].where;
    expect(findManyWhere.createdAt).toEqual({ lt: before });
    expect(countWhere.createdAt).toBeUndefined();
  });
});
