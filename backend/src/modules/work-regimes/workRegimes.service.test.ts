import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { Prisma } from "@prisma/client";
import { workRegimesService, resolveActiveWorkRegime } from "./workRegimes.service";
import { classifyWorkRegimeVigency, findActiveEmployeeWorkRegime, workRegimesRepository } from "./workRegimes.repository";
import { auditService } from "../audit/audit.service";
import { roles } from "../../shared/security/roles";

vi.mock("./workRegimes.repository", () => ({
  findActiveEmployeeWorkRegime: vi.fn(),
  classifyWorkRegimeVigency: vi.fn(() => "current"),
  workRegimesRepository: {
    findMany: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    employeeExists: vi.fn(),
    findHistoryByEmployee: vi.fn(),
    findAssignmentById: vi.fn(),
    findOverlappingAssignment: vi.fn(),
    createAssignment: vi.fn(),
    updateAssignment: vi.fn(),
    findEmployees: vi.fn(),
  },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(undefined) },
}));

const mockedFind = findActiveEmployeeWorkRegime as unknown as Mock;
const mockedClassify = classifyWorkRegimeVigency as unknown as Mock;
const repo = workRegimesRepository as unknown as {
  findMany: Mock;
  findById: Mock;
  create: Mock;
  update: Mock;
  employeeExists: Mock;
  findHistoryByEmployee: Mock;
  findAssignmentById: Mock;
  findOverlappingAssignment: Mock;
  createAssignment: Mock;
  updateAssignment: Mock;
  findEmployees: Mock;
};
const mockedAudit = auditService.register as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveActiveWorkRegime", () => {
  it("devuelve null (fallback a comportamiento actual) si el empleado no tiene regimen vigente", async () => {
    mockedFind.mockResolvedValue(null);

    const result = await resolveActiveWorkRegime("employee-1", new Date("2026-08-18T15:00:00.000Z"));

    expect(result).toBeNull();
  });

  it("devuelve kind y alertOnOutOfShift del regimen vigente encontrado", async () => {
    mockedFind.mockResolvedValue({
      id: "assignment-1",
      workRegime: { kind: "SIN_TURNO", alertOnOutOfShift: false },
    });

    const result = await resolveActiveWorkRegime("employee-1", new Date("2026-08-18T15:00:00.000Z"));

    expect(result).toEqual({ kind: "SIN_TURNO", alertOnOutOfShift: false });
  });

  it("devuelve openShiftOverflowAction del regimen vigente (política de rollover por régimen)", async () => {
    mockedFind.mockResolvedValue({
      id: "assignment-1",
      workRegime: { kind: "TURNO_FLEXIBLE", alertOnOutOfShift: false, openShiftOverflowAction: "ALERT_ONLY" },
    });

    const result = await resolveActiveWorkRegime("employee-1", new Date("2026-08-18T15:00:00.000Z"));

    expect(result).toEqual({ kind: "TURNO_FLEXIBLE", alertOnOutOfShift: false, openShiftOverflowAction: "ALERT_ONLY" });
  });

  it("resuelve la fecha calendario Argentina del instante, no la fecha UTC (23:15 ART no es el dia siguiente)", async () => {
    mockedFind.mockResolvedValue(null);
    // 2026-08-18 23:15 ART = 2026-08-19 02:15 UTC.
    const instant = new Date("2026-08-19T02:15:00.000Z");

    await resolveActiveWorkRegime("employee-1", instant);

    const referenceDateUsed = mockedFind.mock.calls.at(0)?.[1] as Date;
    expect(referenceDateUsed.toISOString().slice(0, 10)).toBe("2026-08-18");
  });
});

function prismaKnownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("mock prisma error", { code, clientVersion: "0.0.0" });
}

const baseRegime = { id: "regime-1", code: "CAMPANA", name: "Campaña", kind: "TURNO_FLEXIBLE", alertOnOutOfShift: false, openShiftOverflowAction: "ALERT_ONLY", status: "ACTIVO" };

