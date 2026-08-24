import { describe, expect, it } from "vitest";
import { calculateAutomaticBreakdowns } from "./automaticHourConceptBreakdowns";

const rule = (overrides: Partial<{ id: string; hourConceptId: string; startTime: string; endTime: string; crossesMidnight: boolean }> = {}) => ({
  id: "rule-sereno",
  hourConceptId: "sereno",
  startTime: "22:00",
  endTime: "06:00",
  crossesMidnight: true,
  ...overrides,
});
const shift = (start: string, end: string, id = "shift-1") => ({ id, startAt: new Date(start), endAt: new Date(end) });
const total = (rows: ReturnType<typeof calculateAutomaticBreakdowns>) => rows.reduce((sum, row) => sum + row.minutes, 0);

describe("calculateAutomaticBreakdowns", () => {
  it("calcula una regla y un turno del mismo día", () => {
    const rows = calculateAutomaticBreakdowns("2026-08", [shift("2026-08-10T08:00:00-03:00", "2026-08-10T16:00:00-03:00")], [
      rule({ startTime: "09:00", endTime: "17:00", crossesMidnight: false }),
    ]);
    expect(total(rows)).toBe(420);
  });

  it.each([
    ["2026-08-10T22:00:00-03:00", "2026-08-11T04:00:00-03:00", 360],
    ["2026-08-10T20:00:00-03:00", "2026-08-10T23:00:00-03:00", 60],
    ["2026-08-11T04:00:00-03:00", "2026-08-11T08:00:00-03:00", 120],
    ["2026-08-11T08:00:00-03:00", "2026-08-11T16:00:00-03:00", 0],
    ["2026-08-10T21:00:00-03:00", "2026-08-11T07:00:00-03:00", 480],
  ])("intersecta Sereno 22:00-06:00: %s a %s", (start, end, minutes) => {
    expect(total(calculateAutomaticBreakdowns("2026-08", [shift(start, end)], [rule()]))).toBe(minutes);
  });

  it("parte el resultado por día calendario Argentina", () => {
    const rows = calculateAutomaticBreakdowns("2026-08", [shift("2026-08-10T22:00:00-03:00", "2026-08-11T04:00:00-03:00")], [rule()]);
    expect(rows.map(({ day, minutes }) => ({ day, minutes }))).toEqual([{ day: 10, minutes: 120 }, { day: 11, minutes: 240 }]);
  });

  it("acumula varios turnos sin mezclar su trazabilidad", () => {
    const rows = calculateAutomaticBreakdowns("2026-08", [
      shift("2026-08-10T22:00:00-03:00", "2026-08-11T00:00:00-03:00", "shift-a"),
      shift("2026-08-11T02:00:00-03:00", "2026-08-11T04:00:00-03:00", "shift-b"),
    ], [rule()]);
    expect(total(rows)).toBe(240);
    expect(new Set(rows.map((row) => row.workShiftId))).toEqual(new Set(["shift-a", "shift-b"]));
  });

  it("fusiona reglas solapadas del mismo concepto sin duplicar minutos", () => {
    const rows = calculateAutomaticBreakdowns("2026-08", [shift("2026-08-10T21:00:00-03:00", "2026-08-11T07:00:00-03:00")], [
      rule(),
      rule({ id: "rule-sereno-2", startTime: "23:00", endTime: "05:00" }),
    ]);
    expect(total(rows)).toBe(480);
    expect(rows.some((row) => row.hourConceptRuleId === null)).toBe(true);
  });

  it("permite que conceptos distintos se superpongan aditivamente", () => {
    const rows = calculateAutomaticBreakdowns("2026-08", [shift("2026-08-10T22:00:00-03:00", "2026-08-11T04:00:00-03:00")], [
      rule(),
      rule({ id: "rule-guardia", hourConceptId: "guardia" }),
    ]);
    expect(total(rows.filter((row) => row.hourConceptId === "sereno"))).toBe(360);
    expect(total(rows.filter((row) => row.hourConceptId === "guardia"))).toBe(360);
  });

  it("recorta turnos que cruzan el límite del período", () => {
    const rows = calculateAutomaticBreakdowns("2026-08", [shift("2026-07-31T22:00:00-03:00", "2026-08-01T04:00:00-03:00")], [rule()]);
    expect(total(rows)).toBe(240);
    expect(rows.every((row) => row.period === "2026-08" && row.day === 1)).toBe(true);
  });
});
