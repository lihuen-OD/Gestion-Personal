import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { employeesRepository } from "./employees.repository";
import { employeesService } from "./employees.service";
import { auditService } from "../audit/audit.service";
import { laborHistoryService } from "../labor-history/laborHistory.service";

/**
 * A6 (docs/decisions/ORG_LOCATION_REORGANIZATION.md §3.3): el legajo tiene
 * un puesto; el alcance se lee del puesto. Asignar un puesto NUEVO exige que
 * esté activo y tenga alcance, pero un legajo que conserva su puesto o sector
 * anterior sigue pudiendo editar el resto de sus datos laborales.
 */
vi.mock("./employees.repository", () => ({
  employeesRepository: {
    findUpdateAuditSnapshot: vi.fn(),
    findConflictingUniqueFields: vi.fn(),
    findByUniqueFields: vi.fn(),
    findPositionForAssignment: vi.fn(),
    findPositionForAssignmentWithin: vi.fn(),
    findArchivedCompanyNames: vi.fn().mockResolvedValue([]),
    findArchivedCompanyNamesWithin: vi.fn().mockResolvedValue([]),
    findAssignableHourConceptIds: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    transaction: vi.fn((operation: (tx: unknown) => unknown) => operation({})),
    findLaborNamesWithin: vi.fn().mockResolvedValue({ positions: new Map(), costCenters: new Map(), companies: new Map() }),
    createFieldHistoryWithin: vi.fn(),
  },
}));
vi.mock("../audit/audit.service", () => ({ auditService: { register: vi.fn(), registerWithin: vi.fn() }, clearAuditDerivedCaches: vi.fn() }));
vi.mock("../time-entries/timeEntries.repository", () => ({ resolveDoubleHourMultipliersByDate: vi.fn() }));
vi.mock("../labor-history/laborHistory.service", () => ({
  laborHistoryService: { recordEmployeeChangesWithin: vi.fn().mockResolvedValue([]), openEmployeeHistoryWithin: vi.fn() },
  mapLaborHistoryPersistenceError: vi.fn(),
}));

const laborChange = { effectiveFrom: "2026-10-01", reason: "Reasignación" };

const repo = employeesRepository as unknown as Record<"findUpdateAuditSnapshot" | "findConflictingUniqueFields" | "findByUniqueFields" | "findPositionForAssignment" | "findPositionForAssignmentWithin" | "findArchivedCompanyNames" | "findArchivedCompanyNamesWithin" | "update" | "create", Mock>;

const legacySnapshot = {
  id: "emp-1",
  legajo: "30",
  firstName: "Juan",
  lastName: "Pérez",
  positionId: "pos-legacy",
  sectorId: "sector-legacy",
  costCenterId: "cc-1",
  internalCategory: "Administrativo A",
  address: null,
  companies: [{ companyId: "company-1", isPrimary: true }],
};

const createInput = {
  legajo: "99", cuil: "20-11111111-1", dni: "11111111", firstName: "Ana", lastName: "Gómez",
  birthDate: new Date("1990-01-01T00:00:00.000Z"), gender: "Femenino", nationality: "Argentina",
  status: "ACTIVO" as const, companyIds: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  repo.findUpdateAuditSnapshot.mockResolvedValue(legacySnapshot);
  repo.findConflictingUniqueFields.mockResolvedValue(null);
  repo.findByUniqueFields.mockResolvedValue(null);
  repo.update.mockImplementation((id: string, input: Record<string, unknown>) => Promise.resolve({ ...legacySnapshot, ...input, id }));
  repo.create.mockResolvedValue({ id: "emp-new", legajo: "99", firstName: "Ana", lastName: "Gómez" });
  // Revalidación dentro de la transacción: por defecto ve el mismo puesto que el rechazo temprano.
  repo.findPositionForAssignmentWithin.mockImplementation((_tx: unknown, id: string) => repo.findPositionForAssignment(id));
});

