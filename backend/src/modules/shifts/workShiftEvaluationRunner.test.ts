import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { notifyUsers } from "../workforce-management/workforce.service";
import { createShiftAlert, evaluateShiftEntry, evaluateShiftExit, notifyClassificationAlerts, flagOpenShiftOverflowForReview, resolveOpenShiftOverflowAlert } from "./workShiftEvaluationRunner";

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
    shiftAlert: { upsert: vi.fn(), updateMany: vi.fn() },
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
  shiftAlert: { upsert: Mock; updateMany: Mock };
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

// Etapa 10C: turno "sereno" (23:00-04:00, cruza medianoche) — mismo fixture
// conceptual que workShiftEvaluation.service.test.ts, acá a nivel runner
// (con Prisma mockeado) para confirmar que el cruce de medianoche no genera
// alertas falsas end-to-end, no sólo en la función pura.
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
  maximumInformativeMinutes: 300, // 5h — bajo a propósito para poder disparar JORNADA_EXTENDIDA en los tests
  missingOutAlertAfterMinutes: 60,
  absoluteOpenShiftLimitMinutes: 1200,
  status: "ACTIVO",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.workShift.findFirst.mockResolvedValue(null); // sin jornada previa: no evalua descanso
  mockedPrisma.shiftAlert.upsert.mockResolvedValue({ id: "alert-1" });
  mockedPrisma.shiftAlert.updateMany.mockResolvedValue({ count: 0 });
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

