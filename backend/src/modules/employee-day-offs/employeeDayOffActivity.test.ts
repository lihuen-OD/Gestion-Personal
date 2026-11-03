import { beforeEach, describe, expect, it, vi } from "vitest";
import { attendanceRecipients, notifyUsers } from "../workforce-management/workforce.service";
import {
  DAY_OFF_CANCELED_ALERT_NOTE,
  evaluateWorkShiftDayOff,
  findClockWorkShiftsForOperationalDate,
  resolveDayOffActivityAlerts,
} from "./employeeDayOffActivity";

// createShiftAlert corre REAL (mismo camino de alerta + aviso que el resto de
// las alertas de fichada); sólo se reemplazan los destinatarios y el insert.
vi.mock("../workforce-management/workforce.service", () => ({ attendanceRecipients: vi.fn(), notifyUsers: vi.fn() }));
vi.mock("../work-regimes/workRegimes.service", () => ({ resolveActiveWorkRegime: vi.fn(), shouldSuppressMissingShiftAlert: vi.fn() }));
vi.mock("../../shared/prisma/client", () => ({ prisma: {} }));

const START = new Date("2026-11-10T11:05:00.000Z"); // 08:05 ART
const DAY_SHIFT = { startTime: "08:00", endTime: "16:00", crossesMidnight: false };

function tx(overrides: { shift?: unknown; dayOff?: unknown; alert?: unknown; shifts?: unknown[] } = {}) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(0),
    workShift: {
      findUnique: vi.fn().mockResolvedValue("shift" in overrides ? overrides.shift : { id: "shift-1", employeeId: "emp-1", startAt: START, source: "KIOSK", shiftTemplate: DAY_SHIFT }),
      findMany: vi.fn().mockResolvedValue(overrides.shifts ?? []),
    },
    employeeDayOff: { findUnique: vi.fn().mockResolvedValue("dayOff" in overrides ? overrides.dayOff : { status: "ACTIVO" }) },
    shiftAlert: {
      findUnique: vi.fn().mockResolvedValue(overrides.alert ?? null),
      upsert: vi.fn().mockResolvedValue({ id: "alert-1" }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(attendanceRecipients).mockResolvedValue(["user-rrhh", "user-responsable"]);
  vi.mocked(notifyUsers).mockResolvedValue(undefined);
});

