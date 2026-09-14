import { describe, expect, it } from "vitest";
import { isMonthlyClosureLocked } from "./closureLock";

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
