import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { auditService } from "../audit/audit.service";
import { laborHistoryService } from "../labor-history/laborHistory.service";
import { employeesRepository } from "./employees.repository";
import { createEmployeeSchema } from "./employees.schemas";
import { employeesService } from "./employees.service";

/**
 * Alta mínima de legajo: sólo legajo, DNI, nombre y apellido. Empresa, centro
 * de costo, puesto, fecha de alta, CUIL y datos personales se completan
 * después. Se mockea el repositorio (la transacción ejecuta el callback con un
 * cliente ficticio) y el servicio de historia, como en
 * employees.laborHistory.service.test.ts. La unicidad real (consulta y
 * PostgreSQL) se cubre en employees.repository.test.ts y en
 * employees.minimalCreate.integration.test.ts.
 */
const tx = { marker: "tx" };
vi.mock("./employees.repository", () => ({
  employeesRepository: {
    findByUniqueFields: vi.fn(),
    findPositionForAssignment: vi.fn(),
    findPositionForAssignmentWithin: vi.fn(),
    findArchivedCompanyNames: vi.fn(),
    findArchivedCompanyNamesWithin: vi.fn(),
    findCostCenterForAssignment: vi.fn(),
    findAssignableHourConceptIds: vi.fn(),
    create: vi.fn(),
    transaction: vi.fn(),
  },
}));
vi.mock("../audit/audit.service", () => ({ auditService: { register: vi.fn(), registerWithin: vi.fn() }, clearAuditDerivedCaches: vi.fn() }));
vi.mock("../time-entries/timeEntries.repository", () => ({ resolveDoubleHourMultipliersByDate: vi.fn() }));
vi.mock("../labor-history/laborHistory.service", () => ({
  laborHistoryService: { recordEmployeeChangesWithin: vi.fn(), openEmployeeHistoryWithin: vi.fn() },
  mapLaborHistoryPersistenceError: vi.fn(),
}));

const repo = employeesRepository as unknown as Record<
  "findByUniqueFields" | "findPositionForAssignment" | "findPositionForAssignmentWithin" | "findArchivedCompanyNames" | "findArchivedCompanyNamesWithin" | "findCostCenterForAssignment" | "findAssignableHourConceptIds" | "create" | "transaction",
  Mock
>;
const history = laborHistoryService as unknown as { openEmployeeHistoryWithin: Mock };
const registerWithin = auditService.registerWithin as unknown as Mock;

const minimal = createEmployeeSchema.parse({ legajo: "0001", dni: "12345678", firstName: "Juan", lastName: "Perez" });

beforeEach(() => {
  vi.clearAllMocks();
  repo.findByUniqueFields.mockResolvedValue(null);
  repo.transaction.mockImplementation((operation: (client: unknown) => unknown) => operation(tx));
  repo.create.mockResolvedValue({ id: "emp-new", legajo: "0001", firstName: "Juan", lastName: "Perez", status: "ACTIVO" });
});

describe("employeesService.create — alta mínima", () => {
  it("crea el legajo con sólo legajo, DNI, nombre y apellido: sin puesto, empresa, centro de costo, CUIL ni fecha de alta", async () => {
    const created = await employeesService.create(minimal, { userId: "u1" });

    expect(created).toMatchObject({ id: "emp-new", status: "ACTIVO" });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ legajo: "0001", dni: "12345678", hourConceptIds: [] }), "u1", tx);
    const input = repo.create.mock.calls[0]![0];
    expect(input.cuil).toBeUndefined();
    expect(input.positionId).toBeUndefined();
    expect(input.costCenterId).toBeUndefined();
    expect(input.companyIds).toEqual([]);
    expect(input.initialLaborMovement).toBeUndefined();
    // Sin estructura no se valida ni se consulta ninguna relación.
    expect(repo.findPositionForAssignment).not.toHaveBeenCalled();
    expect(repo.findArchivedCompanyNames).not.toHaveBeenCalled();
    expect(repo.findCostCenterForAssignment).not.toHaveBeenCalled();
    expect(repo.findAssignableHourConceptIds).not.toHaveBeenCalled();
    // La historia laboral se abre vacía (sin puesto, centro de costo ni empresas) y el alta queda auditada.
    expect(history.openEmployeeHistoryWithin).toHaveBeenCalledWith(tx, expect.objectContaining({ employeeId: "emp-new", positionId: null, costCenterId: null, companyIds: [] }));
    expect(registerWithin).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "CREATE", entity: "Employee", entityId: "emp-new" }));
  });

  it("con fecha de alta, mantiene el movimiento inicial y la historia desde esa fecha", async () => {
    await employeesService.create(
      createEmployeeSchema.parse({ legajo: "0002", dni: "22345678", firstName: "Ana", lastName: "Gómez", initialLaborMovement: { type: "ALTA", effectiveFrom: "2026-09-01", reason: "Reingreso" } }),
      { userId: "u1" },
    );

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ initialLaborMovement: expect.objectContaining({ type: "ALTA", reason: "Reingreso" }) }), "u1", tx);
    expect(history.openEmployeeHistoryWithin).toHaveBeenCalledWith(tx, expect.objectContaining({ effectiveFrom: "2026-09-01" }));
  });

  it.each([
    ["legajo", { id: "emp-x", legajo: "0001", legajoFinnegans: null, cuil: null, dni: "99999999" }],
    ["DNI", { id: "emp-x", legajo: "0099", legajoFinnegans: null, cuil: null, dni: "12345678" }],
    ["CUIL real", { id: "emp-x", legajo: "0099", legajoFinnegans: null, cuil: "20-12345678-9", dni: "99999999" }],
  ])("un %s duplicado sigue respondiendo 409 EMPLOYEE_ALREADY_EXISTS sin escribir", async (_field, existing) => {
    repo.findByUniqueFields.mockResolvedValue(existing);

    await expect(employeesService.create({ ...minimal, cuil: "20-12345678-9" })).rejects.toMatchObject({ statusCode: 409, code: "EMPLOYEE_ALREADY_EXISTS" });
    expect(repo.transaction).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });
});
