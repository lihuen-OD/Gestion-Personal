import { describe, expect, it } from "vitest";
import { computeExpectedMinutes, parseShiftTime } from "./shiftTemplateTime";

// Fórmula única de duración de un turno (movida sin cambios desde
// workforce.service.ts en la etapa 2 del motor de cobertura).
describe("computeExpectedMinutes", () => {
  it.each([
    ["08:00", "16:00", false, 480],
    ["08:30", "17:15", false, 525],
    ["22:00", "06:00", true, 480],
    ["08:00", "08:00", true, 1440],
  ])("%s → %s (cruza medianoche: %s) = %s min", (start, end, crosses, minutes) => {
    expect(computeExpectedMinutes(start, end, crosses)).toBe(minutes);
  });
});

describe("parseShiftTime", () => {
  it.each([
    ["00:00", 0],
    ["08:30", 510],
    ["23:59", 1439],
  ])("%s → %s", (time, minutes) => {
    expect(parseShiftTime(time)).toBe(minutes);
  });

  it.each(["24:00", "08:60", "8:00", "0800", "", null, undefined, "99:99"])("rechaza %s", (time) => {
    expect(parseShiftTime(time as string | null | undefined)).toBeNull();
  });
});
