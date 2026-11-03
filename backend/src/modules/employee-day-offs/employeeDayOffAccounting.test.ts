import { describe, expect, it, vi } from "vitest";
import { dayOffKey } from "../time-entries/workedTimeAccounting";
import { loadDayOffAccounting, periodDayOffUncountedMinutes } from "./employeeDayOffAccounting";

// docs/decisions/EMPLOYEE_DAY_OFF.md §7.2: el índice atribuye cada jornada
// del fichador a su FECHA OPERATIVA y descuenta sus tramos por la fecha
// calendario de cada tramo.
const EMPLOYEE = "emp-1";
const art = (dateTime: string) => new Date(`${dateTime}:00.000-03:00`);
const date = (key: string) => new Date(`${key}T00:00:00.000Z`);
const NIGHT = { startTime: "23:00", endTime: "07:00", crossesMidnight: true };

function db(input: { dayOffs?: unknown[]; shifts?: unknown[]; entries?: unknown[]; breakdowns?: unknown[] } = {}) {
  return {
    employeeDayOff: { findMany: vi.fn().mockResolvedValue(input.dayOffs ?? []) },
    workShift: { findMany: vi.fn().mockResolvedValue(input.shifts ?? []) },
    timeEntry: { findMany: vi.fn().mockResolvedValue(input.entries ?? []) },
    hourConceptBreakdown: { findMany: vi.fn().mockResolvedValue(input.breakdowns ?? []) },
  };
}

// Noche del 10: 23:00 del 10 → 07:00 del 11 (1 h el 10, 7 h el 11).
const nightShift = {
  id: "shift-night",
  employeeId: EMPLOYEE,
  startAt: art("2026-11-10T23:00"),
  status: "PROCESADO",
  shiftTemplate: NIGHT,
  timeSegments: [{ date: date("2026-11-10"), minutes: 60 }, { date: date("2026-11-11"), minutes: 420 }],
};

describe("loadDayOffAccounting", () => {
  it("sin francos activos en el rango: una sola consulta y un índice vacío", async () => {
    const client = db();
    const result = await loadDayOffAccounting({ employeeIds: [EMPLOYEE], from: date("2026-11-01"), to: date("2026-12-01") }, client as never);

    expect(result.excludedBaseMinutes.size).toBe(0);
    expect(result.dayOffs).toEqual([]);
    expect(client.workShift.findMany).not.toHaveBeenCalled();
    // Un día de margen a cada lado (noche del día anterior, ingreso anticipado del siguiente).
    expect(client.employeeDayOff.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "ACTIVO", employeeId: { in: [EMPLOYEE] }, date: { gte: date("2026-10-31"), lt: date("2026-12-02") } }),
    }));
  });

  it("lista vacía de empleados: no consulta nada", async () => {
    const client = db();
    await loadDayOffAccounting({ employeeIds: [] }, client as never);
    expect(client.employeeDayOff.findMany).not.toHaveBeenCalled();
  });

  it("turno nocturno con franco el 10: descuenta el tramo del 10 Y el del 11 (toda la jornada es de la fecha operativa 10)", async () => {
    const client = db({ dayOffs: [{ id: "d1", employeeId: EMPLOYEE, date: date("2026-11-10"), notes: null }], shifts: [nightShift] });
    const result = await loadDayOffAccounting({ employeeIds: [EMPLOYEE] }, client as never);

    expect(result.excludedBaseMinutes.get(dayOffKey(EMPLOYEE, "2026-11-10"))).toBe(60);
    expect(result.excludedBaseMinutes.get(dayOffKey(EMPLOYEE, "2026-11-11"))).toBe(420);
    expect([...result.excludedWorkShiftIds]).toEqual(["shift-night"]);
    expect(result.dayOffs).toEqual([{ id: "d1", employeeId: EMPLOYEE, dateKey: "2026-11-10", notes: null, activityShifts: 1, activityMinutes: 480 }]);
  });

  it("franco el 11 y noche legítima del 10 que cae el 11: NO descuenta nada (la jornada es del 10)", async () => {
    const client = db({ dayOffs: [{ id: "d2", employeeId: EMPLOYEE, date: date("2026-11-11"), notes: null }], shifts: [nightShift] });
    const result = await loadDayOffAccounting({ employeeIds: [EMPLOYEE] }, client as never);

    expect(result.excludedBaseMinutes.size).toBe(0);
    expect(result.excludedWorkShiftIds.size).toBe(0);
    expect(result.dayOffs[0]).toMatchObject({ dateKey: "2026-11-11", activityShifts: 0, activityMinutes: 0 });
  });

  it("jornada abierta (aún sin salida): cuenta como actividad pero no descuenta horas que todavía no existen", async () => {
    const open = { ...nightShift, status: "ABIERTO", timeSegments: [] };
    const client = db({ dayOffs: [{ id: "d1", employeeId: EMPLOYEE, date: date("2026-11-10"), notes: "Pedido" }], shifts: [open] });
    const result = await loadDayOffAccounting({ employeeIds: [EMPLOYEE] }, client as never);

    expect(result.excludedBaseMinutes.size).toBe(0);
    expect(result.dayOffs[0]).toMatchObject({ activityShifts: 1, notes: "Pedido" });
  });

  it("sólo busca jornadas del fichador (las registradas a mano por un responsable nunca son actividad automática) en la ventana ±1 día", async () => {
    const client = db({ dayOffs: [{ id: "d1", employeeId: EMPLOYEE, date: date("2026-11-10"), notes: null }] });
    await loadDayOffAccounting({ employeeIds: [EMPLOYEE] }, client as never);

    expect(client.workShift.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { employeeId: { in: [EMPLOYEE] }, source: { not: "ADMIN" }, startAt: { gte: art("2026-11-09T00:00"), lt: art("2026-11-12T00:00") } },
    }));
  });
});

describe("periodDayOffUncountedMinutes — agregados SQL (resumen y dashboard)", () => {
  it("sin francos en el período: cero y una sola consulta", async () => {
    const client = db();
    await expect(periodDayOffUncountedMinutes("2026-11", {}, client as never)).resolves.toEqual({ baseMinutes: 0, additiveMinutes: 0 });
    expect(client.timeEntry.findMany).not.toHaveBeenCalled();
  });

  it("con franco: resta sólo lo automático de esa jornada con la misma regla que la grilla", async () => {
    const client = db({
      dayOffs: [{ id: "d1", employeeId: EMPLOYEE, date: date("2026-11-10"), notes: null }],
      shifts: [nightShift],
      entries: [
        { employeeId: EMPLOYEE, day: 10, date: date("2026-11-10"), hours: 1, appliedMultiplier: 1, source: "KIOSK" },
        { employeeId: EMPLOYEE, day: 11, date: date("2026-11-11"), hours: 7, appliedMultiplier: 1, source: "KIOSK" },
      ],
      breakdowns: [{ employeeId: EMPLOYEE, day: 11, date: date("2026-11-11"), hourConceptId: "colectivo", minutes: 30, source: "AUTOMATIC", workShiftId: "shift-night", hourConcept: { workTreatment: "ADDITIVE_TO_WORKED_TOTAL" } }],
    });

    await expect(periodDayOffUncountedMinutes("2026-11", {}, client as never)).resolves.toEqual({ baseMinutes: 480, additiveMinutes: 30 });
    // Sólo filas automáticas (canales del fichador) de las fechas afectadas.
    expect(client.timeEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ period: "2026-11", source: { in: ["PORTAL_DNI", "PUBLIC_CLOCK_PHOTO", "KIOSK", "BIOTIME", "FACIAL"] } }),
    }));
  });
});
