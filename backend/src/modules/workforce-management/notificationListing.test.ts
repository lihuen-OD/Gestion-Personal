import { describe, expect, it } from "vitest";
import { calendarDayEventAt, formatNotificationCursor, notificationEventDateWhere, parseNotificationCursor } from "./notificationListing";
import { argentinaDateKey } from "../../shared/datetime/argentinaTime";

const row = { eventAt: new Date("2026-10-02T03:00:00.000Z"), createdAt: new Date("2026-10-05T13:00:00.123Z"), id: "0b6a1f7e-3c2d-4e5f-8a9b-0c1d2e3f4a5b" };

describe("cursor de Notificaciones — (eventAt, createdAt, id), nunca un offset", () => {
  it("ida y vuelta exacto, con milisegundos", () => {
    const cursor = formatNotificationCursor(row);

    expect(cursor).toBe("2026-10-02T03:00:00.000Z_2026-10-05T13:00:00.123Z_0b6a1f7e-3c2d-4e5f-8a9b-0c1d2e3f4a5b");
    expect(parseNotificationCursor(cursor)).toEqual(row);
  });

  it.each([
    ["vacío", ""],
    ["un offset", "40"],
    ["sin id", "2026-10-02T03:00:00.000Z_2026-10-05T13:00:00.123Z"],
    ["id que no es UUID", "2026-10-02T03:00:00.000Z_2026-10-05T13:00:00.123Z_n-1"],
    ["UUID en mayúsculas (no respetaría el orden de la DB)", "2026-10-02T03:00:00.000Z_2026-10-05T13:00:00.123Z_0B6A1F7E-3C2D-4E5F-8A9B-0C1D2E3F4A5B"],
    ["fecha imposible", "2026-13-45T03:00:00.000Z_2026-10-05T13:00:00.123Z_0b6a1f7e-3c2d-4e5f-8a9b-0c1d2e3f4a5b"],
  ])("rechaza %s", (_label, value) => {
    expect(parseNotificationCursor(value)).toBeNull();
  });
});

describe("filtro Desde/Hasta — días calendario Argentina, inclusive", () => {
  it("dateFrom = 00:00 AR (03:00 UTC); dateTo = antes de las 00:00 AR del día siguiente", () => {
    expect(notificationEventDateWhere("2026-10-03", "2026-10-05")).toEqual({
      eventAt: { gte: new Date("2026-10-03T03:00:00.000Z"), lt: new Date("2026-10-06T03:00:00.000Z") },
    });
  });

  it("sin fechas no agrega condición", () => {
    expect(notificationEventDateWhere()).toEqual({});
  });
});

// Mismo criterio que el backfill SQL de la migración
// 20261006100000_add_system_notification_event_at (operationalDate::timestamp
// AT TIME ZONE 'America/Argentina/Buenos_Aires').
describe("calendarDayEventAt — fecha calendario argentina → instante, sin corrimiento de día", () => {
  it.each(["2026-10-02", "2026-01-01", "2026-12-31", "2026-03-01"])("%s → 00:00 Argentina de ese mismo día", (dateKey) => {
    const eventAt = calendarDayEventAt(dateKey);

    expect(eventAt.toISOString()).toBe(`${dateKey}T03:00:00.000Z`);
    expect(argentinaDateKey(eventAt)).toBe(dateKey);
  });
});