describe("WorkRegime CRUD", () => {
  it("crea un régimen laboral válido y lo audita", async () => {
    repo.create.mockResolvedValue(baseRegime);

    const item = await workRegimesService.create({ code: "CAMPANA", name: "Campaña", kind: "TURNO_FLEXIBLE" } as never, { userId: "user-1" });

    expect(item).toEqual(baseRegime);
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ code: "CAMPANA" }), "user-1");
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE", entity: "WorkRegime", entityId: "regime-1" }));
  });

  it("rechaza code duplicado (P2002) con 409", async () => {
    repo.create.mockRejectedValue(prismaKnownError("P2002"));

    await expect(workRegimesService.create({ code: "CAMPANA", name: "Campaña", kind: "TURNO_FLEXIBLE" } as never)).rejects.toMatchObject({
      statusCode: 409,
      code: "WORK_REGIME_UNIQUE_CONSTRAINT",
    });
  });

  it("lista con filtros por status/kind/search (passthrough al repository)", async () => {
    repo.findMany.mockResolvedValue([[baseRegime], 1]);

    const result = await workRegimesService.list({ page: 1, take: 100, kind: "TURNO_FLEXIBLE" } as never);

    expect(result.items).toEqual([baseRegime]);
    expect(result.meta).toMatchObject({ total: 1, page: 1, pageSize: 100 });
    expect(repo.findMany).toHaveBeenCalledWith(expect.objectContaining({ kind: "TURNO_FLEXIBLE" }));
  });

  it("edita name/description sin cambiar status -> audita UPDATE", async () => {
    repo.findById.mockResolvedValue(baseRegime);
    repo.update.mockResolvedValue({ ...baseRegime, name: "Campaña de verano" });

    await workRegimesService.update("regime-1", { name: "Campaña de verano" } as never, { userId: "user-1" });

    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE", entity: "WorkRegime" }));
  });

  it("inactiva un régimen (status ACTIVO -> INACTIVO) audita DEACTIVATE", async () => {
    repo.findById.mockResolvedValue(baseRegime);
    repo.update.mockResolvedValue({ ...baseRegime, status: "INACTIVO" });

    await workRegimesService.updateStatus("regime-1", "INACTIVO", { userId: "user-1" });

    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "DEACTIVATE", entity: "WorkRegime" }));
  });
});

