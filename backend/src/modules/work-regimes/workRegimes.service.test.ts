import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { Prisma } from "@prisma/client";
import { workRegimesService, resolveActiveWorkRegime } from "./workRegimes.service";
import { findActiveEmployeeWorkRegime, workRegimesRepository } from "./workRegimes.repository";
import { auditService } from "../audit/audit.service";

vi.mock("./workRegimes.repository", () => ({
  findActiveEmployeeWorkRegime: vi.fn(),
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
  },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(undefined) },
}));

const mockedFind = findActiveEmployeeWorkRegime as unknown as Mock;
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
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE", entity: "EmployeeWorkRegime" }));
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
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE", entity: "EmployeeWorkRegime" }));
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