// Etapa 13A (docs/decisions/SHIFT_ENTRY_CLASSIFICATION_13A.md): la entrada
// debe clasificarse siempre contra el turno ASIGNADO al empleado, nunca
// contra un turno ajeno que coincida mejor con la hora.
describe("Etapa 13A — evaluateShiftEntry: ingreso anticipado usa el turno asignado", () => {
  const shift0830 = {
    id: "shift-0830",
    code: "T-0830",
    startTime: "08:30",
    endTime: "16:30",
    crossesMidnight: false,
    entryToleranceBeforeMinutes: 10,
    entryToleranceAfterMinutes: 10,
    exitToleranceBeforeMinutes: 20,
    exitToleranceAfterMinutes: 20,
    minimumMinutesForCompliance: null,
    maximumInformativeMinutes: null,
    missingOutAlertAfterMinutes: null,
    absoluteOpenShiftLimitMinutes: 1200,
    status: "ACTIVO",
  };
  const alien0800 = { ...shift0830, id: "alien-0800", code: "T-0800", startTime: "08:00", endTime: "16:00" };

  it("Caso 5/F del pedido: turno asignado 08:30, entrada 08:00, existe un turno de 08:00 no asignado -> INGRESO_ANTICIPADO sobre el turno propio, nunca sobre el ajeno", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ shiftTemplateId: "shift-0830", status: "HABILITADO" }]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([shift0830, alien0800]);

    // 08:00 hora Argentina = 11:00 UTC
    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T11:00:00.000Z"));

    expect(upsertedAlertTypes()).toContain("INGRESO_ANTICIPADO");
    expect(upsertedAlertTypes()).not.toContain("POSSIBLE_SHIFT_CONFIGURATION_MISSING");
    expect(upsertedAlertTypes()).not.toContain("TURNO_NO_IDENTIFICADO");
    const call = mockedPrisma.shiftAlert.upsert.mock.calls.find((c) => c[0]?.create?.type === "INGRESO_ANTICIPADO")![0]!;
    expect(call.create.differenceMinutes).toBe(-30);
    expect(call.create.severity).toBe("INFO");
    expect(mockedPrisma.workShift.update).toHaveBeenCalledWith({ where: { id: "shift-1" }, data: { shiftTemplateId: "shift-0830", maxAllowedMinutes: 1200 } });
  });

  it("Caso 4/E del pedido: turno asignado, entrada antes del horario, sin ningún otro turno en el sistema -> INGRESO_ANTICIPADO (antes de esta etapa daba TURNO_NO_IDENTIFICADO)", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ shiftTemplateId: "shift-0830", status: "HABILITADO" }]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([shift0830]);

    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T11:00:00.000Z"));

    expect(upsertedAlertTypes()).toContain("INGRESO_ANTICIPADO");
    expect(upsertedAlertTypes()).not.toContain("TURNO_NO_IDENTIFICADO");
  });

  it("Caso 3 del pedido: dentro de tolerancia no genera ninguna alerta de puntualidad de ingreso", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ shiftTemplateId: "shift-0830", status: "HABILITADO" }]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([shift0830]);

    // 08:25 ART = 11:25 UTC, 5 min antes, dentro de entryToleranceBeforeMinutes=10
    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T11:25:00.000Z"));

    expect(upsertedAlertTypes()).not.toContain("INGRESO_ANTICIPADO");
    expect(upsertedAlertTypes()).not.toContain("INGRESO_TARDE");
  });

  it("Caso 3 del pedido: entrada tarde fuera de tolerancia sigue generando INGRESO_TARDE, nunca INGRESO_ANTICIPADO", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ shiftTemplateId: "shift-0830", status: "HABILITADO" }]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([shift0830]);

    // 08:50 ART = 11:50 UTC, 20 min tarde
    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T11:50:00.000Z"));

    expect(upsertedAlertTypes()).toContain("INGRESO_TARDE");
    expect(upsertedAlertTypes()).not.toContain("INGRESO_ANTICIPADO");
  });

  it("Caso H del pedido: ingreso muy anticipado (más de 240 min antes) sube la severidad a ADVERTENCIA, pero sigue siendo INGRESO_ANTICIPADO sobre el turno propio", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ shiftTemplateId: "shift-0830", status: "HABILITADO" }]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([shift0830]);

    // 04:00 ART = 07:00 UTC, 270 min antes
    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T07:00:00.000Z"));

    const call = mockedPrisma.shiftAlert.upsert.mock.calls.find((c) => c[0]?.create?.type === "INGRESO_ANTICIPADO")![0]!;
    expect(call.create.differenceMinutes).toBe(-270);
    expect(call.create.severity).toBe("ADVERTENCIA");
  });

  it("un fallo de notificación no bloquea la fichada ni la alerta ya creada (mismo patrón best-effort de la Etapa 10E)", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ shiftTemplateId: "shift-0830", status: "HABILITADO" }]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([shift0830]);
    vi.mocked(notifyUsers).mockRejectedValueOnce(new Error("fallo transitorio"));

    await expect(evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T11:00:00.000Z"))).resolves.toBeUndefined();
    expect(upsertedAlertTypes()).toContain("INGRESO_ANTICIPADO");
  });

  it("no genera alertas duplicadas: evaluar la misma jornada dos veces upsertea la misma fila (mismo workShiftId+type)", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ shiftTemplateId: "shift-0830", status: "HABILITADO" }]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([shift0830]);

    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T11:00:00.000Z"));
    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T11:00:00.000Z"));

    const calls = mockedPrisma.shiftAlert.upsert.mock.calls.filter((c) => c[0]?.create?.type === "INGRESO_ANTICIPADO");
    expect(calls).toHaveLength(2);
    expect(calls[0]![0]!.where).toEqual(calls[1]![0]!.where); // misma clave [workShiftId, type] -> upsert, nunca una fila nueva
  });

  it("régimen alertOnOutOfShift=false no suprime INGRESO_ANTICIPADO (es puntualidad contra el turno ya matcheado, no una alerta de 'fuera de turno')", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ shiftTemplateId: "shift-0830", status: "HABILITADO" }]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([shift0830]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({ workRegime: { kind: "TURNO_FLEXIBLE", alertOnOutOfShift: false } });

    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T11:00:00.000Z"));

    expect(upsertedAlertTypes()).toContain("INGRESO_ANTICIPADO");
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

describe("resolveOpenShiftOverflowAlert — Etapa 10B (cierre del hueco de alertas huérfanas, 10A §11.2)", () => {
  it("resuelve sólo la alerta POSIBLE_OLVIDO_SALIDA PENDIENTE de esta jornada puntual", async () => {
    mockedPrisma.shiftAlert.updateMany.mockResolvedValue({ count: 1 });

    await resolveOpenShiftOverflowAlert("shift-1", "Resuelta automáticamente: prueba.");

    expect(mockedPrisma.shiftAlert.updateMany).toHaveBeenCalledWith({
      where: { workShiftId: "shift-1", type: "POSIBLE_OLVIDO_SALIDA", status: "PENDIENTE" },
      data: expect.objectContaining({ status: "RESUELTA", resolutionNote: "Resuelta automáticamente: prueba." }),
    });
  });

  it("es un no-op seguro si no había ninguna alerta pendiente para esa jornada", async () => {
    mockedPrisma.shiftAlert.updateMany.mockResolvedValue({ count: 0 });

    await expect(resolveOpenShiftOverflowAlert("shift-sin-alertas", "nota")).resolves.toBeUndefined();
  });

  it("evaluateShiftExit (salida real registrada) resuelve automáticamente una alerta POSIBLE_OLVIDO_SALIDA previa de esa misma jornada", async () => {
    mockedPrisma.workShift.findUnique.mockResolvedValue({
      id: "shift-1",
      startAt: new Date("2026-08-18T10:00:00.000Z"),
      shiftTemplateId: null,
      totalMinutes: 400,
    });
    mockedPrisma.shiftAlert.updateMany.mockResolvedValue({ count: 1 });

    await evaluateShiftExit("employee-1", "shift-1", new Date("2026-08-18T18:00:00.000Z"));

    expect(mockedPrisma.shiftAlert.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workShiftId: "shift-1", type: "POSIBLE_OLVIDO_SALIDA", status: "PENDIENTE" } }),
    );
  });
});

