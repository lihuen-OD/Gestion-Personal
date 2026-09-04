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
    existsWithAccess: vi.fn(),
    findFieldHistory: vi.fn(),
    findBlockHistory: vi.fn(),
    createFieldHistory: vi.fn(),
    createBlockHistory: vi.fn(),
    findAssignableHourConceptIds: vi.fn(),
    findHourConceptsAuditSnapshot: vi.fn(),
    replaceHourConcepts: vi.fn(),
    findEmployeeForManualBreakdown: vi.fn(),
    findHourConceptForManualBreakdown: vi.fn(),
    isHourConceptEnabled: vi.fn(),
    findMonthlyClosure: vi.fn(),
    saveManualHourConceptBreakdown: vi.fn(),
    findManualBreakdownById: vi.fn(),
    approveManualHourConceptBreakdown: vi.fn(),
    rejectManualHourConceptBreakdown: vi.fn(),
    returnManualHourConceptBreakdown: vi.fn(),
  },
}));

vi.mock("../audit/audit.service", () => ({ auditService: { register: vi.fn() } }));

const repo = employeesRepository as unknown as {
  findById: Mock;
  existsWithAccess: Mock;
  findFieldHistory: Mock;
  findBlockHistory: Mock;
  createFieldHistory: Mock;
  createBlockHistory: Mock;
  findAssignableHourConceptIds: Mock;
  findHourConceptsAuditSnapshot: Mock;
  replaceHourConcepts: Mock;
  findEmployeeForManualBreakdown: Mock;
  findHourConceptForManualBreakdown: Mock;
  isHourConceptEnabled: Mock;
  findMonthlyClosure: Mock;
  saveManualHourConceptBreakdown: Mock;
  findManualBreakdownById: Mock;
  approveManualHourConceptBreakdown: Mock;
  rejectManualHourConceptBreakdown: Mock;
  returnManualHourConceptBreakdown: Mock;
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

  // Etapa 11B: el detalle por legajo (EmployeeHoursPage) ignoraba por
  // completo appliedMultiplier/SpecialHourRuleApplication — estos tests
  // verifican que ahora expone lo mismo que ya expone la grilla principal
  // (11A/11A.1), sin inflar totalWorkedMinutes ni minutesByDay reales.
  describe("Horas Especiales sobre total y conceptos horarios (Etapa 11B)", () => {
    it("sin ninguna regla: specialHoursByDay vacío, liquidable = real", () => {
      const result = buildAdditiveTimeGrid(normal, [sereno], [
        { day: 1, hours: 8 as never, status: "APROBADO", hourConcept: normal, appliedMultiplier: 1 },
      ], []);

      expect(result.specialHoursByDay).toEqual({});
      expect(result.specialHourAdditionalMinutes).toBe(0);
      expect(result.specialHourLiquidableTotalMinutes).toBe(480);
      expect(result.totalWorkedMinutes).toBe(480); // real, sin inflar
    });

    it("caso obligatorio — 8hs normales + 4hs Sereno en domingo x2: liquidable total 24hs (1440 min), reales intactas", () => {
      const result = buildAdditiveTimeGrid(normal, [sereno], [
        {
          day: 27, hours: 8 as never, status: "APROBADO", hourConcept: normal, appliedMultiplier: 2,
          timeSegment: { specialHourRuleApplications: [{ wasConflicting: false, doubleHourRule: { name: "Domingo" } }] },
        },
      ], [{ day: 27, hourConceptId: "sereno", minutes: 240 }]);

      // Reales: nunca se inflan.
      expect(result.totalWorkedMinutes).toBe(480); // 8hs reales de Hora normal
      expect(result.rows[1]).toMatchObject({ minutesByDay: { "27": 240 }, totalMinutes: 240 }); // 4hs reales de Sereno

      // Liquidable: 8*2 + 4*2 = 16 + 8 = 24hs = 1440 min.
      expect(result.specialHoursByDay["27"]).toMatchObject({
        multiplier: 2,
        additionalMinutes: 720, // 480*(2-1) + 240*(2-1)
        liquidableTotalMinutes: 1440,
        ruleNames: ["Domingo"],
        conflict: false,
      });
      expect(result.specialHourAdditionalMinutes).toBe(720);
      expect(result.specialHourLiquidableTotalMinutes).toBe(1440);
    });

    it("conflicto de prioridad (empate): se refleja en specialHoursByDay sin bloquear el cálculo", () => {
      const result = buildAdditiveTimeGrid(normal, [sereno], [
        {
          day: 16, hours: 8 as never, status: "APROBADO", hourConcept: normal, appliedMultiplier: 2.5,
          timeSegment: {
            specialHourRuleApplications: [
              { wasConflicting: true, doubleHourRule: { name: "Domingo Odwyer" } },
              { wasConflicting: true, doubleHourRule: { name: "Domingo Pañol" } },
            ],
          },
        },
      ], []);

      expect(result.specialHoursByDay["16"]).toMatchObject({ multiplier: 2.5, conflict: true, ruleNames: ["Domingo Odwyer", "Domingo Pañol"] });
    });

    it("carga manual (sin timeSegment/trazabilidad de regla) igual expone el multiplicador y el liquidable, sin nombre de regla", () => {
      const result = buildAdditiveTimeGrid(normal, [sereno], [
        { day: 5, hours: 8 as never, status: "APROBADO", hourConcept: normal, appliedMultiplier: 2, timeSegment: null },
      ], [{ day: 5, hourConceptId: "sereno", minutes: 120 }]);

      expect(result.specialHoursByDay["5"]).toMatchObject({ multiplier: 2, ruleNames: [], liquidableTotalMinutes: 1200 }); // (480+120)*2
    });

    it("un TimeEntry EN_REVISION también cuenta (mismo gate que 'normal'), uno BORRADOR no", () => {
      const result = buildAdditiveTimeGrid(normal, [sereno], [
        { day: 1, hours: 8 as never, status: "EN_REVISION", hourConcept: normal, appliedMultiplier: 2 },
        { day: 2, hours: 8 as never, status: "BORRADOR", hourConcept: normal, appliedMultiplier: 2 },
      ], []);

      expect(result.specialHoursByDay).toHaveProperty("1");
      expect(result.specialHoursByDay).not.toHaveProperty("2");
    });
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

describe("employeesService manual hour concept breakdowns — flujo de aprobación por rol (Etapa 6L.3)", () => {
  const input = { date: "2026-08-12", hourConceptId: "11111111-1111-4111-8111-111111111111", minutes: 120, observation: "Traslado" };
  const concept = { id: input.hourConceptId, code: "COLECTIVO", name: "Colectivo", status: "ACTIVO", deletedAt: null, loadMode: "MANUAL", systemRole: null };
  const nivel2User = { id: "user-n2", role: roles.supervision } as unknown as Express.AuthUser;
  const nivel3User = { id: "user-n3", role: roles.cargaHoraria } as unknown as Express.AuthUser;

  beforeEach(() => {
    repo.findEmployeeForManualBreakdown.mockResolvedValue({ id: "emp-1" });
    repo.findHourConceptForManualBreakdown.mockResolvedValue(concept);
    repo.isHourConceptEnabled.mockResolvedValue(true);
    repo.findMonthlyClosure.mockResolvedValue(null);
    repo.saveManualHourConceptBreakdown.mockResolvedValue({ item: { id: "breakdown-1", minutes: 120, status: "APROBADO", source: "MANUAL" }, deleted: 0, operation: "CREATE" });
  });

  it("RRHH carga un desglose manual y no queda pendiente para sí mismo: pasa su propio id como approvedByUserId", async () => {
    await employeesService.upsertManualHourConceptBreakdown("emp-1", input, rrhhUser);

    expect(repo.saveManualHourConceptBreakdown).toHaveBeenCalledWith(expect.objectContaining({ approvedByUserId: rrhhUser.id }));
  });

  it("Nivel 2 carga un desglose manual y queda pendiente/en revisión: no pasa approvedByUserId", async () => {
    await employeesService.upsertManualHourConceptBreakdown("emp-1", input, nivel2User);

    expect(repo.saveManualHourConceptBreakdown).toHaveBeenCalledWith(expect.objectContaining({ approvedByUserId: null }));
  });

  it("Nivel 3 carga un desglose manual y queda pendiente/en revisión: no pasa approvedByUserId", async () => {
    await employeesService.upsertManualHourConceptBreakdown("emp-1", input, nivel3User);

    expect(repo.saveManualHourConceptBreakdown).toHaveBeenCalledWith(expect.objectContaining({ approvedByUserId: null }));
  });

  it("un período cerrado sigue bloqueando la carga de Nivel 2/3 (no se rompe el bloqueo de cierre)", async () => {
    repo.findMonthlyClosure.mockResolvedValue({ id: "closure-1", status: "APROBADO" });

    await expect(employeesService.upsertManualHourConceptBreakdown("emp-1", input, nivel2User)).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    expect(repo.saveManualHourConceptBreakdown).not.toHaveBeenCalled();
  });

  it("un concepto no habilitado sigue rechazado para Nivel 2/3 (el scope/permiso no cambia)", async () => {
    repo.isHourConceptEnabled.mockResolvedValue(false);

    await expect(employeesService.upsertManualHourConceptBreakdown("emp-1", input, nivel3User)).rejects.toMatchObject({ code: "HOUR_CONCEPT_NOT_ENABLED" });
  });
});

describe("employeesService — approve/reject/return de HourConceptBreakdown manual (Etapa 6L.3, ajuste)", () => {
  const nivel2User = { id: "user-n2", role: roles.supervision } as unknown as Express.AuthUser;
  const nivel3User = { id: "user-n3", role: roles.cargaHoraria } as unknown as Express.AuthUser;
  const breakdownInReview = {
    id: "breakdown-1",
    employeeId: "emp-1",
    status: "EN_REVISION",
    createdByUserId: "user-n2",
    employee: { id: "emp-1", legajo: "100" },
    hourConcept: { id: "colectivo", name: "Colectivo" },
  };

  beforeEach(() => {
    repo.findManualBreakdownById.mockResolvedValue(breakdownInReview);
  });

  it("RRHH aprueba un desglose manual EN_REVISION de Nivel 2/3", async () => {
    repo.approveManualHourConceptBreakdown.mockResolvedValue({ ...breakdownInReview, status: "APROBADO", approvedByUserId: rrhhUser.id });

    const result = await employeesService.approveManualHourConceptBreakdown("emp-1", "breakdown-1", rrhhUser);

    expect(result).toMatchObject({ status: "APROBADO" });
    expect(repo.approveManualHourConceptBreakdown).toHaveBeenCalledWith("breakdown-1", rrhhUser.id);
  });

  it("RRHH rechaza un desglose manual EN_REVISION", async () => {
    repo.rejectManualHourConceptBreakdown.mockResolvedValue({ ...breakdownInReview, status: "RECHAZADO" });

    const result = await employeesService.rejectManualHourConceptBreakdown("emp-1", "breakdown-1", { reason: "Sin comprobante" }, rrhhUser);

    expect(result).toMatchObject({ status: "RECHAZADO" });
    expect(repo.rejectManualHourConceptBreakdown).toHaveBeenCalledWith("breakdown-1");
  });

  it("RRHH devuelve un desglose manual EN_REVISION", async () => {
    repo.returnManualHourConceptBreakdown.mockResolvedValue({ ...breakdownInReview, status: "DEVUELTO" });

    const result = await employeesService.returnManualHourConceptBreakdown("emp-1", "breakdown-1", { reason: "Falta el destino" }, rrhhUser);

    expect(result).toMatchObject({ status: "DEVUELTO" });
    expect(repo.returnManualHourConceptBreakdown).toHaveBeenCalledWith("breakdown-1");
  });

  it("Nivel 2 no puede aprobar un desglose manual (ni propio ni ajeno)", async () => {
    await expect(employeesService.approveManualHourConceptBreakdown("emp-1", "breakdown-1", nivel2User)).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    expect(repo.approveManualHourConceptBreakdown).not.toHaveBeenCalled();
    expect(repo.findManualBreakdownById).not.toHaveBeenCalled();
  });

  it("Nivel 3 no puede aprobar/rechazar/devolver un desglose manual", async () => {
    await expect(employeesService.approveManualHourConceptBreakdown("emp-1", "breakdown-1", nivel3User)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(employeesService.rejectManualHourConceptBreakdown("emp-1", "breakdown-1", { reason: "x" }, nivel3User)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(employeesService.returnManualHourConceptBreakdown("emp-1", "breakdown-1", { reason: "x" }, nivel3User)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repo.approveManualHourConceptBreakdown).not.toHaveBeenCalled();
    expect(repo.rejectManualHourConceptBreakdown).not.toHaveBeenCalled();
    expect(repo.returnManualHourConceptBreakdown).not.toHaveBeenCalled();
  });

  it("no permite aprobar un desglose que ya no está EN_REVISION", async () => {
    repo.findManualBreakdownById.mockResolvedValue({ ...breakdownInReview, status: "APROBADO" });

    await expect(employeesService.approveManualHourConceptBreakdown("emp-1", "breakdown-1", rrhhUser)).rejects.toMatchObject({
      code: "HOUR_CONCEPT_BREAKDOWN_STATUS_NOT_RESOLVABLE",
      statusCode: 400,
    });
    expect(repo.approveManualHourConceptBreakdown).not.toHaveBeenCalled();
  });

  it("responde 404 si el desglose no existe o está fuera de scope", async () => {
    repo.findManualBreakdownById.mockResolvedValue(null);

    await expect(employeesService.approveManualHourConceptBreakdown("emp-1", "breakdown-404", rrhhUser)).rejects.toMatchObject({
      code: "HOUR_CONCEPT_BREAKDOWN_NOT_FOUND",
      statusCode: 404,
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

// Etapa 14C.3: `listFieldHistory`/`listBlockHistory`/`createFieldHistory`/
// `createBlockHistory` pasaron de `employeesService.getById` (detalle
// COMPLETO del legajo — causa real de los 3-5s medidos en block-history) a
// `employeesService.assertAccessible` (sólo existencia + alcance, sin
// relaciones). Estos tests confirman el cambio de mecanismo y que el
// comportamiento de 404/permisos se preserva exactamente igual.
describe("employeesService.assertAccessible / historiales de campo y bloque — Etapa 14C.3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("assertAccessible no llama a findById (no carga el detalle completo)", async () => {
    repo.existsWithAccess.mockResolvedValue(true);

    await employeesService.assertAccessible("emp-1", rrhhUser);

    expect(repo.existsWithAccess).toHaveBeenCalledWith("emp-1", {});
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it("assertAccessible lanza EMPLOYEE_NOT_FOUND (404) si no existe o está fuera de alcance", async () => {
    repo.existsWithAccess.mockResolvedValue(false);

    await expect(employeesService.assertAccessible("emp-404", rrhhUser)).rejects.toMatchObject({ code: "EMPLOYEE_NOT_FOUND", statusCode: 404 });
  });

  it("listFieldHistory usa assertAccessible (no findById) y devuelve el resultado de findFieldHistory tal cual", async () => {
    repo.existsWithAccess.mockResolvedValue(true);
    const rows = [{ id: "fh-1" }];
    repo.findFieldHistory.mockResolvedValue(rows);

    const result = await employeesService.listFieldHistory("emp-1", { take: 50 } as never, rrhhUser);

    expect(repo.existsWithAccess).toHaveBeenCalledWith("emp-1", {});
    expect(repo.findById).not.toHaveBeenCalled();
    expect(repo.findFieldHistory).toHaveBeenCalledWith("emp-1", { take: 50 });
    expect(result).toBe(rows);
  });

  it("listFieldHistory propaga 404 sin llegar a consultar el historial", async () => {
    repo.existsWithAccess.mockResolvedValue(false);

    await expect(employeesService.listFieldHistory("emp-404", { take: 50 } as never, rrhhUser)).rejects.toMatchObject({ code: "EMPLOYEE_NOT_FOUND" });
    expect(repo.findFieldHistory).not.toHaveBeenCalled();
  });

  it("listBlockHistory usa assertAccessible (no findById) y devuelve el resultado de findBlockHistory tal cual", async () => {
    repo.existsWithAccess.mockResolvedValue(true);
    const rows = [{ id: "bh-1" }];
    repo.findBlockHistory.mockResolvedValue(rows);

    const result = await employeesService.listBlockHistory("emp-1", { take: 50 } as never, rrhhUser);

    expect(repo.existsWithAccess).toHaveBeenCalledWith("emp-1", {});
    expect(repo.findById).not.toHaveBeenCalled();
    expect(repo.findBlockHistory).toHaveBeenCalledWith("emp-1", { take: 50 });
    expect(result).toBe(rows);
  });

  it("listBlockHistory propaga 404 sin llegar a consultar el historial", async () => {
    repo.existsWithAccess.mockResolvedValue(false);

    await expect(employeesService.listBlockHistory("emp-404", { take: 50 } as never, rrhhUser)).rejects.toMatchObject({ code: "EMPLOYEE_NOT_FOUND" });
    expect(repo.findBlockHistory).not.toHaveBeenCalled();
  });

  it("createFieldHistory usa assertAccessible cuando hay usuario, no findById", async () => {
    repo.existsWithAccess.mockResolvedValue(true);
    const record = { id: "fh-new", fieldLabel: "Sector" };
    repo.createFieldHistory.mockResolvedValue(record);

    const input = { section: "DATOS_LABORALES", field: "sectorId", fieldLabel: "Sector", newValue: "Ventas", effectiveFrom: "2026-09-01", reason: "Cambio de área" } as never;
    const result = await employeesService.createFieldHistory("emp-1", input, { userId: "user-rrhh" }, rrhhUser);

    expect(repo.existsWithAccess).toHaveBeenCalledWith("emp-1", {});
    expect(repo.findById).not.toHaveBeenCalled();
    expect(result).toBe(record);
  });

  it("createBlockHistory usa assertAccessible cuando hay usuario, no findById", async () => {
    repo.existsWithAccess.mockResolvedValue(true);
    const record = { id: "bh-new", blockLabel: "Responsable de carga" };
    repo.createBlockHistory.mockResolvedValue(record);

    const input = { section: "RESPONSABLES", block: "TIME_RESPONSIBLE", blockLabel: "Responsable de carga", newValue: "user-2", effectiveFrom: "2026-09-01", reason: "Reasignación" } as never;
    const result = await employeesService.createBlockHistory("emp-1", input, { userId: "user-rrhh" }, rrhhUser);

    expect(repo.existsWithAccess).toHaveBeenCalledWith("emp-1", {});
    expect(repo.findById).not.toHaveBeenCalled();
    expect(result).toBe(record);
  });
});
