import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { Prisma } from "@prisma/client";
import { hourConceptsService } from "./hourConcepts.service";
import { hourConceptsRepository, invalidateHourConceptsCache } from "./hourConcepts.repository";
import { auditService } from "../audit/audit.service";
import { roles } from "../../shared/security/roles";

vi.mock("./hourConcepts.repository", () => ({
  invalidateHourConceptsCache: vi.fn(),
  hourConceptsRepository: {
    findMany: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findEmployees: vi.fn(),
    countExistingEmployees: vi.fn(),
    findEmployeeHourConcept: vi.fn(),
    enableForEmployees: vi.fn(),
    disableForEmployee: vi.fn(),
    findWithUsage: vi.fn(),
    delete: vi.fn(),
    disableAllEmployees: vi.fn(),
    deactivateAllRules: vi.fn(),
    softDelete: vi.fn(),
  },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(undefined) },
}));

const repo = hourConceptsRepository as unknown as {
  findMany: Mock;
  findById: Mock;
  create: Mock;
  update: Mock;
  findEmployees: Mock;
  countExistingEmployees: Mock;
  findEmployeeHourConcept: Mock;
  enableForEmployees: Mock;
  disableForEmployee: Mock;
  findWithUsage: Mock;
  delete: Mock;
  disableAllEmployees: Mock;
  deactivateAllRules: Mock;
  softDelete: Mock;
};
const mockedAudit = auditService.register as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
});

function prismaKnownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("mock prisma error", { code, clientVersion: "0.0.0" });
}

const rrhhUser = { id: "user-rrhh", role: roles.rrhh } as Express.AuthUser;
const employeeRow = {
  employeeId: "employee-1",
  employee: {
    id: "employee-1",
    legajo: "100",
    cuil: "20-12345678-9",
    firstName: "Ana",
    lastName: "Prueba",
    status: "ACTIVO",
    sector: { id: "sector-1", name: "Campo" },
    costCenter: null,
    companies: [{ company: { id: "company-1", name: "OD" } }],
  },
};

describe("listEmployees — empleados habilitados (Etapa 8G)", () => {
  it("rechaza concepto inexistente (404), sin llegar a consultar empleados", async () => {
    repo.findById.mockRejectedValue(prismaKnownError("P2025"));

    await expect(
      hourConceptsService.listEmployees("concept-inexistente", { page: 1, take: 50 } as never, rrhhUser),
    ).rejects.toMatchObject({ statusCode: 404, code: "HOUR_CONCEPT_NOT_FOUND" });
    expect(repo.findEmployees).not.toHaveBeenCalled();
  });

  it("lista empleados habilitados, mapeando employeeId y los datos del empleado", async () => {
    repo.findById.mockResolvedValue({ id: "concept-1" });
    repo.findEmployees.mockResolvedValue([[employeeRow], 1]);

    const result = await hourConceptsService.listEmployees("concept-1", { page: 1, take: 50 } as never, rrhhUser);

    expect(result.items).toEqual([
      {
        employeeId: "employee-1",
        employee: {
          id: "employee-1",
          legajo: "100",
          cuil: "20-12345678-9",
          firstName: "Ana",
          lastName: "Prueba",
          status: "ACTIVO",
          sector: { id: "sector-1", name: "Campo" },
          costCenter: null,
          companies: [{ id: "company-1", name: "OD" }],
        },
      },
    ]);
    expect(result.meta).toMatchObject({ total: 1, page: 1, pageSize: 50 });
  });

  it("no devuelve empleados no habilitados: si el repository no los trae, la lista queda vacía sin inventar filas", async () => {
    repo.findById.mockResolvedValue({ id: "concept-1" });
    repo.findEmployees.mockResolvedValue([[], 0]);

    const result = await hourConceptsService.listEmployees("concept-1", { page: 1, take: 50 } as never, rrhhUser);

    expect(result.items).toEqual([]);
    expect(result.meta.total).toBe(0);
  });

  it("pasa los filtros (search/sectorId/costCenterId/companyId/status/page/take) al repository sin transformarlos", async () => {
    repo.findById.mockResolvedValue({ id: "concept-1" });
    repo.findEmployees.mockResolvedValue([[], 0]);

    const query = { search: "perez", sectorId: "sector-1", costCenterId: "cc-1", companyId: "company-1", status: "ACTIVO", page: 2, take: 25 } as never;
    await hourConceptsService.listEmployees("concept-1", query, rrhhUser);

    expect(repo.findEmployees).toHaveBeenCalledWith("concept-1", query, {});
  });

  it("respeta el patrón de permisos por área: un usuario de supervisión no recibe accessWhere vacío como RRHH", async () => {
    repo.findById.mockResolvedValue({ id: "concept-1" });
    repo.findEmployees.mockResolvedValue([[], 0]);
    const supervisionUser = { id: "user-sup", role: roles.supervision } as Express.AuthUser;

    await hourConceptsService.listEmployees("concept-1", { page: 1, take: 50 } as never, supervisionUser);

    const accessWhereUsed = repo.findEmployees.mock.calls.at(0)?.[2];
    expect(accessWhereUsed).not.toEqual({});
    expect(accessWhereUsed).toMatchObject({ assignments: { some: expect.objectContaining({ type: "TIME_RESPONSIBLE", userId: "user-sup" }) } });
  });
});

