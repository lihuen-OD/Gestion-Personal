import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { findProtectedClosurePeriods } from "../../shared/monthlyClosure/closurePeriodGuard";
import { findClosuresForEmployeePeriods, rebuildClosureSnapshots } from "../workforce-management/closureSnapshot";
import { lockEmployeeCoverage, lockNoveltyCoverageGlobally, persistNoveltyCoverageWithin, type CoveragePersistSummary } from "./noveltyCoverage.service";
import {
  coverageWindowOf,
  describeNoveltyCoverageRecalculation,
  emptyNoveltyCoverageRecalculation,
  rebuildNoveltyCoverageSnapshots,
  recalculateNoveltyCoverage,
} from "./noveltyCoverageRecalculation";

// Mock explícito (sin importOriginal: el módulo real arrastra un ciclo de imports).
vi.mock("./noveltyCoverage.service", () => ({
  lockEmployeeCoverage: vi.fn(),
  lockNoveltyCoverageGlobally: vi.fn(),
  persistNoveltyCoverageWithin: vi.fn(),
  noveltyCoverageEnd: (novelty: { fromDate: Date; toDate: Date | null }) => novelty.toDate ?? novelty.fromDate,
}));
vi.mock("../../shared/monthlyClosure/closurePeriodGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared/monthlyClosure/closurePeriodGuard")>()),
  findProtectedClosurePeriods: vi.fn(),
}));
vi.mock("../workforce-management/closureSnapshot", () => ({ findClosuresForEmployeePeriods: vi.fn(), rebuildClosureSnapshots: vi.fn() }));

const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const findMany = vi.fn();
const db = { novelty: { findMany } } as unknown as PrismaTransactionClient;
const reason = { source: "EMPLOYEE_DAY_OFF_CHANGED" as const, label: "cambio de francos del 16/11/2026" };

function persisted(overrides: Partial<CoveragePersistSummary> = {}): CoveragePersistSummary {
  return { novelties: 1, days: 1, pendingReviewDays: 0, droppedResolutions: 0, protectedPeriods: [], changedDays: 0, changedNoveltyIds: [], changedPairs: [], droppedResolutionDetails: [], ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
  vi.mocked(persistNoveltyCoverageWithin).mockResolvedValue(persisted());
  vi.mocked(findProtectedClosurePeriods).mockResolvedValue(new Map());
  vi.mocked(findClosuresForEmployeePeriods).mockResolvedValue([]);
  vi.mocked(rebuildClosureSnapshots).mockResolvedValue([]);
});

describe("recalculateNoveltyCoverage — alcance", () => {
  it("evento de un legajo: lock por legajo (no global) y sólo novedades con tiempo que tocan la ventana", async () => {
    await recalculateNoveltyCoverage(db, { employeeIds: ["emp-1"], from: day("2026-11-16"), to: day("2026-11-16") }, reason);

    expect(lockEmployeeCoverage).toHaveBeenCalledWith(db, ["emp-1"]);
    expect(lockNoveltyCoverageGlobally).not.toHaveBeenCalled();
    expect(findMany.mock.calls[0]![0].where).toEqual({
      AND: [
        { status: { not: "RECHAZADO" } },
        { employeeId: { in: ["emp-1"] } },
        { noveltyType: { coverageMode: { not: "NONE" } } },
        { fromDate: { lte: day("2026-11-16") } },
        { OR: [{ toDate: { gte: day("2026-11-16") } }, { toDate: null, fromDate: { gte: day("2026-11-16") } }] },
      ],
    });
  });

  it("evento global (regla, convocatoria): lock global exclusivo; un cambio de tipo incluye los tipos sin tiempo", async () => {
    await recalculateNoveltyCoverage(db, { noveltyTypeIds: ["type-1"], includeNoneTypes: true }, reason);
    expect(lockNoveltyCoverageGlobally).toHaveBeenCalledWith(db);
    expect(findMany.mock.calls[0]![0].where).toEqual({ AND: [{ status: { not: "RECHAZADO" } }, { noveltyTypeId: { in: ["type-1"] } }] });
  });

  it("regla que no es FERIADO: sólo tipos que aplican multiplicadores", async () => {
    await recalculateNoveltyCoverage(db, { from: day("2026-01-01"), onlySpecialHourTypes: true }, reason);
    expect(findMany.mock.calls[0]![0].where.AND).toContainEqual({ noveltyType: { coverageMode: { not: "NONE" }, coverageAppliesSpecialHours: true } });
  });

  it("alcance vacío: no lee ni escribe nada", async () => {
    await expect(recalculateNoveltyCoverage(db, { employeeIds: [] }, reason)).resolves.toMatchObject({ novelties: 0, changedDays: 0 });
    expect(findMany).not.toHaveBeenCalled();
    expect(persistNoveltyCoverageWithin).not.toHaveBeenCalled();
  });

  it("`touchesDate` descarta novedades sin ninguna fecha alcanzada (p. ej. una regla de domingos)", async () => {
    findMany.mockResolvedValue([
      { id: "monday", employeeId: "emp-1", fromDate: day("2026-11-16"), toDate: null },
      { id: "week", employeeId: "emp-1", fromDate: day("2026-11-16"), toDate: day("2026-11-22") },
    ]);
    const isSunday = (key: string) => day(key).getUTCDay() === 0;
    await recalculateNoveltyCoverage(db, { from: day("2026-11-01"), touchesDate: isSunday }, reason);
    expect(persistNoveltyCoverageWithin).toHaveBeenCalledWith(db, ["week"], { protectedPeriods: "SKIP", window: { from: day("2026-11-01"), to: null } });
  });
});

