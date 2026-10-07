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
    findGeneratedCodes: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateReinterpretingHistory: vi.fn(),
    findEmployees: vi.fn(),
    countExistingEmployees: vi.fn(),
    findEmployeeHourConcept: vi.fn(),
    enableForEmployees: vi.fn(),
    disableForEmployee: vi.fn(),
    findWithUsage: vi.fn(),
    deletePermanently: vi.fn(),
    employeeReferences: vi.fn(),
  },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(undefined) },
}));

const repo = hourConceptsRepository as unknown as {
  findMany: Mock;
  findGeneratedCodes: Mock;
  findById: Mock;
  create: Mock;
  update: Mock;
  updateReinterpretingHistory: Mock;
  findEmployees: Mock;
  countExistingEmployees: Mock;
  findEmployeeHourConcept: Mock;
  enableForEmployees: Mock;
  disableForEmployee: Mock;
  findWithUsage: Mock;
  deletePermanently: Mock;
  employeeReferences: Mock;
};
const mockedAudit = auditService.register as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  repo.employeeReferences.mockResolvedValue(() => "un legajo sin identificar");
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

describe("list — contrato 6E", () => {
  it("conserva loadMode y systemRole para distinguir base y adicionales", async () => {
    repo.findMany.mockResolvedValue([[
      { id: "normal-1", code: "HC-NORMAL", systemRole: "NORMAL_BASE", loadMode: null },
      { id: "sereno-1", code: "HOR-001", systemRole: null, loadMode: "AUTOMATIC" },
    ], 2]);
    const result = await hourConceptsService.list({ page: 1, take: 100 } as never);
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ systemRole: "NORMAL_BASE", loadMode: null }),
      expect.objectContaining({ systemRole: null, loadMode: "AUTOMATIC" }),
    ]));
  });
});

describe("nextCode — código automático desde la base", () => {
  it("si el catálogo visible termina en HOR-004 pero HOR-005 está ocupado, devuelve HOR-006", async () => {
    repo.findGeneratedCodes.mockResolvedValue(["001", "002", "003", "004", "005"].map((suffix) => ({ code: `HOR-${suffix}` })));

    await expect(hourConceptsService.nextCode()).resolves.toEqual({ code: "HOR-006" });
  });

  it("reutiliza el primer hueco liberado por una eliminación definitiva", async () => {
    repo.findGeneratedCodes.mockResolvedValue(["001", "002", "003", "004", "006"].map((suffix) => ({ code: `HOR-${suffix}` })));

    await expect(hourConceptsService.nextCode()).resolves.toEqual({ code: "HOR-005" });
  });
});

describe("create — carrera por código automático", () => {
  it("mantiene UNIQUE como autoridad y traduce P2002 a un 409 accionable", async () => {
    repo.create.mockRejectedValue(prismaKnownError("P2002"));

    await expect(hourConceptsService.create({ code: "HOR-005" } as never)).rejects.toMatchObject({
      statusCode: 409,
      code: "HOUR_CONCEPT_UNIQUE_CONSTRAINT",
      message: expect.stringContaining("código acaba de ser utilizado"),
    });
  });
});

