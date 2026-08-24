import { describe, expect, it } from "vitest";
import { isValidTimeOfDay, validateHourConceptRuleDraft } from "./hourConceptRuleValidation";

const validDraft = { startTime: "07:00", endTime: "21:00", crossesMidnight: false };

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

  // Etapa 8N: consistencia entre el rango horario y "cruza medianoche" —
  // ruleTimeIntervals (hourConceptRules.service.ts) confía en crossesMidnight
  // tal cual, así que un valor inconsistente con el rango real rompe el
  // cálculo de solapamiento en silencio, no como un error legible.
  describe("consistencia con crossesMidnight", () => {
    it("rechaza 21:00 a 04:00 (hasta < desde) sin tildar 'cruza medianoche'", () => {
      const result = validateHourConceptRuleDraft({ startTime: "21:00", endTime: "04:00", crossesMidnight: false });
      expect(result).toMatch(/cruza medianoche/i);
    });

    it("acepta 21:00 a 04:00 con 'cruza medianoche' tildado", () => {
      expect(validateHourConceptRuleDraft({ startTime: "21:00", endTime: "04:00", crossesMidnight: true })).toBeNull();
    });

    it("rechaza 07:00 a 21:00 (rango normal) con 'cruza medianoche' tildado por error", () => {
      const result = validateHourConceptRuleDraft({ startTime: "07:00", endTime: "21:00", crossesMidnight: true });
      expect(result).toMatch(/no cruza medianoche/i);
    });

    it("acepta 07:00 a 21:00 sin tildar 'cruza medianoche' (caso normal)", () => {
      expect(validateHourConceptRuleDraft({ startTime: "07:00", endTime: "21:00", crossesMidnight: false })).toBeNull();
    });
  });
});
