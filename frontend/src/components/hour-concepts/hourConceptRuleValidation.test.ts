import { describe, expect, it } from "vitest";
import { isValidTimeOfDay, validateHourConceptRuleDraft } from "./hourConceptRuleValidation";

const validDraft = { startTime: "07:00", endTime: "21:00", priority: "1" };

describe("isValidTimeOfDay — mismo formato que exige el backend", () => {
  it("acepta 00:00 (límite inferior)", () => {
    expect(isValidTimeOfDay("00:00")).toBe(true);
  });

  it("acepta 23:59 (límite superior)", () => {
    expect(isValidTimeOfDay("23:59")).toBe(true);
  });

  it("rechaza 24:00", () => {
    expect(isValidTimeOfDay("24:00")).toBe(false);
  });

  it("rechaza formatos inválidos", () => {
    for (const invalid of ["7:00", "07:0", "0700", "07-00", "07:60", "25:00", ""]) {
      expect(isValidTimeOfDay(invalid), `esperaba rechazar "${invalid}"`).toBe(false);
    }
  });
});

describe("validateHourConceptRuleDraft", () => {
  it("acepta un draft válido", () => {
    expect(validateHourConceptRuleDraft(validDraft)).toBeNull();
  });

  it("rechaza startTime vacío", () => {
    expect(validateHourConceptRuleDraft({ ...validDraft, startTime: "" })).toBe("La hora desde es obligatoria.");
  });

  it("rechaza endTime vacío", () => {
    expect(validateHourConceptRuleDraft({ ...validDraft, endTime: "" })).toBe("La hora hasta es obligatoria.");
  });

  it("rechaza formato inválido en startTime o endTime", () => {
    expect(validateHourConceptRuleDraft({ ...validDraft, startTime: "7:00" })).toMatch(/formato HH:MM/);
    expect(validateHourConceptRuleDraft({ ...validDraft, endTime: "24:00" })).toMatch(/formato HH:MM/);
  });

  it("rechaza startTime igual a endTime", () => {
    expect(validateHourConceptRuleDraft({ ...validDraft, startTime: "08:00", endTime: "08:00" })).toBe("La hora desde y la hora hasta no pueden ser iguales.");
  });

  it("acepta 21:00 a 04:00 (cruza medianoche — la validación de formato no depende de crossesMidnight)", () => {
    expect(validateHourConceptRuleDraft({ startTime: "21:00", endTime: "04:00", priority: "1" })).toBeNull();
  });

  it("rechaza priority vacía o no numérica", () => {
    expect(validateHourConceptRuleDraft({ ...validDraft, priority: "" })).toBe("La prioridad es obligatoria.");
    expect(validateHourConceptRuleDraft({ ...validDraft, priority: "abc" })).toBe("La prioridad debe ser un número entero.");
  });

  it("no intenta detectar solapamientos — eso queda para el backend (409)", () => {
    // Dos reglas que solaparían con la misma prioridad no es algo que esta
    // función pueda ni deba resolver; solo valida forma, no lógica de negocio.
    expect(validateHourConceptRuleDraft(validDraft)).toBeNull();
  });
});
