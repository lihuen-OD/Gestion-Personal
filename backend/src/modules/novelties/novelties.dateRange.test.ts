import { describe, expect, it } from "vitest";
import { noveltyCoversDay } from "./novelties.dateRange";

// noveltyCoversDay decide, dia por dia, si una novedad cubre esa fecha —lo
// usa timeEntries.repository.ts para la grilla mensual de horas. No rechaza
// nada al crear (ver la nota en novelties.service.test.ts sobre el gap de
// solapamiento); esto solo fija su comportamiento real de cobertura.

describe("noveltyCoversDay", () => {
  it("no cubre un dia anterior a fromDate", () => {
    const novelty = { fromDate: new Date("2026-08-10"), toDate: new Date("2026-08-15") };
    expect(noveltyCoversDay(novelty, { allowsDateTo: true }, new Date("2026-08-09"))).toBe(false);
  });

  it("cubre el propio fromDate", () => {
    const novelty = { fromDate: new Date("2026-08-10"), toDate: new Date("2026-08-15") };
    expect(noveltyCoversDay(novelty, { allowsDateTo: true }, new Date("2026-08-10"))).toBe(true);
  });

  it("cubre un dia intermedio dentro del rango", () => {
    const novelty = { fromDate: new Date("2026-08-10"), toDate: new Date("2026-08-15") };
    expect(noveltyCoversDay(novelty, { allowsDateTo: true }, new Date("2026-08-12"))).toBe(true);
  });

  it("cubre el propio toDate (limite inclusive)", () => {
    const novelty = { fromDate: new Date("2026-08-10"), toDate: new Date("2026-08-15") };
    expect(noveltyCoversDay(novelty, { allowsDateTo: true }, new Date("2026-08-15"))).toBe(true);
  });

  it("no cubre un dia posterior a toDate", () => {
    const novelty = { fromDate: new Date("2026-08-10"), toDate: new Date("2026-08-15") };
    expect(noveltyCoversDay(novelty, { allowsDateTo: true }, new Date("2026-08-16"))).toBe(false);
  });

  it("sin toDate, con un tipo que permite dateTo: se considera vigente desde fromDate en adelante", () => {
    const novelty = { fromDate: new Date("2026-08-10"), toDate: null };
    expect(noveltyCoversDay(novelty, { allowsDateTo: true }, new Date("2026-08-30"))).toBe(true);
  });

  it("sin toDate, con un tipo de un solo dia (no permite dateTo): solo cubre exactamente fromDate", () => {
    const novelty = { fromDate: new Date("2026-08-10"), toDate: null };
    expect(noveltyCoversDay(novelty, { allowsDateTo: false }, new Date("2026-08-10"))).toBe(true);
    expect(noveltyCoversDay(novelty, { allowsDateTo: false }, new Date("2026-08-11"))).toBe(false);
  });
});
