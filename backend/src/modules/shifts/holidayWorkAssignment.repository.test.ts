import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { holidayWorkAssignmentRepository } from "./holidayWorkAssignment.repository";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    employee: { findMany: vi.fn(), count: vi.fn() },
    holidayWorkAssignment: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn((operations: unknown[]) => Promise.all(operations)),
  },
}));

const mockedPrisma = prisma as unknown as {
  employee: { findMany: Mock; count: Mock };
  holidayWorkAssignment: { findMany: Mock; findUnique: Mock; create: Mock; update: Mock };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findCandidates — Etapa 12D", () => {
  it("filtra por sectorId cuando se pasa", async () => {
    mockedPrisma.employee.findMany.mockResolvedValue([]);
    mockedPrisma.employee.count.mockResolvedValue(0);

    await holidayWorkAssignmentRepository.findCandidates({ sectorId: "sector-panol", page: 1, take: 100 }, {});

    const where = mockedPrisma.employee.findMany.mock.calls[0]![0].where;
    expect(where.AND[0].sectorId).toBe("sector-panol");
  });

  it("filtra por shiftTemplateId vía la relación shiftAssignments HABILITADO", async () => {
    mockedPrisma.employee.findMany.mockResolvedValue([]);
    mockedPrisma.employee.count.mockResolvedValue(0);

    await holidayWorkAssignmentRepository.findCandidates({ shiftTemplateId: "template-1", page: 1, take: 100 }, {});

    const where = mockedPrisma.employee.findMany.mock.calls[0]![0].where;
    expect(where.AND[0].shiftAssignments).toEqual({ some: { shiftTemplateId: "template-1", status: "HABILITADO" } });
  });

  it("filtra empleados sin turno con withoutShift", async () => {
    mockedPrisma.employee.findMany.mockResolvedValue([]);
    mockedPrisma.employee.count.mockResolvedValue(0);

    await holidayWorkAssignmentRepository.findCandidates({ withoutShift: true, page: 1, take: 100 }, {});

    const where = mockedPrisma.employee.findMany.mock.calls[0]![0].where;
    expect(where.AND[0].shiftAssignments).toEqual({ none: { status: "HABILITADO" } });
  });

  it("busca por nombre/legajo con search", async () => {
    mockedPrisma.employee.findMany.mockResolvedValue([]);
    mockedPrisma.employee.count.mockResolvedValue(0);

    await holidayWorkAssignmentRepository.findCandidates({ search: "Pedro", page: 1, take: 100 }, {});

    const where = mockedPrisma.employee.findMany.mock.calls[0]![0].where;
    expect(where.AND[0].OR).toEqual(
      expect.arrayContaining([{ firstName: { contains: "Pedro", mode: "insensitive" } }, { lastName: { contains: "Pedro", mode: "insensitive" } }]),
    );
  });

  it("siempre filtra por status ACTIVO — no convoca a empleados inactivos", async () => {
    mockedPrisma.employee.findMany.mockResolvedValue([]);
    mockedPrisma.employee.count.mockResolvedValue(0);

    await holidayWorkAssignmentRepository.findCandidates({ page: 1, take: 100 }, {});

    const where = mockedPrisma.employee.findMany.mock.calls[0]![0].where;
    expect(where.AND[0].status).toBe("ACTIVO");
  });

  it("combina el alcance del empleado (accessWhere) con AND, sin pisarlo", async () => {
    mockedPrisma.employee.findMany.mockResolvedValue([]);
    mockedPrisma.employee.count.mockResolvedValue(0);
    const accessWhere = { assignments: { some: { userId: "user-1" } } };

    await holidayWorkAssignmentRepository.findCandidates({ page: 1, take: 100 }, accessWhere);

    const where = mockedPrisma.employee.findMany.mock.calls[0]![0].where;
    expect(where.AND[1]).toBe(accessWhere);
  });

  it("pagina con skip/take", async () => {
    mockedPrisma.employee.findMany.mockResolvedValue([]);
    mockedPrisma.employee.count.mockResolvedValue(0);

    await holidayWorkAssignmentRepository.findCandidates({ page: 3, take: 20 }, {});

    expect(mockedPrisma.employee.findMany.mock.calls[0]![0]).toMatchObject({ skip: 40, take: 20 });
  });
});

describe("findByDate — Etapa 12D", () => {
  it("filtra por fecha, status ACTIVA y el alcance del empleado", async () => {
    mockedPrisma.holidayWorkAssignment.findMany.mockResolvedValue([]);
    const date = new Date("2026-08-27");
    const accessWhere = { assignments: { some: { userId: "user-1" } } };

    await holidayWorkAssignmentRepository.findByDate(date, accessWhere);

    expect(mockedPrisma.holidayWorkAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { date, status: "ACTIVA", employee: accessWhere } }),
    );
  });
});

describe("findExisting/create/update — Etapa 12D", () => {
  it("findExisting consulta por el unique compuesto date_employeeId", async () => {
    mockedPrisma.holidayWorkAssignment.findUnique.mockResolvedValue(null);
    const date = new Date("2026-08-27");

    await holidayWorkAssignmentRepository.findExisting(date, "employee-1");

    expect(mockedPrisma.holidayWorkAssignment.findUnique).toHaveBeenCalledWith({ where: { date_employeeId: { date, employeeId: "employee-1" } } });
  });

  it("create persiste turno/horario/notas y createdByUserId/updatedByUserId", async () => {
    mockedPrisma.holidayWorkAssignment.create.mockResolvedValue({ id: "hwa-1" });
    const date = new Date("2026-08-27");

    await holidayWorkAssignmentRepository.create(date, "employee-1", { employeeId: "employee-1", status: "ACTIVA", shiftTemplateId: "template-1", expectedStartTime: "08:00", expectedEndTime: "16:00", notes: "Convocado" }, "user-1");

    expect(mockedPrisma.holidayWorkAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          date,
          employeeId: "employee-1",
          status: "ACTIVA",
          shiftTemplateId: "template-1",
          expectedStartTime: "08:00",
          expectedEndTime: "16:00",
          notes: "Convocado",
          createdByUserId: "user-1",
          updatedByUserId: "user-1",
        }),
      }),
    );
  });

  it("update cambia status/horario/notas y updatedByUserId, sin tocar createdByUserId", async () => {
    mockedPrisma.holidayWorkAssignment.update.mockResolvedValue({ id: "hwa-1" });

    await holidayWorkAssignmentRepository.update("hwa-1", { employeeId: "employee-1", status: "CANCELADA", shiftTemplateId: null, expectedStartTime: null, expectedEndTime: null, notes: "Ya no viene" }, "user-2");

    expect(mockedPrisma.holidayWorkAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "hwa-1" },
        data: expect.objectContaining({ status: "CANCELADA", notes: "Ya no viene", updatedByUserId: "user-2" }),
      }),
    );
    expect(mockedPrisma.holidayWorkAssignment.update.mock.calls[0]![0].data.createdByUserId).toBeUndefined();
  });
});
