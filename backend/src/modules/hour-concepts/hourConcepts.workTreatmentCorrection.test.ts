import { describe, expect, it, vi } from "vitest";
import { buildEmployeeTimeGrid } from "../employees/employees.service";
import { accountEmployeePeriods, toAccountingBaseEntry, toAccountingBreakdown, totalWorkedHours } from "../time-entries/workedTimeAccounting";
import { buildClosureSnapshots } from "../workforce-management/closureSnapshot";

vi.mock("../employees/employees.repository", () => ({ employeesRepository: {} }));
vi.mock("../audit/audit.service", () => ({ auditService: { register: vi.fn() } }));
vi.mock("../time-entries/timeEntries.repository", () => ({ resolveDoubleHourMultipliersByDate: vi.fn() }));

/**
 * docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §2: RRHH corrige
 * `workTreatment` de un concepto que ya tiene horas. Los desgloses NO se
 * tocan (mismos ids y minutos — hourConcepts.repository.test.ts confirma que
 * la corrección nunca escribe HourConceptBreakdown); toda lectura une el
 * desglose con el tratamiento vigente del concepto, así que la misma fila
 * persistida se lee distinto apenas cambia el concepto.
 *
 * Caso real: "Prueba" se configuró por error como horas adicionales.
 */
type Treatment = "WITHIN_BASE" | "ADDITIVE_TO_WORKED_TOTAL";

const normal = { id: "normal", code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", loadMode: null, status: "ACTIVO", systemRole: "NORMAL_BASE", workTreatment: null } as const;
const pruebaConcept = (workTreatment: Treatment) =>
  ({ id: "prueba", code: "HOR-005", name: "Prueba", kind: "OTRO", loadMode: "BOTH", status: "ACTIVO", systemRole: null, workTreatment }) as const;

// Filas tal como están persistidas: no cambian entre la lectura previa y la posterior.
function persisted(multiplier: number) {
  const baseEntry = { employeeId: "emp-1", day: 4, hours: 8, appliedMultiplier: multiplier, status: "APROBADO" };
  const breakdown = { id: "breakdown-1", employeeId: "emp-1", day: 4, hourConceptId: "prueba", minutes: 120, appliedMultiplier: multiplier, startAt: null, endAt: null };
  return { baseEntry, breakdown };
}

// Lo que devuelve cada consulta: la fila persistida unida con el concepto vigente.
function readAs(treatment: Treatment, multiplier = 1) {
  const { baseEntry, breakdown } = persisted(multiplier);
  const concept = pruebaConcept(treatment);
  return {
    grid: buildEmployeeTimeGrid(normal, [concept], [{ ...baseEntry, hourConcept: normal } as never], [{ ...breakdown, hourConcept: concept }]),
    // Grilla de período, Por persona, export: misma contabilidad por empleado.
    period: accountEmployeePeriods([toAccountingBaseEntry(baseEntry)], [toAccountingBreakdown({ ...breakdown, hourConcept: concept })]).get("emp-1")!,
    breakdown,
    concept,
  };
}

describe("corrección de workTreatment con horas cargadas — test principal", () => {
  it("Base 8 + Prueba 2 como ADDITIVE → total 10; corregida a WITHIN_BASE → base 8, normal 6, Prueba 2, total 8, con el mismo desglose", () => {
    const before = readAs("ADDITIVE_TO_WORKED_TOTAL");
    expect(before.grid.totalWorkedMinutes).toBe(600);
    expect(before.grid.accounting).toMatchObject({ baseMinutes: 480, normalResidualMinutes: 480, additiveMinutes: 120, withinBaseMinutes: 0, totalWorkedMinutes: 600 });
    expect(before.period.totalWorkedMinutes).toBe(600);

    const after = readAs("WITHIN_BASE");
    expect(after.breakdown).toEqual(before.breakdown);
    expect(after.grid.rows.map((row) => [row.concept.id, row.totalMinutes])).toEqual([["normal", 480], ["prueba", 120]]);
    expect(after.grid.accounting).toMatchObject({ baseMinutes: 480, normalResidualMinutes: 360, withinBaseMinutes: 120, additiveMinutes: 0, totalWorkedMinutes: 480 });
    expect(after.grid.totalWorkedMinutes).toBe(480);
    expect(after.grid.accounting.concepts).toEqual([expect.objectContaining({ hourConceptId: "prueba", treatment: "WITHIN_BASE", realMinutes: 120 })]);
    expect(after.period).toMatchObject({ baseMinutes: 480, normalResidualMinutes: 360, withinBaseMinutes: 120, totalWorkedMinutes: 480 });
  });

  it("resumen \"Total trabajado\" y dashboard (base + ADDITIVE por SQL): 10 h → 8 h", () => {
    // Ambos filtran `hourConcept.workTreatment = ADDITIVE_TO_WORKED_TOTAL` al leer.
    const additiveMinutes = (treatment: Treatment) => (treatment === "ADDITIVE_TO_WORKED_TOTAL" ? persisted(1).breakdown.minutes : 0);
    expect(totalWorkedHours(8, additiveMinutes("ADDITIVE_TO_WORKED_TOTAL"))).toBe(10);
    expect(totalWorkedHours(8, additiveMinutes("WITHIN_BASE"))).toBe(8);
  });

  it("cierre: el snapshot recalculado con las mismas filas pasa de 10 h a 8 h (nunca grilla 8 / cierre 10)", async () => {
    const snapshotAs = async (treatment: Treatment) => {
      const { baseEntry, breakdown } = persisted(1);
      const client = {
        timeEntry: {
          groupBy: vi.fn().mockResolvedValue([{ employeeId: "emp-1", status: "APROBADO", _sum: { hours: 8 }, _count: 1 }]),
          findMany: vi.fn().mockResolvedValue([baseEntry]),
        },
        hourConceptBreakdown: { findMany: vi.fn().mockResolvedValue([{ ...breakdown, hourConcept: { workTreatment: treatment, code: "HOR-005", name: "Prueba" } }]) },
      };
      return (await buildClosureSnapshots(client as never, ["emp-1"], "2026-10")).get("emp-1") as { accounting: { totalWorkedMinutes: number; normalResidualMinutes: number } };
    };

    expect((await snapshotAs("ADDITIVE_TO_WORKED_TOTAL")).accounting.totalWorkedMinutes).toBe(600);
    expect((await snapshotAs("WITHIN_BASE")).accounting).toMatchObject({ totalWorkedMinutes: 480, normalResidualMinutes: 360 });
  });
});

describe("corrección de workTreatment — domingo ×2", () => {
  it("ADDITIVE: real 10, equivalencia 20 → WITHIN_BASE: real 8, normal 6, Prueba 2, equivalencia 16, sin recrear horas", () => {
    const before = readAs("ADDITIVE_TO_WORKED_TOTAL", 2);
    expect(before.grid.totalWorkedMinutes).toBe(600);
    expect(before.grid.accounting.settlement).toEqual({ normalMinutes: 960, withinBaseMinutes: 0, additiveMinutes: 240, totalMinutes: 1200 });

    const after = readAs("WITHIN_BASE", 2);
    expect(after.breakdown).toEqual(before.breakdown);
    expect(after.grid.accounting).toMatchObject({ baseMinutes: 480, normalResidualMinutes: 360, withinBaseMinutes: 120, totalWorkedMinutes: 480 });
    expect(after.grid.accounting.settlement).toEqual({ normalMinutes: 720, withinBaseMinutes: 240, additiveMinutes: 0, totalMinutes: 960 });
    expect(after.grid.specialHoursByDay["4"]).toMatchObject({ multiplier: 2 });
  });
});
