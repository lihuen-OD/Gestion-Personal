import { describe, expect, it } from "vitest";
import {
  applyNoveltyTypeCompatibilitySync,
  resolveAllowsDateRangeSync,
  resolveFinnegansRequiresValiditySync,
  resolveFinnegansValueUnitSync,
  resolveTimeEntryBehaviorSync,
} from "./noveltyTypes.sync";

// Etapa 15L.2A (docs/decisions/NOVELTY_TYPE_MODEL_NORMALIZATION_15L2A.md):
// estas funciones son la única fuente de la regla "nunca dejar una
// combinación contradictoria entre el modelo nuevo y el legacy".

describe("resolveTimeEntryBehaviorSync", () => {
  it("timeEntryBehavior=BLOQUEA_NUEVA_CARGA fuerza los 3 legacy, setsWorkedHoursToZero siempre false", () => {
    expect(resolveTimeEntryBehaviorSync({ timeEntryBehavior: "BLOQUEA_NUEVA_CARGA" })).toEqual({
      timeEntryBehavior: "BLOQUEA_NUEVA_CARGA",
      blocksTimeEntry: true,
      setsWorkedHoursToZero: false,
      timeImpact: "BLOQUEA_CARGA_DIA",
    });
  });

  it("timeEntryBehavior=NO_BLOQUEA fuerza los 3 legacy a su valor apagado", () => {
    expect(resolveTimeEntryBehaviorSync({ timeEntryBehavior: "NO_BLOQUEA" })).toEqual({
      timeEntryBehavior: "NO_BLOQUEA",
      blocksTimeEntry: false,
      setsWorkedHoursToZero: false,
      timeImpact: "NO_AFECTA_HORAS",
    });
  });

  it("timeEntryBehavior explícito gana aunque el legacy diga lo contrario (nunca queda contradictorio)", () => {
    expect(
      resolveTimeEntryBehaviorSync({ timeEntryBehavior: "NO_BLOQUEA", blocksTimeEntry: true, timeImpact: "BLOQUEA_CARGA_DIA" }),
    ).toMatchObject({ timeEntryBehavior: "NO_BLOQUEA", blocksTimeEntry: false, timeImpact: "NO_AFECTA_HORAS" });
  });

  it("sin timeEntryBehavior, blocksTimeEntry=true (legacy) deriva BLOQUEA_NUEVA_CARGA y fuerza los otros 2", () => {
    expect(resolveTimeEntryBehaviorSync({ blocksTimeEntry: true })).toEqual({
      timeEntryBehavior: "BLOQUEA_NUEVA_CARGA",
      blocksTimeEntry: true,
      setsWorkedHoursToZero: false,
      timeImpact: "BLOQUEA_CARGA_DIA",
    });
  });

  it("sin timeEntryBehavior, setsWorkedHoursToZero=true (legacy) deriva BLOQUEA_NUEVA_CARGA y lo deja en false", () => {
    const result = resolveTimeEntryBehaviorSync({ setsWorkedHoursToZero: true });
    expect(result.timeEntryBehavior).toBe("BLOQUEA_NUEVA_CARGA");
    // Etapa 15G.1/15L.2A: nunca vuelve a quedar true desde código nuevo.
    expect(result.setsWorkedHoursToZero).toBe(false);
  });

  it("sin timeEntryBehavior, timeImpact=BLOQUEA_CARGA_DIA (legacy) deriva BLOQUEA_NUEVA_CARGA", () => {
    expect(resolveTimeEntryBehaviorSync({ timeImpact: "BLOQUEA_CARGA_DIA" }).timeEntryBehavior).toBe("BLOQUEA_NUEVA_CARGA");
  });

  it("sin timeEntryBehavior, ningún legacy en false/NO_AFECTA_HORAS deriva NO_BLOQUEA", () => {
    expect(resolveTimeEntryBehaviorSync({ blocksTimeEntry: false, setsWorkedHoursToZero: false, timeImpact: "NO_AFECTA_HORAS" })).toEqual({
      timeEntryBehavior: "NO_BLOQUEA",
      blocksTimeEntry: false,
      setsWorkedHoursToZero: false,
      timeImpact: "NO_AFECTA_HORAS",
    });
  });

  it("sin ninguno de los 4 campos: no devuelve nada (no pisa lo que ya existe)", () => {
    expect(resolveTimeEntryBehaviorSync({})).toEqual({});
  });
});

