import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { employeesRepository } from "./employees.repository";
import { buildAdditiveTimeGrid, employeesService } from "./employees.service";
import { roles } from "../../shared/security/roles";
import { Prisma } from "@prisma/client";

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
    findAssignableHourConceptIds: vi.fn(),
    findHourConceptsAuditSnapshot: vi.fn(),
    replaceHourConcepts: vi.fn(),
    findEmployeeForManualBreakdown: vi.fn(),
    findHourConceptForManualBreakdown: vi.fn(),
    isHourConceptEnabled: vi.fn(),
    findMonthlyClosure: vi.fn(),
    saveManualHourConceptBreakdown: vi.fn(),
  },
}));

vi.mock("../audit/audit.service", () => ({ auditService: { register: vi.fn() } }));

const repo = employeesRepository as unknown as {
  findById: Mock;
  findAssignableHourConceptIds: Mock;
  findHourConceptsAuditSnapshot: Mock;
  replaceHourConcepts: Mock;
  findEmployeeForManualBreakdown: Mock;
  findHourConceptForManualBreakdown: Mock;
  isHourConceptEnabled: Mock;
  findMonthlyClosure: Mock;
  saveManualHourConceptBreakdown: Mock;
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

describe("buildAdditiveTimeGrid", () => {
  const normal = { id: "normal", code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", loadMode: null, status: "ACTIVO", systemRole: "NORMAL_BASE" } as const;
  const sereno = { id: "sereno", code: "HC-SERENO", name: "Sereno", kind: "SERENO", loadMode: "AUTOMATIC", status: "ACTIVO", systemRole: null } as const;

  it("presenta Normal primero y calcula el total trabajado sólo desde Normal", () => {
    const result = buildAdditiveTimeGrid(
      normal,
      [sereno],
      [
        { day: 1, hours: 10 as never, status: "APROBADO", hourConcept: normal },
        { day: 1, hours: 6 as never, status: "APROBADO", hourConcept: sereno },
      ],
      [{ day: 1, hourConceptId: "sereno", minutes: 360 }],
    );

    expect(result.totalWorkedMinutes).toBe(600);
    expect(result.rows.map((row) => row.concept.id)).toEqual(["normal", "sereno"]);
    expect(result.rows[1]).toMatchObject({ role: "ADDITIONAL", minutesByDay: { "1": 360 }, totalMinutes: 360 });
  });

  it("muestra adicionales habilitados sin desglose con total cero", () => {
    const result = buildAdditiveTimeGrid(normal, [sereno], [], []);
    expect(result.rows[1]).toMatchObject({ concept: sereno, minutesByDay: {}, totalMinutes: 0 });
  });

  it("ignora desgloses de conceptos no habilitados y agrega los existentes por día", () => {
    const result = buildAdditiveTimeGrid(normal, [sereno], [], [
      { day: 2, hourConceptId: "sereno", minutes: 120 },
      { day: 2, hourConceptId: "sereno", minutes: 60 },
      { day: 2, hourConceptId: "colectivo-no-habilitado", minutes: 90 },
    ]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]).toMatchObject({ minutesByDay: { "2": 180 }, totalMinutes: 180 });
  });
});

describe("employeesService manual hour concept breakdowns", () => {
  const input = { date: "2026-08-12", hourConceptId: "11111111-1111-4111-8111-111111111111", minutes: 120, observation: "Traslado" };
  const concept = { id: input.hourConceptId, code: "COLECTIVO", name: "Colectivo", status: "ACTIVO", deletedAt: null, loadMode: "MANUAL", systemRole: null };

  beforeEach(() => {
    repo.findEmployeeForManualBreakdown.mockResolvedValue({ id: "emp-1" });
    repo.findHourConceptForManualBreakdown.mockResolvedValue(concept);
    repo.isHourConceptEnabled.mockResolvedValue(true);
    repo.findMonthlyClosure.mockResolvedValue(null);
    repo.saveManualHourConceptBreakdown.mockResolvedValue({ item: { id: "breakdown-1", minutes: 120, status: "BORRADOR", source: "MANUAL" }, deleted: 0, operation: "CREATE" });
  });

  it.each(["MANUAL", "BOTH"])("guarda un concepto %s habilitado como breakdown MANUAL BORRADOR", async (loadMode) => {
    repo.findHourConceptForManualBreakdown.mockResolvedValue({ ...concept, loadMode });
    const result = await employeesService.upsertManualHourConceptBreakdown("emp-1", input, rrhhUser);
    expect(result).toMatchObject({ source: "MANUAL", status: "BORRADOR", minutes: 120 });
    expect(repo.saveManualHourConceptBreakdown).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: "emp-1", hourConceptId: input.hourConceptId, period: "2026-08", day: 12, minutes: 120,
    }));
  });

  it.each([
    ["Normal", { systemRole: "NORMAL_BASE", loadMode: null }, "NORMAL_BREAKDOWN_NOT_ALLOWED"],
    ["Automático", { loadMode: "AUTOMATIC" }, "MANUAL_BREAKDOWN_NOT_ALLOWED"],
    ["Inactivo", { status: "INACTIVO" }, "HOUR_CONCEPT_INACTIVE"],
    ["Eliminado", { deletedAt: new Date() }, "HOUR_CONCEPT_DELETED"],
    ["Sin modo", { loadMode: null }, "HOUR_CONCEPT_LOAD_MODE_REQUIRED"],
  ])("rechaza %s", async (_label, overrides, code) => {
    repo.findHourConceptForManualBreakdown.mockResolvedValue({ ...concept, ...overrides });
    await expect(employeesService.upsertManualHourConceptBreakdown("emp-1", input, rrhhUser)).rejects.toMatchObject({ code });
    expect(repo.saveManualHourConceptBreakdown).not.toHaveBeenCalled();
  });

  it("rechaza conceptos no habilitados", async () => {
    repo.isHourConceptEnabled.mockResolvedValue(false);
    await expect(employeesService.upsertManualHourConceptBreakdown("emp-1", input, rrhhUser)).rejects.toMatchObject({ code: "HOUR_CONCEPT_NOT_ENABLED" });
  });

  it("respeta scope operativo y no revela empleados fuera de alcance", async () => {
    repo.findEmployeeForManualBreakdown.mockResolvedValue(null);
    await expect(employeesService.upsertManualHourConceptBreakdown("emp-1", input, rrhhUser)).rejects.toMatchObject({ code: "EMPLOYEE_NOT_FOUND" });
    expect(repo.findEmployeeForManualBreakdown).toHaveBeenCalledWith("emp-1", expect.any(Object));
  });

  it("bloquea edición directa de un período cerrado", async () => {
    repo.findMonthlyClosure.mockResolvedValue({ id: "closure-1", status: "APROBADO" });
    await expect(employeesService.upsertManualHourConceptBreakdown("emp-1", input, rrhhUser)).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
  });

  it("minutes cero usa el mismo comando idempotente para eliminar", async () => {
    repo.saveManualHourConceptBreakdown.mockResolvedValue({ item: null, deleted: 1, operation: "DELETE" });
    await expect(employeesService.upsertManualHourConceptBreakdown("emp-1", { ...input, minutes: 0 }, rrhhUser)).resolves.toBeNull();
    expect(repo.saveManualHourConceptBreakdown).toHaveBeenCalledWith(expect.objectContaining({ minutes: 0 }));
  });

  it.each(["P2002", "P2034"])("reintenta una carrera concurrente %s y actualiza sin duplicar", async (code) => {
    const conflict = new Prisma.PrismaClientKnownRequestError("concurrent conflict", { code, clientVersion: "0.0.0" });
    repo.saveManualHourConceptBreakdown
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ item: { id: "breakdown-1", minutes: 120, source: "MANUAL", status: "BORRADOR" }, deleted: 0, operation: "UPDATE" });

    await expect(employeesService.upsertManualHourConceptBreakdown("emp-1", input, rrhhUser)).resolves.toMatchObject({ id: "breakdown-1" });
    expect(repo.saveManualHourConceptBreakdown).toHaveBeenCalledTimes(2);
  });

  it("responde 409 controlado si el conflicto concurrente persiste", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("unique conflict", { code: "P2002", clientVersion: "0.0.0" });
    repo.saveManualHourConceptBreakdown.mockRejectedValue(conflict);
    await expect(employeesService.upsertManualHourConceptBreakdown("emp-1", input, rrhhUser)).rejects.toMatchObject({
      statusCode: 409,
      code: "MANUAL_BREAKDOWN_CONCURRENT_CONFLICT",
    });
  });
});

