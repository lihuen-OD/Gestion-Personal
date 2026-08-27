import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { checkMissingOutRisk } from "./openShiftMonitor.service";
import { createShiftAlert } from "./workShiftEvaluationRunner";

// Etapa 10C: cierra el hueco de cobertura señalado por 10A/10B — hasta acá
// sólo `evaluateOpenShiftRisk` (función pura) tenía tests; `checkMissingOutRisk`
// (el cron que efectivamente lee WorkShift/ShiftAlert y llama createShiftAlert)
// no tenía ningún test propio. Estos tests confirman, con evidencia directa,
// la propiedad central del análisis de "notificaciones duplicadas" de 10B/10C:
// este chequeo periódico sólo actúa sobre jornadas en riesgo MISSING_OUT
// (todavía ABIERTO) — nunca sobre jornadas ya EXPIRED, que quedan
// exclusivamente a cargo de expireOpenWorkShifts/rolloverExpiredOpenWorkShift.
vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    workShift: { findMany: vi.fn() },
    shiftAlert: { findUnique: vi.fn() },
  },
}));

vi.mock("./workShiftEvaluationRunner", () => ({
  createShiftAlert: vi.fn().mockResolvedValue({ id: "alert-1" }),
  toTemplateRef: (template: Record<string, unknown>) => template,
}));

const mockedPrisma = prisma as unknown as {
  workShift: { findMany: Mock };
  shiftAlert: { findUnique: Mock };
};
const mockedCreateShiftAlert = createShiftAlert as unknown as Mock;

function at(hours: number, minutes: number, day = 10) {
  return new Date(2026, 6, day, hours, minutes, 0, 0);
}

const nightTemplate = {
  id: "sereno",
  code: "TURNO-SERENO",
  startTime: "23:00",
  endTime: "04:00",
  crossesMidnight: true,
  entryToleranceBeforeMinutes: 15,
  entryToleranceAfterMinutes: 15,
  exitToleranceBeforeMinutes: 15,
  exitToleranceAfterMinutes: 15,
  minimumMinutesForCompliance: null,
  maximumInformativeMinutes: null,
  missingOutAlertAfterMinutes: 60,
  absoluteOpenShiftLimitMinutes: 1200,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkMissingOutRisk", () => {
  it("genera POSIBLE_OLVIDO_SALIDA sólo cuando el nivel de riesgo es MISSING_OUT, nunca en NORMAL", async () => {
    const dayTemplate = { ...nightTemplate, id: "dia", startTime: "07:00", endTime: "15:30", crossesMidnight: false, missingOutAlertAfterMinutes: 60 };
    mockedPrisma.workShift.findMany.mockResolvedValue([
      { id: "shift-normal", employeeId: "emp-1", startAt: at(7, 0), shiftTemplate: dayTemplate },
    ]);

    const result = await checkMissingOutRisk(at(10, 0)); // 3h abierto, lejos del riesgo

    expect(result).toEqual({ checked: 1, created: 0 });
    expect(mockedCreateShiftAlert).not.toHaveBeenCalled();
  });

  it("genera POSIBLE_OLVIDO_SALIDA cuando el riesgo es MISSING_OUT (todavía no EXPIRED)", async () => {
    const dayTemplate = { ...nightTemplate, id: "dia", startTime: "07:00", endTime: "15:30", crossesMidnight: false, missingOutAlertAfterMinutes: 60, exitToleranceAfterMinutes: 20 };
    mockedPrisma.workShift.findMany.mockResolvedValue([
      { id: "shift-risk", employeeId: "emp-1", startAt: at(7, 0), shiftTemplate: dayTemplate },
    ]);
    mockedPrisma.shiftAlert.findUnique.mockResolvedValue(null);

    // 15:30 (salida esperada) + 20 (tolerancia) + 60 (aviso) = 620 min desde las 07:00 -> 17:40
    const result = await checkMissingOutRisk(at(17, 50));

    expect(result.created).toBe(1);
    expect(mockedCreateShiftAlert).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: "emp-1", workShiftId: "shift-risk", type: "POSIBLE_OLVIDO_SALIDA" }),
    );
  });

  it("nunca evalúa una jornada EXPIRED — ese caso queda exclusivamente a cargo de expireOpenWorkShifts (evita la doble notificación)", async () => {
    // Jornada abierta hace 21h — ya superó absoluteOpenShiftLimitMinutes (1200 = 20h).
    mockedPrisma.workShift.findMany.mockResolvedValue([
      { id: "shift-expired", employeeId: "emp-1", startAt: at(0, 0, 9), shiftTemplate: null },
    ]);

    const result = await checkMissingOutRisk(at(21, 0, 9));

    // Nivel EXPIRED (no MISSING_OUT) -> el chequeo la salta explícitamente (`if (risk.level !== "MISSING_OUT") continue`).
    expect(result.created).toBe(0);
    expect(mockedCreateShiftAlert).not.toHaveBeenCalled();
  });

  it("no duplica: si ya existe una alerta POSIBLE_OLVIDO_SALIDA para esa jornada, no vuelve a crear ni a notificar", async () => {
    const dayTemplate = { ...nightTemplate, id: "dia", startTime: "07:00", endTime: "15:30", crossesMidnight: false, missingOutAlertAfterMinutes: 60, exitToleranceAfterMinutes: 20 };
    mockedPrisma.workShift.findMany.mockResolvedValue([
      { id: "shift-risk", employeeId: "emp-1", startAt: at(7, 0), shiftTemplate: dayTemplate },
    ]);
    mockedPrisma.shiftAlert.findUnique.mockResolvedValue({ id: "alert-existing" });

    const result = await checkMissingOutRisk(at(17, 50));

    expect(result.created).toBe(0);
    expect(mockedCreateShiftAlert).not.toHaveBeenCalled();
  });

  it("turno nocturno (cruza medianoche) sin llegar todavía a la salida esperada no genera ninguna alerta (sin falso positivo)", async () => {
    mockedPrisma.workShift.findMany.mockResolvedValue([
      { id: "shift-sereno", employeeId: "emp-1", startAt: at(23, 5), shiftTemplate: nightTemplate },
    ]);

    // Entró 23:05, todavía 01:30 del día siguiente — bien antes de la salida esperada (04:00 + tolerancias).
    const result = await checkMissingOutRisk(at(1, 30, 11));

    expect(result.created).toBe(0);
    expect(mockedCreateShiftAlert).not.toHaveBeenCalled();
  });

  it("turno nocturno que se pasó de la salida esperada (cruzando medianoche) sí genera POSIBLE_OLVIDO_SALIDA", async () => {
    mockedPrisma.workShift.findMany.mockResolvedValue([
      { id: "shift-sereno", employeeId: "emp-1", startAt: at(23, 5), shiftTemplate: nightTemplate },
    ]);
    mockedPrisma.shiftAlert.findUnique.mockResolvedValue(null);

    // Salida esperada 04:00 (martes) + 15 tolerancia + 60 aviso = 04:15 + 60min = 05:15 martes.
    const result = await checkMissingOutRisk(at(5, 30, 11));

    expect(result.created).toBe(1);
    expect(mockedCreateShiftAlert).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: "emp-1", workShiftId: "shift-sereno", type: "POSIBLE_OLVIDO_SALIDA" }),
    );
  });
});