describe("resolveAllowsDateRangeSync", () => {
  it("allowsDateRange explícito sincroniza allowsDateTo", () => {
    expect(resolveAllowsDateRangeSync({ allowsDateRange: false })).toEqual({ allowsDateRange: false, allowsDateTo: false });
  });

  it("sólo allowsDateTo (cliente legacy) deriva allowsDateRange", () => {
    expect(resolveAllowsDateRangeSync({ allowsDateTo: true })).toEqual({ allowsDateRange: true, allowsDateTo: true });
  });

  it("allowsDateRange gana si ambos vienen y difieren", () => {
    expect(resolveAllowsDateRangeSync({ allowsDateRange: true, allowsDateTo: false })).toEqual({ allowsDateRange: true, allowsDateTo: true });
  });

  it("ninguno de los dos: no devuelve nada", () => {
    expect(resolveAllowsDateRangeSync({})).toEqual({});
  });
});

describe("resolveFinnegansRequiresValiditySync", () => {
  it("finnegansRequiresValidity explícito sincroniza hasValidity", () => {
    expect(resolveFinnegansRequiresValiditySync({ finnegansRequiresValidity: true })).toEqual({ finnegansRequiresValidity: true, hasValidity: true });
  });

  it("sólo hasValidity (cliente legacy) deriva finnegansRequiresValidity", () => {
    expect(resolveFinnegansRequiresValiditySync({ hasValidity: false })).toEqual({ finnegansRequiresValidity: false, hasValidity: false });
  });

  it("ninguno de los dos: no devuelve nada", () => {
    expect(resolveFinnegansRequiresValiditySync({})).toEqual({});
  });
});

describe("resolveFinnegansValueUnitSync", () => {
  it("finnegansValueUnit explícito gana, incluso null", () => {
    expect(resolveFinnegansValueUnitSync({ finnegansValueUnit: "DAYS" })).toEqual({ finnegansValueUnit: "DAYS" });
    expect(resolveFinnegansValueUnitSync({ finnegansValueUnit: null })).toEqual({ finnegansValueUnit: null });
  });

  it("sin finnegansValueUnit, allowsHours=true infiere HOURS", () => {
    expect(resolveFinnegansValueUnitSync({ allowsHours: true })).toEqual({ finnegansValueUnit: "HOURS" });
  });

  it("sin finnegansValueUnit, allowsHours=false no infiere nada (no asume DAYS/UNIT)", () => {
    expect(resolveFinnegansValueUnitSync({ allowsHours: false })).toEqual({});
  });

  it("sin ninguno de los dos: no devuelve nada", () => {
    expect(resolveFinnegansValueUnitSync({})).toEqual({});
  });
});

describe("applyNoveltyTypeCompatibilitySync", () => {
  it("combina las 4 sincronizaciones sobre un input de create legacy típico", () => {
    const result = applyNoveltyTypeCompatibilitySync({
      allowsHours: true,
      allowsDateTo: false,
      hasValidity: false,
      blocksTimeEntry: false,
      setsWorkedHoursToZero: false,
      timeImpact: "NO_AFECTA_HORAS",
    });

    expect(result).toMatchObject({
      allowsDateRange: false,
      finnegansRequiresValidity: false,
      finnegansValueUnit: "HOURS",
      timeEntryBehavior: "NO_BLOQUEA",
    });
  });

  it("un input que sólo trae el contrato nuevo no depende de ningún legacy", () => {
    const result = applyNoveltyTypeCompatibilitySync({
      timeEntryBehavior: "BLOQUEA_NUEVA_CARGA",
      allowsDateRange: true,
      finnegansRequiresValidity: true,
      finnegansValueUnit: "UNIT",
    });

    expect(result).toMatchObject({
      blocksTimeEntry: true,
      setsWorkedHoursToZero: false,
      timeImpact: "BLOQUEA_CARGA_DIA",
      allowsDateTo: true,
      hasValidity: true,
      finnegansValueUnit: "UNIT",
    });
  });

  it("un update que no toca ninguno de los campos sincronizables no agrega nada", () => {
    expect(applyNoveltyTypeCompatibilitySync({ name: "Nuevo nombre" } as never)).toEqual({ name: "Nuevo nombre" });
  });
});
