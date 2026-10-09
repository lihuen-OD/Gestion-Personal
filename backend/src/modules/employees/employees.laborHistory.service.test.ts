import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { auditService, clearAuditDerivedCaches } from "../audit/audit.service";
import { laborHistoryService } from "../labor-history/laborHistory.service";
import { employeesRepository } from "./employees.repository";
import { employeesService } from "./employees.service";

/**
 * D-5 (docs/decisions/ORG_LOCATION_REORGANIZATION.md §19): cambiar puesto,
 * centro de costo o empresas empleadoras registra la vigencia desde una fecha,
 * el historial visible y la auditoría en la MISMA transacción que la columna
 * vigente. Se mockea el repositorio (la transacción ejecuta el callback con un
 * cliente ficticio) y el servicio de historia.
 */
const tx = { marker: "tx" };
vi.mock("./employees.repository", () => ({
  employeesRepository: {
    findUpdateAuditSnapshot: vi.fn(),
    findConflictingUniqueFields: vi.fn(),
    findByUniqueFields: vi.fn(),
    findPositionForAssignment: vi.fn(),
    findPositionForAssignmentWithin: vi.fn(),
    findArchivedCompanyNames: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
    create: vi.fn(),
    transaction: vi.fn(),
    findLaborNamesWithin: vi.fn(),
    createFieldHistoryWithin: vi.fn(),
  },
}));
vi.mock("../audit/audit.service", () => ({ auditService: { register: vi.fn(), registerWithin: vi.fn() }, clearAuditDerivedCaches: vi.fn() }));
vi.mock("../time-entries/timeEntries.repository", () => ({ resolveDoubleHourMultipliersByDate: vi.fn() }));
vi.mock("../labor-history/laborHistory.service", () => ({
  laborHistoryService: { recordEmployeeChangesWithin: vi.fn(), openEmployeeHistoryWithin: vi.fn() },
  mapLaborHistoryPersistenceError: vi.fn(),
}));

const repo = employeesRepository as unknown as Record<"findUpdateAuditSnapshot" | "findConflictingUniqueFields" | "findByUniqueFields" | "findPositionForAssignment" | "findPositionForAssignmentWithin" | "update" | "create" | "transaction" | "findLaborNamesWithin" | "createFieldHistoryWithin", Mock>;
const history = laborHistoryService as unknown as { recordEmployeeChangesWithin: Mock; openEmployeeHistoryWithin: Mock };
const registerWithin = auditService.registerWithin as unknown as Mock;

const snapshot = {
  id: "emp-1", legajo: "QA-1", firstName: "Ana", lastName: "Gómez", positionId: "pos-a", sectorId: null, costCenterId: "cc-a", address: null,
  companies: [{ companyId: "losod", isPrimary: true }, { companyId: "tropa", isPrimary: false }],
};
const laborChange = { effectiveFrom: "2026-10-01", reason: "Promoción" };

beforeEach(() => {
  vi.clearAllMocks();
  repo.findUpdateAuditSnapshot.mockResolvedValue(snapshot);
  repo.findConflictingUniqueFields.mockResolvedValue(null);
  repo.findByUniqueFields.mockResolvedValue(null);
  repo.findPositionForAssignment.mockResolvedValue({ id: "pos-b", name: "Encargado", status: "ACTIVO", _count: { orgScopes: 1 } });
  // Revalidación dentro de la transacción: por defecto ve el mismo puesto.
  repo.findPositionForAssignmentWithin.mockImplementation((_tx: unknown, id: string) => repo.findPositionForAssignment(id));
  repo.transaction.mockImplementation((operation: (client: unknown) => unknown) => operation(tx));
  repo.update.mockImplementation((id: string, input: object) => Promise.resolve({ ...snapshot, ...input, id }));
  repo.create.mockResolvedValue({ id: "emp-new", legajo: "QA-2", firstName: "Juan", lastName: "Pérez" });
  repo.findLaborNamesWithin.mockResolvedValue({
    positions: new Map([["pos-a", "Administrativo"], ["pos-b", "Encargado"]]),
    costCenters: new Map([["cc-a", "Administración"], ["cc-b", "Campo"]]),
    companies: new Map([["losod", "Los O'Dwyer"], ["tropa", "Tropa"]]),
  });
  history.recordEmployeeChangesWithin.mockResolvedValue([{ dimension: "POSITION", kind: "SPLIT", effectiveFrom: "2026-10-01", effectiveTo: null, previous: "pos-a", value: "pos-b" }]);
});