describe("listEmployees — empleados habilitados (Etapa 8G)", () => {
  it("rechaza concepto inexistente (404), sin llegar a consultar empleados", async () => {
    repo.findById.mockRejectedValue(prismaKnownError("P2025"));

    await expect(
      hourConceptsService.listEmployees("concept-inexistente", { page: 1, take: 50 } as never, rrhhUser),
    ).rejects.toMatchObject({ statusCode: 404, code: "HOUR_CONCEPT_NOT_FOUND" });
    expect(repo.findEmployees).not.toHaveBeenCalled();
  });

  it("lista empleados habilitados, mapeando employeeId y los datos del empleado", async () => {
    repo.findById.mockResolvedValue({ id: "concept-1", status: "ACTIVO", systemRole: null });
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
          position: null,
          costCenter: null,
          companies: [{ id: "company-1", name: "OD" }],
        },
      },
    ]);
    expect(result.meta).toMatchObject({ total: 1, page: 1, pageSize: 50 });
  });

  it("no devuelve empleados no habilitados: si el repository no los trae, la lista queda vacía sin inventar filas", async () => {
    repo.findById.mockResolvedValue({ id: "concept-1", status: "ACTIVO", systemRole: null });
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

// docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §2: workTreatment es una
// clasificación corregible por RRHH aunque el concepto ya tenga horas.
describe("update — corrección del tratamiento en el total trabajado", () => {
  const prueba = { id: "prueba", code: "HOR-005", name: "Prueba 02", systemRole: null, workTreatment: "ADDITIVE_TO_WORKED_TOTAL" };
  const rebuiltClosure = {
    id: "closure-1",
    employeeId: "emp-1",
    period: "2026-10",
    before: { accounting: { totalWorkedMinutes: 600 } },
    after: { accounting: { totalWorkedMinutes: 480 } },
  };

  it("permite cambiarlo aunque el concepto tenga horas: actualiza el concepto (sin tocar desgloses) y recalcula cierres en la misma operación", async () => {
    repo.findById.mockResolvedValue(prueba);
    repo.updateReinterpretingHistory.mockResolvedValue({
      item: { ...prueba, workTreatment: "WITHIN_BASE" },
      reinterpreted: { breakdowns: 6, employees: 2, periods: 3 },
      rebuiltClosures: [rebuiltClosure],
    });

    const item = await hourConceptsService.update("prueba", { workTreatment: "WITHIN_BASE" }, { userId: "user-1" });

    expect(item).toMatchObject({ id: "prueba", workTreatment: "WITHIN_BASE" });
    expect(repo.updateReinterpretingHistory).toHaveBeenCalledWith("prueba", { workTreatment: "WITHIN_BASE" }, {
      reason: "HOUR_CONCEPT_WORK_TREATMENT_CHANGED",
      hourConceptId: "prueba",
      hourConceptCode: "HOR-005",
    });
    expect(repo.update).not.toHaveBeenCalled();
    expect(invalidateHourConceptsCache).toHaveBeenCalled();
  });

  it("audita concepto, tratamiento anterior y nuevo, usuario y alcance (desgloses/legajos/períodos/cierres)", async () => {
    repo.findById.mockResolvedValue(prueba);
    repo.updateReinterpretingHistory.mockResolvedValue({
      item: { ...prueba, workTreatment: "WITHIN_BASE" },
      reinterpreted: { breakdowns: 6, employees: 2, periods: 3 },
      rebuiltClosures: [rebuiltClosure],
    });

    await hourConceptsService.update("prueba", { workTreatment: "WITHIN_BASE" }, { userId: "user-1" });

    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      action: "UPDATE",
      entity: "HourConcept",
      entityId: "prueba",
      description: expect.stringMatching(/HOR-005 - Prueba 02 de "Horas adicionales" a "Dentro de la jornada"\. 6 desglose\(s\) de 2 legajo\(s\) en 3 período\(s\).*1 cierre\(s\)/),
      before: expect.objectContaining({ workTreatment: "ADDITIVE_TO_WORKED_TOTAL" }),
      after: expect.objectContaining({ workTreatment: "WITHIN_BASE", reinterpreted: { breakdowns: 6, employees: 2, periods: 3 }, recalculatedClosureIds: ["closure-1"] }),
    }));
    // Un AuditLog por cierre recalculado, con el snapshot anterior y el nuevo.
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      action: "UPDATE",
      entity: "MonthlyTimeClosure",
      entityId: "closure-1",
      before: { snapshot: rebuiltClosure.before },
      after: { snapshot: rebuiltClosure.after },
    }));
  });

  it("sin cambio de tratamiento (o sin enviarlo) es una edición común: no reinterpreta ni recalcula cierres", async () => {
    repo.findById.mockResolvedValue(prueba);
    repo.update.mockResolvedValue({ ...prueba, name: "Renombrado" });

    await hourConceptsService.update("prueba", { workTreatment: "ADDITIVE_TO_WORKED_TOTAL", name: "Renombrado" }, { userId: "user-1" });
    await hourConceptsService.update("prueba", { status: "INACTIVO" }, { userId: "user-1" });

    expect(repo.update).toHaveBeenCalledTimes(2);
    expect(repo.updateReinterpretingHistory).not.toHaveBeenCalled();
  });

  it("también se corrige en el otro sentido (dentro de la jornada → horas adicionales) con horas cargadas", async () => {
    repo.findById.mockResolvedValue({ ...prueba, workTreatment: "WITHIN_BASE" });
    repo.updateReinterpretingHistory.mockResolvedValue({ item: prueba, reinterpreted: { breakdowns: 9, employees: 1, periods: 1 }, rebuiltClosures: [] });

    await expect(hourConceptsService.update("prueba", { workTreatment: "ADDITIVE_TO_WORKED_TOTAL" })).resolves.toMatchObject({ id: "prueba" });
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
    repo.findById.mockResolvedValue({ id: "concept-1", status: "ACTIVO", systemRole: null });
    repo.countExistingEmployees.mockResolvedValue(1); // pidieron 2, solo existe 1

    await expect(
      hourConceptsService.enableEmployees("concept-1", { employeeIds: ["employee-1", "employee-inexistente"] }, { userId: "user-1" }),
    ).rejects.toMatchObject({ statusCode: 404, code: "EMPLOYEE_NOT_FOUND" });
    expect(repo.enableForEmployees).not.toHaveBeenCalled();
  });

  it("habilita a los empleados reales, deduplicando ids repetidos, y audita CREATE", async () => {
    repo.findById.mockResolvedValue({ id: "concept-1", status: "ACTIVO", systemRole: null });
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

  it("rechaza asignar un concepto adicional inactivo", async () => {
    repo.findById.mockResolvedValue({ id: "concept-1", status: "INACTIVO", systemRole: null });
    await expect(
      hourConceptsService.enableEmployees("concept-1", { employeeIds: ["employee-1"] }),
    ).rejects.toMatchObject({ statusCode: 409, code: "HOUR_CONCEPT_NOT_ASSIGNABLE" });
    expect(repo.enableForEmployees).not.toHaveBeenCalled();
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

const usage = { employees: 2, timeEntries: 0, novelties: 1, timeSegments: 8, workShifts: 0, rules: 1, breakdowns: 12 };
const conceptWithUsage = { id: "concept-1", code: "HOR-005", name: "Prueba 02", kind: "OTRO", status: "ACTIVO", loadMode: "BOTH", workTreatment: "ADDITIVE_TO_WORKED_TOTAL", systemRole: null, _count: usage };
const deletionResult = {
  concept: { id: "concept-1", code: "HOR-005", name: "Prueba 02" },
  deletedBreakdowns: 12,
  deletedRules: 1,
  deletedEmployeeAssignments: 2,
  reclassifiedSegments: 8,
  reclassifiedWorkShifts: 0,
  unlinkedNovelties: 1,
  rebuiltClosures: [{ id: "closure-1", employeeId: "emp-1", period: "2026-10", before: { a: 1 }, after: { a: 2 } }],
};

// docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §14: Eliminar es definitivo
// (no hay baja lógica ni segunda confirmación con force); Deshabilitar es lo
// que conserva la historia.
describe("remove — eliminación definitiva", () => {
  it("no permite eliminar el NORMAL_BASE administrado por el sistema", async () => {
    repo.findWithUsage.mockResolvedValue({ ...conceptWithUsage, id: "normal-1", code: "HC-NORMAL", systemRole: "NORMAL_BASE" });

    await expect(hourConceptsService.remove("normal-1", { userId: "user-1" })).rejects.toMatchObject({
      statusCode: 409,
      code: "HOUR_CONCEPT_SYSTEM_MANAGED",
    });
    expect(repo.deletePermanently).not.toHaveBeenCalled();
  });

  it("rechaza concepto inexistente (404), sin llegar a borrar nada", async () => {
    repo.findWithUsage.mockRejectedValue(prismaKnownError("P2025"));

    await expect(hourConceptsService.remove("concept-inexistente", { userId: "user-1" })).rejects.toMatchObject({
      statusCode: 404,
      code: "HOUR_CONCEPT_NOT_FOUND",
    });
    expect(repo.deletePermanently).not.toHaveBeenCalled();
  });

  it("con historial (desgloses, reglas, habilitaciones, segmentos, novedades) elimina en un único paso, sin pedir force", async () => {
    repo.findWithUsage.mockResolvedValue(conceptWithUsage);
    repo.deletePermanently.mockResolvedValue(deletionResult);

    const result = await hourConceptsService.remove("concept-1", { userId: "user-1" });

    expect(repo.deletePermanently).toHaveBeenCalledWith("concept-1", { reason: "HOUR_CONCEPT_DELETED", hourConceptId: "concept-1", hourConceptCode: "HOR-005" });
    expect(invalidateHourConceptsCache).toHaveBeenCalled();
    expect(result).toEqual({
      concept: { id: "concept-1", code: "HOR-005", name: "Prueba 02" },
      deletedBreakdowns: 12,
      deletedRules: 1,
      deletedEmployeeAssignments: 2,
      reclassifiedSegments: 8,
      reclassifiedWorkShifts: 0,
      unlinkedNovelties: 1,
      recalculatedClosures: 1,
    });
  });

  it("audita el concepto completo y su uso antes de borrar, el resumen de lo borrado y cada cierre recalculado", async () => {
    repo.findWithUsage.mockResolvedValue(conceptWithUsage);
    repo.deletePermanently.mockResolvedValue(deletionResult);

    await hourConceptsService.remove("concept-1", { userId: "user-1" });

    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      action: "DELETE",
      entity: "HourConcept",
      entityId: "concept-1",
      description: expect.stringContaining("Se eliminó definitivamente el concepto horario HOR-005 - Prueba 02"),
      before: conceptWithUsage,
      after: expect.objectContaining({ deletedBreakdowns: 12, deletedRules: 1, deletedEmployeeAssignments: 2, recalculatedClosureIds: ["closure-1"] }),
    }));
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE", entity: "MonthlyTimeClosure", entityId: "closure-1" }));
  });

  it("con TimeEntry legacy del concepto (modelo previo a 6L) no borra nada: 409, porque esos minutos pueden ser jornada trabajada", async () => {
    repo.findWithUsage.mockResolvedValue({ ...conceptWithUsage, _count: { ...usage, timeEntries: 3 } });

    await expect(hourConceptsService.remove("concept-1", { userId: "user-1" })).rejects.toMatchObject({
      statusCode: 409,
      code: "HOUR_CONCEPT_HAS_LEGACY_TIME_ENTRIES",
    });
    expect(repo.deletePermanently).not.toHaveBeenCalled();
    expect(mockedAudit).not.toHaveBeenCalled();
  });

  it("si se cargaron horas del concepto durante la eliminación (FK RESTRICT), la transacción no borra nada y responde 409 claro", async () => {
    repo.findWithUsage.mockResolvedValue(conceptWithUsage);
    repo.deletePermanently.mockRejectedValue(prismaKnownError("P2003"));

    await expect(hourConceptsService.remove("concept-1", { userId: "user-1" })).rejects.toMatchObject({
      statusCode: 409,
      code: "HOUR_CONCEPT_CHANGED_DURING_DELETE",
    });
    expect(mockedAudit).not.toHaveBeenCalled();
  });
});

// Lenguaje de negocio en auditoría: el employeeId (UUID) nunca va en el texto
// visible; se usa la identidad humana "Apellido, Nombre · Legajo N".
describe("auditoría — identidad humana del legajo, nunca el employeeId", () => {
  const employeeUuid = "016dc01c-655d-4474-8319-67f1b8108c93";
  const otherEmployeeUuid = "5b0e6f0a-1c2d-4e3f-8a9b-0c1d2e3f4a5b";

  it("quitar un concepto a un empleado describe concepto y persona, sin el UUID", async () => {
    repo.findById.mockResolvedValue({ id: "concept-1", name: "Sereno" });
    repo.findEmployeeHourConcept.mockResolvedValue({
      employeeId: employeeUuid,
      hourConceptId: "concept-1",
      employee: { legajo: "30", firstName: "Juan", lastName: "Pérez" },
    });
    repo.disableForEmployee.mockResolvedValue({});

    await hourConceptsService.disableEmployee("concept-1", employeeUuid, { userId: "user-1" });

    const { description } = mockedAudit.mock.calls[0]![0];
    expect(description).toBe("Se quitó el concepto horario Sereno de Pérez, Juan · Legajo 30.");
    expect(description).not.toContain(employeeUuid);
  });

  it("recalcular cierres de varios legajos resuelve todas las identidades en una sola consulta", async () => {
    const references: Record<string, string> = {
      [employeeUuid]: "Pérez, Juan · Legajo 30",
      [otherEmployeeUuid]: "Gómez, Ana · Legajo 31",
    };
    repo.employeeReferences.mockResolvedValue((id: string) => references[id]);
    repo.findById.mockResolvedValue({ id: "prueba", code: "HOR-005", name: "Prueba 02", systemRole: null, workTreatment: "ADDITIVE_TO_WORKED_TOTAL" });
    repo.updateReinterpretingHistory.mockResolvedValue({
      item: { id: "prueba", code: "HOR-005", name: "Prueba 02", workTreatment: "WITHIN_BASE" },
      reinterpreted: { breakdowns: 2, employees: 2, periods: 1 },
      rebuiltClosures: [
        { id: "closure-1", employeeId: employeeUuid, period: "2026-10", before: null, after: {} },
        { id: "closure-2", employeeId: otherEmployeeUuid, period: "2026-10", before: null, after: {} },
      ],
    });

    await hourConceptsService.update("prueba", { workTreatment: "WITHIN_BASE" }, { userId: "user-1" });

    expect(repo.employeeReferences).toHaveBeenCalledTimes(1);
    expect(repo.employeeReferences).toHaveBeenCalledWith([employeeUuid, otherEmployeeUuid]);
    const closureDescriptions = mockedAudit.mock.calls
      .map(([input]) => input)
      .filter((input) => input.entity === "MonthlyTimeClosure")
      .map((input) => input.description as string);
    expect(closureDescriptions).toEqual([
      expect.stringContaining("Se recalculó el snapshot del cierre de octubre de 2026 de Pérez, Juan · Legajo 30 por"),
      expect.stringContaining("Se recalculó el snapshot del cierre de octubre de 2026 de Gómez, Ana · Legajo 31 por"),
    ]);
    for (const description of closureDescriptions) {
      expect(description).not.toContain(employeeUuid);
      expect(description).not.toContain(otherEmployeeUuid);
    }
  });
});