describe("employeesService.replaceHourConcepts", () => {
  it("rechaza NORMAL_BASE antes de modificar las asignaciones del legajo", async () => {
    repo.findAssignableHourConceptIds.mockResolvedValue([]);

    await expect(
      employeesService.replaceHourConcepts("emp-1", { hourConceptIds: ["normal-1"] }),
    ).rejects.toMatchObject({ statusCode: 409, code: "HOUR_CONCEPT_NOT_ASSIGNABLE" });

    expect(repo.findHourConceptsAuditSnapshot).not.toHaveBeenCalled();
    expect(repo.replaceHourConcepts).not.toHaveBeenCalled();
  });

  it.each([
    ["Normal", "normal-1"],
    ["inactivo", "inactive-1"],
    ["eliminado", "deleted-1"],
    ["sin loadMode", "legacy-1"],
  ])("rechaza concepto %s cuando el catálogo asignable no devuelve su id", async (_case, conceptId) => {
    repo.findAssignableHourConceptIds.mockResolvedValue([]);
    await expect(employeesService.replaceHourConcepts("emp-1", { hourConceptIds: [conceptId] })).rejects.toMatchObject({
      statusCode: 409,
      code: "HOUR_CONCEPT_NOT_ASSIGNABLE",
    });
    expect(repo.replaceHourConcepts).not.toHaveBeenCalled();
  });

  it("acepta sólo conceptos adicionales activos y deduplica ids", async () => {
    repo.findAssignableHourConceptIds.mockResolvedValue([{ id: "additional-1" }]);
    repo.findHourConceptsAuditSnapshot.mockResolvedValue({ hourConcepts: [] });
    repo.replaceHourConcepts.mockResolvedValue({ id: "emp-1", legajo: "1", hourConcepts: [] });

    await employeesService.replaceHourConcepts("emp-1", { hourConceptIds: ["additional-1", "additional-1"] });
    expect(repo.replaceHourConcepts).toHaveBeenCalledWith("emp-1", ["additional-1"]);
  });

  it.each([
    ["Colectivo MANUAL", "colectivo"],
    ["Sereno AUTOMATIC", "sereno"],
    ["concepto BOTH", "both"],
  ])("asigna %s cuando el id está en el catálogo asignable", async (_case, conceptId) => {
    repo.findAssignableHourConceptIds.mockResolvedValue([{ id: conceptId }]);
    repo.findHourConceptsAuditSnapshot.mockResolvedValue({ hourConcepts: [] });
    repo.replaceHourConcepts.mockResolvedValue({ id: "emp-1", legajo: "1", hourConcepts: [] });
    await employeesService.replaceHourConcepts("emp-1", { hourConceptIds: [conceptId] });
    expect(repo.replaceHourConcepts).toHaveBeenCalledWith("emp-1", [conceptId]);
  });

  it("permite quitar todos los conceptos adicionales", async () => {
    repo.findHourConceptsAuditSnapshot.mockResolvedValue({ hourConcepts: [{ hourConceptId: "colectivo" }] });
    repo.replaceHourConcepts.mockResolvedValue({ id: "emp-1", legajo: "1", hourConcepts: [] });
    await employeesService.replaceHourConcepts("emp-1", { hourConceptIds: [] });
    expect(repo.findAssignableHourConceptIds).not.toHaveBeenCalled();
    expect(repo.replaceHourConcepts).toHaveBeenCalledWith("emp-1", []);
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