describe("mockedAudit/invalidateHourConceptsCache no se disparan por listEmployees (es solo lectura)", () => {
  it("no audita ni invalida cache al listar empleados", async () => {
    repo.findById.mockResolvedValue({ id: "concept-1" });
    repo.findEmployees.mockResolvedValue([[], 0]);

    await hourConceptsService.listEmployees("concept-1", { page: 1, take: 50 } as never, rrhhUser);

    expect(mockedAudit).not.toHaveBeenCalled();
    expect(invalidateHourConceptsCache).not.toHaveBeenCalled();
  });
});

describe("update — concepto administrado por el sistema", () => {
  it("no permite desactivar ni editar NORMAL_BASE desde el CRUD genérico", async () => {
    repo.findById.mockResolvedValue({ id: "normal-1", systemRole: "NORMAL_BASE" });

    await expect(hourConceptsService.update("normal-1", { status: "INACTIVO" }, { userId: "user-1" })).rejects.toMatchObject({
      statusCode: 409,
      code: "HOUR_CONCEPT_SYSTEM_MANAGED",
    });
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe("enableEmployees — habilitar desde el concepto (Etapa 8N)", () => {
  it("rechaza asignar NORMAL_BASE porque Horas normales existe para todo legajo", async () => {
    repo.findById.mockResolvedValue({ id: "normal-1", systemRole: "NORMAL_BASE" });

    await expect(
      hourConceptsService.enableEmployees("normal-1", { employeeIds: ["employee-1"] }, { userId: "user-1" }),
    ).rejects.toMatchObject({ statusCode: 409, code: "HOUR_CONCEPT_BASE_NOT_ASSIGNABLE" });
    expect(repo.countExistingEmployees).not.toHaveBeenCalled();
    expect(repo.enableForEmployees).not.toHaveBeenCalled();
  });

  it("rechaza concepto inexistente (404), sin llegar a habilitar nada", async () => {
    repo.findById.mockRejectedValue(prismaKnownError("P2025"));

    await expect(
      hourConceptsService.enableEmployees("concept-inexistente", { employeeIds: ["employee-1"] }, { userId: "user-1" }),
    ).rejects.toMatchObject({ statusCode: 404, code: "HOUR_CONCEPT_NOT_FOUND" });
    expect(repo.enableForEmployees).not.toHaveBeenCalled();
  });

  it("rechaza si algún empleado no existe (404), sin llegar a habilitar nada", async () => {
    repo.findById.mockResolvedValue({ id: "concept-1" });
    repo.countExistingEmployees.mockResolvedValue(1); // pidieron 2, solo existe 1

    await expect(
      hourConceptsService.enableEmployees("concept-1", { employeeIds: ["employee-1", "employee-inexistente"] }, { userId: "user-1" }),
    ).rejects.toMatchObject({ statusCode: 404, code: "EMPLOYEE_NOT_FOUND" });
    expect(repo.enableForEmployees).not.toHaveBeenCalled();
  });

  it("habilita a los empleados reales, deduplicando ids repetidos, y audita CREATE", async () => {
    repo.findById.mockResolvedValue({ id: "concept-1" });
    repo.countExistingEmployees.mockResolvedValue(2);
    repo.enableForEmployees.mockResolvedValue({ count: 2 });

    const result = await hourConceptsService.enableEmployees(
      "concept-1",
      { employeeIds: ["employee-1", "employee-2", "employee-1"] },
      { userId: "user-1" },
    );

    expect(repo.enableForEmployees).toHaveBeenCalledWith("concept-1", ["employee-1", "employee-2"]);
    expect(result).toEqual({ hourConceptId: "concept-1", employeeIds: ["employee-1", "employee-2"] });
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE", entity: "EmployeeHourConcept", entityId: "concept-1" }));
  });
});

describe("disableEmployee — quitar desde el concepto (Etapa 8N)", () => {
  it("rechaza concepto inexistente (404)", async () => {
    repo.findById.mockRejectedValue(prismaKnownError("P2025"));

    await expect(
      hourConceptsService.disableEmployee("concept-inexistente", "employee-1", { userId: "user-1" }),
    ).rejects.toMatchObject({ statusCode: 404, code: "HOUR_CONCEPT_NOT_FOUND" });
    expect(repo.disableForEmployee).not.toHaveBeenCalled();
  });

  it("rechaza si el empleado no tiene el concepto habilitado (404), sin intentar borrar", async () => {
    repo.findById.mockResolvedValue({ id: "concept-1" });
    repo.findEmployeeHourConcept.mockResolvedValue(null);

    await expect(
      hourConceptsService.disableEmployee("concept-1", "employee-1", { userId: "user-1" }),
    ).rejects.toMatchObject({ statusCode: 404, code: "EMPLOYEE_HOUR_CONCEPT_NOT_FOUND" });
    expect(repo.disableForEmployee).not.toHaveBeenCalled();
  });

  it("quita al empleado y audita DELETE", async () => {
    repo.findById.mockResolvedValue({ id: "concept-1" });
    repo.findEmployeeHourConcept.mockResolvedValue({ employeeId: "employee-1", hourConceptId: "concept-1" });
    repo.disableForEmployee.mockResolvedValue({ employeeId: "employee-1", hourConceptId: "concept-1" });

    const result = await hourConceptsService.disableEmployee("concept-1", "employee-1", { userId: "user-1" });

    expect(repo.disableForEmployee).toHaveBeenCalledWith("concept-1", "employee-1");
    expect(result).toEqual({ hourConceptId: "concept-1", employeeId: "employee-1" });
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "DELETE", entity: "EmployeeHourConcept", entityId: "concept-1" }));
  });
});

const zeroUsage = { employees: 0, timeEntries: 0, novelties: 0, timeSegments: 0, workShifts: 0, rules: 0 };
const realUsage = { employees: 2, timeEntries: 5, novelties: 1, timeSegments: 8, workShifts: 3, rules: 1 };

describe("remove — sin uso: delete físico (Etapa 8O)", () => {
  it("no permite eliminar ni desactivar el NORMAL_BASE administrado por el sistema", async () => {
    repo.findWithUsage.mockResolvedValue({
      id: "normal-1",
      code: "HC-NORMAL",
      name: "Hora normal",
      systemRole: "NORMAL_BASE",
      _count: zeroUsage,
    });

    await expect(hourConceptsService.remove("normal-1", true, { userId: "user-1" })).rejects.toMatchObject({
      statusCode: 409,
      code: "HOUR_CONCEPT_SYSTEM_MANAGED",
    });
    expect(repo.delete).not.toHaveBeenCalled();
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it("rechaza concepto inexistente (404), sin llegar a borrar nada", async () => {
    repo.findWithUsage.mockRejectedValue(prismaKnownError("P2025"));

    await expect(hourConceptsService.remove("concept-inexistente", false, { userId: "user-1" })).rejects.toMatchObject({
      statusCode: 404,
      code: "HOUR_CONCEPT_NOT_FOUND",
    });
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it("elimina físicamente cuando no hay uso en ninguna relación, invalida cache y audita DELETE", async () => {
    repo.findWithUsage.mockResolvedValue({ id: "concept-1", code: "HOR-001", name: "Sereno", _count: zeroUsage });
    repo.delete.mockResolvedValue({ id: "concept-1" });

    const result = await hourConceptsService.remove("concept-1", false, { userId: "user-1" });

    expect(repo.delete).toHaveBeenCalledWith("concept-1");
    expect(repo.disableAllEmployees).not.toHaveBeenCalled();
    expect(repo.softDelete).not.toHaveBeenCalled();
    expect(invalidateHourConceptsCache).toHaveBeenCalled();
    expect(result).toEqual({ id: "concept-1", code: "HOR-001", name: "Sereno", mode: "DELETED" });
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "DELETE", entity: "HourConcept", entityId: "concept-1" }));
  });

  it("elimina físicamente aunque force=true si de todas formas no hay uso (force no cambia este camino)", async () => {
    repo.findWithUsage.mockResolvedValue({ id: "concept-1", code: "HOR-001", name: "Sereno", _count: zeroUsage });
    repo.delete.mockResolvedValue({ id: "concept-1" });

    const result = await hourConceptsService.remove("concept-1", true, { userId: "user-1" });

    expect(repo.delete).toHaveBeenCalledWith("concept-1");
    expect(result.mode).toBe("DELETED");
  });
});

describe("remove — con uso e force=false: bloquea (Etapa 8P)", () => {
  it.each([
    ["employees", { ...zeroUsage, employees: 1 }],
    ["timeEntries", { ...zeroUsage, timeEntries: 3 }],
    ["novelties", { ...zeroUsage, novelties: 1 }],
    ["timeSegments", { ...zeroUsage, timeSegments: 5 }],
    ["workShifts", { ...zeroUsage, workShifts: 1 }],
    ["rules", { ...zeroUsage, rules: 2 }],
  ])("bloquea con 409 HOUR_CONCEPT_IN_USE si hay uso en %s, sin borrar ni auditar", async (_relation, counts) => {
    repo.findWithUsage.mockResolvedValue({ id: "concept-1", code: "HOR-001", name: "Sereno", _count: counts });

    await expect(hourConceptsService.remove("concept-1", false, { userId: "user-1" })).rejects.toMatchObject({
      statusCode: 409,
      code: "HOUR_CONCEPT_IN_USE",
    });
    expect(repo.delete).not.toHaveBeenCalled();
    expect(repo.disableAllEmployees).not.toHaveBeenCalled();
    expect(repo.softDelete).not.toHaveBeenCalled();
    expect(mockedAudit).not.toHaveBeenCalled();
  });
});

describe("remove — con uso y force=true: baja lógica, nunca toca historial (Etapa 8P)", () => {
  it("desvincula empleados, desactiva reglas, marca INACTIVO+deletedAt, invalida cache y audita — nunca llama a delete físico", async () => {
    repo.findWithUsage.mockResolvedValue({ id: "concept-1", code: "HOR-001", name: "Sereno", _count: realUsage });
    repo.disableAllEmployees.mockResolvedValue({ count: realUsage.employees });
    repo.deactivateAllRules.mockResolvedValue({ count: realUsage.rules });
    repo.softDelete.mockResolvedValue({ id: "concept-1", code: "HOR-001", name: "Sereno" });

    const result = await hourConceptsService.remove("concept-1", true, { userId: "user-1" });

    expect(repo.disableAllEmployees).toHaveBeenCalledWith("concept-1");
    expect(repo.deactivateAllRules).toHaveBeenCalledWith("concept-1");
    expect(repo.softDelete).toHaveBeenCalledWith("concept-1");
    expect(repo.delete).not.toHaveBeenCalled();
    expect(invalidateHourConceptsCache).toHaveBeenCalled();
    expect(result).toEqual({ id: "concept-1", code: "HOR-001", name: "Sereno", mode: "SOFT_DELETED" });
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "DELETE", entity: "HourConcept", entityId: "concept-1", description: expect.stringContaining("baja lógica") }),
    );
  });

  it("rechaza concepto inexistente (404) antes de tocar ninguna relación", async () => {
    repo.findWithUsage.mockRejectedValue(prismaKnownError("P2025"));

    await expect(hourConceptsService.remove("concept-inexistente", true, { userId: "user-1" })).rejects.toMatchObject({
      statusCode: 404,
      code: "HOUR_CONCEPT_NOT_FOUND",
    });
    expect(repo.disableAllEmployees).not.toHaveBeenCalled();
  });
});
