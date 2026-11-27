import { describe, expect, it } from "vitest";
import { findUnapprovedEmployeeIdsForExport, isMonthlyClosureApproved, isMonthlyClosureLocked } from "./closureLock";

/**
 * Etapa 15E (docs/decisions/TIME_CLOSURE_CONSISTENCY_15E.md): helper puro,
 * sin DB ni mocks — fija la semántica de qué estados de MonthlyTimeClosure
 * bloquean edición/creación directa de horas.
 */
describe("isMonthlyClosureLocked", () => {
  it("CERRADO bloquea para todos los roles hasta la reapertura", () => {
    expect(isMonthlyClosureLocked({ status: "CERRADO" })).toBe(true);
  });

  it("ABIERTO (incluido un período reabierto) NO bloquea", () => {
    expect(isMonthlyClosureLocked({ status: "ABIERTO" })).toBe(false);
  });

  it("sin cierre (null) no bloquea — período nunca enviado a revisión", () => {
    expect(isMonthlyClosureLocked(null)).toBe(false);
  });

  it("cierre undefined no bloquea", () => {
    expect(isMonthlyClosureLocked(undefined)).toBe(false);
  });
});

/**
 * Etapa 15E.2 (docs/decisions/TIME_EXPORT_CLOSURE_GATE_15E2.md): la
 * exportación definitiva exige el cierre terminal CERRADO.
 */
describe("isMonthlyClosureApproved", () => {
  it("CERRADO: exportable definitivamente", () => {
    expect(isMonthlyClosureApproved({ status: "CERRADO" })).toBe(true);
  });

  it("ABIERTO: NO exportable definitivamente", () => {
    expect(isMonthlyClosureApproved({ status: "ABIERTO" })).toBe(false);
  });

  it("sin cierre (null/undefined): no aprobado", () => {
    expect(isMonthlyClosureApproved(null)).toBe(false);
    expect(isMonthlyClosureApproved(undefined)).toBe(false);
  });
});

describe("findUnapprovedEmployeeIdsForExport", () => {
  it("lista vacía cuando todos los empleados tienen cierre CERRADO", () => {
    const closures = new Map([
      ["employee-1", { status: "CERRADO" as const }],
      ["employee-2", { status: "CERRADO" as const }],
    ]);

    expect(findUnapprovedEmployeeIdsForExport(["employee-1", "employee-2"], closures)).toEqual([]);
  });

  it("devuelve sólo los employeeId sin cierre CERRADO, preservando cuáles fallan", () => {
    const closures = new Map([
      ["employee-1", { status: "CERRADO" as const }],
      ["employee-2", { status: "ABIERTO" as const }],
    ]);

    expect(findUnapprovedEmployeeIdsForExport(["employee-1", "employee-2", "employee-3"], closures)).toEqual([
      "employee-2",
      "employee-3", // ni siquiera está en el mapa — sin cierre
    ]);
  });

  it("lista vacía de empleados: lista vacía de no-aprobados", () => {
    expect(findUnapprovedEmployeeIdsForExport([], new Map())).toEqual([]);
  });
});