describe("EmployeeWorkRegime — asignación con vigencia", () => {
  const employeeId = "employee-1";
  const assignment = { id: "assignment-1", employeeId, workRegimeId: "regime-1", effectiveFrom: new Date("2026-01-01"), effectiveTo: null, workRegime: baseRegime };

  it("asigna régimen a empleado con effectiveFrom y lo audita", async () => {
    repo.employeeExists.mockResolvedValue({ id: employeeId });
    repo.findById.mockResolvedValue(baseRegime);
    repo.findOverlappingAssignment.mockResolvedValue(null);
    repo.createAssignment.mockResolvedValue(assignment);

    const item = await workRegimesService.assign(employeeId, { workRegimeId: "regime-1", effectiveFrom: new Date("2026-01-01") } as never, { userId: "user-1" });

    expect(item).toEqual(assignment);
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE", entity: "EmployeeWorkRegime" }));
  });

  // Etapa 10B (hallazgo 10A §7/§11): entityId debe ser el id del EMPLEADO,
  // no el id de la fila de asignación (assignment.id) — de lo contrario el
  // cambio de régimen no aparece en el tab "Historial de Eventos"/"Auditoría"
  // del propio legajo, que filtra por entityId=employee.id.
  it("audita la asignación con entityId=employeeId (no el id de la asignación) para que aparezca en el historial del legajo", async () => {
    repo.employeeExists.mockResolvedValue({ id: employeeId });
    repo.findById.mockResolvedValue(baseRegime);
    repo.findOverlappingAssignment.mockResolvedValue(null);
    repo.createAssignment.mockResolvedValue(assignment); // assignment.id = "assignment-1", distinto de employeeId

    await workRegimesService.assign(employeeId, { workRegimeId: "regime-1", effectiveFrom: new Date("2026-01-01") } as never, { userId: "user-1" });

    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ entity: "EmployeeWorkRegime", entityId: employeeId }));
    expect(mockedAudit).not.toHaveBeenCalledWith(expect.objectContaining({ entityId: assignment.id }));
  });

  it("rechaza employeeId inexistente (404), sin llegar a crear la asignación", async () => {
    repo.employeeExists.mockResolvedValue(null);

    await expect(
      workRegimesService.assign(employeeId, { workRegimeId: "regime-1", effectiveFrom: new Date("2026-01-01") } as never),
    ).rejects.toMatchObject({ statusCode: 404, code: "EMPLOYEE_NOT_FOUND" });
    expect(repo.createAssignment).not.toHaveBeenCalled();
  });

  it("rechaza workRegimeId inexistente (404), sin llegar a crear la asignación", async () => {
    repo.employeeExists.mockResolvedValue({ id: employeeId });
    repo.findById.mockRejectedValue(prismaKnownError("P2025"));

    await expect(
      workRegimesService.assign(employeeId, { workRegimeId: "regime-does-not-exist", effectiveFrom: new Date("2026-01-01") } as never),
    ).rejects.toMatchObject({ statusCode: 404, code: "WORK_REGIME_NOT_FOUND" });
    expect(repo.createAssignment).not.toHaveBeenCalled();
  });

  it("rechaza solapamiento con una asignación vigente (409), sin modificar datos", async () => {
    repo.employeeExists.mockResolvedValue({ id: employeeId });
    repo.findById.mockResolvedValue(baseRegime);
    repo.findOverlappingAssignment.mockResolvedValue(assignment);

    await expect(
      workRegimesService.assign(employeeId, { workRegimeId: "regime-1", effectiveFrom: new Date("2026-01-01") } as never),
    ).rejects.toMatchObject({ statusCode: 409, code: "WORK_REGIME_ASSIGNMENT_OVERLAP" });
    expect(repo.createAssignment).not.toHaveBeenCalled();
  });

  it("consulta el historial ordenado (delegado al repository), 404 si el empleado no existe", async () => {
    repo.employeeExists.mockResolvedValue({ id: employeeId });
    repo.findHistoryByEmployee.mockResolvedValue([assignment]);

    const history = await workRegimesService.getHistory(employeeId);
    expect(history).toEqual([assignment]);

    repo.employeeExists.mockResolvedValue(null);
    await expect(workRegimesService.getHistory("employee-inexistente")).rejects.toMatchObject({ statusCode: 404, code: "EMPLOYEE_NOT_FOUND" });
  });

  it("consulta el régimen vigente por fecha reutilizando findActiveEmployeeWorkRegime (no lo duplica)", async () => {
    repo.employeeExists.mockResolvedValue({ id: employeeId });
    mockedFind.mockResolvedValue(assignment);

    const current = await workRegimesService.getCurrent(employeeId, new Date("2026-06-01T12:00:00.000Z"));

    expect(current).toEqual(assignment);
    expect(mockedFind).toHaveBeenCalledWith(employeeId, expect.any(Date));
  });

  it("si no hay régimen vigente para la fecha, devuelve null", async () => {
    repo.employeeExists.mockResolvedValue({ id: employeeId });
    mockedFind.mockResolvedValue(null);

    const current = await workRegimesService.getCurrent(employeeId, undefined);
    expect(current).toBeNull();
  });

  it("edita una asignación (cambia effectiveFrom) re-chequeando solapamiento excluyéndose a sí misma", async () => {
    repo.findAssignmentById.mockResolvedValue(assignment);
    repo.findOverlappingAssignment.mockResolvedValue(null);
    repo.updateAssignment.mockResolvedValue({ ...assignment, effectiveFrom: new Date("2026-02-01") });

    await workRegimesService.updateAssignment(employeeId, "assignment-1", { effectiveFrom: new Date("2026-02-01") } as never, { userId: "user-1" });

    expect(repo.findOverlappingAssignment).toHaveBeenCalledWith(employeeId, new Date("2026-02-01"), null, "assignment-1");
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE", entity: "EmployeeWorkRegime", entityId: employeeId }));
  });

  it("rechaza editar una asignación inexistente (404)", async () => {
    repo.findAssignmentById.mockResolvedValue(null);

    await expect(
      workRegimesService.updateAssignment(employeeId, "assignment-inexistente", { effectiveFrom: new Date("2026-02-01") } as never),
    ).rejects.toMatchObject({ statusCode: 404, code: "WORK_REGIME_ASSIGNMENT_NOT_FOUND" });
    expect(repo.updateAssignment).not.toHaveBeenCalled();
  });

  it("permite cerrar la vigencia con effectiveTo", async () => {
    repo.findAssignmentById.mockResolvedValue(assignment);
    repo.updateAssignment.mockResolvedValue({ ...assignment, effectiveTo: new Date("2026-06-30") });

    const item = await workRegimesService.closeAssignment(employeeId, "assignment-1", new Date("2026-06-30"), { userId: "user-1" });

    expect(item.effectiveTo).toEqual(new Date("2026-06-30"));
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE", entity: "EmployeeWorkRegime", entityId: employeeId }));
  });

  it("rechaza cerrar la vigencia con effectiveTo anterior a effectiveFrom", async () => {
    repo.findAssignmentById.mockResolvedValue(assignment); // effectiveFrom: 2026-01-01

    await expect(workRegimesService.closeAssignment(employeeId, "assignment-1", new Date("2025-12-31"))).rejects.toMatchObject({
      statusCode: 400,
      code: "WORK_REGIME_ASSIGNMENT_INVALID_RANGE",
    });
    expect(repo.updateAssignment).not.toHaveBeenCalled();
  });
});