describe("employeesService.update — cambios con vigencia", () => {
  it("exige fecha desde y motivo para cambiar el puesto (400, sin escribir)", async () => {
    await expect(employeesService.update("emp-1", { positionId: "pos-b" })).rejects.toMatchObject({ statusCode: 400, code: "EMPLOYEE_LABOR_CHANGE_DATE_REQUIRED" });
    expect(repo.transaction).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("también para el centro de costo y para el conjunto de empresas empleadoras", async () => {
    await expect(employeesService.update("emp-1", { costCenterId: "cc-b" })).rejects.toMatchObject({ code: "EMPLOYEE_LABOR_CHANGE_DATE_REQUIRED" });
    await expect(employeesService.update("emp-1", { companyIds: ["losod"], primaryCompanyId: "losod" })).rejects.toMatchObject({ code: "EMPLOYEE_LABOR_CHANGE_DATE_REQUIRED" });
  });

  it("cambiar sólo la empresa principal no es un cambio del motor: no exige fecha ni registra historia", async () => {
    await employeesService.update("emp-1", { companyIds: ["tropa", "losod"], primaryCompanyId: "tropa" });
    expect(history.recordEmployeeChangesWithin).not.toHaveBeenCalled();
    expect(repo.createFieldHistoryWithin).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith("emp-1", expect.objectContaining({ primaryCompanyId: "tropa" }), tx);
  });

  it("editar otros datos (categoría) reenviando los mismos valores no exige fecha ni toca la historia", async () => {
    await employeesService.update("emp-1", { internalCategory: "Administrativo B", positionId: "pos-a", costCenterId: "cc-a", companyIds: ["losod", "tropa"], primaryCompanyId: "losod" });
    expect(history.recordEmployeeChangesWithin).not.toHaveBeenCalled();
    expect(registerWithin).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "UPDATE", entity: "Employee" }));
  });

  it("columna, vigencia, historial visible y auditoría se escriben en la misma transacción; cachés después", async () => {
    history.recordEmployeeChangesWithin.mockResolvedValue([
      { dimension: "POSITION", kind: "SPLIT", effectiveFrom: "2026-10-01", effectiveTo: null, previous: "pos-a", value: "pos-b" },
      { dimension: "COST_CENTER", kind: "SPLIT", effectiveFrom: "2026-10-01", effectiveTo: null, previous: "cc-a", value: "cc-b" },
      { dimension: "EMPLOYER", kind: "SPLIT", effectiveFrom: "2026-10-01", effectiveTo: null, previous: ["losod", "tropa"], value: ["tropa"] },
    ]);

    await employeesService.update("emp-1", { positionId: "pos-b", costCenterId: "cc-b", companyIds: ["tropa"], primaryCompanyId: "tropa", laborChange }, { userId: "u1" });

    expect(repo.update).toHaveBeenCalledWith("emp-1", expect.objectContaining({ positionId: "pos-b", costCenterId: "cc-b" }), tx);
    expect(repo.update.mock.calls[0]![1]).not.toHaveProperty("laborChange");
    expect(history.recordEmployeeChangesWithin).toHaveBeenCalledWith(tx, {
      employeeId: "emp-1", effectiveFrom: "2026-10-01", reason: "Promoción", createdByUserId: "u1",
      changes: { positionId: "pos-b", costCenterId: "cc-b", companyIds: ["tropa"] },
    });
    expect(repo.createFieldHistoryWithin).toHaveBeenCalledWith(tx, "emp-1", { field: "positionId", fieldLabel: "Puesto", oldValue: "Administrativo", newValue: "Encargado", effectiveFrom: "2026-10-01", reason: "Promoción" }, "u1");
    expect(repo.createFieldHistoryWithin).toHaveBeenCalledWith(tx, "emp-1", expect.objectContaining({ field: "costCenter", oldValue: "Administración", newValue: "Campo" }), "u1");
    expect(repo.createFieldHistoryWithin).toHaveBeenCalledWith(tx, "emp-1", expect.objectContaining({ field: "companies", fieldLabel: "Empresa", oldValue: "Los O'Dwyer, Tropa", newValue: "Tropa" }), "u1");
    expect(registerWithin).toHaveBeenCalledWith(tx, expect.objectContaining({
      entity: "Employee",
      description: expect.stringContaining("Datos laborales desde el 01/10/2026: Puesto Administrativo → Encargado"),
      after: expect.objectContaining({ laborChange, laborHistory: expect.any(Array) }),
    }));
    expect(clearAuditDerivedCaches).toHaveBeenCalled();
  });

  it("si la historia rechaza el cambio (p. ej. período protegido), se propaga y no se limpian cachés: la transacción se revierte entera", async () => {
    history.recordEmployeeChangesWithin.mockRejectedValue(Object.assign(new Error("protegido"), { code: "PERIOD_CLOSED" }));

    await expect(employeesService.update("emp-1", { positionId: "pos-b", laborChange })).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    expect(repo.createFieldHistoryWithin).not.toHaveBeenCalled();
    expect(registerWithin).not.toHaveBeenCalled();
    expect(clearAuditDerivedCaches).not.toHaveBeenCalled();
  });

  it("compara contra el estado releído DENTRO de la transacción (un cambio concurrente no se pisa en silencio)", async () => {
    repo.findUpdateAuditSnapshot
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce({ ...snapshot, positionId: "pos-b" });

    await employeesService.update("emp-1", { positionId: "pos-b", laborChange });

    expect(repo.findUpdateAuditSnapshot).toHaveBeenLastCalledWith("emp-1", tx);
    expect(history.recordEmployeeChangesWithin).not.toHaveBeenCalled();
  });
});

