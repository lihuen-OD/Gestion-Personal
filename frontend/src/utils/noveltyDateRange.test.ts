import { describe, expect, it } from "vitest";
import { calendarDaysInclusive } from "./noveltyDateRange";

describe("calendarDaysInclusive — Etapa 15L.5 (docs/decisions/NOVELTY_QUANTITY_SEMANTICS_15L5.md)", () => {
  it("sin toDate: 1 día", () => {
    expect(calendarDaysInclusive("2026-07-15", null)).toBe(1);
  });

  it("toDate igual a fromDate: 1 día", () => {
    expect(calendarDaysInclusive("2026-07-15", "2026-07-15")).toBe(1);
  });

  it("30/07 → 02/08: 4 días (cruza de mes, no sólo los días de julio)", () => {
    expect(calendarDaysInclusive("2026-07-30", "2026-08-02")).toBe(4);
  });

  it("31/12 → 02/01 del año siguiente: 3 días", () => {
    expect(calendarDaysInclusive("2026-12-31", "2027-01-02")).toBe(3);
  });

  it("rango largo dentro del mismo mes: cuenta todos los días", () => {
    expect(calendarDaysInclusive("2026-07-01", "2026-07-31")).toBe(31);
  });

  it("toDate anterior a fromDate: devuelve null (estado transitorio, sin inventar un número)", () => {
    expect(calendarDaysInclusive("2026-08-02", "2026-07-30")).toBeNull();
  });

  it("sin fromDate: devuelve null", () => {
    expect(calendarDaysInclusive("", null)).toBeNull();
  });
});
