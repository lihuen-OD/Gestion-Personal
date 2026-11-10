import { describe, expect, it } from "vitest";
import { formatClock, formatDayMonth, formatLongDate, formatTime, isSameArgentinaDay } from "./date";

// 2026-11-06T15:30:05Z = 12:30:05 en Argentina (UTC-3, sin horario de verano).
const INSTANT = new Date("2026-11-06T15:30:05.000Z");

describe("formatos de fecha y hora del fichador (hora Argentina)", () => {
  it("el reloj usa la hora Argentina en 24 h, con segundos aparte", () => {
    expect(formatClock(INSTANT)).toEqual({ time: "12:30", seconds: "05" });
    expect(formatClock(new Date("2026-11-07T03:00:00.000Z"))).toEqual({ time: "00:00", seconds: "00" });
  });

  it("la hora del reloj coincide con la de la confirmación (formatTime)", () => {
    expect(formatClock(INSTANT).time).toBe(formatTime(INSTANT));
  });

  it("fecha larga capitalizada y sin coma", () => {
    expect(formatLongDate(INSTANT)).toBe("Viernes 6 de noviembre");
  });

  it("día/mes y mismo día calendario según Argentina, no según UTC", () => {
    const lateNight = new Date("2026-11-07T02:30:00.000Z"); // 06/11 23:30 en Argentina
    expect(formatDayMonth(lateNight)).toBe("06/11");
    expect(isSameArgentinaDay(lateNight, INSTANT)).toBe(true);
    expect(isSameArgentinaDay(new Date("2026-11-07T03:30:00.000Z"), INSTANT)).toBe(false);
  });

  it("valores inválidos no rompen la pantalla", () => {
    expect(formatLongDate("no-es-fecha")).toBe("-");
    expect(formatDayMonth("no-es-fecha")).toBe("-");
    expect(isSameArgentinaDay("no-es-fecha", INSTANT)).toBe(false);
  });
});
