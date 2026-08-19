import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { hourConceptsRepository } from "./hourConcepts.repository";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    hourConcept: { findUniqueOrThrow: vi.fn() },
    employeeHourConcept: { findMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

const mockedPrisma = prisma as unknown as {
  hourConcept: { findUniqueOrThrow: Mock };
  employeeHourConcept: { findMany: Mock; count: Mock };
  $transaction: Mock;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findById", () => {
  it("delega en findUniqueOrThrow por id (P2025 -> 404 lo mapea el service)", async () => {
    mockedPrisma.hourConcept.findUniqueOrThrow.mockResolvedValue({ id: "concept-1" });

    await hourConceptsRepository.findById("concept-1");

    expect(mockedPrisma.hourConcept.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "concept-1" } });
  });
});

describe("findEmployees — empleados habilitados para el concepto (Etapa 8G)", () => {
  beforeEach(() => {
    mockedPrisma.employeeHourConcept.findMany.mockResolvedValue([]);
    mockedPrisma.employeeHourConcept.count.mockResolvedValue(0);
  });

  it("filtra por hourConceptId y pagina con $transaction([findMany, count])", async () => {
    await hourConceptsRepository.findEmployees("concept-1", { page: 2, take: 10 } as never, {});

    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
    const call = mockedPrisma.employeeHourConcept.findMany.mock.calls.at(0)?.[0];
    expect(call.where.hourConceptId).toBe("concept-1");
    expect(call.skip).toBe(10);
    expect(call.take).toBe(10);
  });

  it("no infiere nada de TimeSegment — solo lee EmployeeHourConcept", async () => {
    await hourConceptsRepository.findEmployees("concept-1", { page: 1, take: 50 } as never, {});

    expect(mockedPrisma.employeeHourConcept.findMany).toHaveBeenCalled();
  });

  it("combina filtros de empleado (sectorId/costCenterId/companyId/search/status) y accessWhere bajo employee.AND", async () => {
    const accessWhere = { id: "__NO_ACCESS__" };
    await hourConceptsRepository.findEmployees(
      "concept-1",
      { sectorId: "sector-1", costCenterId: "cc-1", companyId: "company-1", search: "perez", status: "ACTIVO", page: 1, take: 50 } as never,
      accessWhere,
    );

    const call = mockedPrisma.employeeHourConcept.findMany.mock.calls.at(0)?.[0];
    expect(call.where.employee.AND).toContainEqual(accessWhere);
    expect(call.where.employee.AND).toContainEqual(expect.objectContaining({ sectorId: "sector-1", costCenterId: "cc-1" }));
    expect(call.where.employee.AND).toContainEqual({ status: "ACTIVO" });
  });

  it("sin status, no agrega ningún filtro extra por status de empleado", async () => {
    await hourConceptsRepository.findEmployees("concept-1", { page: 1, take: 50 } as never, {});

    const call = mockedPrisma.employeeHourConcept.findMany.mock.calls.at(0)?.[0];
    expect(call.where.employee.AND).toHaveLength(2);
  });

  it("ordena de forma estable: apellido, nombre, employeeId como desempate final", async () => {
    await hourConceptsRepository.findEmployees("concept-1", { page: 1, take: 50 } as never, {});

    const call = mockedPrisma.employeeHourConcept.findMany.mock.calls.at(0)?.[0];
    expect(call.orderBy).toEqual([{ employee: { lastName: "asc" } }, { employee: { firstName: "asc" } }, { employeeId: "asc" }]);
  });
});