describe("employeesService.create — historia inicial", () => {
  const input = {
    legajo: "QA-2", cuil: "20-22222222-2", dni: "22222222", firstName: "Juan", lastName: "Pérez",
    birthDate: new Date("1990-01-01T00:00:00.000Z"), gender: "Masculino", nationality: "Argentina", status: "ACTIVO" as const,
    positionId: "pos-b", costCenterId: "cc-b", companyIds: ["losod"],
  };

  it("abre la historia desde la fecha de ingreso (movimiento ALTA) en la transacción del alta", async () => {
    await employeesService.create({ ...input, initialLaborMovement: { type: "ALTA", effectiveFrom: new Date("2026-09-01T00:00:00.000Z"), reason: "Ingreso" } }, { userId: "u1" });

    expect(repo.create).toHaveBeenCalledWith(expect.anything(), "u1", tx);
    expect(history.openEmployeeHistoryWithin).toHaveBeenCalledWith(tx, expect.objectContaining({ employeeId: "emp-new", effectiveFrom: "2026-09-01", positionId: "pos-b", costCenterId: "cc-b", companyIds: ["losod"] }));
    expect(registerWithin).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "CREATE", description: expect.stringContaining("Historia laboral desde el 01/09/2026") }));
    expect(clearAuditDerivedCaches).toHaveBeenCalled();
  });

  it("sin movimiento de ingreso, la historia empieza el día del alta (nunca antes)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T15:00:00.000Z"));
    try {
      await employeesService.create(input);
    } finally {
      vi.useRealTimers();
    }
    expect(history.openEmployeeHistoryWithin).toHaveBeenCalledWith(tx, expect.objectContaining({ effectiveFrom: "2026-10-08" }));
  });
});
