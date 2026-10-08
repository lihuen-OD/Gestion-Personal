import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { findProtectedClosurePeriods } from "../../shared/monthlyClosure/closurePeriodGuard";
import { laborHistoryRepository } from "./laborHistory.repository";
import { laborHistoryService, mapLaborHistoryPersistenceError } from "./laborHistory.service";

/**
 * D-5 (docs/decisions/ORG_LOCATION_REORGANIZATION.md §19): historia temporal
 * de puesto, centro de costo, empresas empleadoras y alcance de puestos. Se
 * mockea el repositorio y la guarda de cierres; se verifica el orden de las
 * escrituras, la protección de cierres y que nada se escriba si algo falla.
 */
vi.mock("./laborHistory.repository", () => ({
  laborHistoryRepository: {
    findScalarPeriods: vi.fn(),
    findEmployerPeriods: vi.fn(),
    findScopePeriods: vi.fn(),
    findPositionAssignmentsFrom: vi.fn(),
    findClosurePeriodsFrom: vi.fn(),
    createScalarPeriod: vi.fn(),
    closeScalarPeriod: vi.fn(),
    replaceScalarPeriodValue: vi.fn(),
    createEmployerPeriod: vi.fn(),
    closeEmployerPeriod: vi.fn(),
    replaceEmployerPeriodCompanies: vi.fn(),
    createScopePeriod: vi.fn(),
    closeScopePeriod: vi.fn(),
    replaceScopePeriodNodes: vi.fn(),
  },
}));
vi.mock("../../shared/monthlyClosure/closurePeriodGuard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/monthlyClosure/closurePeriodGuard")>();
  return { ...actual, findProtectedClosurePeriods: vi.fn() };
});

const repo = laborHistoryRepository as unknown as Record<keyof typeof laborHistoryRepository, Mock>;
const findProtected = findProtectedClosurePeriods as unknown as Mock;
const tx = {} as PrismaTransactionClient;
const TODAY = "2026-10-08";
const writes = ["createScalarPeriod", "closeScalarPeriod", "replaceScalarPeriodValue", "createEmployerPeriod", "closeEmployerPeriod", "replaceEmployerPeriodCompanies", "createScopePeriod", "closeScopePeriod", "replaceScopePeriodNodes"] as const;
const period = <V>(id: string, effectiveFrom: string, effectiveTo: string | null, value: V) => ({ id, effectiveFrom, effectiveTo, value });

beforeEach(() => {
  vi.clearAllMocks();
  repo.findScalarPeriods.mockResolvedValue([]);
  repo.findEmployerPeriods.mockResolvedValue([]);
  repo.findScopePeriods.mockResolvedValue(new Map());
  repo.findPositionAssignmentsFrom.mockResolvedValue([]);
  repo.findClosurePeriodsFrom.mockResolvedValue([]);
  findProtected.mockResolvedValue(new Map());
});

const record = (changes: Parameters<typeof laborHistoryService.recordEmployeeChangesWithin>[1]["changes"], effectiveFrom = "2026-10-01") =>
  laborHistoryService.recordEmployeeChangesWithin(tx, { employeeId: "emp-1", effectiveFrom, reason: "Reasignación", createdByUserId: "u1", changes, todayKey: TODAY });

