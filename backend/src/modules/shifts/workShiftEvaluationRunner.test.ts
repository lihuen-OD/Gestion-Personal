import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { evaluateShiftEntry, evaluateShiftExit, notifyClassificationAlerts, flagOpenShiftOverflowForReview } from "./workShiftEvaluationRunner";

/**
 * Etapa de logica de Regimen de Trabajo (2026-08-18): un empleado sin
 * EmployeeWorkRegime vigente debe comportarse exactamente igual que hoy
 * (regla de compatibilidad). Un regimen con alertOnOutOfShift = false solo
 * suprime TURNO_NO_IDENTIFICADO / SHIFT_NOT_ENABLED_FOR_EMPLOYEE — nunca
 * otras alertas (jornada extendida, olvido de salida, descanso insuficiente,
 * etc.), que son ortogonales al regimen.
 */
vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    shiftAssignment: { findMany: vi.fn(), findUnique: vi.fn() },
    shiftTemplate: { findMany: vi.fn(), findUnique: vi.fn() },
    workShift: { update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    shiftAlert: { upsert: vi.fn() },
    employeeWorkRegime: { findFirst: vi.fn() },
  },
}));

vi.mock("../workforce-management/workforce.service", () => ({
  attendanceRecipients: vi.fn().mockResolvedValue([]),
  notifyUsers: vi.fn().mockResolvedValue(undefined),
}));

const mockedPrisma = prisma as unknown as {
  shiftAssignment: { findMany: Mock; findUnique: Mock };
  shiftTemplate: { findMany: Mock; findUnique: Mock };
  workShift: { update: Mock; findFirst: Mock; findUnique: Mock };
  shiftAlert: { upsert: Mock };
  employeeWorkRegime: { findFirst: Mock };
};

function upsertedAlertTypes(): string[] {
  return mockedPrisma.shiftAlert.upsert.mock.calls.map((call) => call[0]?.create?.type);
}

const disabledTemplate = {
  id: "t1",
  code: "T1",
  startTime: "07:00",
  endTime: "15:00",
  crossesMidnight: false,
  entryToleranceBeforeMinutes: 10,
  entryToleranceAfterMinutes: 10,
  exitToleranceBeforeMinutes: 20,
  exitToleranceAfterMinutes: 20,
  minimumMinutesForCompliance: null,
  maximumInformativeMinutes: 60,
  missingOutAlertAfterMinutes: null,
  absoluteOpenShiftLimitMinutes: 1200,
  status: "ACTIVO",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.workShift.findFirst.mockResolvedValue(null); // sin jornada previa: no evalua descanso
  mockedPrisma.shiftAlert.upsert.mockResolvedValue({ id: "alert-1" });
});

describe("Caso A — empleado sin regimen vigente", () => {
  it("sin turno compatible, genera TURNO_NO_IDENTIFICADO igual que hoy", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T10:00:00.000Z"));

    expect(upsertedAlertTypes()).toContain("TURNO_NO_IDENTIFICADO");
  });
});

describe("Caso B — regimen TURNO_OBLIGATORIO con alertOnOutOfShift = true", () => {
  it("fuera de turno, sigue generando la alerta igual que hoy", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({
      workRegime: { kind: "TURNO_OBLIGATORIO", alertOnOutOfShift: true },
    });

    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T10:00:00.000Z"));

    expect(upsertedAlertTypes()).toContain("TURNO_NO_IDENTIFICADO");
  });
});

describe("Caso C — regimen SIN_TURNO con alertOnOutOfShift = false", () => {
  it("sin turno compatible, NO genera TURNO_NO_IDENTIFICADO, y la jornada se evalua igual (sin excepciones)", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({
      workRegime: { kind: "SIN_TURNO", alertOnOutOfShift: false },
    });

    await expect(evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T10:00:00.000Z"))).resolves.not.toThrow();

    expect(upsertedAlertTypes()).not.toContain("TURNO_NO_IDENTIFICADO");
  });
});

describe("Caso D — regimen TURNO_FLEXIBLE con alertOnOutOfShift = false", () => {
  it("matchea un turno propio deshabilitado, NO genera SHIFT_NOT_ENABLED_FOR_EMPLOYEE", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ shiftTemplateId: "t1", status: "DESHABILITADO" }]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([disabledTemplate]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({
      workRegime: { kind: "TURNO_FLEXIBLE", alertOnOutOfShift: false },
    });

    // 07:05 hora Argentina = 10:05 UTC, dentro del turno 07:00-15:00 (deshabilitado para el empleado).
    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T10:05:00.000Z"));

    expect(upsertedAlertTypes()).not.toContain("SHIFT_NOT_ENABLED_FOR_EMPLOYEE");
  });

  it("aun con alertOnOutOfShift = false, jornada extendida se sigue alertando (no depende del regimen)", async () => {
    mockedPrisma.workShift.findUnique.mockResolvedValue({
      id: "shift-1",
      startAt: new Date("2026-08-18T10:00:00.000Z"),
      shiftTemplateId: "t1",
      totalMinutes: 500, // supera maximumInformativeMinutes (60) del template de prueba
    });
    mockedPrisma.shiftTemplate.findUnique.mockResolvedValue(disabledTemplate);
    mockedPrisma.shiftAssignment.findUnique.mockResolvedValue({ status: "DESHABILITADO" });

    await evaluateShiftExit("employee-1", "shift-1", new Date("2026-08-18T18:30:00.000Z"));

    expect(upsertedAlertTypes()).toContain("JORNADA_EXTENDIDA");
  });
});