describe("recalculateNoveltyCoverage — rendimiento", () => {
  it("tandas acotadas por días-legajo: la cantidad de llamadas no depende de la cantidad de legajos sino del volumen (sin N+1)", async () => {
    // 60 vacaciones de un año → 21.960 días: 3 tandas de ≤ 10.000.
    findMany.mockResolvedValue(Array.from({ length: 60 }, (_, index) => ({ id: `n-${index}`, employeeId: `emp-${index}`, fromDate: day("2026-01-01"), toDate: day("2026-12-31") })));
    await recalculateNoveltyCoverage(db, { from: day("2026-01-01") }, reason);
    expect(persistNoveltyCoverageWithin).toHaveBeenCalledTimes(3);
    expect(vi.mocked(persistNoveltyCoverageWithin).mock.calls.flatMap((call) => call[1])).toHaveLength(60);
  });
});

describe("recalculateNoveltyCoverage — resumen y snapshots", () => {
  beforeEach(() => {
    findMany.mockResolvedValue([
      { id: "n-1", employeeId: "emp-1", fromDate: day("2026-11-16"), toDate: day("2026-11-20") },
      { id: "n-2", employeeId: "emp-2", fromDate: day("2026-11-16"), toDate: null },
    ]);
    vi.mocked(persistNoveltyCoverageWithin).mockResolvedValue(persisted({
      changedDays: 2,
      changedNoveltyIds: ["n-1"],
      changedPairs: [{ employeeId: "emp-1", period: "2026-11" }],
      protectedPeriods: [{ employeeId: "emp-2", period: "2026-11" }],
    }));
  });

  it("reconstruye los snapshots abiertos de los pares que cambiaron con motivo NOVELTY_COVERAGE_CHANGED", async () => {
    const closure = { id: "c-1", employeeId: "emp-1", period: "2026-11", snapshot: {} };
    vi.mocked(findClosuresForEmployeePeriods).mockResolvedValue([closure]);
    vi.mocked(rebuildClosureSnapshots).mockResolvedValue([{ ...closure, before: {}, after: {} }]);

    const result = await recalculateNoveltyCoverage(db, { employeeIds: ["emp-1", "emp-2"] }, reason);

    expect(result).toMatchObject({ novelties: 2, employees: 2, changedNovelties: 1, changedEmployees: 1, changedDays: 2, protectedPeriods: [{ employeeId: "emp-2", period: "2026-11" }] });
    expect(rebuildClosureSnapshots).toHaveBeenCalledWith(db, [closure], { reason: "NOVELTY_COVERAGE_CHANGED", source: "EMPLOYEE_DAY_OFF_CHANGED", label: reason.label });
    expect(result.rebuiltClosures).toHaveLength(1);
  });

  it("`rebuildSnapshots: false` deja la reconstrucción a quien llama", async () => {
    await recalculateNoveltyCoverage(db, { employeeIds: ["emp-1"] }, reason, { rebuildSnapshots: false });
    expect(rebuildClosureSnapshots).not.toHaveBeenCalled();
  });

  it("nunca reconstruye un cierre protegido ni los pares que el evento ya reconstruyó", async () => {
    vi.mocked(findProtectedClosurePeriods).mockResolvedValue(new Map([["emp-1:2026-11", "CERRADO" as const]]));
    vi.mocked(findClosuresForEmployeePeriods).mockResolvedValue([{ id: "c-1", employeeId: "emp-1", period: "2026-11", snapshot: {} }]);
    await rebuildNoveltyCoverageSnapshots(db, [{ employeeId: "emp-1", period: "2026-11" }], reason);
    expect(rebuildClosureSnapshots).toHaveBeenCalledWith(db, [], expect.anything());

    vi.clearAllMocks();
    await rebuildNoveltyCoverageSnapshots(db, [{ employeeId: "emp-1", period: "2026-11" }], reason, [{ employeeId: "emp-1", period: "2026-11" }]);
    expect(findClosuresForEmployeePeriods).not.toHaveBeenCalled();
  });

  it("resumen en lenguaje de negocio, sin ids técnicos", async () => {
    const result = await recalculateNoveltyCoverage(db, { employeeIds: ["emp-1", "emp-2"] }, reason);
    const text = describeNoveltyCoverageRecalculation(result);
    expect(text).toBe("Se recalculó la cobertura de 1 novedad de 1 empleado por cambio de francos del 16/11/2026 (2 días). No se reinterpretaron períodos enviados o aprobados (noviembre de 2026).");
    expect(text).not.toMatch(/emp-|n-1/);
    expect(describeNoveltyCoverageRecalculation(emptyNoveltyCoverageRecalculation(reason))).toBe("");
  });
});

describe("coverageWindowOf", () => {
  it("une vigencias antes y después del cambio; una abierta deja la ventana abierta", () => {
    expect(coverageWindowOf([{ from: day("2026-03-01"), to: day("2026-06-30") }, { from: day("2026-01-01"), to: day("2026-04-30") }])).toEqual({ from: day("2026-01-01"), to: day("2026-06-30") });
    expect(coverageWindowOf([{ from: day("2026-03-01"), to: null }, null])).toEqual({ from: day("2026-03-01"), to: null });
    expect(coverageWindowOf([])).toBeNull();
  });
});