describe("recordEmployeeChangesWithin — cambio de puesto, centro de costo y empresas desde una fecha", () => {
  it("legajo sin historia: abre la vigencia en D y no inventa nada anterior", async () => {
    const result = await record({ positionId: "pos-b" });

    expect(repo.createScalarPeriod).toHaveBeenCalledWith(tx, "POSITION", "emp-1", "pos-b", { effectiveFrom: "2026-10-01", effectiveTo: null, reason: "Reasignación", createdByUserId: "u1" });
    expect(repo.closeScalarPeriod).not.toHaveBeenCalled();
    expect(result).toEqual([expect.objectContaining({ dimension: "POSITION", kind: "OPEN", effectiveFrom: "2026-10-01" })]);
  });

  it("cambio de puesto, centro de costo y empresas desde D: cierra cada vigente en D − 1 ANTES de abrir la nueva", async () => {
    const order: string[] = [];
    for (const name of writes) repo[name].mockImplementation(async (_tx: unknown, ...args: unknown[]) => { order.push(`${name}:${String(args[0])}`); });
    repo.findScalarPeriods.mockImplementation(async (_db: unknown, dimension: string) => (dimension === "POSITION" ? [period("p1", "2026-01-01", null, "pos-a")] : [period("c1", "2026-01-01", null, "cc-a")]));
    repo.findEmployerPeriods.mockResolvedValue([period("e1", "2026-01-01", null, ["losod"])]);

    const result = await record({ positionId: "pos-b", costCenterId: "cc-b", companyIds: ["tropa"] });

    expect(order).toEqual([
      "closeScalarPeriod:POSITION", "createScalarPeriod:POSITION",
      "closeScalarPeriod:COST_CENTER", "createScalarPeriod:COST_CENTER",
      "closeEmployerPeriod:e1", "createEmployerPeriod:emp-1",
    ]);
    expect(repo.closeScalarPeriod).toHaveBeenCalledWith(tx, "POSITION", "p1", "2026-09-30");
    expect(repo.closeEmployerPeriod).toHaveBeenCalledWith(tx, "e1", "2026-09-30");
    expect(repo.createEmployerPeriod).toHaveBeenCalledWith(tx, "emp-1", ["tropa"], expect.objectContaining({ effectiveFrom: "2026-10-01" }));
    expect(result.map((change) => `${change.dimension}:${change.kind}`)).toEqual(["POSITION:SPLIT", "COST_CENTER:SPLIT", "EMPLOYER:SPLIT"]);
  });

  it("mismo conjunto de empresas (sólo cambia la principal): no registra vigencia", async () => {
    repo.findEmployerPeriods.mockResolvedValue([period("e1", "2026-01-01", null, ["losod", "tropa"])]);
    expect(await record({ companyIds: ["tropa", "losod"] })).toEqual([]);
    expect(findProtected).not.toHaveBeenCalled();
    for (const name of writes) expect(repo[name]).not.toHaveBeenCalled();
  });

  it("un período ENVIADO/APROBADO alcanzado rechaza TODO el cambio sin escrituras parciales", async () => {
    repo.findScalarPeriods.mockResolvedValue([period("p1", "2026-01-01", null, "pos-a")]);
    findProtected.mockResolvedValue(new Map([["emp-1:2026-09", "APROBADO"]]));

    await expect(record({ positionId: "pos-b", costCenterId: "cc-b" }, "2026-09-15")).rejects.toMatchObject({ statusCode: 409, code: "PERIOD_CLOSED", message: expect.stringContaining("septiembre de 2026") });

    // La guarda se consultó con todos los meses desde D hasta hoy, dentro de la transacción.
    expect(findProtected).toHaveBeenCalledWith(tx, expect.arrayContaining([{ employeeId: "emp-1", period: "2026-09" }, { employeeId: "emp-1", period: "2026-10" }]));
    for (const name of writes) expect(repo[name]).not.toHaveBeenCalled();
  });

  it("una fecha inválida en cualquier dimensión rechaza antes de escribir ni consultar cierres", async () => {
    repo.findScalarPeriods.mockImplementation(async (_db: unknown, dimension: string) => (dimension === "COST_CENTER" ? [period("c1", "2026-10-05", null, "cc-a")] : []));

    await expect(record({ positionId: "pos-b", costCenterId: "cc-b" })).rejects.toMatchObject({ code: "LABOR_HISTORY_DATE_BEFORE_CURRENT_PERIOD" });
    expect(findProtected).not.toHaveBeenCalled();
    for (const name of writes) expect(repo[name]).not.toHaveBeenCalled();
  });

  it("fecha futura rechazada", async () => {
    await expect(record({ positionId: "pos-b" }, "2026-10-09")).rejects.toMatchObject({ code: "LABOR_HISTORY_FUTURE_DATE_NOT_SUPPORTED" });
  });

  it("D igual al inicio de la vigente: corrige su valor (auditable) en vez de abrir otra", async () => {
    repo.findScalarPeriods.mockResolvedValue([period("p1", "2026-10-01", null, "pos-a")]);
    await record({ positionId: "pos-b" });
    expect(repo.replaceScalarPeriodValue).toHaveBeenCalledWith(tx, "POSITION", "p1", "pos-b", "Reasignación");
    expect(repo.createScalarPeriod).not.toHaveBeenCalled();
  });
});

