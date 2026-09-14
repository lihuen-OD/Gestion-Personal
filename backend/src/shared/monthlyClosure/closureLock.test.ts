import { describe, expect, it } from "vitest";
import { findUnapprovedEmployeeIdsForExport, isMonthlyClosureApproved, isMonthlyClosureLocked } from "./closureLock";

/**
 * Etapa 15E (docs/decisions/TIME_CLOSURE_CONSISTENCY_15E.md): helper puro,
 * sin DB ni mocks — fija la semántica de qué estados de MonthlyTimeClosure
 * bloquean edición/creación directa de horas.
 */
describe("isMonthlyClosureLocked", () => {
  it.each(["ENVIADO", "APROBADO", "CORRECCION_PENDIENTE"] as const)(
    "%s bloquea (requiere corrección formal / RRHH con motivo)",
    (status) => {
      expect(isMonthlyClosureLocked({ status })).toBe(true);
    },
  );

  it.each(["ABIERTO", "DEVUELTO"] as const)("%s NO bloquea (flujo normal permitido)", (status) => {
    expect(isMonthlyClosureLocked({ status })).toBe(false);
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
 * exportación definitiva exige el estado terminal exacto APROBADO — más
 * estricto que isMonthlyClosureLocked (que trata ENVIADO/CORRECCION_PENDIENTE
 * como "bloqueado para edición", no como "exportable").
 */
describe("isMonthlyClosureApproved", () => {
  it("APROBADO: aprobado", () => {
    expect(isMonthlyClosureApproved({ status: "APROBADO" })).toBe(true);
  });

  it.each(["ABIERTO", "ENVIADO", "DEVUELTO", "CORRECCION_PENDIENTE"] as const)(
    "%s: NO aprobado (no exportable definitivamente)",
    (status) => {
      expect(isMonthlyClosureApproved({ status })).toBe(false);
    },
  );

  it("sin cierre (null/undefined): no aprobado", () => {
    expect(isMonthlyClosureApproved(null)).toBe(false);
    expect(isMonthlyClosureApproved(undefined)).toBe(false);
  });
});

describe("findUnapprovedEmployeeIdsForExport", () => {
  it("lista vacía cuando todos los empleados tienen cierre APROBADO", () => {
    const closures = new Map([
      ["employee-1", { status: "APROBADO" as const }],
      ["employee-2", { status: "APROBADO" as const }],
    ]);

    expect(findUnapprovedEmployeeIdsForExport(["employee-1", "employee-2"], closures)).toEqual([]);
  });

  it("devuelve sólo los employeeId sin cierre APROBADO, preservando cuáles fallan", () => {
    const closures = new Map([
      ["employee-1", { status: "APROBADO" as const }],
      ["employee-2", { status: "ENVIADO" as const }],
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