describe("WorkRegime.listEmployees — empleados asociados (Etapa 8G)", () => {
  const rrhhUser = { id: "user-rrhh", role: roles.rrhh } as Express.AuthUser;
  const row = {
    id: "assignment-1",
    effectiveFrom: new Date("2026-01-01"),
    effectiveTo: null,
    employee: {
      id: "employee-1",
      legajo: "100",
      cuil: "20-12345678-9",
      firstName: "Ana",
      lastName: "Prueba",
      status: "ACTIVO",
      sector: null,
      costCenter: null,
      companies: [],
    },
  };

  it("rechaza régimen inexistente (404), sin llegar a consultar empleados", async () => {
    repo.findById.mockRejectedValue(prismaKnownError("P2025"));

    await expect(
      workRegimesService.listEmployees("regime-inexistente", { status: "all", page: 1, take: 50 } as never, rrhhUser),
    ).rejects.toMatchObject({ statusCode: 404, code: "WORK_REGIME_NOT_FOUND" });
    expect(repo.findEmployees).not.toHaveBeenCalled();
  });

  it("lista empleados asociados, mapeando cada fila con id/employeeId/vigencia/datos del empleado", async () => {
    repo.findById.mockResolvedValue(baseRegime);
    repo.findEmployees.mockResolvedValue([[row], 1]);
    mockedClassify.mockReturnValue("current");

    const result = await workRegimesService.listEmployees("regime-1", { status: "all", page: 1, take: 50 } as never, rrhhUser);

    expect(result.items).toEqual([
      {
        id: "assignment-1",
        employeeId: "employee-1",
        effectiveFrom: row.effectiveFrom,
        effectiveTo: null,
        vigencyStatus: "current",
        employee: {
          id: "employee-1",
          legajo: "100",
          cuil: "20-12345678-9",
          firstName: "Ana",
          lastName: "Prueba",
          status: "ACTIVO",
          sector: null,
          costCenter: null,
          companies: [],
        },
      },
    ]);
    expect(result.meta).toMatchObject({ total: 1, page: 1, pageSize: 50 });
  });

  it("distingue vigente/histórica/futura delegando en classifyWorkRegimeVigency por fila (no inventa el estado)", async () => {
    repo.findById.mockResolvedValue(baseRegime);
    const rows = [
      { ...row, id: "a1" },
      { ...row, id: "a2" },
      { ...row, id: "a3" },
    ];
    repo.findEmployees.mockResolvedValue([rows, 3]);
    mockedClassify.mockReturnValueOnce("future").mockReturnValueOnce("current").mockReturnValueOnce("historical");

    const result = await workRegimesService.listEmployees("regime-1", { status: "all", page: 1, take: 50 } as never, rrhhUser);

    expect(result.items.map((item) => item.vigencyStatus)).toEqual(["future", "current", "historical"]);
  });

  it("pasa los filtros (status/search/sectorId/costCenterId/companyId/page/take) al repository sin transformarlos", async () => {
    repo.findById.mockResolvedValue(baseRegime);
    repo.findEmployees.mockResolvedValue([[], 0]);

    const query = { status: "future", search: "perez", sectorId: "sector-1", costCenterId: "cc-1", companyId: "company-1", page: 2, take: 25 } as never;
    await workRegimesService.listEmployees("regime-1", query, rrhhUser);

    expect(repo.findEmployees).toHaveBeenCalledWith("regime-1", query, expect.any(Date), {});
  });

  it("respeta el patrón de permisos por área: un usuario de supervisión no recibe accessWhere vacío como RRHH", async () => {
    repo.findById.mockResolvedValue(baseRegime);
    repo.findEmployees.mockResolvedValue([[], 0]);
    const supervisionUser = { id: "user-sup", role: roles.supervision } as Express.AuthUser;

    await workRegimesService.listEmployees("regime-1", { status: "all", page: 1, take: 50 } as never, supervisionUser);

    const accessWhereUsed = repo.findEmployees.mock.calls.at(0)?.[3];
    expect(accessWhereUsed).not.toEqual({});
    expect(accessWhereUsed).toMatchObject({ assignments: { some: expect.objectContaining({ type: "TIME_RESPONSIBLE", userId: "user-sup" }) } });
  });

  it("usa hoy en calendario Argentina como fecha de referencia por defecto cuando no se pasa date", async () => {
    repo.findById.mockResolvedValue(baseRegime);
    repo.findEmployees.mockResolvedValue([[], 0]);

    await workRegimesService.listEmployees("regime-1", { status: "all", page: 1, take: 50 } as never, rrhhUser);

    const referenceDateUsed = repo.findEmployees.mock.calls.at(0)?.[2] as Date;
    expect(referenceDateUsed).toBeInstanceOf(Date);
  });
});