describe("Caso E — notifyClassificationAlerts: una sola alerta por tipo por jornada, nunca por segmento", () => {
  it("varios segmentos CONCEPTO_NO_HABILITADO generan una sola alerta de ese tipo, con los minutos sumados", async () => {
    await notifyClassificationAlerts("employee-1", "shift-1", [
      { startAt: new Date("2026-08-18T00:00:00.000Z"), minutes: 180, conceptStatus: "CONCEPTO_NO_HABILITADO" },
      { startAt: new Date("2026-08-18T03:00:00.000Z"), minutes: 240, conceptStatus: "CONCEPTO_NO_HABILITADO" },
    ]);

    const calls = mockedPrisma.shiftAlert.upsert.mock.calls.filter((call) => call[0]?.create?.type === "CONCEPTO_NO_HABILITADO");
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]?.create?.differenceMinutes).toBe(420);
  });

  it("segmentos con distintos problemas generan una alerta por tipo, no una combinada ni una por segmento", async () => {
    await notifyClassificationAlerts("employee-1", "shift-1", [
      { startAt: new Date("2026-08-18T00:00:00.000Z"), minutes: 60, conceptStatus: "CONCEPTO_NO_HABILITADO" },
      { startAt: new Date("2026-08-18T01:00:00.000Z"), minutes: 60, conceptStatus: "SIN_CONCEPTO_COMPATIBLE" },
      { startAt: new Date("2026-08-18T02:00:00.000Z"), minutes: 60, conceptStatus: "SIN_CONCEPTO_COMPATIBLE" },
    ]);

    expect(upsertedAlertTypes().filter((type) => type === "CONCEPTO_NO_HABILITADO")).toHaveLength(1);
    expect(upsertedAlertTypes().filter((type) => type === "SEGMENTO_SIN_CLASIFICAR")).toHaveLength(1);
  });

  it("si todos los segmentos quedaron SUGERIDO/MANUAL, no genera ninguna alerta", async () => {
    await notifyClassificationAlerts("employee-1", "shift-1", [
      { startAt: new Date("2026-08-18T00:00:00.000Z"), minutes: 240, conceptStatus: "SUGERIDO" },
      { startAt: new Date("2026-08-18T04:00:00.000Z"), minutes: 240, conceptStatus: "MANUAL" },
    ]);

    expect(mockedPrisma.shiftAlert.upsert).not.toHaveBeenCalled();
  });
});

describe("flagOpenShiftOverflowForReview — política de rollover por régimen (Etapa 5)", () => {
  it("crea la alerta con severity CRITICA (override), reutilizando POSIBLE_OLVIDO_SALIDA en vez de un tipo nuevo", async () => {
    mockedPrisma.shiftAlert.upsert.mockResolvedValue({ id: "alert-1" });

    await flagOpenShiftOverflowForReview("employee-1", "shift-1", 1500, new Date("2026-08-18T05:00:00.000Z"));

    expect(mockedPrisma.shiftAlert.upsert).toHaveBeenCalledTimes(1);
    const call = mockedPrisma.shiftAlert.upsert.mock.calls[0]![0];
    expect(call.create).toMatchObject({ type: "POSIBLE_OLVIDO_SALIDA", severity: "CRITICA", differenceMinutes: 1500 });
    expect(call.where).toEqual({ workShiftId_type: { workShiftId: "shift-1", type: "POSIBLE_OLVIDO_SALIDA" } });
  });

  it("idempotencia: evaluar la misma jornada dos veces upsertea la misma fila (mismo workShiftId+type), no crea una segunda — y conserva severity CRITICA en el update", async () => {
    mockedPrisma.shiftAlert.upsert.mockResolvedValue({ id: "alert-1" });

    await flagOpenShiftOverflowForReview("employee-1", "shift-1", 1500, new Date("2026-08-18T05:00:00.000Z"));
    await flagOpenShiftOverflowForReview("employee-1", "shift-1", 1560, new Date("2026-08-18T06:00:00.000Z"));

    expect(mockedPrisma.shiftAlert.upsert).toHaveBeenCalledTimes(2);
    const [first, second] = mockedPrisma.shiftAlert.upsert.mock.calls.map((call) => call[0]!);
    expect(first.where).toEqual(second.where); // misma clave [workShiftId, type] en ambos llamados -> upsert, no create duplicado
    expect(second.update).toMatchObject({ severity: "CRITICA", differenceMinutes: 1560 });
  });

  it("no pisa la severity por defecto de otros tipos de alerta (ej. JORNADA_EXTENDIDA sigue en INFO)", async () => {
    mockedPrisma.shiftAlert.upsert.mockResolvedValue({ id: "alert-2" });
    mockedPrisma.workShift.findUnique.mockResolvedValue({
      id: "shift-2",
      startAt: new Date("2026-08-18T10:00:00.000Z"),
      shiftTemplateId: "t1",
      totalMinutes: 500,
    });
    mockedPrisma.shiftTemplate.findUnique.mockResolvedValue(disabledTemplate);
    mockedPrisma.shiftAssignment.findUnique.mockResolvedValue({ status: "DESHABILITADO" });

    await evaluateShiftExit("employee-1", "shift-2", new Date("2026-08-18T18:30:00.000Z"));

    const call = mockedPrisma.shiftAlert.upsert.mock.calls.find((c) => c[0]?.create?.type === "JORNADA_EXTENDIDA")![0]!;
    expect(call.create.severity).toBe("INFO");
  });
});
