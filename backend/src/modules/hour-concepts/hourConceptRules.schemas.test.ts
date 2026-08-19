import { describe, expect, it } from "vitest";
import { createHourConceptRuleSchema, timeOfDaySchema, updateHourConceptRuleSchema } from "./hourConceptRules.schemas";

const validBase = { hourConceptId: "11111111-1111-1111-1111-111111111111", startTime: "07:00", endTime: "21:00", crossesMidnight: false, priority: 1 };

describe("timeOfDaySchema — validación HH:MM", () => {
  it("acepta 00:00 (límite inferior)", () => {
    expect(timeOfDaySchema.safeParse("00:00").success).toBe(true);
  });

  it("acepta 23:59 (límite superior)", () => {
    expect(timeOfDaySchema.safeParse("23:59").success).toBe(true);
  });

  it("rechaza 24:00 (no es un horario válido de un día)", () => {
    expect(timeOfDaySchema.safeParse("24:00").success).toBe(false);
  });

  it("rechaza formato inválido (sin dos dígitos, sin separador, minutos fuera de rango, etc.)", () => {
    for (const invalid of ["7:00", "07:0", "0700", "07-00", "07:60", "25:00", "07:00:00", "", "abc"]) {
      expect(timeOfDaySchema.safeParse(invalid).success, `esperaba rechazar "${invalid}"`).toBe(false);
    }
  });
});

describe("createHourConceptRuleSchema", () => {
  it("acepta una regla válida", () => {
    expect(createHourConceptRuleSchema.safeParse(validBase).success).toBe(true);
  });

  it("rechaza startTime == endTime", () => {
    const result = createHourConceptRuleSchema.safeParse({ ...validBase, startTime: "07:00", endTime: "07:00" });
    expect(result.success).toBe(false);
  });

  it("acepta crossesMidnight true para 21:00–04:00", () => {
    const result = createHourConceptRuleSchema.safeParse({ ...validBase, startTime: "21:00", endTime: "04:00", crossesMidnight: true });
    expect(result.success).toBe(true);
  });

  it("rechaza hourConceptId que no es uuid", () => {
    expect(createHourConceptRuleSchema.safeParse({ ...validBase, hourConceptId: "no-es-un-uuid" }).success).toBe(false);
  });

  it("rechaza priority no entero", () => {
    expect(createHourConceptRuleSchema.safeParse({ ...validBase, priority: 1.5 }).success).toBe(false);
  });

  it("status por defecto es ACTIVO si no se envía", () => {
    const result = createHourConceptRuleSchema.safeParse(validBase);
    expect(result.success && result.data.status).toBe("ACTIVO");
  });

  it("rechaza status inválido", () => {
    expect(createHourConceptRuleSchema.safeParse({ ...validBase, status: "BORRADOR" }).success).toBe(false);
  });
});

describe("updateHourConceptRuleSchema", () => {
  it("rechaza un body vacío (no hay nada para actualizar)", () => {
    expect(updateHourConceptRuleSchema.safeParse({}).success).toBe(false);
  });

  it("permite actualizar un solo campo", () => {
    expect(updateHourConceptRuleSchema.safeParse({ priority: 5 }).success).toBe(true);
  });

  it("rechaza startTime == endTime cuando se envían ambos juntos", () => {
    expect(updateHourConceptRuleSchema.safeParse({ startTime: "08:00", endTime: "08:00" }).success).toBe(false);
  });
});
