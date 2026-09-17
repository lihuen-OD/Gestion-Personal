import { describe, expect, it } from "vitest";
import { formatDecimalHoursDuration, formatDurationMinutes, hoursDecimalToMinutes } from "./hours";

// Etapa 15M.5 (docs/decisions/HUMAN_DURATION_FORMAT_15M5.md): 2.35 horas
// decimales NO son "2h 35min" — son 2h 21min (0.35 * 60 = 21).
describe("formatDurationMinutes", () => {
  it.each([
    [0, "0 h"],
    [1, "1 min"],
    [21, "21 min"],
    [59, "59 min"],
    [60, "1 h"],
    [61, "1 h 1 min"],
    [119, "1 h 59 min"],
    [120, "2 h"],
    [121, "2 h 1 min"],
    [141, "2 h 21 min"], // caso real legajo 29, 17/09 — nunca "2.35"
    [247, "4 h 7 min"],
    [250, "4 h 10 min"], // caso real legajo 30, 16/09 (reconciliado en 15M.4) — nunca "4.17"
    [601, "10 h 1 min"],
  ])("%i min -> %s", (minutes, expected) => {
    expect(formatDurationMinutes(minutes)).toBe(expected);
  });

  it("valores negativos, null, undefined o no finitos caen a '0 h'", () => {
    expect(formatDurationMinutes(-5)).toBe("0 h");
    expect(formatDurationMinutes(null)).toBe("0 h");
    expect(formatDurationMinutes(undefined)).toBe("0 h");
    expect(formatDurationMinutes(NaN)).toBe("0 h");
  });

  it("redondea minutos fraccionarios antes de formatear", () => {
    expect(formatDurationMinutes(140.6)).toBe("2 h 21 min");
  });
});

describe("hoursDecimalToMinutes", () => {
  it("2.35 horas decimales -> 141 minutos (nunca 2h35min)", () => {
    expect(hoursDecimalToMinutes(2.35)).toBe(141);
  });

  it("4.12 horas decimales -> 247 minutos (0.12 * 60 = 7.2, no 12)", () => {
    expect(hoursDecimalToMinutes(4.12)).toBe(247);
  });

  it("4.17 horas decimales (caso legajo 30 reconciliado) -> 250 minutos", () => {
    expect(hoursDecimalToMinutes(4.17)).toBe(250);
  });

  it("null/undefined/no finito -> 0", () => {
    expect(hoursDecimalToMinutes(null)).toBe(0);
    expect(hoursDecimalToMinutes(undefined)).toBe(0);
    expect(hoursDecimalToMinutes(NaN)).toBe(0);
  });
});

describe("formatDurationMinutes(hoursDecimalToMinutes(x)) — pipeline completo decimal -> humano", () => {
  it.each([
    [2.35, "2 h 21 min"],
    [4.12, "4 h 7 min"],
    [4.17, "4 h 10 min"],
    [1.02, "1 h 1 min"], // caso real legajo 30 antes de la Etapa 15M.4 (61 min)
  ])("%s h decimales -> %s", (decimalHours, expected) => {
    expect(formatDurationMinutes(hoursDecimalToMinutes(decimalHours))).toBe(expected);
  });
});

describe("formatDecimalHoursDuration — composición para DTOs sólo-decimal (ej. findPeriodEmployees)", () => {
  it.each([
    [2.35, "2 h 21 min"],
    [4.12, "4 h 7 min"],
    [4.17, "4 h 10 min"],
    [0, "0 h"],
  ])("%s h decimales -> %s", (decimalHours, expected) => {
    expect(formatDecimalHoursDuration(decimalHours)).toBe(expected);
  });
});

describe("suma de duraciones — siempre en minutos, nunca sumando decimales/strings", () => {
  it("2h21min + 4h7min + 1h2min = 141 + 247 + 62 = 450 min = 7h30min", () => {
    const totalMinutes = 141 + 247 + 62;
    expect(totalMinutes).toBe(450);
    expect(formatDurationMinutes(totalMinutes)).toBe("7 h 30 min");
  });

  it("suma de varios días reales (no parseFloat de strings ya formateados)", () => {
    const dailyMinutes = [141, 247, 62, 0, 480];
    const total = dailyMinutes.reduce((sum, minutes) => sum + minutes, 0);
    expect(total).toBe(930);
    expect(formatDurationMinutes(total)).toBe("15 h 30 min");
  });
});