// Etapa 8J: matchShiftForEmployee ahora filtra "turnos propios" por
// vigencia/weekdays (ver workShiftEvaluation.service.ts). Estos tests
// confirman que esa nueva capa interactúa bien con la lógica de régimen
// laboral ya existente en este runner, que NO se tocó: la clasificación
// ENABLED/DISABLED_FOR_EMPLOYEE/GENERAL_UNASSIGNED/NO_MATCH sigue siendo lo
// único que le importa a isOutOfShiftAlertSuppressed.
describe("Caso F — régimen laboral + vigencia/weekdays de la asignación (Etapa 8J)", () => {
  // 2026-08-18T23:00:00.000Z = martes 20:00 hora Argentina — lejos de
  // cualquier ventana de tolerancia de disabledTemplate (07:00-15:00), para
  // que no matchee por el camino general y quede en NO_MATCH real.
  const tuesdayFarFromShift = new Date("2026-08-18T23:00:00.000Z");
  const mondayOnlyAssignment = {
    shiftTemplateId: "t1",
    status: "HABILITADO",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    weekdays: [1], // solo lunes
  };

  it("asignación que no aplica hoy (weekday no coincide) + régimen alertOnOutOfShift=false: no genera ruido (se sigue suprimiendo TURNO_NO_IDENTIFICADO)", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([mondayOnlyAssignment]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([disabledTemplate]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({
      workRegime: { kind: "TURNO_FLEXIBLE", alertOnOutOfShift: false },
    });

    await evaluateShiftEntry("employee-1", "shift-1", tuesdayFarFromShift);

    expect(upsertedAlertTypes()).not.toContain("TURNO_NO_IDENTIFICADO");
  });

  it("misma asignación fuera de vigencia por weekday, pero régimen TURNO_OBLIGATORIO: la alerta se mantiene (el régimen es ortogonal al filtro de vigencia)", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([mondayOnlyAssignment]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([disabledTemplate]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({
      workRegime: { kind: "TURNO_OBLIGATORIO", alertOnOutOfShift: true },
    });

    await evaluateShiftEntry("employee-1", "shift-1", tuesdayFarFromShift);

    expect(upsertedAlertTypes()).toContain("TURNO_NO_IDENTIFICADO");
  });

  it("sin régimen vigente, el filtro de weekday se sigue aplicando igual (comportamiento por defecto, sin excepciones)", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([mondayOnlyAssignment]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([disabledTemplate]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

    await evaluateShiftEntry("employee-1", "shift-1", tuesdayFarFromShift);

    expect(upsertedAlertTypes()).toContain("TURNO_NO_IDENTIFICADO");
  });

  it("Etapa 8K — asignación DESHABILITADO que no aplica hoy por weekday, con la fichada cerca del horario general del mismo turno, bajo régimen alertOnOutOfShift=false: no genera ruido (POSSIBLE_SHIFT_CONFIGURATION_MISSING ahora también es suprimible)", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ ...mondayOnlyAssignment, status: "DESHABILITADO" }]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([disabledTemplate]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({
      workRegime: { kind: "TURNO_FLEXIBLE", alertOnOutOfShift: false },
    });

    // 07:05 hora Argentina = 10:05 UTC, dentro de la tolerancia general de
    // disabledTemplate (07:00 ± 10min) — la asignación DESHABILITADO no
    // aplica un martes (weekdays: [1]), así que esto cae en GENERAL_UNASSIGNED.
    // Antes de la corrección de la Etapa 8K, este caso SÍ generaba la alerta
    // (confirmado corriendo este mismo test contra el código previo) — era
    // exactamente el ruido documentado como riesgo pendiente en la Etapa 8J.
    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T10:05:00.000Z"));

    expect(upsertedAlertTypes()).not.toContain("POSSIBLE_SHIFT_CONFIGURATION_MISSING");
  });

  it("weekdays vacío en la asignación (comportamiento anterior): matchea igual un martes, sin generar TURNO_NO_IDENTIFICADO ni SHIFT_NOT_ENABLED_FOR_EMPLOYEE", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([
      { shiftTemplateId: "t1", status: "HABILITADO", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null, weekdays: [] },
    ]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([disabledTemplate]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

    // 07:05 hora Argentina = 10:05 UTC, dentro del turno 07:00-15:00.
    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T10:05:00.000Z"));

    expect(upsertedAlertTypes()).not.toContain("TURNO_NO_IDENTIFICADO");
    expect(upsertedAlertTypes()).not.toContain("SHIFT_NOT_ENABLED_FOR_EMPLOYEE");
  });
});

// Etapa 8K: diagnóstico + corrección puntual sobre el ruido documentado en la
// Etapa 8J. Único cambio de comportamiento: POSSIBLE_SHIFT_CONFIGURATION_MISSING
// pasa a ser suprimible por alertOnOutOfShift=false (ver SUPPRESSIBLE_OUT_OF_SHIFT_ALERTS
// en workShiftEvaluationRunner.ts). Todo lo demás en este bloque documenta
// comportamiento que ya era correcto y no cambió.
describe("Etapa 8K — régimen laboral y las 3 alertas de falta/configuración de turno", () => {
  // 07:05 ART = 10:05 UTC, dentro de la tolerancia general de disabledTemplate (07:00 ±10min).
  const withinGeneralTolerance = new Date("2026-08-18T10:05:00.000Z");
  // 20:00 ART = 23:00 UTC del mismo martes, lejos de cualquier tolerancia -> NO_MATCH real.
  const farFromAnyShift = new Date("2026-08-18T23:00:00.000Z");

  describe("A. Régimen laboral y supresión", () => {
    it("alertOnOutOfShift=false suprime TURNO_NO_IDENTIFICADO (sin ningún turno ni asignación)", async () => {
      mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]);
      mockedPrisma.shiftTemplate.findMany.mockResolvedValue([]);
      mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({ workRegime: { kind: "SIN_TURNO", alertOnOutOfShift: false } });

      await evaluateShiftEntry("employee-1", "shift-1", farFromAnyShift);

      expect(upsertedAlertTypes()).not.toContain("TURNO_NO_IDENTIFICADO");
    });

    it("alertOnOutOfShift=false suprime SHIFT_NOT_ENABLED_FOR_EMPLOYEE (asignación deshabilitada aplicable)", async () => {
      mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ shiftTemplateId: "t1", status: "DESHABILITADO" }]);
      mockedPrisma.shiftTemplate.findMany.mockResolvedValue([disabledTemplate]);
      mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({ workRegime: { kind: "TURNO_FLEXIBLE", alertOnOutOfShift: false } });

      await evaluateShiftEntry("employee-1", "shift-1", withinGeneralTolerance);

      expect(upsertedAlertTypes()).not.toContain("SHIFT_NOT_ENABLED_FOR_EMPLOYEE");
    });

    it("alertOnOutOfShift=false suprime POSSIBLE_SHIFT_CONFIGURATION_MISSING (turno general, sin asignación)", async () => {
      mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]);
      mockedPrisma.shiftTemplate.findMany.mockResolvedValue([disabledTemplate]);
      mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({ workRegime: { kind: "TURNO_FLEXIBLE", alertOnOutOfShift: false } });

      await evaluateShiftEntry("employee-1", "shift-1", withinGeneralTolerance);

      expect(upsertedAlertTypes()).not.toContain("POSSIBLE_SHIFT_CONFIGURATION_MISSING");
    });

    it("alertOnOutOfShift=true permite las 3 alertas de falta/configuración de turno cuando corresponden", async () => {
      mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]);
      mockedPrisma.shiftTemplate.findMany.mockResolvedValue([disabledTemplate]);
      mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({ workRegime: { kind: "TURNO_OBLIGATORIO", alertOnOutOfShift: true } });

      await evaluateShiftEntry("employee-1", "shift-1", withinGeneralTolerance);

      expect(upsertedAlertTypes()).toContain("POSSIBLE_SHIFT_CONFIGURATION_MISSING");
    });

    it("sin régimen laboral vigente, ninguna de las 3 se suprime (comportamiento por defecto, sin cambios)", async () => {
      mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]);
      mockedPrisma.shiftTemplate.findMany.mockResolvedValue([disabledTemplate]);
      mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

      await evaluateShiftEntry("employee-1", "shift-1", withinGeneralTolerance);

      expect(upsertedAlertTypes()).toContain("POSSIBLE_SHIFT_CONFIGURATION_MISSING");
    });
  });

  describe("B. POSSIBLE_SHIFT_CONFIGURATION_MISSING", () => {
    it("se genera si hay un turno general compatible sin ninguna asignación y el régimen exige alerta", async () => {
      mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]);
      mockedPrisma.shiftTemplate.findMany.mockResolvedValue([disabledTemplate]);
      mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({ workRegime: { kind: "TURNO_OBLIGATORIO", alertOnOutOfShift: true } });

      await evaluateShiftEntry("employee-1", "shift-1", withinGeneralTolerance);

      expect(upsertedAlertTypes()).toContain("POSSIBLE_SHIFT_CONFIGURATION_MISSING");
    });

    it("no se duplica si ya existe una alerta activa para la misma jornada (mismo upsert key [workShiftId, type])", async () => {
      mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]);
      mockedPrisma.shiftTemplate.findMany.mockResolvedValue([disabledTemplate]);
      mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

      await evaluateShiftEntry("employee-1", "shift-1", withinGeneralTolerance);
      await evaluateShiftEntry("employee-1", "shift-1", withinGeneralTolerance);

      const calls = mockedPrisma.shiftAlert.upsert.mock.calls.filter((call) => call[0]?.create?.type === "POSSIBLE_SHIFT_CONFIGURATION_MISSING");
      expect(calls).toHaveLength(2); // dos evaluaciones -> dos upserts...
      expect(calls[0]![0].where).toEqual(calls[1]![0].where); // ...pero contra la misma fila (mismo where), no una nueva cada vez
    });
  });

  describe("C. SHIFT_NOT_ENABLED_FOR_EMPLOYEE", () => {
    it("se genera si hay una asignación deshabilitada que sí aplica hoy, y el régimen exige alerta", async () => {
      mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ shiftTemplateId: "t1", status: "DESHABILITADO" }]); // sin weekdays -> aplica siempre
      mockedPrisma.shiftTemplate.findMany.mockResolvedValue([disabledTemplate]);
      mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({ workRegime: { kind: "TURNO_OBLIGATORIO", alertOnOutOfShift: true } });

      await evaluateShiftEntry("employee-1", "shift-1", withinGeneralTolerance);

      expect(upsertedAlertTypes()).toContain("SHIFT_NOT_ENABLED_FOR_EMPLOYEE");
    });

    it("no se genera si la asignación deshabilitada no aplica hoy por weekday (cae fuera de todo turno propio)", async () => {
      mockedPrisma.shiftAssignment.findMany.mockResolvedValue([
        { shiftTemplateId: "t1", status: "DESHABILITADO", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null, weekdays: [1] },
      ]);
      mockedPrisma.shiftTemplate.findMany.mockResolvedValue([disabledTemplate]);
      mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({ workRegime: { kind: "TURNO_OBLIGATORIO", alertOnOutOfShift: true } });

      await evaluateShiftEntry("employee-1", "shift-1", farFromAnyShift); // martes, lejos de todo horario

      expect(upsertedAlertTypes()).not.toContain("SHIFT_NOT_ENABLED_FOR_EMPLOYEE");
    });

    it("no se genera si la asignación deshabilitada está vencida (effectiveTo pasado)", async () => {
      mockedPrisma.shiftAssignment.findMany.mockResolvedValue([
        { shiftTemplateId: "t1", status: "DESHABILITADO", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: new Date("2026-06-30T00:00:00.000Z"), weekdays: [] },
      ]);
      mockedPrisma.shiftTemplate.findMany.mockResolvedValue([disabledTemplate]);
      mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({ workRegime: { kind: "TURNO_OBLIGATORIO", alertOnOutOfShift: true } });

      await evaluateShiftEntry("employee-1", "shift-1", withinGeneralTolerance); // 2026-08-18, posterior a effectiveTo

      expect(upsertedAlertTypes()).not.toContain("SHIFT_NOT_ENABLED_FOR_EMPLOYEE");
      // al no contar como "propia", cae en el camino general (POSSIBLE_SHIFT_CONFIGURATION_MISSING), no en NO_MATCH.
      expect(upsertedAlertTypes()).toContain("POSSIBLE_SHIFT_CONFIGURATION_MISSING");
    });

    it("no se genera si la asignación deshabilitada todavía no comenzó (effectiveFrom futuro)", async () => {
      mockedPrisma.shiftAssignment.findMany.mockResolvedValue([
        { shiftTemplateId: "t1", status: "DESHABILITADO", effectiveFrom: new Date("2026-09-01T00:00:00.000Z"), effectiveTo: null, weekdays: [] },
      ]);
      mockedPrisma.shiftTemplate.findMany.mockResolvedValue([disabledTemplate]);
      mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({ workRegime: { kind: "TURNO_OBLIGATORIO", alertOnOutOfShift: true } });

      await evaluateShiftEntry("employee-1", "shift-1", withinGeneralTolerance); // 2026-08-18, anterior a effectiveFrom

      expect(upsertedAlertTypes()).not.toContain("SHIFT_NOT_ENABLED_FOR_EMPLOYEE");
    });
  });

  describe("D. TURNO_NO_IDENTIFICADO", () => {
    it("se genera cuando no hay ningún turno compatible y el régimen exige alerta", async () => {
      mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]);
      mockedPrisma.shiftTemplate.findMany.mockResolvedValue([]);
      mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({ workRegime: { kind: "TURNO_OBLIGATORIO", alertOnOutOfShift: true } });

      await evaluateShiftEntry("employee-1", "shift-1", farFromAnyShift);

      expect(upsertedAlertTypes()).toContain("TURNO_NO_IDENTIFICADO");
    });

    it("se suprime cuando el régimen no alerta fuera de turno", async () => {
      mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]);
      mockedPrisma.shiftTemplate.findMany.mockResolvedValue([]);
      mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({ workRegime: { kind: "SIN_TURNO", alertOnOutOfShift: false } });

      await evaluateShiftEntry("employee-1", "shift-1", farFromAnyShift);

      expect(upsertedAlertTypes()).not.toContain("TURNO_NO_IDENTIFICADO");
    });
  });

  describe("E. Backward compatibility", () => {
    it("sin régimen laboral, el caso histórico (sin turno compatible) sigue generando TURNO_NO_IDENTIFICADO", async () => {
      mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]);
      mockedPrisma.shiftTemplate.findMany.mockResolvedValue([]);
      mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

      await evaluateShiftEntry("employee-1", "shift-1", farFromAnyShift);

      expect(upsertedAlertTypes()).toContain("TURNO_NO_IDENTIFICADO");
    });

    it("weekdays vacío en una asignación habilitada conserva el comportamiento anterior a la Etapa 8J/8K (matchea cualquier día)", async () => {
      mockedPrisma.shiftAssignment.findMany.mockResolvedValue([
        { shiftTemplateId: "t1", status: "HABILITADO", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null, weekdays: [] },
      ]);
      mockedPrisma.shiftTemplate.findMany.mockResolvedValue([disabledTemplate]);
      mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

      await evaluateShiftEntry("employee-1", "shift-1", withinGeneralTolerance);

      expect(upsertedAlertTypes()).not.toContain("TURNO_NO_IDENTIFICADO");
      expect(upsertedAlertTypes()).not.toContain("SHIFT_NOT_ENABLED_FOR_EMPLOYEE");
      expect(upsertedAlertTypes()).not.toContain("POSSIBLE_SHIFT_CONFIGURATION_MISSING");
    });
  });

  describe("F. No regresión", () => {
    it("alertOnOutOfShift=false no suprime SALIDA_ANTICIPADA/JORNADA_EXTENDIDA (alertas críticas ortogonales al turno)", async () => {
      mockedPrisma.workShift.findUnique.mockResolvedValue({
        id: "shift-1",
        startAt: new Date("2026-08-18T10:00:00.000Z"),
        shiftTemplateId: "t1",
        totalMinutes: 500,
      });
      mockedPrisma.shiftTemplate.findUnique.mockResolvedValue(disabledTemplate);
      mockedPrisma.shiftAssignment.findUnique.mockResolvedValue({ status: "HABILITADO" });

      await evaluateShiftExit("employee-1", "shift-1", new Date("2026-08-18T18:30:00.000Z"));

      expect(upsertedAlertTypes()).toContain("JORNADA_EXTENDIDA");
    });

    it("las alertas de clasificación de conceptos horarios no dependen del régimen ni de isOutOfShiftAlertSuppressed (no reciben régimen como parámetro)", async () => {
      await notifyClassificationAlerts("employee-1", "shift-1", [
        { startAt: new Date("2026-08-18T00:00:00.000Z"), minutes: 180, conceptStatus: "CONCEPTO_NO_HABILITADO" },
      ]);

      expect(upsertedAlertTypes()).toContain("CONCEPTO_NO_HABILITADO");
      expect(mockedPrisma.employeeWorkRegime.findFirst).not.toHaveBeenCalled();
    });
  });
});

