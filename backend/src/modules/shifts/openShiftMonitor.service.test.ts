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
    employeeWorkRegime: { findFirst: vi.fn() },
  },
}));

vi.mock("./workShiftEvaluationRunner", () => ({
  createShiftAlert: vi.fn().mockResolvedValue({ id: "alert-1" }),
  toTemplateRef: (template: Record<string, unknown>) => template,
}));

const mockedPrisma = prisma as unknown as {
  workShift: { findMany: Mock };
  shiftAlert: { findUnique: Mock };
  employeeWorkRegime: { findFirst: Mock };
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
  // Etapa 10E: sin régimen vigente por defecto — comportamiento igual que
  // antes de esta etapa (no suprime el default de "olvido de salida" sin turno).
  mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);
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

describe("checkMissingOutRisk — Etapa 10E (hallazgo central: empleado sin turno nunca generaba ShiftAlert de olvido de salida)", () => {
  it("empleado sin turno (template null), sin régimen asignado, sí genera POSIBLE_OLVIDO_SALIDA al superar el default (600 min) — antes de este fix, nunca se generaba", async () => {
    mockedPrisma.workShift.findMany.mockResolvedValue([
      { id: "shift-sin-turno", employeeId: "emp-1", startAt: at(0, 0, 10), shiftTemplate: null },
    ]);
    mockedPrisma.shiftAlert.findUnique.mockResolvedValue(null);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

    const result = await checkMissingOutRisk(at(10, 30, 10)); // 10h30 abierto

    expect(result.created).toBe(1);
    expect(mockedCreateShiftAlert).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: "emp-1", workShiftId: "shift-sin-turno", type: "POSIBLE_OLVIDO_SALIDA" }),
    );
  });

  it("empleado sin turno con régimen alertOnOutOfShift=false (cosecha/flexible) NO genera la alerta por el default — evita reintroducir ruido en jornadas largas legítimas", async () => {
    mockedPrisma.workShift.findMany.mockResolvedValue([
      { id: "shift-cosecha", employeeId: "emp-2", startAt: at(0, 0, 10), shiftTemplate: null },
    ]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({
      workRegime: { kind: "TURNO_FLEXIBLE", alertOnOutOfShift: false, openShiftOverflowAction: "ROLLOVER", extendedShiftAlertMinutes: null },
    });

    const result = await checkMissingOutRisk(at(10, 30, 10)); // 10h30 abierto, hubiera generado MISSING_OUT sin régimen

    expect(result.created).toBe(0);
    expect(mockedCreateShiftAlert).not.toHaveBeenCalled();
  });

  it("empleado sin turno con régimen alertOnOutOfShift=true (explícito) sigue generando la alerta por el default", async () => {
    mockedPrisma.workShift.findMany.mockResolvedValue([
      { id: "shift-sin-turno-2", employeeId: "emp-3", startAt: at(0, 0, 10), shiftTemplate: null },
    ]);
    mockedPrisma.shiftAlert.findUnique.mockResolvedValue(null);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({
      workRegime: { kind: "TURNO_OBLIGATORIO", alertOnOutOfShift: true, openShiftOverflowAction: "ROLLOVER", extendedShiftAlertMinutes: null },
    });

    const result = await checkMissingOutRisk(at(10, 30, 10));

    expect(result.created).toBe(1);
  });

  it("empleado CON turno pero sin missingOutAlertAfterMinutes configurado también se beneficia del default (mismo hallazgo, otra causa raíz)", async () => {
    const templateSinAlerta = { ...nightTemplate, id: "sin-alerta-cron", missingOutAlertAfterMinutes: null };
    mockedPrisma.workShift.findMany.mockResolvedValue([
      { id: "shift-turno-sin-alerta", employeeId: "emp-4", startAt: at(0, 0, 10), shiftTemplate: templateSinAlerta },
    ]);
    mockedPrisma.shiftAlert.findUnique.mockResolvedValue(null);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

    const result = await checkMissingOutRisk(at(10, 30, 10));

    expect(result.created).toBe(1);
  });

  it("coherencia con expireOpenWorkShifts: el default de olvido de salida nunca se evalúa para una jornada ya EXPIRED, ese caso sigue exclusivo del cierre automático", async () => {
    mockedPrisma.workShift.findMany.mockResolvedValue([
      { id: "shift-vencido", employeeId: "emp-5", startAt: at(0, 0, 9), shiftTemplate: null },
    ]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

    // 21h abierto — ya superó el límite absoluto (1200 min = 20h), por lo tanto EXPIRED, no MISSING_OUT.
    const result = await checkMissingOutRisk(at(21, 0, 9));

    expect(result.created).toBe(0);
    expect(mockedCreateShiftAlert).not.toHaveBeenCalled();
  });
});
