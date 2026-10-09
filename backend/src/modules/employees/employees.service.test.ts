import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { employeesRepository } from "./employees.repository";
import { buildEmployeeTimeGrid, employeesService } from "./employees.service";
import { resolveDoubleHourMultipliersByDate } from "../time-entries/timeEntries.repository";
import { roles } from "../../shared/security/roles";
import { Prisma } from "@prisma/client";
import { calculateAutomaticBreakdowns } from "./automaticHourConceptBreakdowns";
import { auditService } from "../audit/audit.service";

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
    findPositionValidationById: vi.fn(),
    findFieldHistory: vi.fn(),
    findBlockHistory: vi.fn(),
    createFieldHistory: vi.fn(),
    createBlockHistory: vi.fn(),
    findAssignableHourConceptIds: vi.fn(),
    findHourConceptsAuditSnapshot: vi.fn(),
    replaceHourConcepts: vi.fn(),
    findEmployeeForManualBreakdown: vi.fn(),
    findHourConceptForManualBreakdown: vi.fn(),
    findWithinBaseDayContext: vi.fn(),
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
vi.mock("../time-entries/timeEntries.repository", () => ({ resolveDoubleHourMultipliersByDate: vi.fn() }));
const mockedResolveMultipliers = resolveDoubleHourMultipliersByDate as unknown as Mock;

const repo = employeesRepository as unknown as {
  findById: Mock;
  existsWithAccess: Mock;
  findPositionValidationById: Mock;
  findFieldHistory: Mock;
  findBlockHistory: Mock;
  createFieldHistory: Mock;
  createBlockHistory: Mock;
  findAssignableHourConceptIds: Mock;
  findHourConceptsAuditSnapshot: Mock;
  replaceHourConcepts: Mock;
  findEmployeeForManualBreakdown: Mock;
  findHourConceptForManualBreakdown: Mock;
  findWithinBaseDayContext: Mock;
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
    // Puesto del modelo anterior por defecto: sector legado, sin alcance A5.
    position: {
      id: "pos-1",
      sector: sectorChain(),
      salaryCategories: [{ salaryCategory: { name: "Administrativo A", order: 8 } }],
      _count: { orgScopes: 0 },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolveMultipliers.mockResolvedValue(new Map());
});

// docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md — reemplaza el modelo 11B
// donde todo desglose "nunca sumaba" y el liquidable era (base + conceptos)×m.
describe("buildEmployeeTimeGrid", () => {
  const normal = { id: "normal", code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", loadMode: null, status: "ACTIVO", systemRole: "NORMAL_BASE", workTreatment: null } as const;
  const sereno = { id: "sereno", code: "HOR-001", name: "Sereno", kind: "SERENO", loadMode: "BOTH", status: "ACTIVO", systemRole: null, workTreatment: "WITHIN_BASE" } as const;
  const colectivo = { id: "colectivo", code: "HOR-002", name: "Colectivo", kind: "TRANSPORTE", loadMode: "MANUAL", status: "ACTIVO", systemRole: null, workTreatment: "ADDITIVE_TO_WORKED_TOTAL" } as const;
  const entry = (day: number, hours: number, overrides: Record<string, unknown> = {}) => ({ employeeId: "emp-1", day, hours: hours as never, status: "APROBADO", hourConcept: normal, appliedMultiplier: 1, ...overrides });
  const breakdown = (concept: typeof sereno | typeof colectivo, day: number, minutes: number, multiplier = 1) => ({
    employeeId: "emp-1", day, hourConceptId: concept.id, minutes, appliedMultiplier: multiplier, startAt: null, endAt: null, hourConcept: concept,
  });

  it("filas: Horas base primero, después dentro de la jornada y por último horas adicionales", () => {
    const result = buildEmployeeTimeGrid(normal, [colectivo, sereno], [], []);
    expect(result.rows.map((row) => row.concept.id)).toEqual(["normal", "sereno", "colectivo"]);
    expect(result.rows[1]).toMatchObject({ role: "ADDITIONAL", enabled: true, minutesByDay: {}, totalMinutes: 0 });
  });

  it("día común — base 8 + Sereno 3 + Colectivo 1: Horas normales 5, total trabajado 9 (Sereno no se vuelve a sumar)", () => {
    const result = buildEmployeeTimeGrid(normal, [sereno, colectivo], [entry(4, 8)], [breakdown(sereno, 4, 180), breakdown(colectivo, 4, 60)]);
    expect(result.rows[0]).toMatchObject({ role: "NORMAL_BASE", minutesByDay: { "4": 480 }, totalMinutes: 480 });
    expect(result.accounting.days["4"]).toMatchObject({ baseMinutes: 480, normalResidualMinutes: 300, withinBaseMinutes: 180, additiveMinutes: 60, totalWorkedMinutes: 540 });
    expect(result.totalWorkedMinutes).toBe(540);
    expect(result.specialHoursByDay).toEqual({});
    expect(result.accounting.settlement.totalMinutes).toBe(540);
  });

  it("domingo x2 — base 8 + Sereno 3 + Colectivo 1: real 9, para liquidación 10 + 6 + 2 = 18 (nunca 22 ni 24)", () => {
    const result = buildEmployeeTimeGrid(normal, [sereno, colectivo], [
      entry(27, 8, { appliedMultiplier: 2, timeSegment: { specialHourRuleApplications: [{ wasConflicting: false, doubleHourRule: { name: "Domingos" } }] } }),
    ], [breakdown(sereno, 27, 180, 2), breakdown(colectivo, 27, 60, 2)]);

    expect(result.totalWorkedMinutes).toBe(540);
    expect(result.accounting.settlement).toEqual({ normalMinutes: 600, withinBaseMinutes: 360, additiveMinutes: 120, totalMinutes: 1080 });
    expect(result.specialHoursByDay["27"]).toEqual({ multiplier: 2, ruleNames: ["Domingos"], conflict: false });
  });

  it("Colectivo de domingo sin Horas base ese día: conserva su x2 propio (snapshot), real 2 y equivalencia 4", () => {
    const result = buildEmployeeTimeGrid(normal, [colectivo], [], [breakdown(colectivo, 6, 120, 2)]);
    expect(result.accounting.days["6"]).toMatchObject({ baseMinutes: 0, totalWorkedMinutes: 120, settlement: expect.objectContaining({ totalMinutes: 240 }) });
    expect(result.specialHoursByDay["6"]).toEqual({ multiplier: 2, ruleNames: [], conflict: false });
  });

  it("conflicto de prioridad (empate): se refleja en specialHoursByDay sin bloquear el cálculo", () => {
    const result = buildEmployeeTimeGrid(normal, [sereno], [
      entry(16, 8, {
        appliedMultiplier: 2.5,
        timeSegment: { specialHourRuleApplications: [{ wasConflicting: true, doubleHourRule: { name: "Domingo Odwyer" } }, { wasConflicting: true, doubleHourRule: { name: "Domingo Pañol" } }] },
      }),
    ], []);
    expect(result.specialHoursByDay["16"]).toMatchObject({ multiplier: 2.5, conflict: true, ruleNames: ["Domingo Odwyer", "Domingo Pañol"] });
    expect(result.accounting.settlement.totalMinutes).toBe(1200);
  });

  it("Horas base: cuenta APROBADO y EN_REVISION, nunca BORRADOR ni otro concepto", () => {
    const result = buildEmployeeTimeGrid(normal, [sereno], [
      entry(1, 8, { status: "EN_REVISION" }),
      entry(2, 8, { status: "BORRADOR", appliedMultiplier: 2 }),
      entry(3, 6, { hourConcept: sereno }),
    ], []);
    expect(result.rows[0]).toMatchObject({ minutesByDay: { "1": 480 }, totalMinutes: 480 });
    expect(result.specialHoursByDay).not.toHaveProperty("2");
  });

  it("un concepto con horas en el período que hoy no está habilitado se muestra (sólo lectura) para que la grilla explique el total", () => {
    const result = buildEmployeeTimeGrid(normal, [sereno], [entry(2, 8)], [breakdown(sereno, 2, 120), breakdown(sereno, 2, 60), breakdown(colectivo, 2, 90)]);
    expect(result.rows.map((row) => [row.concept.id, row.enabled, row.totalMinutes])).toEqual([["normal", true, 480], ["sereno", true, 180], ["colectivo", false, 90]]);
    expect(result.totalWorkedMinutes).toBe(570);
  });

  // Etapa 15M.2 encadenada con el modelo nuevo: el desglose automático
  // dentro de la jornada nunca infla el total y persiste su intervalo real.
  it("Motor B -> grilla: 07:50-11:59 (249 min) con concepto automático 09:00-11:00 → base 249, Horas normales 129, total 249 (nunca 369)", () => {
    const shift = { id: "shift-1", startAt: new Date("2026-09-10T10:50:00.000Z"), endAt: new Date("2026-09-10T14:59:00.000Z") }; // 07:50-11:59 ART
    const rule = { id: "rule-prueba", hourConceptId: "sereno", startTime: "09:00", endTime: "11:00", crossesMidnight: false };

    const rows = calculateAutomaticBreakdowns("2026-09", [shift], [rule]);
    expect(rows).toEqual([expect.objectContaining({ hourConceptId: "sereno", minutes: 120, day: 10, startAt: new Date("2026-09-10T12:00:00.000Z"), endAt: new Date("2026-09-10T14:00:00.000Z") })]);

    const result = buildEmployeeTimeGrid(normal, [sereno], [entry(10, 4.15)], rows.map((row) => ({ ...breakdown(sereno, row.day, row.minutes), startAt: row.startAt, endAt: row.endAt })));
    expect(result.rows[0]).toMatchObject({ role: "NORMAL_BASE", totalMinutes: 249 });
    expect(result.rows[1]).toMatchObject({ role: "ADDITIONAL", minutesByDay: { "10": 120 }, totalMinutes: 120 });
    expect(result.accounting.normalResidualMinutes).toBe(129);
    expect(result.totalWorkedMinutes).toBe(249);
  });
});

describe("employeesService manual hour concept breakdowns", () => {
  const input = { date: "2026-08-12", hourConceptId: "11111111-1111-4111-8111-111111111111", minutes: 120, observation: "Traslado" };
  const concept = { id: input.hourConceptId, code: "COLECTIVO", name: "Colectivo", status: "ACTIVO", loadMode: "MANUAL", systemRole: null, workTreatment: "ADDITIVE_TO_WORKED_TOTAL" };

  beforeEach(() => {
    repo.findEmployeeForManualBreakdown.mockResolvedValue({ id: "emp-1" });
    repo.findHourConceptForManualBreakdown.mockResolvedValue(concept);
    repo.isHourConceptEnabled.mockResolvedValue(true);
    repo.findMonthlyClosure.mockResolvedValue(null);
    repo.saveManualHourConceptBreakdown.mockResolvedValue({ item: { id: "breakdown-1", minutes: 120, status: "BORRADOR", source: "MANUAL" }, deleted: 0, operation: "CREATE" });
  });

  // docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md — semántica explícita,
  // nunca deducida de loadMode.
  describe("tratamiento en el total trabajado", () => {
    const serenoConcept = { ...concept, code: "HOR-001", name: "Sereno", loadMode: "BOTH", workTreatment: "WITHIN_BASE" };

    it("Colectivo (adicional) se guarda aunque no haya Horas base ese día — sin consultar el contexto de jornada", async () => {
      await employeesService.upsertManualHourConceptBreakdown("emp-1", input, rrhhUser);
      expect(repo.findWithinBaseDayContext).not.toHaveBeenCalled();
      expect(repo.saveManualHourConceptBreakdown).toHaveBeenCalled();
    });

    it("congela el multiplicador de Hora Especial de la fecha en el desglose (Colectivo de domingo → x2)", async () => {
      mockedResolveMultipliers.mockResolvedValue(new Map([["2026-08-12", 2]]));
      await employeesService.upsertManualHourConceptBreakdown("emp-1", input, rrhhUser);
      expect(mockedResolveMultipliers).toHaveBeenCalledWith("emp-1", [new Date("2026-08-12T00:00:00.000Z")]);
      expect(repo.saveManualHourConceptBreakdown).toHaveBeenCalledWith(expect.objectContaining({ appliedMultiplier: 2 }));
    });

    it("Sereno (dentro de la jornada, loadMode BOTH) sin Horas base ese día: error de negocio, nunca se convierte en horas adicionales", async () => {
      repo.findHourConceptForManualBreakdown.mockResolvedValue(serenoConcept);
      repo.findWithinBaseDayContext.mockResolvedValue({ baseMinutes: 0, withinBaseBreakdowns: [] });
      await expect(employeesService.upsertManualHourConceptBreakdown("emp-1", input, rrhhUser)).rejects.toMatchObject({
        statusCode: 409,
        code: "WITHIN_BASE_REQUIRES_BASE_HOURS",
        message: "No se puede cargar Sereno dentro de la jornada porque no hay horas base registradas para ese día.",
      });
      expect(repo.saveManualHourConceptBreakdown).not.toHaveBeenCalled();
    });

    it("Sereno no puede superar la base junto con los demás conceptos dentro de la jornada (unión de cobertura)", async () => {
      repo.findHourConceptForManualBreakdown.mockResolvedValue(serenoConcept);
      repo.findWithinBaseDayContext.mockResolvedValue({
        baseMinutes: 480,
        withinBaseBreakdowns: [{ minutes: 420, startAt: new Date("2026-08-12T10:00:00.000Z"), endAt: new Date("2026-08-12T17:00:00.000Z") }],
      });
      await expect(employeesService.upsertManualHourConceptBreakdown("emp-1", input, rrhhUser)).rejects.toMatchObject({ code: "WITHIN_BASE_EXCEEDS_BASE_HOURS" });
      expect(repo.findWithinBaseDayContext).toHaveBeenCalledWith("emp-1", new Date("2026-08-12T00:00:00.000Z"), input.hourConceptId);
    });

    it("Sereno dentro de la base se guarda", async () => {
      repo.findHourConceptForManualBreakdown.mockResolvedValue(serenoConcept);
      repo.findWithinBaseDayContext.mockResolvedValue({ baseMinutes: 480, withinBaseBreakdowns: [] });
      await employeesService.upsertManualHourConceptBreakdown("emp-1", { ...input, minutes: 180 }, rrhhUser);
      expect(repo.saveManualHourConceptBreakdown).toHaveBeenCalledWith(expect.objectContaining({ minutes: 180, appliedMultiplier: 1 }));
    });

    it("borrar (0 minutos) un concepto dentro de la jornada no exige base", async () => {
      repo.findHourConceptForManualBreakdown.mockResolvedValue(serenoConcept);
      repo.saveManualHourConceptBreakdown.mockResolvedValue({ item: null, deleted: 1, operation: "DELETE" });
      await employeesService.upsertManualHourConceptBreakdown("emp-1", { ...input, minutes: 0 }, rrhhUser);
      expect(repo.findWithinBaseDayContext).not.toHaveBeenCalled();
      expect(mockedResolveMultipliers).not.toHaveBeenCalled();
    });
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

  it("RRHH corrige un período cerrado directo, siempre que mande motivo (Etapa 15E) — input.observation ya viene con 'Traslado'", async () => {
    repo.findMonthlyClosure.mockResolvedValue({ id: "closure-1", status: "APROBADO" });
    const result = await employeesService.upsertManualHourConceptBreakdown("emp-1", input, rrhhUser);
    expect(result).toMatchObject({ id: "breakdown-1" });
    expect(repo.saveManualHourConceptBreakdown).toHaveBeenCalledWith(expect.objectContaining({ approvedByUserId: rrhhUser.id }));
  });

  it("RRHH sin motivo en un período cerrado queda bloqueado con un error propio (Etapa 15E)", async () => {
    repo.findMonthlyClosure.mockResolvedValue({ id: "closure-1", status: "APROBADO" });
    await expect(
      employeesService.upsertManualHourConceptBreakdown("emp-1", { ...input, observation: undefined }, rrhhUser),
    ).rejects.toMatchObject({ statusCode: 400, code: "HOUR_CONCEPT_BREAKDOWN_CORRECTION_REASON_REQUIRED" });
    expect(repo.saveManualHourConceptBreakdown).not.toHaveBeenCalled();
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
  const concept = { id: input.hourConceptId, code: "COLECTIVO", name: "Colectivo", status: "ACTIVO", loadMode: "MANUAL", systemRole: null };
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
  it("puesto sin alcance: pendiente de recarga, sin comparación estructural (M2: el legajo ya no tiene sector)", async () => {
    repo.findPositionValidationById.mockResolvedValue(employeeFixture());

    const result = await employeesService.getPositionValidation("emp-1", rrhhUser);

    expect(result.tone).toBe("warning");
    expect(result.title).toBe("Puesto pendiente de recarga");
    expect(result.checks).toEqual([]);
  });

  it("puesto con alcance A5: no exige ni compara un sector del legajo; success con categoría en rango (A6)", async () => {
    repo.findPositionValidationById.mockResolvedValue(employeeFixture({
      sector: null,
      position: { id: "pos-1", sector: null, salaryCategories: [{ salaryCategory: { name: "Administrativo A", order: 8 } }], _count: { orgScopes: 2 } },
    }));

    const result = await employeesService.getPositionValidation("emp-1", rrhhUser);

    expect(result.checks).toEqual([]);
    expect(result.tone).toBe("success");
    expect(result.title).toBe("Datos laborales dentro del puesto");
  });

  it("puesto con alcance A5 y sector anterior distinto en el legajo: el sector anterior no genera discrepancia (A6)", async () => {
    repo.findPositionValidationById.mockResolvedValue(employeeFixture({
      position: { id: "pos-1", sector: null, salaryCategories: [{ salaryCategory: { name: "Administrativo A", order: 8 } }], _count: { orgScopes: 1 } },
    }));

    const result = await employeesService.getPositionValidation("emp-1", rrhhUser);

    expect(result.tone).toBe("success");
  });

  it("puesto con alcance A5 y categoría fuera de rango: sigue marcando danger por la categoría salarial", async () => {
    repo.findPositionValidationById.mockResolvedValue(employeeFixture({
      internalCategory: "Operario D",
      position: { id: "pos-1", sector: null, salaryCategories: [{ salaryCategory: { name: "Administrativo A", order: 8 } }], _count: { orgScopes: 1 } },
    }));

    const result = await employeesService.getPositionValidation("emp-1", rrhhUser);

    expect(result.tone).toBe("danger");
    expect(result.category.status).toBe("ABOVE_RANGE");
  });

  it("un puesto con sector legado distinto ya no genera discrepancia estructural: queda pendiente de recarga (M2)", async () => {
    repo.findPositionValidationById.mockResolvedValue(employeeFixture({
      position: {
        id: "pos-1",
        sector: sectorChain({ sector: "Compras", area: "Administracion", establishment: "Casa Central", businessUnit: "Administracion" }),
        salaryCategories: [{ salaryCategory: { name: "Administrativo A", order: 8 } }],
        _count: { orgScopes: 0 },
      },
    }));

    const result = await employeesService.getPositionValidation("emp-1", rrhhUser);

    expect(result.tone).toBe("warning");
    expect(result.checks).toEqual([]);
  });

  it("puesto sin sectorId: no hay cadena real para comparar, tone warning (no success, no danger)", async () => {
    repo.findPositionValidationById.mockResolvedValue(employeeFixture({
      position: { id: "pos-1", sector: null, salaryCategories: [], _count: { orgScopes: 0 } },
    }));

    const result = await employeesService.getPositionValidation("emp-1", rrhhUser);

    expect(result.tone).toBe("warning");
    expect(result.checks.every((check) => check.ok)).toBe(true); // nada que comparar, no es un mismatch
  });

  it("empleado sin sector: los checks quedan missing y el tone es warning, no danger", async () => {
    repo.findPositionValidationById.mockResolvedValue(employeeFixture({ sector: null }));

    const result = await employeesService.getPositionValidation("emp-1", rrhhUser);

    expect(result.tone).toBe("warning");
    expect(result.checks.every((check) => check.missing)).toBe(true);
  });

  it("puesto con alcance: el rango salarial se ordena por SalaryCategory.order, no por el orden del array de vinculos", async () => {
    repo.findPositionValidationById.mockResolvedValue(employeeFixture({
      internalCategory: "Operario A",
      position: {
        id: "pos-1",
        sector: null,
        _count: { orgScopes: 1 },
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
    repo.findPositionValidationById.mockResolvedValue(employeeFixture({ position: null }));

    const result = await employeesService.getPositionValidation("emp-1", rrhhUser);

    expect(result.tone).toBe("neutral");
    expect(result.title).toBe("Puesto sin seleccionar");
  });

  // Etapa 14D.2: causa real de los 12825ms máx/9978ms promedio medidos en
  // 14D.1 — `getPositionValidation` usaba `getById` (detalle completo) sólo
  // para leer 3 campos. Estos tests confirman el cambio de mecanismo (Parte
  // 5, ítems 1 y 4 del pedido).
  it("usa findPositionValidationById (select liviano), no findById (detalle completo)", async () => {
    repo.findPositionValidationById.mockResolvedValue(employeeFixture());

    await employeesService.getPositionValidation("emp-1", rrhhUser);

    expect(repo.findPositionValidationById).toHaveBeenCalledWith("emp-1", {}, undefined);
    expect(repo.findById).not.toHaveBeenCalled();
  });

  // Etapa 14D.2.1: `positionId` opcional — el frontend lo pasa cuando ya lo
  // conoce (viene de overview-details) para habilitar el camino paralelo en
  // el repositorio; sin cambiar en nada el resultado ni el criterio de
  // comparación.
  it("pasa positionId al repositorio cuando el caller lo conoce (habilita el camino paralelo)", async () => {
    repo.findPositionValidationById.mockResolvedValue(employeeFixture());

    await employeesService.getPositionValidation("emp-1", rrhhUser, "pos-1");

    expect(repo.findPositionValidationById).toHaveBeenCalledWith("emp-1", {}, "pos-1");
  });

  // Parte 5, ítem 2: respeta permisos/RBAC — mismo criterio de alcance que
  // `findById`/`assertAccessible`, sólo pasado al select liviano nuevo.
  it("aplica el mismo alcance (accessWhere) que el resto de los endpoints de legajo, según el rol", async () => {
    const supervisionUser = { id: "user-2", role: roles.supervision } as unknown as Express.AuthUser;
    repo.findPositionValidationById.mockResolvedValue(employeeFixture());

    await employeesService.getPositionValidation("emp-1", supervisionUser);

    const [, accessWhereArg] = repo.findPositionValidationById.mock.calls.at(0)!;
    expect(accessWhereArg).not.toEqual({}); // RRHH es {} (sin restricción); otros roles sí llevan un where de alcance.
  });

  it("lanza EMPLOYEE_NOT_FOUND (404) si el legajo no existe o está fuera de alcance — no expone datos de otro empleado", async () => {
    repo.findPositionValidationById.mockResolvedValue(null);

    await expect(employeesService.getPositionValidation("emp-404", rrhhUser)).rejects.toMatchObject({ code: "EMPLOYEE_NOT_FOUND", statusCode: 404 });
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

// Lenguaje de negocio en auditoría: "para el legajo <employeeId>" mostraba el
// UUID interno en Dashboard > Actividad reciente. La identidad sale del mismo
// findEmployeeForManualBreakdown que ya valida el scope (sin consulta extra).
describe("employeesService — auditoría del desglose manual con identidad humana, nunca el employeeId", () => {
  const employeeUuid = "016dc01c-655d-4474-8319-67f1b8108c93";
  const juan = { id: employeeUuid, legajo: "30", firstName: "Juan", lastName: "Pérez" };
  const input = { date: "2026-10-03", hourConceptId: "11111111-1111-4111-8111-111111111111", minutes: 60, observation: "Traslado" };
  const colectivo = { id: input.hourConceptId, code: "HOR-002", name: "Colectivo", status: "ACTIVO", loadMode: "MANUAL", systemRole: null, workTreatment: "ADDITIVE_TO_WORKED_TOTAL" };
  const nivel2User = { id: "user-n2", role: roles.supervision } as unknown as Express.AuthUser;
  const audited = () => (auditService.register as unknown as Mock).mock.calls.map(([call]) => call.description as string);

  beforeEach(() => {
    (auditService.register as unknown as Mock).mockClear();
    repo.findEmployeeForManualBreakdown.mockClear();
    repo.findEmployeeForManualBreakdown.mockResolvedValue(juan);
    repo.findHourConceptForManualBreakdown.mockResolvedValue(colectivo);
    repo.isHourConceptEnabled.mockResolvedValue(true);
    repo.findMonthlyClosure.mockResolvedValue(null);
    mockedResolveMultipliers.mockResolvedValue(new Map());
  });

  it("alta por RRHH: concepto, fecha y persona — el caso reportado en Actividad reciente", async () => {
    repo.saveManualHourConceptBreakdown.mockResolvedValue({ item: { id: "breakdown-1" }, deleted: 0, operation: "CREATE" });

    await employeesService.upsertManualHourConceptBreakdown(employeeUuid, input, rrhhUser);

    expect(audited()).toEqual(["Se guardó y aplicó (RRHH) el desglose manual Colectivo del 03/10/2026 para Pérez, Juan · Legajo 30."]);
    expect(repo.findEmployeeForManualBreakdown).toHaveBeenCalledTimes(1);
  });

  it("edición por Nivel 2 y eliminación (0 minutos) tampoco exponen el UUID", async () => {
    repo.saveManualHourConceptBreakdown.mockResolvedValueOnce({ item: { id: "breakdown-1" }, deleted: 0, operation: "UPDATE" });
    await employeesService.upsertManualHourConceptBreakdown(employeeUuid, input, nivel2User);
    repo.saveManualHourConceptBreakdown.mockResolvedValueOnce({ item: null, deleted: 1, operation: "DELETE" });
    await employeesService.upsertManualHourConceptBreakdown(employeeUuid, { ...input, minutes: 0 }, rrhhUser);

    expect(audited()).toEqual([
      "Se guardó el desglose manual Colectivo del 03/10/2026 para Pérez, Juan · Legajo 30.",
      "Se eliminó el desglose manual Colectivo del 03/10/2026 para Pérez, Juan · Legajo 30.",
    ]);
  });

  it("aprobar/rechazar/devolver describen a la persona con nombre y legajo", async () => {
    const resolved = { id: "breakdown-1", employeeId: employeeUuid, status: "EN_REVISION", employee: juan, hourConcept: { id: colectivo.id, name: "Colectivo" } };
    repo.findManualBreakdownById.mockResolvedValue(resolved);
    repo.approveManualHourConceptBreakdown.mockResolvedValue(resolved);
    repo.rejectManualHourConceptBreakdown.mockResolvedValue(resolved);
    repo.returnManualHourConceptBreakdown.mockResolvedValue(resolved);

    await employeesService.approveManualHourConceptBreakdown(employeeUuid, "breakdown-1", rrhhUser);
    await employeesService.rejectManualHourConceptBreakdown(employeeUuid, "breakdown-1", { reason: "Sin comprobante" }, rrhhUser);
    await employeesService.returnManualHourConceptBreakdown(employeeUuid, "breakdown-1", { reason: "Falta el destino" }, rrhhUser);

    expect(audited()).toEqual([
      "Se aprobó el desglose manual Colectivo de Pérez, Juan · Legajo 30.",
      "Se rechazó el desglose manual Colectivo de Pérez, Juan · Legajo 30. Motivo: Sin comprobante",
      "Se devolvió el desglose manual Colectivo de Pérez, Juan · Legajo 30. Motivo: Falta el destino",
    ]);
    for (const description of audited()) expect(description).not.toContain(employeeUuid);
  });
});