describe("Etapa 10C — turno nocturno/sereno (cruce de medianoche), diagnóstico de JORNADA_EXTENDIDA", () => {
  it("entrada 23:05 matchea el turno sereno propio, sin ninguna alerta de turno", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ shiftTemplateId: "sereno", status: "HABILITADO" }]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([nightTemplate]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T02:05:00.000Z")); // 23:05 ART

    expect(upsertedAlertTypes()).not.toContain("TURNO_NO_IDENTIFICADO");
    expect(upsertedAlertTypes()).not.toContain("INGRESO_TARDE");
  });

  it("salida real en horario (04:00 del día siguiente, cruzando medianoche) no genera ninguna alerta de puntualidad ni jornada extendida — nunca confunde el cruce de medianoche con salida anticipada/tardía", async () => {
    mockedPrisma.workShift.findUnique.mockResolvedValue({
      id: "shift-sereno-1",
      startAt: new Date("2026-08-18T02:05:00.000Z"), // 23:05 ART del 17/08
      shiftTemplateId: "sereno",
      totalMinutes: 295, // dentro del máximo informativo (300)
    });
    mockedPrisma.shiftTemplate.findUnique.mockResolvedValue(nightTemplate);
    mockedPrisma.shiftAssignment.findUnique.mockResolvedValue({ status: "HABILITADO" });

    await evaluateShiftExit("employee-1", "shift-sereno-1", new Date("2026-08-18T07:00:00.000Z")); // 04:00 ART del 18/08

    expect(upsertedAlertTypes()).not.toContain("SALIDA_ANTICIPADA");
    expect(upsertedAlertTypes()).not.toContain("SALIDA_TARDIA");
    expect(upsertedAlertTypes()).not.toContain("JORNADA_EXTENDIDA");
  });

  it("jornada nocturna que se extiende real y de verdad (salida confirmada, más tarde de lo esperado) genera JORNADA_EXTENDIDA — nunca POSIBLE_OLVIDO_SALIDA, porque hay una salida real registrada", async () => {
    mockedPrisma.workShift.findUnique.mockResolvedValue({
      id: "shift-sereno-2",
      startAt: new Date("2026-08-18T02:05:00.000Z"), // 23:05 ART
      shiftTemplateId: "sereno",
      totalMinutes: 360, // 6h > maximumInformativeMinutes (300 = 5h) del turno sereno
    });
    mockedPrisma.shiftTemplate.findUnique.mockResolvedValue(nightTemplate);
    mockedPrisma.shiftAssignment.findUnique.mockResolvedValue({ status: "HABILITADO" });

    // Sale 05:10 ART del 18/08 — real, confirmada por el empleado (no una expiración del sistema).
    await evaluateShiftExit("employee-1", "shift-sereno-2", new Date("2026-08-18T08:10:00.000Z"));

    expect(upsertedAlertTypes()).toContain("JORNADA_EXTENDIDA");
    expect(upsertedAlertTypes()).not.toContain("POSIBLE_OLVIDO_SALIDA");
  });

  it("una salida real siempre resuelve cualquier POSIBLE_OLVIDO_SALIDA previa de esa jornada, incluso en turno nocturno — el aviso temprano de riesgo deja de tener sentido una vez que hay salida confirmada", async () => {
    mockedPrisma.workShift.findUnique.mockResolvedValue({
      id: "shift-sereno-3",
      startAt: new Date("2026-08-18T02:05:00.000Z"),
      shiftTemplateId: "sereno",
      totalMinutes: 250,
    });
    mockedPrisma.shiftTemplate.findUnique.mockResolvedValue(nightTemplate);
    mockedPrisma.shiftAssignment.findUnique.mockResolvedValue({ status: "HABILITADO" });

    await evaluateShiftExit("employee-1", "shift-sereno-3", new Date("2026-08-18T07:15:00.000Z"));

    expect(mockedPrisma.shiftAlert.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workShiftId: "shift-sereno-3", type: "POSIBLE_OLVIDO_SALIDA", status: "PENDIENTE" } }),
    );
  });
});

