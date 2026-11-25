import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { holidayWorkAssignmentRepository } from "./holidayWorkAssignment.repository";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    employee: { findMany: vi.fn(), count: vi.fn() },
    holidayWorkAssignment: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn((operations: unknown[]) => Promise.all(operations)),
  },
}));

const mockedPrisma = prisma as unknown as {
  employee: { findMany: Mock; count: Mock };
  holidayWorkAssignment: { findMany: Mock; createMany: Mock; updateMany: Mock };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findCandidates — Etapa 12D", () => {
  it("no filtra ni selecciona el sector anterior del legajo (retirado en M2)", async () => {
    mockedPrisma.employee.findMany.mockResolvedValue([]);
    mockedPrisma.employee.count.mockResolvedValue(0);

    await holidayWorkAssignmentRepository.findCandidates({ page: 1, take: 100 }, {});

    const args = mockedPrisma.employee.findMany.mock.calls[0]![0];
    expect(JSON.stringify(args.where)).not.toContain("sectorId");
    expect(args.select).not.toHaveProperty("sector");
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

  // Etapa 14H.4: findMany/count ya no se piden dentro de una transacción
  // interactiva (antipatrón que serializaba 2 lecturas independientes en
  // una sola conexión) — ver holidayWorkAssignment.repository.ts.
  it("pagina con Promise.all([findMany, count]) — sin $transaction (Etapa 14H.4)", async () => {
    mockedPrisma.employee.findMany.mockResolvedValue([]);
    mockedPrisma.employee.count.mockResolvedValue(0);

    await holidayWorkAssignmentRepository.findCandidates({ page: 1, take: 100 }, {});

    expect((prisma as unknown as { $transaction: Mock }).$transaction).not.toHaveBeenCalled();
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

describe("escrituras en lote del guardado (fix/holiday-work-assignment-performance)", () => {
  const date = new Date("2026-08-27");
  const fields = { status: "ACTIVA" as const, shiftTemplateId: "template-1", expectedStartTime: "08:00", expectedEndTime: "16:00", notes: "Convocado" };

  it("findExistingForEmployees lee lo existente de la fecha para todos los empleados en una sola consulta", async () => {
    mockedPrisma.holidayWorkAssignment.findMany.mockResolvedValue([]);

    await holidayWorkAssignmentRepository.findExistingForEmployees(date, ["employee-1", "employee-2"]);

    expect(mockedPrisma.holidayWorkAssignment.findMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.holidayWorkAssignment.findMany).toHaveBeenCalledWith({ where: { date, employeeId: { in: ["employee-1", "employee-2"] } } });
  });

  it("createMany persiste turno/horario/notas y createdByUserId/updatedByUserId de todas las altas en una sola consulta", async () => {
    mockedPrisma.holidayWorkAssignment.createMany.mockResolvedValue({ count: 2 });

    await holidayWorkAssignmentRepository.createMany(date, [{ employeeId: "employee-1", fields }, { employeeId: "employee-2", fields: { ...fields, shiftTemplateId: null, notes: null } }], "user-1");

    expect(mockedPrisma.holidayWorkAssignment.createMany).toHaveBeenCalledWith({
      data: [
        { date, employeeId: "employee-1", ...fields, createdByUserId: "user-1", updatedByUserId: "user-1" },
        { date, employeeId: "employee-2", ...fields, shiftTemplateId: null, notes: null, createdByUserId: "user-1", updatedByUserId: "user-1" },
      ],
    });
  });

  it("updateMany cambia status/horario/notas y updatedByUserId, sin tocar createdByUserId", async () => {
    mockedPrisma.holidayWorkAssignment.updateMany.mockResolvedValue({ count: 2 });
    const cancel = { status: "CANCELADA" as const, shiftTemplateId: null, expectedStartTime: null, expectedEndTime: null, notes: null };

    await holidayWorkAssignmentRepository.updateMany(["hwa-1", "hwa-2"], cancel, "user-2");

    expect(mockedPrisma.holidayWorkAssignment.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["hwa-1", "hwa-2"] } }, data: { ...cancel, updatedByUserId: "user-2" } });
    expect(mockedPrisma.holidayWorkAssignment.updateMany.mock.calls[0]![0].data.createdByUserId).toBeUndefined();
  });

  it("findForEmployeesWithRelations devuelve las filas con empleado y turno para la respuesta y la auditoría", async () => {
    mockedPrisma.holidayWorkAssignment.findMany.mockResolvedValue([]);

    await holidayWorkAssignmentRepository.findForEmployeesWithRelations(date, ["employee-1"]);

    expect(mockedPrisma.holidayWorkAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { date, employeeId: { in: ["employee-1"] } },
      include: { employee: expect.any(Object), shiftTemplate: expect.any(Object) },
    }));
  });
});
