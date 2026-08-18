import { describe, expect, it } from "vitest";
import {
  argentinaCalendarDate,
  argentinaDateKey,
  argentinaDayRange,
  dayOfMonthFromCalendarDate,
  dayOfMonthFromInstant,
  nextArgentinaMidnightUtc,
  periodFromCalendarDate,
  periodFromInstant,
  scheduledInstantForShiftTime,
} from "./argentinaTime";

describe("argentinaDateKey", () => {
  it("atribuye una fichada de las 23:30 hora Argentina al día Argentina correcto, no al día UTC siguiente", () => {
    // 2026-08-14 23:30 ART (UTC-3) = 2026-08-15 02:30 UTC.
    const instant = new Date("2026-08-15T02:30:00.000Z");
    expect(argentinaDateKey(instant)).toBe("2026-08-14");
  });

  it("no cambia nada para un instante bien entrado el día (sin ambigüedad de huso)", () => {
    // 2026-08-14 15:00 ART = 2026-08-14 18:00 UTC.
    const instant = new Date("2026-08-14T18:00:00.000Z");
    expect(argentinaDateKey(instant)).toBe("2026-08-14");
  });
});

describe("periodFromInstant / dayOfMonthFromInstant (el bug real: fichada 21:00-23:59 ART cruzando fin de mes)", () => {
  it("atribuye una jornada que arranca el 31/08 a las 22:00 ART al período de agosto, no septiembre", () => {
    // 2026-08-31 22:00 ART = 2026-09-01 01:00 UTC — con getters UTC crudos esto caía en septiembre/día 1.
    const shiftStartAt = new Date("2026-09-01T01:00:00.000Z");
    expect(periodFromInstant(shiftStartAt)).toBe("2026-08");
    expect(dayOfMonthFromInstant(shiftStartAt)).toBe(31);
  });

  it("cubre todo el rango 21:00-23:59 ART como el mismo día calendario Argentina", () => {
    const at2100 = new Date("2026-08-15T00:00:00.000Z"); // 2026-08-14 21:00 ART
    const at2359 = new Date("2026-08-15T02:59:00.000Z"); // 2026-08-14 23:59 ART
    expect(argentinaDateKey(at2100)).toBe("2026-08-14");
    expect(argentinaDateKey(at2359)).toBe("2026-08-14");
    expect(dayOfMonthFromInstant(at2100)).toBe(14);
    expect(dayOfMonthFromInstant(at2359)).toBe(14);
  });
});

describe("periodFromCalendarDate / dayOfMonthFromCalendarDate", () => {
  it("no aplica corrimiento de huso horario sobre una fecha-calendario ya normalizada", () => {
    const calendarDate = argentinaCalendarDate("2026-08-31");
    expect(periodFromCalendarDate(calendarDate)).toBe("2026-08");
    expect(dayOfMonthFromCalendarDate(calendarDate)).toBe(31);
  });

  it("demuestra por qué periodFromInstant y periodFromCalendarDate deben ser funciones distintas", () => {
    // Si se le aplicara corrección de huso a un valor ya normalizado a medianoche UTC,
    // el día se correría uno para atrás — este es exactamente el bug inverso a evitar.
    const calendarDate = argentinaCalendarDate("2026-08-01");
    expect(periodFromCalendarDate(calendarDate)).toBe("2026-08");
    expect(periodFromInstant(calendarDate)).toBe("2026-07");
    expect(dayOfMonthFromCalendarDate(calendarDate)).toBe(1);
    expect(dayOfMonthFromInstant(calendarDate)).toBe(31);
  });
});

describe("nextArgentinaMidnightUtc (turnos que cruzan medianoche)", () => {
  it("un turno que arranca 23:30 ART corta en la medianoche Argentina, no en la medianoche UTC", () => {
    const startAt = new Date("2026-08-15T02:30:00.000Z"); // 2026-08-14 23:30 ART
    const midnight = nextArgentinaMidnightUtc(startAt);
    // 2026-08-15 00:00 ART = 2026-08-15 03:00 UTC.
    expect(midnight.toISOString()).toBe("2026-08-15T03:00:00.000Z");
  });
});

describe("scheduledInstantForShiftTime (independiente de la zona horaria del proceso Node)", () => {
  it("construye el instante UTC correcto para una hora de turno en Argentina, sin usar Date local", () => {
    // 2026-08-14 09:00 ART = 2026-08-14 12:00 UTC.
    const reference = new Date("2026-08-14T12:00:00.000Z");
    const scheduled = scheduledInstantForShiftTime(reference, "09:00");
    expect(scheduled.toISOString()).toBe("2026-08-14T12:00:00.000Z");
  });

  it("suma un día cuando el turno cruza medianoche (addDay)", () => {
    const reference = new Date("2026-08-14T12:00:00.000Z"); // 2026-08-14 09:00 ART
    const scheduled = scheduledInstantForShiftTime(reference, "06:00", true);
    // 2026-08-15 06:00 ART = 2026-08-15 09:00 UTC.
    expect(scheduled.toISOString()).toBe("2026-08-15T09:00:00.000Z");
  });

  it("da el mismo resultado sin importar la zona horaria del proceso, porque no usa Date.setHours/getDate ni Intl con timeZone implícito", () => {
    // La implementación se construye enteramente con Date.UTC(...) y una constante de offset
    // explícita — nunca lee la hora local del proceso. Por eso comparar por .toISOString()
    // (siempre en UTC, sin importar la TZ de quien ejecuta el test) alcanza para probar que
    // el resultado es determinístico. El scheduledDateFor anterior fallaba esta misma prueba
    // conceptual: dependía de `Date.prototype.setHours`, que sí varía según la TZ del proceso.
    // 2026-01-01 00:00 UTC es todavía 2025-12-31 21:00 en Argentina (UTC-3) — el resultado
    // debe usar el día calendario ARGENTINA de la referencia (31/12), no el día UTC (01/01).
    const reference = new Date("2026-01-01T00:00:00.000Z");
    const first = scheduledInstantForShiftTime(reference, "14:45").getTime();
    const second = scheduledInstantForShiftTime(new Date(reference.getTime()), "14:45").getTime();
    expect(first).toBe(second);
    expect(new Date(first).toISOString()).toBe("2025-12-31T17:45:00.000Z");
  });
});

describe("argentinaCalendarDate / argentinaDayRange", () => {
  it("argentinaCalendarDate produce medianoche UTC para la clave dada", () => {
    expect(argentinaCalendarDate("2026-08-14").toISOString()).toBe("2026-08-14T00:00:00.000Z");
  });

  it("argentinaDayRange da el rango [00:00, 24:00) en hora Argentina real, no UTC", () => {
    const { startAt, endAt } = argentinaDayRange("2026-08-14");
    // 2026-08-14 00:00 ART = 2026-08-14 03:00 UTC.
    expect(startAt.toISOString()).toBe("2026-08-14T03:00:00.000Z");
    expect(endAt.toISOString()).toBe("2026-08-15T03:00:00.000Z");
  });
});