describe("Etapa 10D — evaluateShiftExit consulta el régimen para ajustar el umbral de JORNADA_EXTENDIDA", () => {
  it("turno nocturno (cruza medianoche) + régimen con umbral mayor evita la alerta de jornada extendida", async () => {
    mockedPrisma.workShift.findUnique.mockResolvedValue({
      id: "shift-sereno-10d",
      startAt: new Date("2026-08-18T02:05:00.000Z"), // 23:05 ART del 17/08
      shiftTemplateId: "sereno",
      totalMinutes: 360, // 6h > maximumInformativeMinutes del turno sereno (300) — con turno solo, generaría JORNADA_EXTENDIDA
    });
    mockedPrisma.shiftTemplate.findUnique.mockResolvedValue(nightTemplate);
    mockedPrisma.shiftAssignment.findUnique.mockResolvedValue({ status: "HABILITADO" });
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({
      workRegime: { kind: "TURNO_FLEXIBLE", alertOnOutOfShift: true, openShiftOverflowAction: "ROLLOVER", extendedShiftAlertMinutes: 900 },
    });

    await evaluateShiftExit("employee-1", "shift-sereno-10d", new Date("2026-08-18T08:10:00.000Z"));

    expect(upsertedAlertTypes()).not.toContain("JORNADA_EXTENDIDA");
  });

  it("turno nocturno + régimen con umbral menor genera la alerta antes de lo que el turno solo hubiera generado", async () => {
    mockedPrisma.workShift.findUnique.mockResolvedValue({
      id: "shift-sereno-11d",
      startAt: new Date("2026-08-18T02:05:00.000Z"),
      shiftTemplateId: "sereno",
      totalMinutes: 200, // < maximumInformativeMinutes del turno (300) — con turno solo, NO generaría JORNADA_EXTENDIDA
    });
    mockedPrisma.shiftTemplate.findUnique.mockResolvedValue(nightTemplate);
    mockedPrisma.shiftAssignment.findUnique.mockResolvedValue({ status: "HABILITADO" });
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({
      workRegime: { kind: "TURNO_OBLIGATORIO", alertOnOutOfShift: true, openShiftOverflowAction: "ROLLOVER", extendedShiftAlertMinutes: 120 },
    });

    await evaluateShiftExit("employee-1", "shift-sereno-11d", new Date("2026-08-18T05:25:00.000Z"));

    expect(upsertedAlertTypes()).toContain("JORNADA_EXTENDIDA");
  });

  it("régimen sin extendedShiftAlertMinutes (null) no altera el umbral del turno — mismo comportamiento que antes de 10D", async () => {
    mockedPrisma.workShift.findUnique.mockResolvedValue({
      id: "shift-1",
      startAt: new Date("2026-08-18T10:00:00.000Z"),
      shiftTemplateId: "t1",
      totalMinutes: 500, // > maximumInformativeMinutes de disabledTemplate (60)
    });
    mockedPrisma.shiftTemplate.findUnique.mockResolvedValue(disabledTemplate);
    mockedPrisma.shiftAssignment.findUnique.mockResolvedValue({ status: "HABILITADO" });
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({
      workRegime: { kind: "TURNO_OBLIGATORIO", alertOnOutOfShift: true, openShiftOverflowAction: "ROLLOVER", extendedShiftAlertMinutes: null },
    });

    await evaluateShiftExit("employee-1", "shift-1", new Date("2026-08-18T18:30:00.000Z"));

    expect(upsertedAlertTypes()).toContain("JORNADA_EXTENDIDA");
  });

  it("JORNADA_EXTENDIDA (con o sin régimen) nunca modifica horas reales — ninguna llamada a workShift.update con datos de horas", async () => {
    mockedPrisma.workShift.findUnique.mockResolvedValue({
      id: "shift-sereno-12d",
      startAt: new Date("2026-08-18T02:05:00.000Z"),
      shiftTemplateId: "sereno",
      totalMinutes: 360,
    });
    mockedPrisma.shiftTemplate.findUnique.mockResolvedValue(nightTemplate);
    mockedPrisma.shiftAssignment.findUnique.mockResolvedValue({ status: "HABILITADO" });
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({
      workRegime: { kind: "TURNO_OBLIGATORIO", alertOnOutOfShift: true, openShiftOverflowAction: "ROLLOVER", extendedShiftAlertMinutes: 120 },
    });

    await evaluateShiftExit("employee-1", "shift-sereno-12d", new Date("2026-08-18T08:10:00.000Z"));

    expect(upsertedAlertTypes()).toContain("JORNADA_EXTENDIDA");
    // El único método que este runner usa para persistir algo sobre la
    // jornada es workShift.update, y sólo lo llama evaluateShiftEntry para
    // adjuntar el turno matcheado (shiftTemplateId/maxAllowedMinutes) — nunca
    // con hours/totalMinutes. evaluateShiftExit no lo llama en absoluto.
    expect(mockedPrisma.workShift.update).not.toHaveBeenCalled();
  });

  it("POSIBLE_OLVIDO_SALIDA sigue completamente separado del nuevo umbral de régimen — el parámetro no se lee en el camino de jornada abierta", async () => {
    mockedPrisma.workShift.findUnique.mockResolvedValue({
      id: "shift-sereno-13d",
      startAt: new Date("2026-08-18T02:05:00.000Z"),
      shiftTemplateId: "sereno",
      totalMinutes: 250, // dentro del umbral (300) del turno, sin régimen que lo ajuste
    });
    mockedPrisma.shiftTemplate.findUnique.mockResolvedValue(nightTemplate);
    mockedPrisma.shiftAssignment.findUnique.mockResolvedValue({ status: "HABILITADO" });
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({
      workRegime: { kind: "TURNO_OBLIGATORIO", alertOnOutOfShift: true, openShiftOverflowAction: "ROLLOVER", extendedShiftAlertMinutes: 30 },
    });

    await evaluateShiftExit("employee-1", "shift-sereno-13d", new Date("2026-08-18T07:15:00.000Z"));

    // El régimen con extendedShiftAlertMinutes=30 sí dispara JORNADA_EXTENDIDA (250 > 30)...
    expect(upsertedAlertTypes()).toContain("JORNADA_EXTENDIDA");
    // ...pero nunca POSIBLE_OLVIDO_SALIDA — son alertas completamente
    // independientes, el umbral de régimen de esta etapa no participa en
    // absoluto en evaluateOpenShiftRisk (jornada abierta).
    expect(upsertedAlertTypes()).not.toContain("POSIBLE_OLVIDO_SALIDA");
  });
});