describe("openEmployeeHistoryWithin — alta de legajo", () => {
  it("abre puesto, centro de costo, sector anterior (vacío) y empresas desde el ingreso", async () => {
    await laborHistoryService.openEmployeeHistoryWithin(tx, { employeeId: "emp-new", effectiveFrom: "2026-09-01", positionId: "pos-a", costCenterId: null, companyIds: ["tropa", "losod", "tropa"], reason: "Alta del legajo", createdByUserId: "u1" });

    const expected = { effectiveFrom: "2026-09-01", effectiveTo: null, reason: "Alta del legajo", createdByUserId: "u1" };
    expect(repo.createScalarPeriod).toHaveBeenCalledWith(tx, "POSITION", "emp-new", "pos-a", expected);
    expect(repo.createScalarPeriod).toHaveBeenCalledWith(tx, "COST_CENTER", "emp-new", null, expected);
    expect(repo.createScalarPeriod).toHaveBeenCalledWith(tx, "LEGACY_SECTOR", "emp-new", null, expected);
    expect(repo.createEmployerPeriod).toHaveBeenCalledWith(tx, "emp-new", ["losod", "tropa"], expected);
  });
});

describe("recordPositionScopeChangeWithin — alcance compartido de un puesto", () => {
  const nodes = [{ level: "SECTOR" as const, nodeId: "ganaderia", areaSectorId: null }];
  const change = (effectiveFrom = "2026-10-01") => laborHistoryService.recordPositionScopeChangeWithin(tx, { positionId: "pos-shared", effectiveFrom, nodes, reason: "Reorganización", createdByUserId: "u1", todayKey: TODAY });

  beforeEach(() => {
    repo.findScopePeriods.mockResolvedValue(new Map([["pos-shared", [period("s1", "2026-01-01", null, [{ level: "SECTOR", nodeId: "agro", areaSectorId: null }])]]]));
  });

  it("protege los cierres de TODOS los ocupantes desde D (según su historia de asignación)", async () => {
    repo.findPositionAssignmentsFrom.mockResolvedValue([
      { employeeId: "ana", effectiveFrom: "2026-01-01", effectiveTo: null },
      { employeeId: "juan", effectiveFrom: "2026-03-01", effectiveTo: "2026-09-30" },
      { employeeId: "pedro", effectiveFrom: "2026-10-05", effectiveTo: null },
    ]);

    await change();

    const pairs = findProtected.mock.calls[0]![1] as Array<{ employeeId: string; period: string }>;
    expect(pairs).toEqual(expect.arrayContaining([{ employeeId: "ana", period: "2026-10" }, { employeeId: "pedro", period: "2026-10" }]));
    // Juan dejó el puesto antes de D: su historia no cambia y sus cierres no se tocan.
    expect(pairs.some((pair) => pair.employeeId === "juan")).toBe(false);
    expect(repo.closeScopePeriod).toHaveBeenCalledWith(tx, "s1", "2026-09-30");
    expect(repo.createScopePeriod).toHaveBeenCalledWith(tx, "pos-shared", nodes, expect.objectContaining({ effectiveFrom: "2026-10-01" }));
  });

  it("si algún ocupante tiene el período protegido, no cambia el alcance", async () => {
    repo.findPositionAssignmentsFrom.mockResolvedValue([{ employeeId: "ana", effectiveFrom: "2026-01-01", effectiveTo: null }]);
    findProtected.mockResolvedValue(new Map([["ana:2026-10", "ENVIADO"]]));

    await expect(change()).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    expect(repo.closeScopePeriod).not.toHaveBeenCalled();
    expect(repo.createScopePeriod).not.toHaveBeenCalled();
  });

  it("el mismo alcance (aunque en otro orden) no abre vigencia", async () => {
    expect(await laborHistoryService.recordPositionScopeChangeWithin(tx, { positionId: "pos-shared", effectiveFrom: "2026-10-01", nodes: [{ level: "SECTOR", nodeId: "agro", areaSectorId: null }], reason: "x", createdByUserId: null, todayKey: TODAY })).toBeNull();
    expect(findProtected).not.toHaveBeenCalled();
  });

  it("el alta de un puesto no acepta una vigencia futura", async () => {
    await expect(laborHistoryService.openPositionScopeWithin(tx, { positionId: "p", effectiveFrom: "2026-10-09", nodes, reason: "Alta", createdByUserId: null, todayKey: TODAY }))
      .rejects.toMatchObject({ code: "LABOR_HISTORY_FUTURE_DATE_NOT_SUPPORTED" });
  });
});

describe("mapLaborHistoryPersistenceError — concurrencia", () => {
  it("la exclusión de la base (dos vigencias superpuestas al mismo tiempo) se informa como 409 legible", () => {
    expect(() => mapLaborHistoryPersistenceError(new Error('conflicting key value violates exclusion constraint "EmployeePositionPeriod_no_overlap"')))
      .toThrow(expect.objectContaining({ statusCode: 409, code: "LABOR_HISTORY_OVERLAP" }));
    expect(() => mapLaborHistoryPersistenceError(new Error("otro"))).not.toThrow();
  });
});
