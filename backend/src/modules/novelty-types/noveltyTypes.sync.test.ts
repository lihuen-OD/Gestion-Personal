import { describe, expect, it } from "vitest";
import {
  applyNoveltyTypeCompatibilitySync,
  resolveAllowsDateRangeSync,
  resolveFinnegansRequiresValiditySync,
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

// Etapa 15L.2B.1 (corrección puntual, docs/decisions/
// NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md): finnegansValueUnit y
// allowsHours son dos decisiones independientes -- allowsHours es la
// capacidad OPERATIVA de la novedad (¿permite cargar quantityHours?);
// finnegansValueUnit es la interpretación de EXPORTACIÓN de esa cantidad
// (qué representa Valor 1 en Finnegans). resolveFinnegansValueUnitSync
// (que sincronizaba ambos en las dos direcciones) se eliminó por completo
// -- estos tests fijan que applyNoveltyTypeCompatibilitySync ya no toca
// ninguno de los dos campos.
describe("applyNoveltyTypeCompatibilitySync — Etapa 15L.2B.1 (allowsHours y finnegansValueUnit desacoplados)", () => {
  it("combina las 3 sincronizaciones restantes sobre un input de create legacy típico, sin tocar finnegansValueUnit", () => {
    const result = applyNoveltyTypeCompatibilitySync({
      allowsHours: true,
      allowsDateTo: false,
      hasValidity: false,
      blocksTimeEntry: false,
      setsWorkedHoursToZero: false,
      timeImpact: "NO_AFECTA_HORAS",
    });

    expect(result).toMatchObject({
      allowsHours: true,
      allowsDateRange: false,
      finnegansRequiresValidity: false,
      timeEntryBehavior: "NO_BLOQUEA",
    });
    expect(result).not.toHaveProperty("finnegansValueUnit");
  });

  it("allowsHours=true en el input no cambia finnegansValueUnit", () => {
    const result = applyNoveltyTypeCompatibilitySync({ allowsHours: true, finnegansValueUnit: null } as never);
    expect(result).toMatchObject({ allowsHours: true, finnegansValueUnit: null });
  });

  it("allowsHours=false en el input no cambia finnegansValueUnit", () => {
    const result = applyNoveltyTypeCompatibilitySync({ allowsHours: false, finnegansValueUnit: "DAYS" } as never);
    expect(result).toMatchObject({ allowsHours: false, finnegansValueUnit: "DAYS" });
  });

  it("finnegansValueUnit=HOURS/DAYS/UNIT en el input no cambia allowsHours", () => {
    expect(applyNoveltyTypeCompatibilitySync({ finnegansValueUnit: "HOURS", allowsHours: false } as never)).toMatchObject({ allowsHours: false, finnegansValueUnit: "HOURS" });
    expect(applyNoveltyTypeCompatibilitySync({ finnegansValueUnit: "DAYS", allowsHours: true } as never)).toMatchObject({ allowsHours: true, finnegansValueUnit: "DAYS" });
    expect(applyNoveltyTypeCompatibilitySync({ finnegansValueUnit: "UNIT", allowsHours: true } as never)).toMatchObject({ allowsHours: true, finnegansValueUnit: "UNIT" });
  });

  it("PATCH que sólo manda allowsHours preserva finnegansValueUnit (no viene en el patch, no se toca)", () => {
    const result = applyNoveltyTypeCompatibilitySync({ allowsHours: true } as never);
    expect(result).toEqual({ allowsHours: true });
    expect(result).not.toHaveProperty("finnegansValueUnit");
  });

  it("PATCH que sólo manda finnegansValueUnit preserva allowsHours (no viene en el patch, no se toca)", () => {
    const result = applyNoveltyTypeCompatibilitySync({ finnegansValueUnit: "UNIT" } as never);
    expect(result).toEqual({ finnegansValueUnit: "UNIT" });
    expect(result).not.toHaveProperty("allowsHours");
  });

  it("un input que sólo trae el contrato nuevo no depende de ningún legacy", () => {
    const result = applyNoveltyTypeCompatibilitySync({
      timeEntryBehavior: "BLOQUEA_NUEVA_CARGA",
      allowsDateRange: true,
      finnegansRequiresValidity: true,
    });

    expect(result).toMatchObject({
      blocksTimeEntry: true,
      setsWorkedHoursToZero: false,
      timeImpact: "BLOQUEA_CARGA_DIA",
      allowsDateTo: true,
      hasValidity: true,
    });
  });

  it("un update que no toca ninguno de los campos sincronizables no agrega nada", () => {
    expect(applyNoveltyTypeCompatibilitySync({ name: "Nuevo nombre" } as never)).toEqual({ name: "Nuevo nombre" });
  });
});
