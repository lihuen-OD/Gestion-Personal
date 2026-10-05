import { describe, expect, it, vi } from "vitest";
import { findClosuresForHourConcept, rebuildClosureSnapshots } from "./closureSnapshot";

// docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §9/§14: el snapshot de cierre
// es lo único que persiste la lectura de un concepto; si RRHH corrige o
// elimina el concepto, se recalcula con el mismo builder del envío.
function db(overrides: { closures?: unknown[]; base?: unknown[]; breakdowns?: unknown[]; groups?: unknown[] } = {}) {
  return {
    monthlyTimeClosure: { findMany: vi.fn().mockResolvedValue(overrides.closures ?? []), update: vi.fn().mockResolvedValue({}) },
    timeEntry: { groupBy: vi.fn().mockResolvedValue(overrides.groups ?? []), findMany: vi.fn().mockResolvedValue(overrides.base ?? []) },
    hourConceptBreakdown: { findMany: vi.fn().mockResolvedValue(overrides.breakdowns ?? []) },
  };
}

const prueba = (workTreatment: "WITHIN_BASE" | "ADDITIVE_TO_WORKED_TOTAL") => ({ workTreatment, code: "HOR-005", name: "Prueba 02" });

describe("findClosuresForHourConcept", () => {
  it("busca por los empleado+período con desgloses y por los snapshots que ya mencionan el concepto, en 1 consulta", async () => {
    const client = db();
    await findClosuresForHourConcept(client as never, "prueba", [
      { employeeId: "emp-1", period: "2026-09" },
      { employeeId: "emp-2", period: "2026-10" },
    ]);

    expect(client.monthlyTimeClosure.findMany).toHaveBeenCalledTimes(1);
    expect(client.monthlyTimeClosure.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { employeeId: { in: ["emp-1", "emp-2"] }, period: { in: ["2026-09", "2026-10"] } },
          { snapshot: { path: ["accounting", "concepts"], array_contains: [{ hourConceptId: "prueba" }] } },
        ],
      },
      select: { id: true, employeeId: true, period: true, snapshot: true },
    });
  });

  it("descarta los cruces in×in que no son pares reales y los cierres sin snapshot", async () => {
    const client = db({
      closures: [
        { id: "real", employeeId: "emp-1", period: "2026-09", snapshot: { entries: [] } },
        { id: "cruce", employeeId: "emp-1", period: "2026-10", snapshot: { entries: [] } },
        { id: "mencionado", employeeId: "emp-3", period: "2026-08", snapshot: { accounting: { concepts: [{ hourConceptId: "prueba" }] } } },
        { id: "sin-snapshot", employeeId: "emp-2", period: "2026-10", snapshot: null },
      ],
    });

    const result = await findClosuresForHourConcept(client as never, "prueba", [
      { employeeId: "emp-1", period: "2026-09" },
      { employeeId: "emp-2", period: "2026-10" },
    ]);

    expect(result.map((closure) => closure.id)).toEqual(["real", "mencionado"]);
  });

  it("sin desgloses sólo busca snapshots que mencionen el concepto", async () => {
    const client = db();
    await findClosuresForHourConcept(client as never, "prueba", []);
    expect(client.monthlyTimeClosure.findMany.mock.calls[0]![0].where.OR).toEqual([
      { snapshot: { path: ["accounting", "concepts"], array_contains: [{ hourConceptId: "prueba" }] } },
    ]);
  });
});

describe("rebuildClosureSnapshots", () => {
  const recalculation = { reason: "HOUR_CONCEPT_WORK_TREATMENT_CHANGED" as const, hourConceptId: "prueba", hourConceptCode: "HOR-005" };

  it("cierre que congeló Prueba como adicional (total 10 h): se recalcula con la lectura vigente (8 h) sin cambiar estado ni autoría, y devuelve before/after", async () => {
    const stale = { accounting: { totalWorkedMinutes: 600, concepts: [{ hourConceptId: "prueba", treatment: "ADDITIVE_TO_WORKED_TOTAL" }] } };
    const client = db({
      groups: [{ employeeId: "emp-1", status: "APROBADO", _sum: { hours: 8 }, _count: 1 }],
      base: [{ employeeId: "emp-1", day: 5, hours: 8, appliedMultiplier: 1 }],
      breakdowns: [{ employeeId: "emp-1", day: 5, hourConceptId: "prueba", minutes: 120, appliedMultiplier: 1, startAt: null, endAt: null, hourConcept: prueba("WITHIN_BASE") }],
    });

    const [rebuilt] = await rebuildClosureSnapshots(client as never, [{ id: "closure-1", employeeId: "emp-1", period: "2026-10", snapshot: stale }], recalculation);

    const update = client.monthlyTimeClosure.update.mock.calls[0]![0];
    expect(Object.keys(update.data)).toEqual(["snapshot"]);
    expect(update.where).toEqual({ id: "closure-1" });
    expect(update.data.snapshot).toMatchObject({
      entries: [{ status: "APROBADO", hours: 8, records: 1 }],
      accounting: {
        model: "WORKED_TIME_ACCOUNTING_V1",
        baseMinutes: 480,
        normalResidualMinutes: 360,
        withinBaseMinutes: 120,
        additiveMinutes: 0,
        totalWorkedMinutes: 480,
        concepts: [expect.objectContaining({ hourConceptId: "prueba", code: "HOR-005", treatment: "WITHIN_BASE", realMinutes: 120 })],
      },
      recalculation: { ...recalculation, at: expect.any(String) },
    });
    expect(rebuilt).toMatchObject({ id: "closure-1", employeeId: "emp-1", period: "2026-10", before: stale, after: update.data.snapshot });
  });

  it("agrupa por período: 3 consultas por período, nunca por cierre", async () => {
    const client = db();
    await rebuildClosureSnapshots(client as never, [
      { id: "a", employeeId: "emp-1", period: "2026-09", snapshot: {} },
      { id: "b", employeeId: "emp-2", period: "2026-09", snapshot: {} },
      { id: "c", employeeId: "emp-1", period: "2026-10", snapshot: {} },
    ], recalculation);

    expect(client.hourConceptBreakdown.findMany).toHaveBeenCalledTimes(2);
    expect(client.hourConceptBreakdown.findMany.mock.calls[0]![0].where).toMatchObject({ employeeId: { in: ["emp-1", "emp-2"] }, period: "2026-09" });
    expect(client.monthlyTimeClosure.update).toHaveBeenCalledTimes(3);
  });

  it("sin cierres afectados no consulta ni escribe nada", async () => {
    const client = db();
    await expect(rebuildClosureSnapshots(client as never, [], recalculation)).resolves.toEqual([]);
    expect(client.timeEntry.findMany).not.toHaveBeenCalled();
    expect(client.monthlyTimeClosure.update).not.toHaveBeenCalled();
  });
});
