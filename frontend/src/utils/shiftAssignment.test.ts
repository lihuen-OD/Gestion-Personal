import { describe, expect, it } from "vitest";
import {
  assignmentVigencyStatus,
  buildShiftAssignmentVigencyPayload,
  formatWeekdays,
  isAssignmentCurrent,
  isValidWeekday,
  toggleWeekday,
  weekdayLabel,
} from "./shiftAssignment";

describe("formatWeekdays — convención 0=domingo..6=sábado, orden lunes-primero", () => {
  it("[1,2,3,4,5] -> Lun, Mar, Mié, Jue, Vie", () => {
    expect(formatWeekdays([1, 2, 3, 4, 5])).toBe("Lun, Mar, Mié, Jue, Vie");
  });

  it("[] -> Todos los días (semántica documentada en schema.prisma)", () => {
    expect(formatWeekdays([])).toBe("Todos los días");
  });

  it("ordena para mostrar lunes-primero aunque el array venga en otro orden", () => {
    expect(formatWeekdays([6, 0, 1])).toBe("Lun, Sáb, Dom");
  });

  it("fin de semana: sábado(6) y domingo(0)", () => {
    expect(formatWeekdays([0, 6])).toBe("Sáb, Dom");
  });
});

describe("weekdayLabel", () => {
  it("0 -> Dom, 1 -> Lun, 6 -> Sáb", () => {
    expect(weekdayLabel(0)).toBe("Dom");
    expect(weekdayLabel(1)).toBe("Lun");
    expect(weekdayLabel(6)).toBe("Sáb");
  });
});

describe("isValidWeekday", () => {
  it("acepta 0-6", () => {
    expect(isValidWeekday(0)).toBe(true);
    expect(isValidWeekday(6)).toBe(true);
  });

  it("rechaza 7, -1 y no enteros", () => {
    expect(isValidWeekday(7)).toBe(false);
    expect(isValidWeekday(-1)).toBe(false);
    expect(isValidWeekday(1.5)).toBe(false);
  });
});

describe("toggleWeekday", () => {
  it("agrega un día ausente", () => {
    expect(toggleWeekday([1, 2], 3)).toEqual([1, 2, 3]);
  });

  it("quita un día presente", () => {
    expect(toggleWeekday([1, 2, 3], 2)).toEqual([1, 3]);
  });

  it("mantiene el resultado ordenado", () => {
    expect(toggleWeekday([5, 1], 3)).toEqual([1, 3, 5]);
  });
});

describe("assignmentVigencyStatus / isAssignmentCurrent — effectiveTo >= effectiveFrom y fechas nulas", () => {
  const ref = new Date("2026-08-19T12:00:00.000Z");

  it("effectiveFrom futuro -> future", () => {
    expect(assignmentVigencyStatus("2026-09-01", null, ref)).toBe("future");
    expect(isAssignmentCurrent("2026-09-01", null, ref)).toBe(false);
  });

  it("effectiveTo pasado -> historical", () => {
    expect(assignmentVigencyStatus("2026-01-01", "2026-06-30", ref)).toBe("historical");
    expect(isAssignmentCurrent("2026-01-01", "2026-06-30", ref)).toBe(false);
  });

  it("effectiveFrom pasado, effectiveTo null (abierta) -> current", () => {
    expect(assignmentVigencyStatus("2026-01-01", null, ref)).toBe("current");
    expect(isAssignmentCurrent("2026-01-01", null, ref)).toBe(true);
  });

  it("effectiveFrom pasado, effectiveTo futuro -> current", () => {
    expect(assignmentVigencyStatus("2026-01-01", "2026-12-31", ref)).toBe("current");
  });

  it("effectiveTo null nunca rompe el cálculo (asignación sin fecha de fin)", () => {
    expect(() => assignmentVigencyStatus("2026-01-01", null, ref)).not.toThrow();
  });
});

describe("buildShiftAssignmentVigencyPayload — string vacío de effectiveTo -> null", () => {
  it("effectiveTo vacío se traduce a null (asignación abierta)", () => {
    const payload = buildShiftAssignmentVigencyPayload({ effectiveFrom: "2026-01-01", effectiveTo: "", weekdays: [] });
    expect(payload.effectiveTo).toBeNull();
  });

  it("effectiveTo con valor se envía tal cual", () => {
    const payload = buildShiftAssignmentVigencyPayload({ effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31", weekdays: [1, 2] });
    expect(payload.effectiveTo).toBe("2026-12-31");
    expect(payload.weekdays).toEqual([1, 2]);
  });
});
