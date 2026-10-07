import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { employeesRepository } from "./employees.repository";
import { employeesService } from "./employees.service";
import { resolveDoubleHourMultipliersByDate } from "../time-entries/timeEntries.repository";

/**
 * A7 (docs/decisions/ORG_LOCATION_REORGANIZATION.md §17.4): cambiar el
 * puesto, el alcance de un puesto o las ubicaciones de un legajo NO dispara
 * ningún recálculo de horas, desgloses ni cierres. Estos tests fijan esa
 * garantía; el riesgo restante (disparadores posteriores que resuelven con el
 * alcance ACTUAL) está documentado en el ADR y no se cambia acá.
 */
vi.mock("./employees.repository", () => ({
  employeesRepository: {
    findUpdateAuditSnapshot: vi.fn(),
    findConflictingUniqueFields: vi.fn(),
    findPositionForAssignment: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock("../audit/audit.service", () => ({ auditService: { register: vi.fn() } }));
vi.mock("../time-entries/timeEntries.repository", () => ({ resolveDoubleHourMultipliersByDate: vi.fn() }));

const repo = employeesRepository as unknown as Record<"findUpdateAuditSnapshot" | "findConflictingUniqueFields" | "findPositionForAssignment" | "update", Mock>;

beforeEach(() => {
  vi.clearAllMocks();
  repo.findUpdateAuditSnapshot.mockResolvedValue({ id: "emp-1", legajo: "1", firstName: "A", lastName: "B", positionId: "pos-old", sectorId: null, costCenterId: "cc-1", address: null, companies: [{ companyId: "c1", isPrimary: true }] });
  repo.findConflictingUniqueFields.mockResolvedValue(null);
  repo.findPositionForAssignment.mockResolvedValue({ id: "pos-new", name: "Nuevo", status: "ACTIVO", _count: { orgScopes: 1 } });
  repo.update.mockImplementation((id: string, input: object) => Promise.resolve({ id, legajo: "1", firstName: "A", lastName: "B", ...input }));
});

describe("cambios de estructura del legajo no recalculan horas (A7)", () => {
  it("cambiar puesto, centro de costo y empresa empleadora no resuelve multiplicadores ni reinterpreta", async () => {
    await employeesService.update("emp-1", { positionId: "pos-new", costCenterId: "cc-2", companyIds: ["c2"], primaryCompanyId: "c2" });

    expect(repo.update).toHaveBeenCalled();
    expect(resolveDoubleHourMultipliersByDate).not.toHaveBeenCalled();
  });
});

describe("módulos de estructura sin dependencia del motor de horas (A7)", () => {
  const forbidden = /specialHourReinterpretation|resolveSpecialHourRulesByDate|resolveDoubleHourMultipliersByDate|reinterpretSpecialHours|closureSnapshot|automaticHourConceptBreakdowns/;
  const files = [
    "employees/employeeWorkLocations.service.ts",
    "employees/employeeWorkLocations.repository.ts",
    "positions/positions.service.ts",
    "positions/positions.repository.ts",
    "org-structure/orgStructure.service.ts",
    "org-structure/orgStructure.repository.ts",
  ];
  it.each(files)("%s no importa ni invoca el motor de horas especiales, cierres ni desgloses", (file) => {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    expect(source).not.toMatch(forbidden);
  });
});