describe("createShiftAlert — Etapa 10E (la notificación es best-effort, nunca bloquea la fichada/alerta real)", () => {
  it("si notifyUsers falla, la alerta igual se crea/actualiza y se devuelve normalmente (no propaga la excepción)", async () => {
    mockedPrisma.shiftAlert.upsert.mockResolvedValue({ id: "alert-1" });
    vi.mocked(notifyUsers).mockRejectedValueOnce(new Error("db hiccup"));

    const alert = await createShiftAlert({ employeeId: "employee-1", workShiftId: "shift-1", type: "INGRESO_TARDE", actualAt: new Date("2026-08-18T10:00:00.000Z") });

    expect(alert).toEqual({ id: "alert-1" });
    expect(mockedPrisma.shiftAlert.upsert).toHaveBeenCalledTimes(1);
  });

  it("un fallo de notificación no impide que el llamador (evaluateShiftEntry) siga funcionando normalmente", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);
    mockedPrisma.shiftAlert.upsert.mockResolvedValue({ id: "alert-1" });
    vi.mocked(notifyUsers).mockRejectedValueOnce(new Error("db hiccup"));

    await expect(evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T10:00:00.000Z"))).resolves.toBeUndefined();

    expect(upsertedAlertTypes()).toContain("TURNO_NO_IDENTIFICADO");
  });
});