describe("employeesService.update — legajo pendiente de recarga", () => {
  it("edita otros datos laborales conservando el puesto y el sector anteriores, sin validar el puesto", async () => {
    await employeesService.update("emp-1", { internalCategory: "Administrativo B", positionId: "pos-legacy", sectorId: "sector-legacy", costCenterId: "cc-1" });

    expect(repo.findPositionForAssignment).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith("emp-1", expect.objectContaining({ internalCategory: "Administrativo B" }), expect.anything());
  });

  it("rechaza cambiar el sector anterior: el alcance sale del puesto (409, sin escribir)", async () => {
    await expect(employeesService.update("emp-1", { sectorId: "11111111-1111-4111-8111-111111111111" }))
      .rejects.toMatchObject({ statusCode: 409, code: "EMPLOYEE_LEGACY_SECTOR_READ_ONLY" });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("rechaza vaciar el sector anterior: no se borra ni convierte en silencio", async () => {
    await expect(employeesService.update("emp-1", { sectorId: null }))
      .rejects.toMatchObject({ code: "EMPLOYEE_LEGACY_SECTOR_READ_ONLY" });
  });

  it("asignar un puesto nuevo con alcance A5 y activo es válido", async () => {
    repo.findPositionForAssignment.mockResolvedValue({ id: "pos-new", name: "Encargado de campo", status: "ACTIVO", _count: { orgScopes: 2 } });

    await employeesService.update("emp-1", { positionId: "pos-new", laborChange });

    expect(repo.findPositionForAssignment).toHaveBeenCalledWith("pos-new");
    expect(repo.update).toHaveBeenCalledWith("emp-1", expect.objectContaining({ positionId: "pos-new" }), expect.anything());
  });

  it("rechaza asignar un puesto nuevo pendiente de recarga (sin alcance)", async () => {
    repo.findPositionForAssignment.mockResolvedValue({ id: "pos-other-legacy", name: "Administrativo", status: "ACTIVO", _count: { orgScopes: 0 } });

    await expect(employeesService.update("emp-1", { positionId: "pos-other-legacy" }))
      .rejects.toMatchObject({ statusCode: 409, code: "EMPLOYEE_POSITION_PENDING_SCOPE" });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("rechaza asignar un puesto inactivo", async () => {
    repo.findPositionForAssignment.mockResolvedValue({ id: "pos-off", name: "Director", status: "INACTIVO", _count: { orgScopes: 1 } });

    await expect(employeesService.update("emp-1", { positionId: "pos-off" }))
      .rejects.toMatchObject({ code: "EMPLOYEE_POSITION_INACTIVE" });
  });

  it("rechaza un puesto inexistente", async () => {
    repo.findPositionForAssignment.mockResolvedValue(null);

    await expect(employeesService.update("emp-1", { positionId: "pos-missing" }))
      .rejects.toMatchObject({ statusCode: 400, code: "EMPLOYEE_POSITION_INVALID" });
  });

  it("rechaza asignar un puesto ARCHIVADO (A8 §12.4), sin escribir", async () => {
    repo.findPositionForAssignment.mockResolvedValue({
      id: "pos-arch", name: "Puesto Archivado", status: "ACTIVO",
      archivedAt: new Date("2026-10-01T00:00:00.000Z"), _count: { orgScopes: 2 },
    });

    await expect(employeesService.update("emp-1", { positionId: "pos-arch", laborChange }))
      .rejects.toMatchObject({ statusCode: 400, code: "EMPLOYEE_POSITION_ARCHIVED", message: expect.stringContaining("Puesto Archivado") });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("rechaza vincular una empresa ARCHIVADA al editar (A8 §12.4), sin escribir", async () => {
    repo.findArchivedCompanyNames.mockResolvedValueOnce(["Odwyer Vieja"]);

    await expect(employeesService.update("emp-1", { companyIds: ["c-arch"] }))
      .rejects.toMatchObject({ statusCode: 400, code: "EMPLOYEE_COMPANY_ARCHIVED", message: expect.stringContaining("Odwyer Vieja") });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("una edición que NO cambia las empresas no consulta el chequeo de archivado", async () => {
    await employeesService.update("emp-1", { internalCategory: "Administrativo C", positionId: "pos-legacy", sectorId: "sector-legacy", costCenterId: "cc-1" });

    expect(repo.findArchivedCompanyNames).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalled();
  });

  it("quitar el puesto (null) no exige requisitos de asignación", async () => {
    await employeesService.update("emp-1", { positionId: null, laborChange });

    expect(repo.findPositionForAssignment).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalled();
  });
});

describe("employeesService.create — nuevas asignaciones", () => {
  it("no acepta un sector del modelo anterior en el alta", async () => {
    await expect(employeesService.create({ ...createInput, sectorId: "11111111-1111-4111-8111-111111111111" }))
      .rejects.toMatchObject({ code: "EMPLOYEE_LEGACY_SECTOR_READ_ONLY" });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("exige que el puesto asignado en el alta tenga alcance", async () => {
    repo.findPositionForAssignment.mockResolvedValue({ id: "pos-legacy", name: "Administrativo", status: "ACTIVO", _count: { orgScopes: 0 } });

    await expect(employeesService.create({ ...createInput, positionId: "pos-legacy" }))
      .rejects.toMatchObject({ code: "EMPLOYEE_POSITION_PENDING_SCOPE" });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("alta sin puesto ni sector sigue siendo válida", async () => {
    await employeesService.create({ ...createInput, sectorId: null });

    expect(repo.create).toHaveBeenCalled();
  });

  it("rechaza el alta con una empresa ARCHIVADA (A8 §12.4), sin escribir", async () => {
    repo.findArchivedCompanyNames.mockResolvedValueOnce(["Odwyer Vieja"]);

    await expect(employeesService.create({ ...createInput, companyIds: ["c-arch"] }))
      .rejects.toMatchObject({ statusCode: 400, code: "EMPLOYEE_COMPANY_ARCHIVED", message: expect.stringContaining("Odwyer Vieja") });
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.findArchivedCompanyNames).toHaveBeenCalledWith(["c-arch"]);
  });

  it("rechaza el alta con un puesto ARCHIVADO (A8 §12.4), sin escribir", async () => {
    repo.findPositionForAssignment.mockResolvedValue({
      id: "pos-arch", name: "Puesto Archivado", status: "ACTIVO",
      archivedAt: new Date("2026-10-01T00:00:00.000Z"), _count: { orgScopes: 2 },
    });

    await expect(employeesService.create({ ...createInput, positionId: "pos-arch" }))
      .rejects.toMatchObject({ statusCode: 400, code: "EMPLOYEE_POSITION_ARCHIVED" });
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe("employeesService — revalidación del puesto dentro de la transacción del guardado", () => {
  const tx = { marker: "labor-tx" };
  const activeWithScope = { id: "pos-new", name: "Encargado de campo", status: "ACTIVO", archivedAt: null, _count: { orgScopes: 2 } };
  const inactivatedMeanwhile = { ...activeWithScope, status: "INACTIVO" };

  beforeEach(() => {
    (employeesRepository.transaction as unknown as Mock).mockImplementation((operation: (client: unknown) => unknown) => operation(tx));
  });

  it("update: el puesto se inactiva entre el rechazo temprano y el guardado → 409 y no escribe", async () => {
    repo.findPositionForAssignment.mockResolvedValue(activeWithScope);
    repo.findPositionForAssignmentWithin.mockResolvedValue(inactivatedMeanwhile);

    await expect(employeesService.update("emp-1", { positionId: "pos-new", laborChange }))
      .rejects.toMatchObject({ statusCode: 409, code: "EMPLOYEE_POSITION_INACTIVE" });
    expect(repo.findPositionForAssignmentWithin).toHaveBeenCalledWith(tx, "pos-new");
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("create: el puesto pierde su alcance entre el rechazo temprano y el guardado → 409 y no crea", async () => {
    repo.findPositionForAssignment.mockResolvedValue(activeWithScope);
    repo.findPositionForAssignmentWithin.mockResolvedValue({ ...activeWithScope, _count: { orgScopes: 0 } });

    await expect(employeesService.create({ ...createInput, positionId: "pos-new" }))
      .rejects.toMatchObject({ statusCode: 409, code: "EMPLOYEE_POSITION_PENDING_SCOPE" });
    expect(repo.findPositionForAssignmentWithin).toHaveBeenCalledWith(tx, "pos-new");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("la comparación usa el puesto del legajo leído DENTRO de la transacción: conservarlo no exige requisitos aunque esté inactivo", async () => {
    // Fuera de la transacción el legajo tenía otro puesto; dentro ya tiene pos-new (inactivo hoy).
    repo.findUpdateAuditSnapshot.mockImplementation((_id: string, client?: unknown) =>
      Promise.resolve(client === tx ? { ...legacySnapshot, positionId: "pos-new" } : legacySnapshot));
    repo.findPositionForAssignment.mockResolvedValue(activeWithScope);
    repo.findPositionForAssignmentWithin.mockResolvedValue(inactivatedMeanwhile);

    await employeesService.update("emp-1", { positionId: "pos-new", internalCategory: "Administrativo B", laborChange });

    expect(repo.findPositionForAssignmentWithin).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith("emp-1", expect.objectContaining({ positionId: "pos-new" }), tx);
  });

  it("mantener el puesto anterior (pendiente de recarga) no consulta el puesto ni dentro ni fuera de la transacción", async () => {
    await employeesService.update("emp-1", { positionId: "pos-legacy", internalCategory: "Administrativo B" });

    expect(repo.findPositionForAssignment).not.toHaveBeenCalled();
    expect(repo.findPositionForAssignmentWithin).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalled();
  });
});

describe("employeesService — revalidación de empresas empleadoras dentro de la transacción del guardado (A8 §12.4)", () => {
  const tx = { marker: "labor-tx" };

  beforeEach(() => {
    (employeesRepository.transaction as unknown as Mock).mockImplementation((operation: (client: unknown) => unknown) => operation(tx));
    repo.findArchivedCompanyNames.mockResolvedValue([]);
    repo.findArchivedCompanyNamesWithin.mockResolvedValue([]);
  });

  const noWrites = () => {
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
    expect(auditService.registerWithin).not.toHaveBeenCalled();
    expect(laborHistoryService.recordEmployeeChangesWithin).not.toHaveBeenCalled();
    expect(laborHistoryService.openEmployeeHistoryWithin).not.toHaveBeenCalled();
  };

  it("update: la empresa se archiva entre el rechazo temprano y el guardado → 400 y la transacción no escribe nada", async () => {
    repo.findArchivedCompanyNamesWithin.mockResolvedValueOnce(["Empresa archivada"]);

    await expect(employeesService.update("emp-1", { companyIds: ["company-1", "c-new"], laborChange }))
      .rejects.toMatchObject({ statusCode: 400, code: "EMPLOYEE_COMPANY_ARCHIVED", message: expect.stringContaining("Empresa archivada") });
    expect(repo.findArchivedCompanyNames).toHaveBeenCalledWith(["c-new"]);
    // Sólo el vínculo NUEVO, con el cliente de la transacción.
    expect(repo.findArchivedCompanyNamesWithin).toHaveBeenCalledWith(tx, ["c-new"]);
    noWrites();
  });

  it("create: la empresa se archiva entre el rechazo temprano y el guardado → 400 sin alta, historia ni auditoría", async () => {
    repo.findArchivedCompanyNamesWithin.mockResolvedValueOnce(["Empresa archivada"]);

    await expect(employeesService.create({ ...createInput, companyIds: ["c-new"] }))
      .rejects.toMatchObject({ statusCode: 400, code: "EMPLOYEE_COMPANY_ARCHIVED" });
    expect(repo.findArchivedCompanyNamesWithin).toHaveBeenCalledWith(tx, ["c-new"]);
    noWrites();
  });

  it("compara contra los vínculos leídos DENTRO de la transacción: lo que el legajo ya tenía allí no se revalida", async () => {
    // Fuera: sólo company-1. Dentro: además c-kept (vínculo preexistente, aunque hoy archivado).
    repo.findUpdateAuditSnapshot.mockImplementation((_id: string, client?: unknown) =>
      Promise.resolve(client === tx ? { ...legacySnapshot, companies: [{ companyId: "company-1", isPrimary: true }, { companyId: "c-kept", isPrimary: false }] } : legacySnapshot));

    await employeesService.update("emp-1", { companyIds: ["company-1", "c-kept", "c-new"], laborChange });

    expect(repo.findArchivedCompanyNamesWithin).toHaveBeenCalledWith(tx, ["c-new"]);
    expect(repo.update).toHaveBeenCalledWith("emp-1", expect.objectContaining({ companyIds: ["company-1", "c-kept", "c-new"] }), tx);
  });

  it("conservar sin cambios las empresas no consulta archivo ni dentro ni fuera de la transacción", async () => {
    await employeesService.update("emp-1", { companyIds: ["company-1"], primaryCompanyId: "company-1", internalCategory: "Administrativo B" });

    expect(repo.findArchivedCompanyNames).not.toHaveBeenCalled();
    expect(repo.findArchivedCompanyNamesWithin).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalled();
  });

  it("la corrección previa del puesto (FOR SHARE) se mantiene junto a la de empresas", async () => {
    repo.findPositionForAssignment.mockResolvedValue({ id: "pos-new", name: "Encargado", status: "ACTIVO", archivedAt: null, _count: { orgScopes: 1 } });
    repo.findPositionForAssignmentWithin.mockResolvedValue({ id: "pos-new", name: "Encargado", status: "INACTIVO", archivedAt: null, _count: { orgScopes: 1 } });

    await expect(employeesService.update("emp-1", { positionId: "pos-new", companyIds: ["company-1", "c-new"], laborChange }))
      .rejects.toMatchObject({ code: "EMPLOYEE_POSITION_INACTIVE" });
    noWrites();
  });
});
