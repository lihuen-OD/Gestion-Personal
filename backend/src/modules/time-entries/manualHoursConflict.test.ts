import { describe, expect, it } from "vitest";
import { argentinaCalendarDate } from "../../shared/datetime/argentinaTime";
import {
  candidateDateKeys,
  KEEP_MANUAL_RESOLUTION_NOTE,
  manualHoursDateKeys,
  manualHoursDecisionOf,
  needsOperationalDate,
  USE_CLOCK_RESOLUTION_NOTE,
} from "./manualHoursConflict";

// docs/decisions/MANUAL_HOURS_VS_CLOCK_PUNCH.md: único criterio de "fecha con horas manuales".
const row = (dateKey: string, source: "KIOSK" | "PUBLIC_CLOCK_PHOTO" | "ADMIN" | null) => ({ date: argentinaCalendarDate(dateKey), source });

describe("manualHoursDateKeys", () => {
  it("carga manual (source null) y corrección (ADMIN) son horas de una persona; los canales del fichador no", () => {
    const entries = [row("2026-10-10", null), row("2026-10-11", "ADMIN"), row("2026-10-12", "KIOSK"), row("2026-10-13", "PUBLIC_CLOCK_PHOTO")];
    expect(manualHoursDateKeys(entries, ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"], null)).toEqual(["2026-10-10", "2026-10-11"]);
  });

  it("sólo cuentan las fechas de los tramos y la fecha operativa", () => {
    const entries = [row("2026-10-09", null), row("2026-10-10", null)];
    expect(manualHoursDateKeys(entries, ["2026-10-11"], null)).toEqual([]);
    // Ingreso tarde (00:15 del 11) a un turno 23:00–07:00: la fecha operativa es el 10.
    expect(manualHoursDateKeys(entries, ["2026-10-11"], "2026-10-10")).toEqual(["2026-10-10"]);
  });

  it("nocturna con carga manual en un solo día: una sola lista, sin repetir fechas", () => {
    const entries = [row("2026-10-10", null), row("2026-10-10", "KIOSK")];
    expect(manualHoursDateKeys(entries, ["2026-10-10", "2026-10-11"], "2026-10-10")).toEqual(["2026-10-10"]);
  });
});

describe("candidateDateKeys / needsOperationalDate", () => {
  it("fechas de los tramos más el día anterior y el siguiente al ingreso", () => {
    expect(candidateDateKeys(["2026-10-11", "2026-10-10"])).toEqual(["2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(candidateDateKeys(["2026-10-31"])).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(candidateDateKeys([])).toEqual([]);
  });

  it("la fecha operativa (y su turno) sólo se resuelve si hay una fila manual en un día sin tramos", () => {
    expect(needsOperationalDate([row("2026-10-10", null)], ["2026-10-10"])).toBe(false);
    expect(needsOperationalDate([row("2026-10-09", "KIOSK")], ["2026-10-10"])).toBe(false);
    expect(needsOperationalDate([row("2026-10-09", null)], ["2026-10-10"])).toBe(true);
  });
});

describe("manualHoursDecisionOf", () => {
  it("lee la decisión de la nota de resolución; cualquier otra nota no es una decisión", () => {
    expect(manualHoursDecisionOf(KEEP_MANUAL_RESOLUTION_NOTE)).toBe("KEEP_MANUAL");
    expect(manualHoursDecisionOf(USE_CLOCK_RESOLUTION_NOTE)).toBe("USE_CLOCK");
    expect(manualHoursDecisionOf("Visto")).toBeNull();
    expect(manualHoursDecisionOf(null)).toBeNull();
  });
});
