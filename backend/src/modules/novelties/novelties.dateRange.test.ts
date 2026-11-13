import { describe, expect, it } from "vitest";
import { noveltyCoversDay, noveltyOverlapsRangeWhere } from "./novelties.dateRange";

// noveltyCoversDay decide, dia por dia, si una novedad cubre esa fecha. Etapa 3
// de cobertura (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §6.3): toDate nulo es
// siempre un único día (fromDate), para cualquier tipo — nunca un rango abierto.

describe("noveltyCoversDay", () => {
  it("no cubre un dia anterior a fromDate", () => {
    const novelty = { fromDate: new Date("2026-08-10"), toDate: new Date("2026-08-15") };
    expect(noveltyCoversDay(novelty, new Date("2026-08-09"))).toBe(false);
  });

  it("cubre el propio fromDate", () => {
    const novelty = { fromDate: new Date("2026-08-10"), toDate: new Date("2026-08-15") };
    expect(noveltyCoversDay(novelty, new Date("2026-08-10"))).toBe(true);
  });

  it("cubre un dia intermedio dentro del rango", () => {
    const novelty = { fromDate: new Date("2026-08-10"), toDate: new Date("2026-08-15") };
    expect(noveltyCoversDay(novelty, new Date("2026-08-12"))).toBe(true);
  });

  it("cubre el propio toDate (limite inclusive)", () => {
    const novelty = { fromDate: new Date("2026-08-10"), toDate: new Date("2026-08-15") };
    expect(noveltyCoversDay(novelty, new Date("2026-08-15"))).toBe(true);
  });

  it("no cubre un dia posterior a toDate", () => {
    const novelty = { fromDate: new Date("2026-08-10"), toDate: new Date("2026-08-15") };
    expect(noveltyCoversDay(novelty, new Date("2026-08-16"))).toBe(false);
  });

  it("sin toDate: cubre exactamente fromDate, nunca los días siguientes (aunque el tipo admita rango)", () => {
    const novelty = { fromDate: new Date("2026-08-10"), toDate: null };
    expect(noveltyCoversDay(novelty, new Date("2026-08-10"))).toBe(true);
    expect(noveltyCoversDay(novelty, new Date("2026-08-11"))).toBe(false);
    expect(noveltyCoversDay(novelty, new Date("2026-08-30"))).toBe(false);
  });
});

describe("noveltyOverlapsRangeWhere", () => {
  it("toDate nulo sólo toca el período de fromDate", () => {
    const start = new Date("2026-09-01");
    const end = new Date("2026-10-01");
    expect(noveltyOverlapsRangeWhere(start, end)).toEqual({
      fromDate: { lt: end },
      OR: [{ toDate: { gte: start } }, { toDate: null, fromDate: { gte: start } }],
    });
  });
});