describe("evaluateWorkShiftDayOff — paso del post-proceso de fichada (EMPLOYEE_DAY_OFF.md §9)", () => {
  it("jornada del fichador en un día con franco ACTIVO → alerta ACTIVIDAD_EN_FRANCO + notificación a los destinatarios de asistencia, con el texto de revisión", async () => {
    const client = tx();

    await expect(evaluateWorkShiftDayOff("shift-1", { db: client as never })).resolves.toBe(true);

    expect(client.employeeDayOff.findUnique).toHaveBeenCalledWith({ where: { employeeId_date: { employeeId: "emp-1", date: new Date("2026-11-10T00:00:00.000Z") } }, select: { status: true } });
    expect(client.shiftAlert.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { workShiftId_type: { workShiftId: "shift-1", type: "ACTIVIDAD_EN_FRANCO" } },
      create: expect.objectContaining({ employeeId: "emp-1", type: "ACTIVIDAD_EN_FRANCO", severity: "ADVERTENCIA", actualAt: START }),
    }));
    expect(attendanceRecipients).toHaveBeenCalledWith("emp-1");
    expect(notifyUsers).toHaveBeenCalledWith(["user-rrhh", "user-responsable"], expect.objectContaining({
      type: "ALERTA_FICHADA",
      title: "Actividad registrada en día de franco",
      message: "La persona tenía franco asignado para esta fecha y registró actividad. Revisá si corresponde reconocer horas trabajadas.",
      entityType: "ShiftAlert",
      entityId: "alert-1",
      eventAt: START,
    }), client);
    // Lock por empleado + fecha: serializa con el guardado del franco.
    expect(client.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("el texto nunca habla de incumplimiento, falta ni error del empleado", async () => {
    await evaluateWorkShiftDayOff("shift-1", { db: tx() as never });
    const [, notice] = vi.mocked(notifyUsers).mock.calls[0]!;
    expect(`${notice.title} ${notice.message}`.toLowerCase()).not.toMatch(/incumpl|falta|error/);
  });

  it("sin franco, o franco CANCELADO: no crea nada", async () => {
    for (const dayOff of [null, { status: "CANCELADO" }]) {
      const client = tx({ dayOff });
      await expect(evaluateWorkShiftDayOff("shift-1", { db: client as never })).resolves.toBe(false);
      expect(client.shiftAlert.upsert).not.toHaveBeenCalled();
    }
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("jornada registrada a mano por un responsable (ADMIN): no es actividad automática, no alerta", async () => {
    const client = tx({ shift: { id: "shift-1", employeeId: "emp-1", startAt: START, source: "ADMIN", shiftTemplate: null } });
    await expect(evaluateWorkShiftDayOff("shift-1", { db: client as never })).resolves.toBe(false);
    expect(client.employeeDayOff.findUnique).not.toHaveBeenCalled();
  });

  it("reintento con la alerta ya creada (PENDIENTE) o resuelta por una persona: no la toca ni vuelve a notificar", async () => {
    for (const alert of [{ id: "alert-1", status: "PENDIENTE", resolutionNote: null }, { id: "alert-1", status: "RESUELTA", resolutionNote: "Se reconocieron 4 h" }, { id: "alert-1", status: "DESCARTADA", resolutionNote: null }]) {
      const client = tx({ alert });
      await expect(evaluateWorkShiftDayOff("shift-1", { db: client as never })).resolves.toBe(false);
      expect(client.shiftAlert.upsert).not.toHaveBeenCalled();
      expect(client.shiftAlert.update).not.toHaveBeenCalled();
    }
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("alerta que había resuelto la cancelación del franco: al reactivarse se reabre (limpia la resolución) y vuelve a avisar", async () => {
    const client = tx({ alert: { id: "alert-1", status: "RESUELTA", resolutionNote: DAY_OFF_CANCELED_ALERT_NOTE } });

    await expect(evaluateWorkShiftDayOff("shift-1", { db: client as never })).resolves.toBe(true);

    expect(client.shiftAlert.update).toHaveBeenCalledWith({ where: { id: "alert-1" }, data: { resolvedAt: null, resolvedByUserId: null, resolutionNote: null } });
    expect(client.shiftAlert.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ status: "PENDIENTE" }) }));
    expect(notifyUsers).toHaveBeenCalledTimes(1);
  });

  it("turno nocturno con ingreso tarde (00:15 del 11): busca el franco de la fecha operativa 10, no la del ingreso", async () => {
    const client = tx({ shift: { id: "shift-1", employeeId: "emp-1", startAt: new Date("2026-11-11T03:15:00.000Z"), source: "KIOSK", shiftTemplate: { startTime: "23:00", endTime: "07:00", crossesMidnight: true } } });

    await evaluateWorkShiftDayOff("shift-1", { db: client as never });

    expect(client.employeeDayOff.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { employeeId_date: { employeeId: "emp-1", date: new Date("2026-11-10T00:00:00.000Z") } } }));
  });
});

describe("findClockWorkShiftsForOperationalDate / resolveDayOffActivityAlerts", () => {
  it("devuelve sólo las jornadas cuya fecha operativa es la del franco (la noche del 9 que termina el 10 no es del 10)", async () => {
    const night = { startTime: "23:00", endTime: "07:00", crossesMidnight: true };
    const client = tx({
      shifts: [
        { id: "night-of-9", employeeId: "emp-1", startAt: new Date("2026-11-10T02:00:00.000Z"), shiftTemplate: night }, // 23:00 ART del 9
        { id: "night-of-10", employeeId: "emp-1", startAt: new Date("2026-11-11T02:00:00.000Z"), shiftTemplate: night }, // 23:00 ART del 10
      ],
    });

    const shifts = await findClockWorkShiftsForOperationalDate(client as never, ["emp-1"], "2026-11-10");

    expect(shifts.map((shift) => shift.id)).toEqual(["night-of-10"]);
    expect(client.workShift.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ source: { not: "ADMIN" } }) }));
  });

  it("al cancelar, resuelve (sin borrar) sólo las alertas PENDIENTES de franco de esas jornadas", async () => {
    const client = tx();

    await expect(resolveDayOffActivityAlerts(client as never, ["shift-1", "shift-2"])).resolves.toBe(2);

    expect(client.shiftAlert.updateMany).toHaveBeenCalledWith({
      where: { workShiftId: { in: ["shift-1", "shift-2"] }, type: "ACTIVIDAD_EN_FRANCO", status: "PENDIENTE" },
      data: { status: "RESUELTA", resolvedAt: expect.any(Date), resolutionNote: DAY_OFF_CANCELED_ALERT_NOTE },
    });
  });
});
