import { describe, expect, it } from "vitest";
import { createNoveltyTypeSchema, updateNoveltyTypeSchema } from "./noveltyTypes.schemas";

const base = { name: "Vacaciones", kind: "VACACIONES" };

// Motor de cobertura — Etapa 1 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md).
describe("createNoveltyTypeSchema — cobertura horaria", () => {
  it("sin campos de cobertura aplica defaults neutros: no registra tiempo ni suma", () => {
    const parsed = createNoveltyTypeSchema.parse(base);

    expect(parsed).toMatchObject({
      coverageMode: "NONE",
      coverageDayRule: "EVERY_DAY",
      coverageWeekdays: [],
      coverageAppliesSpecialHours: false,
      coverageCountsTowardTotal: false,
      realWorkCompatibility: "COMPATIBLE",
      requiresObservation: false,
    });
    expect(parsed.coverageOnDayOff).toBeUndefined();
    expect(parsed.coverageOnHoliday).toBeUndefined();
    expect(parsed.coverageFixedMinutes).toBeUndefined();
  });

  it("normaliza los días de la semana sin repetidos y ordenados", () => {
    expect(createNoveltyTypeSchema.parse({ ...base, coverageWeekdays: [5, 1, 3, 1] }).coverageWeekdays).toEqual([1, 3, 5]);
  });

  it.each([
    ["día fuera de 0..6", { coverageWeekdays: [7] }],
    ["minutos fijos 0", { coverageFixedMinutes: 0 }],
    ["minutos fijos mayores a 24 h", { coverageFixedMinutes: 1441 }],
    ["minutos fijos decimales", { coverageFixedMinutes: 30.5 }],
    ["modo desconocido", { coverageMode: "ALWAYS" }],
    ["política de feriado desconocida", { coverageOnHoliday: "SOMETIMES" }],
    ["política de franco con convocatoria (sólo existe para feriados)", { coverageOnDayOff: "ONLY_IF_CONVOKED" }],
  ])("rechaza %s", (_label, overrides) => {
    expect(createNoveltyTypeSchema.safeParse({ ...base, ...overrides }).success).toBe(false);
  });

  it("acepta la política de feriado \"sólo si estaba convocada\"", () => {
    expect(createNoveltyTypeSchema.parse({ ...base, coverageOnHoliday: "ONLY_IF_CONVOKED" }).coverageOnHoliday).toBe("ONLY_IF_CONVOKED");
  });

  it("un PATCH parcial no inyecta defaults de cobertura (no pisa la configuración actual)", () => {
    const parsed = updateNoveltyTypeSchema.parse({ name: "Otro" });

    expect(parsed).toEqual({ name: "Otro" });
  });
});
