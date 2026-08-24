import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { hourConceptsRepository } from "./hourConcepts.repository";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    hourConcept: { findUniqueOrThrow: vi.fn(), delete: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    employee: { count: vi.fn() },
    employeeHourConcept: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), createMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    hourConceptRule: { updateMany: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

const mockedPrisma = prisma as unknown as {
  hourConcept: { findUniqueOrThrow: Mock; delete: Mock; update: Mock; findMany: Mock };
  employee: { count: Mock };
  employeeHourConcept: { findMany: Mock; count: Mock; findUnique: Mock; createMany: Mock; delete: Mock; deleteMany: Mock };
  hourConceptRule: { updateMany: Mock };
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

describe("countExistingEmployees", () => {
  it("cuenta empleados reales por id, mismo criterio que shiftAssignmentService.assign", async () => {
    mockedPrisma.employee.count.mockResolvedValue(2);

    const count = await hourConceptsRepository.countExistingEmployees(["employee-1", "employee-2"]);

    expect(count).toBe(2);
    expect(mockedPrisma.employee.count).toHaveBeenCalledWith({ where: { id: { in: ["employee-1", "employee-2"] } } });
  });
});

describe("findEmployeeHourConcept", () => {
  it("busca por la PK compuesta (employeeId_hourConceptId)", async () => {
    mockedPrisma.employeeHourConcept.findUnique.mockResolvedValue(null);

    await hourConceptsRepository.findEmployeeHourConcept("concept-1", "employee-1");

    expect(mockedPrisma.employeeHourConcept.findUnique).toHaveBeenCalledWith({
      where: { employeeId_hourConceptId: { employeeId: "employee-1", hourConceptId: "concept-1" } },
    });
  });
});

describe("enableForEmployees — habilitar empleados desde el concepto (Etapa 8N)", () => {
  it("crea una fila EmployeeHourConcept por cada empleado, con skipDuplicates (idempotente)", async () => {
    mockedPrisma.employeeHourConcept.createMany.mockResolvedValue({ count: 2 });

    await hourConceptsRepository.enableForEmployees("concept-1", ["employee-1", "employee-2"]);

    expect(mockedPrisma.employeeHourConcept.createMany).toHaveBeenCalledWith({
      data: [
        { employeeId: "employee-1", hourConceptId: "concept-1" },
        { employeeId: "employee-2", hourConceptId: "concept-1" },
      ],
      skipDuplicates: true,
    });
  });
});

describe("disableForEmployee — quitar un empleado del concepto (Etapa 8N)", () => {
  it("borra por la PK compuesta, no toca otros conceptos habilitados del empleado", async () => {
    mockedPrisma.employeeHourConcept.delete.mockResolvedValue({ employeeId: "employee-1", hourConceptId: "concept-1" });

    await hourConceptsRepository.disableForEmployee("concept-1", "employee-1");

    expect(mockedPrisma.employeeHourConcept.delete).toHaveBeenCalledWith({
      where: { employeeId_hourConceptId: { employeeId: "employee-1", hourConceptId: "concept-1" } },
    });
  });
});

describe("findWithUsage — conteo de uso real antes de eliminar (Etapa 8O)", () => {
  it("selecciona id/code/name y el _count de las 6 relaciones reales de HourConcept", async () => {
    mockedPrisma.hourConcept.findUniqueOrThrow.mockResolvedValue({
      id: "concept-1",
      code: "HOR-001",
      name: "Sereno",
      _count: { employees: 0, timeEntries: 0, novelties: 0, timeSegments: 0, workShifts: 0, rules: 0 },
    });

    await hourConceptsRepository.findWithUsage("concept-1");

    expect(mockedPrisma.hourConcept.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "concept-1" },
      select: {
        id: true,
        code: true,
        name: true,
        systemRole: true,
        _count: { select: { employees: true, timeEntries: true, novelties: true, timeSegments: true, workShifts: true, rules: true } },
      },
    });
  });
});

describe("delete — eliminación física (Etapa 8O)", () => {
  it("borra por id — solo se llama cuando el service ya confirmó cero uso", async () => {
    mockedPrisma.hourConcept.delete.mockResolvedValue({ id: "concept-1" });

    await hourConceptsRepository.delete("concept-1");

    expect(mockedPrisma.hourConcept.delete).toHaveBeenCalledWith({ where: { id: "concept-1" } });
  });
});

describe("disableAllEmployees — desvincula empleados habilitados en batch (Etapa 8P)", () => {
  it("borra todas las filas EmployeeHourConcept del concepto, no toca otros conceptos", async () => {
    mockedPrisma.employeeHourConcept.deleteMany.mockResolvedValue({ count: 3 });

    await hourConceptsRepository.disableAllEmployees("concept-1");

    expect(mockedPrisma.employeeHourConcept.deleteMany).toHaveBeenCalledWith({ where: { hourConceptId: "concept-1" } });
  });
});

describe("deactivateAllRules — desactiva reglas activas, no las borra (Etapa 8P)", () => {
  it("actualiza status a INACTIVO solo para las reglas ACTIVO del concepto", async () => {
    mockedPrisma.hourConceptRule.updateMany.mockResolvedValue({ count: 2 });

    await hourConceptsRepository.deactivateAllRules("concept-1");

    expect(mockedPrisma.hourConceptRule.updateMany).toHaveBeenCalledWith({
      where: { hourConceptId: "concept-1", status: "ACTIVO" },
      data: { status: "INACTIVO" },
    });
  });
});

describe("softDelete — baja lógica (Etapa 8P)", () => {
  it("marca status INACTIVO y deletedAt, nunca borra la fila", async () => {
    mockedPrisma.hourConcept.update.mockResolvedValue({ id: "concept-1", status: "INACTIVO" });

    await hourConceptsRepository.softDelete("concept-1");

    expect(mockedPrisma.hourConcept.update).toHaveBeenCalledWith({
      where: { id: "concept-1" },
      data: { status: "INACTIVO", deletedAt: expect.any(Date) },
    });
  });
});
