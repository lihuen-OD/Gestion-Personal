import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { employeesRepository } from "./employees.repository";
import { employeesService } from "./employees.service";
import { roles } from "../../shared/security/roles";

/**
 * Regresion de la limpieza final de Position (2026-08-18): getPositionValidation
 * compara la cadena real del empleado (sector -> area -> establishment ->
 * businessUnit) contra la cadena real del PUESTO via sectorId (position.sector
 * -> area -> establishment -> businessUnit). Los strings/JSON legado
 * (areaDepartment, sectorName, businessUnitName(s), establishmentName(s),
 * sectorNames, salaryRangeCategories, areaId) ya no existen en el esquema.
 */
vi.mock("./employees.repository", () => ({
  employeesRepository: {
    findById: vi.fn(),
    countBaseHourConcepts: vi.fn(),
    findHourConceptsAuditSnapshot: vi.fn(),
    replaceHourConcepts: vi.fn(),
  },
}));

const repo = employeesRepository as unknown as {
  findById: Mock;
  countBaseHourConcepts: Mock;
  findHourConceptsAuditSnapshot: Mock;
  replaceHourConcepts: Mock;
};
const rrhhUser = { id: "user-rrhh", role: roles.rrhh } as unknown as Express.AuthUser;

function sectorChain(overrides: Partial<{ sector: string; area: string; establishment: string; businessUnit: string }> = {}) {
  const { sector = "Ventas", area = "Comercial", establishment = "Sucursal Centro", businessUnit = "Unidad Comercial" } = overrides;
  return { name: sector, area: { name: area, establishment: { name: establishment, businessUnit: { name: businessUnit } } } };
}

function employeeFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "emp-1",
    internalCategory: "Administrativo A",
    sector: sectorChain(),
    position: {
      id: "pos-1",
      sector: sectorChain(),
      salaryCategories: [{ salaryCategory: { name: "Administrativo A", order: 8 } }],
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("employeesService.replaceHourConcepts", () => {
  it("rechaza NORMAL_BASE antes de modificar las asignaciones del legajo", async () => {
    repo.countBaseHourConcepts.mockResolvedValue(1);

    await expect(
      employeesService.replaceHourConcepts("emp-1", { hourConceptIds: ["normal-1"] }),
    ).rejects.toMatchObject({ statusCode: 409, code: "HOUR_CONCEPT_BASE_NOT_ASSIGNABLE" });

    expect(repo.findHourConceptsAuditSnapshot).not.toHaveBeenCalled();
    expect(repo.replaceHourConcepts).not.toHaveBeenCalled();
  });
});

describe("employeesService.getPositionValidation", () => {
  it("cadena coincidente: tone success cuando el empleado y el puesto comparten sector/area/establecimiento/UN via sectorId", async () => {
    repo.findById.mockResolvedValue(employeeFixture());

    const result = await employeesService.getPositionValidation("emp-1", rrhhUser);

    expect(result.tone).toBe("success");
    expect(result.checks.every((check) => check.ok)).toBe(true);
  });

  it("cadena distinta: tone danger cuando el sector real del puesto no coincide con el del empleado", async () => {
    repo.findById.mockResolvedValue(employeeFixture({
      position: {
        id: "pos-1",
        sector: sectorChain({ sector: "Compras", area: "Administracion", establishment: "Casa Central", businessUnit: "Administracion" }),
        salaryCategories: [{ salaryCategory: { name: "Administrativo A", order: 8 } }],
      },
    }));

    const result = await employeesService.getPositionValidation("emp-1", rrhhUser);

    expect(result.tone).toBe("danger");
    const sectorCheck = result.checks.find((check) => check.label === "Sector");
    expect(sectorCheck?.ok).toBe(false);
  });

  it("puesto sin sectorId: no hay cadena real para comparar, tone warning (no success, no danger)", async () => {
    repo.findById.mockResolvedValue(employeeFixture({
      position: { id: "pos-1", sector: null, salaryCategories: [] },
    }));

    const result = await employeesService.getPositionValidation("emp-1", rrhhUser);

    expect(result.tone).toBe("warning");
    expect(result.checks.every((check) => check.ok)).toBe(true); // nada que comparar, no es un mismatch
  });

  it("empleado sin sector: los checks quedan missing y el tone es warning, no danger", async () => {
    repo.findById.mockResolvedValue(employeeFixture({ sector: null }));

    const result = await employeesService.getPositionValidation("emp-1", rrhhUser);

    expect(result.tone).toBe("warning");
    expect(result.checks.every((check) => check.missing)).toBe(true);
  });

  it("puesto con sectorId valido: el rango salarial se ordena por SalaryCategory.order, no por el orden del array de vinculos", async () => {
    repo.findById.mockResolvedValue(employeeFixture({
      internalCategory: "Operario A",
      position: {
        id: "pos-1",
        sector: sectorChain(),
        // A proposito en desorden: el orden real (order) es Jefe(5) < Administrativo A(8) < Operario A(12).
        salaryCategories: [
          { salaryCategory: { name: "Administrativo A", order: 8 } },
          { salaryCategory: { name: "Jefe", order: 5 } },
          { salaryCategory: { name: "Operario A", order: 12 } },
        ],
      },
    }));

    const result = await employeesService.getPositionValidation("emp-1", rrhhUser);

    expect(result.category.range).toEqual(["Jefe", "Administrativo A", "Operario A"]);
    expect(result.category.status).toBe("IN_RANGE");
    expect(result.tone).toBe("success");
  });

  it("puesto sin seleccionar: tone neutral", async () => {
    repo.findById.mockResolvedValue(employeeFixture({ position: null }));

    const result = await employeesService.getPositionValidation("emp-1", rrhhUser);

    expect(result.tone).toBe("neutral");
    expect(result.title).toBe("Puesto sin seleccionar");
  });
});
