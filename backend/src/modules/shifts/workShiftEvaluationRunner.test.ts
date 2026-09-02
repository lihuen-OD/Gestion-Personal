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
    employeeHourConcept: { findFirst: vi.fn() },
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
  employeeHourConcept: { findFirst: Mock };
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
  // Etapa 13D: default = el empleado SÍ tiene un concepto adicional
  // habilitado, para preservar el comportamiento de todos los tests
  // preexistentes que no son sobre esta dimensión. Los tests de la Etapa
  // 13D que sí prueban "sin conceptos adicionales" lo sobreescriben con null.
  mockedPrisma.employeeHourConcept.findFirst.mockResolvedValue({ employeeId: "employee-1" });
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

    // Etapa 13E.1: renombrado -- ya no hay "turno general, sin asignación"
    // como concepto (esa búsqueda se eliminó). Con withinGeneralTolerance y
    // sin ninguna asignación propia, el resultado es NO_MATCH -> el tipo que
    // corresponde suprimir acá es TURNO_NO_IDENTIFICADO, no
    // POSSIBLE_SHIFT_CONFIGURATION_MISSING (que ya nunca se genera).
    it("alertOnOutOfShift=false suprime TURNO_NO_IDENTIFICADO aunque exista un turno ajeno en el sistema con esa hora (ya no se compara contra él)", async () => {
      mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]);
      mockedPrisma.shiftTemplate.findMany.mockResolvedValue([disabledTemplate]);
      mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({ workRegime: { kind: "TURNO_FLEXIBLE", alertOnOutOfShift: false } });

      await evaluateShiftEntry("employee-1", "shift-1", withinGeneralTolerance);

      expect(upsertedAlertTypes()).not.toContain("POSSIBLE_SHIFT_CONFIGURATION_MISSING");
      expect(upsertedAlertTypes()).not.toContain("TURNO_NO_IDENTIFICADO");
    });

    it("alertOnOutOfShift=true genera TURNO_NO_IDENTIFICADO cuando corresponde -- nunca POSSIBLE_SHIFT_CONFIGURATION_MISSING (Etapa 13E.1)", async () => {
      mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]);
      mockedPrisma.shiftTemplate.findMany.mockResolvedValue([disabledTemplate]);
      mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({ workRegime: { kind: "TURNO_OBLIGATORIO", alertOnOutOfShift: true } });

      await evaluateShiftEntry("employee-1", "shift-1", withinGeneralTolerance);

      expect(upsertedAlertTypes()).toContain("TURNO_NO_IDENTIFICADO");
      expect(upsertedAlertTypes()).not.toContain("POSSIBLE_SHIFT_CONFIGURATION_MISSING");
    });

    it("sin régimen laboral vigente, TURNO_NO_IDENTIFICADO no se suprime (comportamiento por defecto, sin cambios) -- POSSIBLE_SHIFT_CONFIGURATION_MISSING nunca aparece (Etapa 13E.1)", async () => {
      mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]);
      mockedPrisma.shiftTemplate.findMany.mockResolvedValue([disabledTemplate]);
      mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

      await evaluateShiftEntry("employee-1", "shift-1", withinGeneralTolerance);

      expect(upsertedAlertTypes()).toContain("TURNO_NO_IDENTIFICADO");
      expect(upsertedAlertTypes()).not.toContain("POSSIBLE_SHIFT_CONFIGURATION_MISSING");
    });
  });

  // Etapa 13E.1 (docs/decisions/SHIFT_CONFIGURATION_ALERT_POLICY_13E.md):
  // este describe documentaba el comportamiento ANTERIOR (turno general
  // compatible -> POSSIBLE_SHIFT_CONFIGURATION_MISSING). Se reescribe para
  // documentar y probar la regla nueva: esa comparación se eliminó, el tipo
  // ya no tiene ningún caso funcional que lo dispare. El test de dedup por
  // upsert que vivía acá se quitó -- probaba el mecanismo genérico de
  // dedup (createShiftAlert.upsert por [workShiftId, type]) contra un
  // escenario que ya no ocurre; ese mecanismo genérico sigue cubierto por
  // otros tipos (ver "no genera alertas duplicadas" en el describe de 13A).
  describe("B. POSSIBLE_SHIFT_CONFIGURATION_MISSING (Etapa 13E.1 — ya no tiene ningún caso funcional real)", () => {
    it("ya NO se genera aunque exista un turno general compatible por hora y ninguna asignación propia (Regla 6 del pedido 13E.1)", async () => {
      mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]);
      mockedPrisma.shiftTemplate.findMany.mockResolvedValue([disabledTemplate]);
      mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({ workRegime: { kind: "TURNO_OBLIGATORIO", alertOnOutOfShift: true } });

      await evaluateShiftEntry("employee-1", "shift-1", withinGeneralTolerance);

      expect(upsertedAlertTypes()).not.toContain("POSSIBLE_SHIFT_CONFIGURATION_MISSING");
      expect(upsertedAlertTypes()).toContain("TURNO_NO_IDENTIFICADO"); // cae directo a NO_MATCH, sin paso intermedio
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
      // Etapa 13E.1: al no contar como "propia", ya no cae en un camino
      // general contra el turno ajeno (disabledTemplate) -- cae directo a
      // NO_MATCH -> TURNO_NO_IDENTIFICADO. Antes de esta etapa daba
      // POSSIBLE_SHIFT_CONFIGURATION_MISSING sobre disabledTemplate.
      expect(upsertedAlertTypes()).toContain("TURNO_NO_IDENTIFICADO");
      expect(upsertedAlertTypes()).not.toContain("POSSIBLE_SHIFT_CONFIGURATION_MISSING");
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

// Etapa 13B (docs/decisions/SHIFT_EXIT_CLASSIFICATION_13B.md): cierre,
// clasificación y alertas duplicadas de una SALIDA con ingreso abierto.
describe("evaluateShiftExit — Etapa 13B (clasificación de salida, política de alertas duplicadas, robustez)", () => {
  const shiftWithMinimum = {
    id: "min-shift",
    code: "MIN-SHIFT",
    startTime: "08:00",
    endTime: "16:00",
    crossesMidnight: false,
    entryToleranceBeforeMinutes: 10,
    entryToleranceAfterMinutes: 10,
    exitToleranceBeforeMinutes: 15,
    exitToleranceAfterMinutes: 15,
    minimumMinutesForCompliance: 420, // 7h
    maximumInformativeMinutes: 540, // 9h
    missingOutAlertAfterMinutes: null,
    absoluteOpenShiftLimitMinutes: 1200,
    status: "ACTIVO",
  };

  function mockWorkShift(overrides: Partial<{ startAt: Date; shiftTemplateId: string | null; totalMinutes: number }>) {
    mockedPrisma.workShift.findUnique.mockResolvedValue({
      id: "shift-13b",
      startAt: new Date("2026-08-18T11:00:00.000Z"), // 08:00 ART
      shiftTemplateId: "min-shift",
      totalMinutes: 480,
      ...overrides,
    });
  }

  function notifiedTitles(): string[] {
    return vi.mocked(notifyUsers).mock.calls.map((call) => call[1]?.title);
  }

  beforeEach(() => {
    mockedPrisma.shiftTemplate.findUnique.mockResolvedValue(shiftWithMinimum);
    mockedPrisma.shiftAssignment.findUnique.mockResolvedValue({ status: "HABILITADO" });
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);
  });

  it("Caso 1 del pedido: salida normal (dentro de tolerancia, dentro del mínimo) no genera ninguna alerta", async () => {
    mockWorkShift({ totalMinutes: 480 }); // 08:00-16:00 exacto, 8h

    await evaluateShiftExit("employee-1", "shift-13b", new Date("2026-08-18T19:00:00.000Z")); // 16:00 ART

    expect(upsertedAlertTypes()).toHaveLength(0);
  });

  it("Caso 2 del pedido: salida anticipada, dentro del mínimo -> sólo SALIDA_ANTICIPADA, sin ruido adicional", async () => {
    mockWorkShift({ totalMinutes: 450 }); // 08:00-15:30, 7.5h (>= mínimo 420)

    await evaluateShiftExit("employee-1", "shift-13b", new Date("2026-08-18T18:30:00.000Z")); // 15:30 ART, 30 min antes

    expect(upsertedAlertTypes()).toEqual(["SALIDA_ANTICIPADA"]);
    expect(notifiedTitles()).toEqual(["Salida anticipada"]);
  });

  it("Caso 3 del pedido: salida anticipada + jornada por debajo del mínimo -> ambas se persisten, pero sólo notifica SALIDA_ANTICIPADA (JORNADA_INSUFICIENTE queda como detalle sin aviso duplicado)", async () => {
    mockWorkShift({ totalMinutes: 300 }); // 08:00-13:00, 5h (< mínimo 420)

    await evaluateShiftExit("employee-1", "shift-13b", new Date("2026-08-18T16:00:00.000Z")); // 13:00 ART, 3h antes

    expect(upsertedAlertTypes()).toEqual(expect.arrayContaining(["SALIDA_ANTICIPADA", "JORNADA_INSUFICIENTE"]));
    expect(upsertedAlertTypes()).toHaveLength(2);
    // Ambas ShiftAlert quedan registradas (no se oculta el problema), pero
    // sólo la de mayor prioridad dispara SystemNotification.
    expect(notifiedTitles()).toEqual(["Salida anticipada"]);
    expect(notifiedTitles()).not.toContain("Jornada por debajo del mínimo");
  });

  it("jornada por debajo del mínimo SIN salida anticipada (ej. ingreso tardío, salida puntual) sí notifica -- no queda permanentemente silenciada", async () => {
    mockWorkShift({ startAt: new Date("2026-08-18T12:30:00.000Z"), totalMinutes: 390 }); // ingreso 09:30 ART, salida puntual 16:00 ART, 6.5h

    await evaluateShiftExit("employee-1", "shift-13b", new Date("2026-08-18T19:00:00.000Z")); // 16:00 ART, en horario exacto

    expect(upsertedAlertTypes()).toEqual(["JORNADA_INSUFICIENTE"]);
    expect(notifiedTitles()).toEqual(["Jornada por debajo del mínimo"]);
  });

  it("Caso 4 del pedido: salida anticipada + tramo sin concepto compatible -> se persiste el tramo, pero no duplica el aviso (subordinado a SALIDA_ANTICIPADA)", async () => {
    mockWorkShift({ totalMinutes: 450 }); // 7.5h, por sobre el mínimo -> sólo SALIDA_ANTICIPADA es la explicación primaria

    await evaluateShiftExit("employee-1", "shift-13b", new Date("2026-08-18T18:30:00.000Z"), [
      { startAt: new Date("2026-08-18T18:00:00.000Z"), minutes: 30, conceptStatus: "SIN_CONCEPTO_COMPATIBLE" },
    ]);

    expect(upsertedAlertTypes()).toEqual(expect.arrayContaining(["SALIDA_ANTICIPADA", "SEGMENTO_SIN_CLASIFICAR"]));
    expect(notifiedTitles()).toEqual(["Salida anticipada"]);
    expect(notifiedTitles()).not.toContain("Tramo de jornada sin concepto horario compatible");
  });

  it("tramo sin concepto compatible SOLO (sin salida anticipada ni jornada corta) sí notifica -- sigue siendo un problema real de configuración cuando es la única explicación", async () => {
    mockWorkShift({ totalMinutes: 480 }); // salida normal

    await evaluateShiftExit("employee-1", "shift-13b", new Date("2026-08-18T19:00:00.000Z"), [
      { startAt: new Date("2026-08-18T18:30:00.000Z"), minutes: 30, conceptStatus: "SIN_CONCEPTO_COMPATIBLE" },
    ]);

    expect(upsertedAlertTypes()).toEqual(["SEGMENTO_SIN_CLASIFICAR"]);
    expect(notifiedTitles()).toEqual(["Tramo de jornada sin concepto horario compatible"]);
  });

  it("tramo sin concepto subordinado a JORNADA_INSUFICIENTE aunque no haya salida anticipada (prioridad 2 > 3)", async () => {
    mockWorkShift({ startAt: new Date("2026-08-18T12:30:00.000Z"), totalMinutes: 390 }); // ingreso tardío, salida puntual, jornada corta sin salida anticipada

    await evaluateShiftExit("employee-1", "shift-13b", new Date("2026-08-18T19:00:00.000Z"), [
      { startAt: new Date("2026-08-18T18:30:00.000Z"), minutes: 30, conceptStatus: "SIN_CONCEPTO_COMPATIBLE" },
    ]);

    expect(upsertedAlertTypes()).toEqual(expect.arrayContaining(["JORNADA_INSUFICIENTE", "SEGMENTO_SIN_CLASIFICAR"]));
    expect(notifiedTitles()).toEqual(["Jornada por debajo del mínimo"]);
  });

  // Etapa 13G (docs/decisions/SHIFT_EXIT_SINGLE_NOTIFICATION_POLICY_13G.md):
  // redefine esta expectativa -- CONCEPTO_NO_HABILITADO ya no "nunca se
  // suprime" incondicionalmente; ahora es la de MAYOR prioridad de todas
  // (contradicción real de configuración), así que gana el único aviso
  // cuando coincide con cualquier otra alerta de salida. Sigue sin
  // suprimirse NUNCA en el sentido de la ShiftAlert (se persiste siempre) --
  // lo que cambia es que ya no dispara su propio aviso en paralelo a otro.
  it("Etapa 13G: CONCEPTO_NO_HABILITADO es la de mayor prioridad -- gana el único aviso sobre SALIDA_ANTICIPADA, ambas ShiftAlert se persisten", async () => {
    mockWorkShift({ totalMinutes: 450 }); // salida anticipada también dispara

    await evaluateShiftExit("employee-1", "shift-13b", new Date("2026-08-18T18:30:00.000Z"), [
      { startAt: new Date("2026-08-18T18:00:00.000Z"), minutes: 30, conceptStatus: "CONCEPTO_NO_HABILITADO" },
    ]);

    expect(upsertedAlertTypes()).toEqual(expect.arrayContaining(["SALIDA_ANTICIPADA", "CONCEPTO_NO_HABILITADO"]));
    expect(notifiedTitles()).toEqual(["Concepto horario detectado pero no habilitado para el empleado"]);
  });

  it("Caso 5 del pedido: la salida usa exclusivamente shift.shiftTemplateId (el turno ya resuelto en el ingreso) -- nunca busca contra todos los turnos del sistema", async () => {
    mockWorkShift({ totalMinutes: 480 });

    await evaluateShiftExit("employee-1", "shift-13b", new Date("2026-08-18T19:00:00.000Z"));

    expect(mockedPrisma.shiftTemplate.findUnique).toHaveBeenCalledWith({ where: { id: "min-shift" } });
    expect(mockedPrisma.shiftTemplate.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.shiftAssignment.findUnique).toHaveBeenCalledWith({ where: { employeeId_shiftTemplateId: { employeeId: "employee-1", shiftTemplateId: "min-shift" } } });
    expect(mockedPrisma.shiftAssignment.findMany).not.toHaveBeenCalled();
  });

  it("Caso 6/7 del pedido: sin turno (shiftTemplateId null), con régimen -> mantiene comportamiento actual, sin alertas de puntualidad/duración por debajo del default", async () => {
    mockWorkShift({ shiftTemplateId: null, totalMinutes: 300 });
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({ workRegime: { kind: "TURNO_FLEXIBLE", alertOnOutOfShift: false } });

    await evaluateShiftExit("employee-1", "shift-13b", new Date("2026-08-18T16:00:00.000Z"));

    expect(upsertedAlertTypes()).toHaveLength(0);
  });

  it("Caso 6/7 del pedido: sin turno, sin régimen -> mismo comportamiento (sin cambios respecto de antes de esta etapa)", async () => {
    mockWorkShift({ shiftTemplateId: null, totalMinutes: 300 });
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

    await evaluateShiftExit("employee-1", "shift-13b", new Date("2026-08-18T16:00:00.000Z"));

    expect(upsertedAlertTypes()).toHaveLength(0);
  });

  // Etapa 13G: redefine esta expectativa -- antes, JORNADA_EXTENDIDA y
  // SALIDA_TARDIA notificaban las dos (ninguna participaba en ninguna
  // cascada). Ahora JORNADA_EXTENDIDA tiene mayor prioridad que SALIDA_TARDIA
  // (superar el máximo es más relevante que llegar tarde a la salida) --
  // gana el único aviso; SALIDA_TARDIA se sigue persistiendo como ShiftAlert.
  it("Etapa 13G: jornada extendida + salida tardía -- ambas ShiftAlert se persisten, sólo notifica Jornada extendida", async () => {
    mockWorkShift({ totalMinutes: 600 }); // supera maximumInformativeMinutes (540)

    await evaluateShiftExit("employee-1", "shift-13b", new Date("2026-08-18T21:00:00.000Z")); // 18:00 ART

    expect(upsertedAlertTypes()).toEqual(expect.arrayContaining(["SALIDA_TARDIA", "JORNADA_EXTENDIDA"]));
    expect(notifiedTitles()).toEqual(["Jornada extendida"]);
  });

  it("Caso 9 del pedido / causa raíz del 503: un fallo creando una ShiftAlert (no sólo la notificación) no propaga la excepción -- la salida ya se guardó antes de llamar acá", async () => {
    mockWorkShift({ totalMinutes: 450 });
    mockedPrisma.shiftAlert.upsert.mockRejectedValueOnce(new Error("connection reset"));

    await expect(evaluateShiftExit("employee-1", "shift-13b", new Date("2026-08-18T18:30:00.000Z"))).resolves.toBeUndefined();
  });

  it("Caso 10 del pedido: reintentar la misma salida no duplica alertas -- upsertea la misma fila por [workShiftId, type]", async () => {
    mockWorkShift({ totalMinutes: 450 });

    await evaluateShiftExit("employee-1", "shift-13b", new Date("2026-08-18T18:30:00.000Z"));
    await evaluateShiftExit("employee-1", "shift-13b", new Date("2026-08-18T18:30:00.000Z"));

    const calls = mockedPrisma.shiftAlert.upsert.mock.calls.filter((call) => call[0]?.create?.type === "SALIDA_ANTICIPADA");
    expect(calls).toHaveLength(2);
    expect(calls[0]![0]!.where).toEqual(calls[1]![0]!.where);
  });
});

// Etapa 13D (docs/decisions/SHIFT_SEGMENT_UNCLASSIFIED_POLICY_13D.md): un
// tramo SIN_CONCEPTO_COMPATIBLE sólo debe notificar a RRHH cuando el
// empleado tiene al menos un concepto horario ADICIONAL habilitado (nunca la
// Hora Normal base) y ninguna alerta principal de salida (13B) ya explica el
// mismo evento. La ShiftAlert (historial/auditoría) se sigue persistiendo
// siempre, sin excepción -- sólo se suprime el AVISO.
describe("SEGMENTO_SIN_CLASIFICAR — Etapa 13D (política de concepto esperado)", () => {
  const plainShift = {
    id: "plain-shift",
    code: "PLAIN",
    startTime: "08:00",
    endTime: "16:00",
    crossesMidnight: false,
    entryToleranceBeforeMinutes: 10,
    entryToleranceAfterMinutes: 10,
    exitToleranceBeforeMinutes: 15,
    exitToleranceAfterMinutes: 15,
    minimumMinutesForCompliance: null,
    maximumInformativeMinutes: null,
    missingOutAlertAfterMinutes: null,
    absoluteOpenShiftLimitMinutes: 1200,
    status: "ACTIVO",
  };

  function notifiedTitles(): string[] {
    return vi.mocked(notifyUsers).mock.calls.map((call) => call[1]?.title);
  }

  beforeEach(() => {
    mockedPrisma.shiftTemplate.findUnique.mockResolvedValue(plainShift);
    mockedPrisma.shiftAssignment.findUnique.mockResolvedValue({ status: "HABILITADO" });
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);
    mockedPrisma.workShift.findUnique.mockResolvedValue({
      id: "shift-13d",
      startAt: new Date("2026-08-18T11:00:00.000Z"), // 08:00 ART
      shiftTemplateId: "plain-shift",
      totalMinutes: 480, // 08:00-16:00 exacto -- salida puntual, sin salida anticipada ni jornada corta
    });
  });

  // Etapa 13H.1 (docs/decisions/SHIFT_ALERTS_GROUPED_VIEW_13H_1.md):
  // redefine esta expectativa -- sin concepto adicional, la ShiftAlert ya NI
  // SIQUIERA se persiste (antes: se persistía "interna", con notify=false,
  // pero seguía apareciendo como hallazgo en Alertas de Turnos, Etapa 13H,
  // confundiendo a RRHH). La ausencia de concepto adicional no es un
  // problema -- no hay nada que registrar.
  it("Caso A del pedido (redefinido 13H.1): empleado SIN conceptos adicionales -- la ShiftAlert ni se crea, no notifica", async () => {
    mockedPrisma.employeeHourConcept.findFirst.mockResolvedValue(null);

    await evaluateShiftExit("employee-1", "shift-13d", new Date("2026-08-18T19:00:00.000Z"), [
      { startAt: new Date("2026-08-18T18:30:00.000Z"), minutes: 30, conceptStatus: "SIN_CONCEPTO_COMPATIBLE" },
    ]);

    expect(upsertedAlertTypes()).toHaveLength(0); // ni se persiste (13H.1) ni notifica
    expect(notifiedTitles()).toHaveLength(0);
  });

  it("el criterio de 'concepto esperado' consulta EmployeeHourConcept con systemRole:null -- nunca cuenta la Hora Normal base", async () => {
    mockedPrisma.employeeHourConcept.findFirst.mockResolvedValue(null);

    await evaluateShiftExit("employee-1", "shift-13d", new Date("2026-08-18T19:00:00.000Z"), [
      { startAt: new Date("2026-08-18T18:30:00.000Z"), minutes: 30, conceptStatus: "SIN_CONCEPTO_COMPATIBLE" },
    ]);

    expect(mockedPrisma.employeeHourConcept.findFirst).toHaveBeenCalledWith({
      where: { employeeId: "employee-1", hourConcept: { status: "ACTIVO", systemRole: null } },
      select: { employeeId: true },
    });
  });

  it("Caso B del pedido: empleado CON al menos un concepto adicional habilitado -- notifica cuando es la única explicación", async () => {
    mockedPrisma.employeeHourConcept.findFirst.mockResolvedValue({ employeeId: "employee-1" });

    await evaluateShiftExit("employee-1", "shift-13d", new Date("2026-08-18T19:00:00.000Z"), [
      { startAt: new Date("2026-08-18T18:30:00.000Z"), minutes: 30, conceptStatus: "SIN_CONCEPTO_COMPATIBLE" },
    ]);

    expect(upsertedAlertTypes()).toEqual(["SEGMENTO_SIN_CLASIFICAR"]);
    expect(notifiedTitles()).toEqual(["Tramo de jornada sin concepto horario compatible"]);
  });

  // Etapa 13H.1: la consulta de "concepto esperado" ya no puede saltearse
  // cuando otra alerta de mayor prioridad ya ganó -- ahora también decide si
  // la ShiftAlert se persiste (no sólo si notifica), así que corre siempre
  // que haya un segmento sin clasificar. Con concepto adicional (este caso),
  // sigue persistiéndose como hallazgo interno, subordinada a SALIDA_ANTICIPADA.
  it("Caso D del pedido (redefinido 13H.1): SALIDA_ANTICIPADA + segmento sin clasificar, empleado CON conceptos adicionales -- se persiste como hallazgo interno, no notifica, SÍ consulta EmployeeHourConcept (decide persistencia)", async () => {
    mockedPrisma.employeeHourConcept.findFirst.mockResolvedValue({ employeeId: "employee-1" });
    mockedPrisma.workShift.findUnique.mockResolvedValue({
      id: "shift-13d",
      startAt: new Date("2026-08-18T11:00:00.000Z"),
      shiftTemplateId: "plain-shift",
      totalMinutes: 450, // salida 30 min antes
    });

    await evaluateShiftExit("employee-1", "shift-13d", new Date("2026-08-18T18:30:00.000Z"), [
      { startAt: new Date("2026-08-18T18:00:00.000Z"), minutes: 30, conceptStatus: "SIN_CONCEPTO_COMPATIBLE" },
    ]);

    expect(upsertedAlertTypes()).toEqual(expect.arrayContaining(["SALIDA_ANTICIPADA", "SEGMENTO_SIN_CLASIFICAR"]));
    expect(notifiedTitles()).toEqual(["Salida anticipada"]);
    expect(mockedPrisma.employeeHourConcept.findFirst).toHaveBeenCalledTimes(1); // decide persistencia, no sólo el aviso
  });

  // Etapa 13H.1: mismo criterio -- SIN concepto adicional, la ShiftAlert ni
  // se crea, aunque JORNADA_INSUFICIENTE ya haya ganado el aviso.
  it("Caso E del pedido (redefinido 13H.1): JORNADA_INSUFICIENTE + segmento sin clasificar, SIN concepto adicional -- el segmento ni se persiste", async () => {
    mockedPrisma.shiftTemplate.findUnique.mockResolvedValue({ ...plainShift, minimumMinutesForCompliance: 420 });
    mockedPrisma.employeeHourConcept.findFirst.mockResolvedValue(null);
    mockedPrisma.workShift.findUnique.mockResolvedValue({
      id: "shift-13d",
      startAt: new Date("2026-08-18T12:30:00.000Z"), // ingreso 09:30 ART (tardío), salida puntual -> sin SALIDA_ANTICIPADA
      shiftTemplateId: "plain-shift",
      totalMinutes: 390, // < 420
    });

    await evaluateShiftExit("employee-1", "shift-13d", new Date("2026-08-18T19:00:00.000Z"), [
      { startAt: new Date("2026-08-18T18:30:00.000Z"), minutes: 30, conceptStatus: "SIN_CONCEPTO_COMPATIBLE" },
    ]);

    expect(upsertedAlertTypes()).toEqual(["JORNADA_INSUFICIENTE"]); // SEGMENTO_SIN_CLASIFICAR ni se crea
    expect(notifiedTitles()).toEqual(["Jornada por debajo del mínimo"]);
  });

  it("Caso C del pedido: CONCEPTO_NO_HABILITADO sigue notificando sin verse afectado por la nueva política (camino independiente, aunque no haya ningún concepto adicional habilitado)", async () => {
    mockedPrisma.employeeHourConcept.findFirst.mockResolvedValue(null);

    await evaluateShiftExit("employee-1", "shift-13d", new Date("2026-08-18T19:00:00.000Z"), [
      { startAt: new Date("2026-08-18T18:30:00.000Z"), minutes: 30, conceptStatus: "CONCEPTO_NO_HABILITADO" },
    ]);

    expect(upsertedAlertTypes()).toEqual(["CONCEPTO_NO_HABILITADO"]);
    expect(notifiedTitles()).toEqual(["Concepto horario detectado pero no habilitado para el empleado"]);
  });

  it("varios segmentos SIN_CONCEPTO_COMPATIBLE en la misma salida consultan EmployeeHourConcept una sola vez -- no por segmento, sin N+1", async () => {
    mockedPrisma.employeeHourConcept.findFirst.mockResolvedValue({ employeeId: "employee-1" });

    await evaluateShiftExit("employee-1", "shift-13d", new Date("2026-08-18T19:00:00.000Z"), [
      { startAt: new Date("2026-08-18T14:00:00.000Z"), minutes: 30, conceptStatus: "SIN_CONCEPTO_COMPATIBLE" },
      { startAt: new Date("2026-08-18T18:30:00.000Z"), minutes: 30, conceptStatus: "SIN_CONCEPTO_COMPATIBLE" },
    ]);

    expect(mockedPrisma.employeeHourConcept.findFirst).toHaveBeenCalledTimes(1);
  });

  it("notifyClassificationAlerts (alta manual standalone, fuera de la cascada 13B) también respeta la política -- sin conceptos adicionales, ni se persiste ni notifica (Etapa 13H.1)", async () => {
    mockedPrisma.employeeHourConcept.findFirst.mockResolvedValue(null);

    await notifyClassificationAlerts("employee-1", "shift-13d", [
      { startAt: new Date("2026-08-18T18:30:00.000Z"), minutes: 30, conceptStatus: "SIN_CONCEPTO_COMPATIBLE" },
    ]);

    expect(upsertedAlertTypes()).toHaveLength(0);
    expect(notifiedTitles()).toHaveLength(0);
  });
});

// Etapa 13E (docs/decisions/SHIFT_CONFIGURATION_ALERT_POLICY_13E.md):
// POSSIBLE_SHIFT_CONFIGURATION_MISSING ya no adopta el turno ajeno (GENERAL_
// UNASSIGNED) como si fuera el turno real de la jornada -- corta la cadena de
// "verdad automática" que alimentaba evaluateWorkedDuration/checkMissingOutRisk/
// expireOpenWorkShifts con el mínimo/máximo de un turno nunca asignado al
// empleado. El copy visible pasa de afirmar un diagnóstico a pedir revisión.
//
// Etapa 13E.1 (misma doc, corrección funcional): esa comparación en sí misma
// se eliminó -- sin turno propio aplicable, un empleado ya NO se compara
// contra ningún ShiftTemplate ajeno del sistema (ver matchShiftForEmployee,
// workShiftEvaluation.service.ts). Que una fichada coincida por horario con
// el turno de otra persona nunca fue evidencia real para este empleado.
// POSSIBLE_SHIFT_CONFIGURATION_MISSING queda sin ningún caso funcional real
// que la dispare -- el copy de 13E se conserva en el código sólo para que
// las alertas ya persistidas antes de esta etapa se sigan mostrando
// correctamente (verificado por separado en ShiftAlertsPage.test.tsx, que
// mockea la respuesta de la API y no depende de que el backend la genere).
describe("POSSIBLE_SHIFT_CONFIGURATION_MISSING — Etapa 13E/13E.1 (turno ajeno nunca se adopta ni se compara; el tipo queda sin caso funcional)", () => {
  const ownTemplate = {
    id: "own-shift",
    code: "OWN",
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
  // Tolerancia general 07:00 ±10min -- deliberadamente con un máximo
  // informativo bajo (30) para poder confirmar que, tras esta etapa, ese
  // valor ya NO gobierna JORNADA_EXTENDIDA cuando el match es GENERAL_UNASSIGNED.
  const alienTemplate = {
    id: "alien-shift",
    code: "ALIEN",
    startTime: "07:00",
    endTime: "15:00",
    crossesMidnight: false,
    entryToleranceBeforeMinutes: 10,
    entryToleranceAfterMinutes: 10,
    exitToleranceBeforeMinutes: 20,
    exitToleranceAfterMinutes: 20,
    minimumMinutesForCompliance: null,
    maximumInformativeMinutes: 30,
    missingOutAlertAfterMinutes: null,
    absoluteOpenShiftLimitMinutes: 1200,
    status: "ACTIVO",
  };

  it("Parte 5.1: empleado CON turno propio (dentro de tolerancia) nunca genera POSSIBLE_SHIFT_CONFIGURATION_MISSING", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ shiftTemplateId: "own-shift", status: "HABILITADO" }]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([ownTemplate, alienTemplate]);

    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T11:35:00.000Z")); // 08:35 ART, dentro de tolerancia

    expect(upsertedAlertTypes()).not.toContain("POSSIBLE_SHIFT_CONFIGURATION_MISSING");
  });

  it("Parte 5.2: entrada anticipada (turno propio) no genera POSSIBLE_SHIFT_CONFIGURATION_MISSING", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ shiftTemplateId: "own-shift", status: "HABILITADO" }]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([ownTemplate, alienTemplate]);

    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T11:00:00.000Z")); // 08:00 ART, 30 min antes

    expect(upsertedAlertTypes()).toContain("INGRESO_ANTICIPADO");
    expect(upsertedAlertTypes()).not.toContain("POSSIBLE_SHIFT_CONFIGURATION_MISSING");
  });

  it("Parte 5.3: entrada tarde (turno propio) no genera POSSIBLE_SHIFT_CONFIGURATION_MISSING", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ shiftTemplateId: "own-shift", status: "HABILITADO" }]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([ownTemplate, alienTemplate]);

    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T11:50:00.000Z")); // 08:50 ART, 20 min tarde

    expect(upsertedAlertTypes()).toContain("INGRESO_TARDE");
    expect(upsertedAlertTypes()).not.toContain("POSSIBLE_SHIFT_CONFIGURATION_MISSING");
  });

  it("Parte 5.4: salida anticipada no genera POSSIBLE_SHIFT_CONFIGURATION_MISSING (tipos mutuamente excluyentes -- este tipo nunca se evalúa en salida)", async () => {
    mockedPrisma.workShift.findUnique.mockResolvedValue({
      id: "shift-1",
      startAt: new Date("2026-08-18T11:00:00.000Z"), // 08:00 ART
      shiftTemplateId: "own-shift",
      totalMinutes: 400,
    });
    mockedPrisma.shiftTemplate.findUnique.mockResolvedValue(ownTemplate);
    mockedPrisma.shiftAssignment.findUnique.mockResolvedValue({ status: "HABILITADO" });

    await evaluateShiftExit("employee-1", "shift-1", new Date("2026-08-18T17:30:00.000Z")); // 14:30 ART, antes de 16:30

    expect(upsertedAlertTypes()).toContain("SALIDA_ANTICIPADA");
    expect(upsertedAlertTypes()).not.toContain("POSSIBLE_SHIFT_CONFIGURATION_MISSING");
  });

  it("aunque un WorkShift referencie un turno ajeno (contaminación de datos previa a esta etapa), la salida nunca genera POSSIBLE_SHIFT_CONFIGURATION_MISSING", async () => {
    mockedPrisma.workShift.findUnique.mockResolvedValue({
      id: "shift-1",
      startAt: new Date("2026-08-18T10:05:00.000Z"),
      shiftTemplateId: "alien-shift",
      totalMinutes: 300,
    });
    mockedPrisma.shiftTemplate.findUnique.mockResolvedValue(alienTemplate);
    mockedPrisma.shiftAssignment.findUnique.mockResolvedValue(null); // sin asignación real -> GENERAL_UNASSIGNED también en salida

    await evaluateShiftExit("employee-1", "shift-1", new Date("2026-08-18T18:00:00.000Z"));

    expect(upsertedAlertTypes()).not.toContain("POSSIBLE_SHIFT_CONFIGURATION_MISSING");
  });

  // Tests obligatorios 13E.1 #1: "Empleado sin turno y con régimen flexible
  // ficha entrada → no alerta." Antes de 13E.1 alcanzaba con verificar
  // POSSIBLE_SHIFT_CONFIGURATION_MISSING; ahora que ese tipo ya no puede
  // generarse, la aserción fuerte es "ninguna alerta en absoluto" (ni
  // siquiera TURNO_NO_IDENTIFICADO, suprimida por el régimen).
  it("Tests obligatorios #1: empleado sin turno propio, régimen con alertOnOutOfShift=false -- no genera ninguna alerta de turno", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([alienTemplate]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({ workRegime: { kind: "TURNO_FLEXIBLE", alertOnOutOfShift: false } });

    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T10:05:00.000Z")); // hora que antes coincidía con la tolerancia general del turno ajeno -- ya irrelevante

    expect(upsertedAlertTypes()).toHaveLength(0);
  });

  // Tests obligatorios 13E.1 #2: "Empleado sin turno y sin régimen ficha
  // entrada → TURNO_NO_IDENTIFICADO, no POSSIBLE_SHIFT_CONFIGURATION_MISSING."
  it("Tests obligatorios #2: empleado sin turno propio y sin régimen -- genera TURNO_NO_IDENTIFICADO, nunca POSSIBLE_SHIFT_CONFIGURATION_MISSING (Regla 5 del pedido 13E.1)", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([alienTemplate]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T10:05:00.000Z"));

    expect(upsertedAlertTypes()).toEqual(["TURNO_NO_IDENTIFICADO"]);
    expect(upsertedAlertTypes()).not.toContain("POSSIBLE_SHIFT_CONFIGURATION_MISSING");
  });

  // Tests obligatorios 13E.1 #3: "Empleado sin turno ficha a las 08:00
  // existiendo un turno 08:00 de otra persona → no usa ese turno, no
  // POSSIBLE_SHIFT_CONFIGURATION_MISSING."
  it("Tests obligatorios #3: empleado sin turno ficha a las 08:00 existiendo un turno 08:00 de otra persona -- no lo usa, TURNO_NO_IDENTIFICADO en vez de POSSIBLE_SHIFT_CONFIGURATION_MISSING", async () => {
    const others0800 = { ...alienTemplate, id: "otra-persona-0800", startTime: "08:00", endTime: "16:00" };
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]); // este empleado no tiene NINGUNA asignación
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([others0800]); // pero existe un turno 08:00 asignado a otra persona en el sistema

    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T11:00:00.000Z")); // 08:00 ART exacto -- coincide 100% con el turno de la otra persona

    expect(upsertedAlertTypes()).toEqual(["TURNO_NO_IDENTIFICADO"]);
    expect(upsertedAlertTypes()).not.toContain("POSSIBLE_SHIFT_CONFIGURATION_MISSING");
    expect(mockedPrisma.workShift.update).not.toHaveBeenCalled(); // el turno de la otra persona nunca se persiste en esta jornada
  });

  it("otros tipos de alerta siguen usando el mensaje genérico -- el copy de POSSIBLE_SHIFT_CONFIGURATION_MISSING (13E) queda sin ningún camino que lo dispare (13E.1)", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ shiftTemplateId: "own-shift", status: "HABILITADO" }]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([ownTemplate]);

    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T11:50:00.000Z")); // INGRESO_TARDE

    const call = vi.mocked(notifyUsers).mock.calls.find((c) => c[1]?.title === "Ingreso fuera de tolerancia");
    expect(call![1]?.message).toBe("La fichada requiere seguimiento. Las horas no fueron modificadas automáticamente.");
    expect(vi.mocked(notifyUsers).mock.calls.some((c) => c[1]?.title === "Revisar configuración de turno")).toBe(false);
  });

  // Tests obligatorios 13E.1 #7: "No se persiste shiftTemplateId ajeno en
  // WorkShift." -- ya cubierto arriba (#3) para el caso de coincidencia
  // horaria; acá se confirma también el caso general (sin ningún turno en
  // el sistema, ni propio ni ajeno).
  it("Tests obligatorios #7: sin ningún turno propio aplicable, workShift.update nunca se llama -- no hay ningún turno (propio ni ajeno) que adoptar", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([alienTemplate]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T10:05:00.000Z"));

    expect(upsertedAlertTypes()).toEqual(["TURNO_NO_IDENTIFICADO"]);
    expect(mockedPrisma.workShift.update).not.toHaveBeenCalled();
  });

  it("Caso real: aunque el WorkShift tenga un turno ajeno (GENERAL_UNASSIGNED) referenciado, su máximo informativo ya NO gobierna JORNADA_EXTENDIDA en la salida", async () => {
    mockedPrisma.workShift.findUnique.mockResolvedValue({
      id: "shift-1",
      startAt: new Date("2026-08-18T10:05:00.000Z"),
      shiftTemplateId: "alien-shift",
      totalMinutes: 300, // superaría maximumInformativeMinutes (30) del turno ajeno si se usara como verdad
    });
    mockedPrisma.shiftTemplate.findUnique.mockResolvedValue(alienTemplate);
    mockedPrisma.shiftAssignment.findUnique.mockResolvedValue(null); // sin asignación real -> GENERAL_UNASSIGNED

    await evaluateShiftExit("employee-1", "shift-1", new Date("2026-08-18T15:05:00.000Z"));

    // 300 min < default 600 (turno ajeno descartado como fuente del umbral) -> ninguna alerta de duración
    expect(upsertedAlertTypes()).not.toContain("JORNADA_EXTENDIDA");
    expect(upsertedAlertTypes()).not.toContain("JORNADA_INSUFICIENTE");
  });

  it("regresión: un turno propio (ENABLED) SÍ se sigue adoptando en la jornada, sin cambios", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ shiftTemplateId: "own-shift", status: "HABILITADO" }]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([ownTemplate]);

    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T11:35:00.000Z"));

    expect(mockedPrisma.workShift.update).toHaveBeenCalledWith({
      where: { id: "shift-1" },
      data: { shiftTemplateId: "own-shift", maxAllowedMinutes: 1200 },
    });
  });

  it("regresión: un turno propio DESHABILITADO (DISABLED_FOR_EMPLOYEE) también se sigue adoptando -- es evidencia real de una asignación, no una coincidencia ajena", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ shiftTemplateId: "own-shift", status: "DESHABILITADO" }]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([ownTemplate]);

    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T11:35:00.000Z"));

    expect(mockedPrisma.workShift.update).toHaveBeenCalledWith({
      where: { id: "shift-1" },
      data: { shiftTemplateId: "own-shift", maxAllowedMinutes: 1200 },
    });
  });

  // Tests obligatorios 13E.1 #4: "Empleado sin turno ficha salida con
  // ingreso abierto → no usa turno ajeno para jornada insuficiente/extendida."
  // A diferencia del test "Caso real..." de arriba (que simula datos ya
  // contaminados de antes de esta etapa), este escenario es el flujo limpio
  // real: el ingreso nunca resolvió ningún turno (shiftTemplateId ya nace
  // null desde la entrada, por Regla 3 de 13E.1) -- resolveMatchForExit corta
  // en NO_MATCH de entrada, sin ninguna consulta a ShiftTemplate/ShiftAssignment.
  it("Tests obligatorios #4: empleado sin turno ficha salida con ingreso abierto -- sin ningún turno resuelto en la entrada, la duración nunca usa un turno ajeno para JORNADA_INSUFICIENTE/EXTENDIDA", async () => {
    mockedPrisma.workShift.findUnique.mockResolvedValue({
      id: "shift-1",
      startAt: new Date("2026-08-18T10:05:00.000Z"),
      shiftTemplateId: null, // nunca se resolvió ningún turno en la entrada (13E.1)
      totalMinutes: 300,
    });

    await evaluateShiftExit("employee-1", "shift-1", new Date("2026-08-18T15:05:00.000Z"));

    expect(mockedPrisma.shiftTemplate.findUnique).not.toHaveBeenCalled(); // resolveMatchForExit corta en NO_MATCH sin consultar nada
    expect(mockedPrisma.shiftAssignment.findUnique).not.toHaveBeenCalled();
    expect(upsertedAlertTypes()).not.toContain("JORNADA_EXTENDIDA");
    expect(upsertedAlertTypes()).not.toContain("JORNADA_INSUFICIENTE");
  });

  // Tests obligatorios 13E.1 #6: "Empleado con turno propio sigue evaluando
  // salida normal/anticipada." La salida anticipada ya está cubierta más
  // arriba (Parte 5.4) -- acá se cubre la salida normal (dentro de tolerancia).
  it("Tests obligatorios #6: empleado con turno propio -- salida normal (dentro de tolerancia) sigue evaluando sin generar ninguna alerta", async () => {
    mockedPrisma.workShift.findUnique.mockResolvedValue({
      id: "shift-1",
      startAt: new Date("2026-08-18T11:00:00.000Z"), // 08:00 ART
      shiftTemplateId: "own-shift",
      totalMinutes: 480,
    });
    mockedPrisma.shiftTemplate.findUnique.mockResolvedValue(ownTemplate);
    mockedPrisma.shiftAssignment.findUnique.mockResolvedValue({ status: "HABILITADO" });

    await evaluateShiftExit("employee-1", "shift-1", new Date("2026-08-18T19:30:00.000Z")); // 16:30 ART exacto -- fin de ownTemplate

    expect(upsertedAlertTypes()).toHaveLength(0);
  });

  it("Parte 5.8: regresión -- TURNO_NO_IDENTIFICADO sigue funcionando sin cambios", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T23:00:00.000Z")); // lejos de cualquier turno

    expect(upsertedAlertTypes()).toContain("TURNO_NO_IDENTIFICADO");
    expect(upsertedAlertTypes()).not.toContain("POSSIBLE_SHIFT_CONFIGURATION_MISSING");
  });

  it("Parte 5.9: regresión -- SHIFT_NOT_ENABLED_FOR_EMPLOYEE sigue funcionando sin cambios", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ shiftTemplateId: "own-shift", status: "DESHABILITADO" }]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([ownTemplate]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({ workRegime: { kind: "TURNO_OBLIGATORIO", alertOnOutOfShift: true } });

    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T11:35:00.000Z"));

    expect(upsertedAlertTypes()).toContain("SHIFT_NOT_ENABLED_FOR_EMPLOYEE");
    expect(upsertedAlertTypes()).not.toContain("POSSIBLE_SHIFT_CONFIGURATION_MISSING");
  });
});

// Etapa 13G (docs/decisions/SHIFT_EXIT_SINGLE_NOTIFICATION_POLICY_13G.md):
// una fichada de salida debe generar como máximo una notificación visible
// principal, sin importar cuántas ShiftAlert distintas dispare. Prioridad:
// CONCEPTO_NO_HABILITADO > JORNADA_EXTENDIDA > SALIDA_TARDIA >
// SALIDA_ANTICIPADA > JORNADA_INSUFICIENTE > SEGMENTO_SIN_CLASIFICAR.
describe("evaluateShiftExit — Etapa 13G (una sola notificación visible por cierre de salida)", () => {
  const shift = {
    id: "shift-13g",
    code: "SHIFT-13G",
    startTime: "08:00",
    endTime: "16:00",
    crossesMidnight: false,
    entryToleranceBeforeMinutes: 10,
    entryToleranceAfterMinutes: 10,
    exitToleranceBeforeMinutes: 15,
    exitToleranceAfterMinutes: 15,
    minimumMinutesForCompliance: 420, // 7h
    maximumInformativeMinutes: 540, // 9h
    missingOutAlertAfterMinutes: null,
    absoluteOpenShiftLimitMinutes: 1200,
    status: "ACTIVO",
  };

  function notifiedTitles(): string[] {
    return vi.mocked(notifyUsers).mock.calls.map((call) => call[1]?.title);
  }

  function mockWorkShift(overrides: Partial<{ startAt: Date; totalMinutes: number }> = {}) {
    mockedPrisma.workShift.findUnique.mockResolvedValue({
      id: "shift-13g",
      startAt: new Date("2026-08-18T11:00:00.000Z"), // 08:00 ART
      shiftTemplateId: "shift-13g",
      totalMinutes: 480,
      ...overrides,
    });
  }

  beforeEach(() => {
    mockedPrisma.shiftTemplate.findUnique.mockResolvedValue(shift);
    mockedPrisma.shiftAssignment.findUnique.mockResolvedValue({ status: "HABILITADO" });
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);
    mockedPrisma.employeeHourConcept.findFirst.mockResolvedValue({ employeeId: "employee-1" }); // tiene concepto adicional por default
    mockWorkShift();
  });

  // Parte 4 del pedido -- caso real, legajo 09 "Granja": un mismo cierre
  // disparaba CONCEPTO_NO_HABILITADO + JORNADA_EXTENDIDA + SALIDA_TARDIA, las
  // 3 notificando por separado. Ahora las 3 ShiftAlert se persisten (nada se
  // oculta), pero sólo notifica la de mayor prioridad (CONCEPTO_NO_HABILITADO).
  it("Caso real (legajo 09 Granja): CONCEPTO_NO_HABILITADO + JORNADA_EXTENDIDA + SALIDA_TARDIA -- las 3 ShiftAlert se persisten, una sola notificación", async () => {
    mockWorkShift({ totalMinutes: 660 }); // 11h -- supera maximumInformativeMinutes (540)

    await evaluateShiftExit("employee-1", "shift-13g", new Date("2026-08-18T22:00:00.000Z"), [ // 19:00 ART, 3h tarde
      { startAt: new Date("2026-08-18T21:30:00.000Z"), minutes: 30, conceptStatus: "CONCEPTO_NO_HABILITADO" },
    ]);

    expect(upsertedAlertTypes()).toEqual(expect.arrayContaining(["SALIDA_TARDIA", "JORNADA_EXTENDIDA", "CONCEPTO_NO_HABILITADO"]));
    expect(upsertedAlertTypes()).toHaveLength(3);
    expect(notifiedTitles()).toEqual(["Concepto horario detectado pero no habilitado para el empleado"]);
  });

  // Corrección 13H.1 (docs/decisions/SHIFT_ALERTS_GROUPED_VIEW_13H_1.md), caso
  // 3 del pedido: SALIDA_TARDIA + JORNADA_INSUFICIENTE + segmento sin
  // clasificar SIN concepto adicional esperado. Grupo visible esperado en
  // Alertas de Turnos: principal Salida tardía, hallazgo asociado Jornada
  // por debajo del mínimo -- SEGMENTO_SIN_CLASIFICAR no debe aparecer en
  // absoluto (ni como principal, ni como secundaria, ni en Notificaciones).
  it("Corrección 13H.1, caso 3 del pedido: salida tardía + jornada insuficiente + segmento sin clasificar SIN concepto adicional -- el segmento ni se persiste, sólo quedan las otras 2 ShiftAlert", async () => {
    mockedPrisma.employeeHourConcept.findFirst.mockResolvedValue(null); // sin conceptos adicionales
    mockWorkShift({ totalMinutes: 300 }); // por debajo del mínimo (420), independiente del horario real de salida

    await evaluateShiftExit("employee-1", "shift-13g", new Date("2026-08-18T19:30:00.000Z"), [ // 16:30 ART, 30 min tarde
      { startAt: new Date("2026-08-18T19:00:00.000Z"), minutes: 30, conceptStatus: "SIN_CONCEPTO_COMPATIBLE" },
    ]);

    expect(upsertedAlertTypes()).toEqual(expect.arrayContaining(["SALIDA_TARDIA", "JORNADA_INSUFICIENTE"]));
    expect(upsertedAlertTypes()).toHaveLength(2); // SEGMENTO_SIN_CLASIFICAR ni se crea
    expect(upsertedAlertTypes()).not.toContain("SEGMENTO_SIN_CLASIFICAR");
    expect(notifiedTitles()).toEqual(["Salida fuera de tolerancia"]); // principal según 13G, JORNADA_INSUFICIENTE queda interna
  });

  it("Parte 5.1: salida normal (dentro de tolerancia, dentro del mínimo, sin conceptos) -- sin alertas, sin notificación", async () => {
    mockWorkShift({ totalMinutes: 480 }); // 08:00-16:00 exacto

    await evaluateShiftExit("employee-1", "shift-13g", new Date("2026-08-18T19:00:00.000Z")); // 16:00 ART

    expect(upsertedAlertTypes()).toHaveLength(0);
    expect(notifiedTitles()).toHaveLength(0);
  });

  it("Parte 5.2: salida tardía sola -- una ShiftAlert SALIDA_TARDIA, una notificación 'Salida fuera de tolerancia'", async () => {
    mockWorkShift({ totalMinutes: 500 }); // 20 min por encima del mínimo, muy por debajo del máximo (540)

    await evaluateShiftExit("employee-1", "shift-13g", new Date("2026-08-18T19:20:00.000Z")); // 16:20 ART, 20 min tarde

    expect(upsertedAlertTypes()).toEqual(["SALIDA_TARDIA"]);
    expect(notifiedTitles()).toEqual(["Salida fuera de tolerancia"]);
  });

  it("Parte 5.5: CONCEPTO_NO_HABILITADO + SALIDA_TARDIA (sin jornada extendida) -- notifica sólo Concepto no habilitado", async () => {
    mockWorkShift({ totalMinutes: 500 }); // tardía, sin llegar a jornada extendida

    await evaluateShiftExit("employee-1", "shift-13g", new Date("2026-08-18T19:20:00.000Z"), [
      { startAt: new Date("2026-08-18T19:00:00.000Z"), minutes: 20, conceptStatus: "CONCEPTO_NO_HABILITADO" },
    ]);

    expect(upsertedAlertTypes()).toEqual(expect.arrayContaining(["SALIDA_TARDIA", "CONCEPTO_NO_HABILITADO"]));
    expect(notifiedTitles()).toEqual(["Concepto horario detectado pero no habilitado para el empleado"]);
  });

  it("Parte 5.6: segmento sin clasificar + salida tardía (alerta principal más clara) -- no notifica el segmento", async () => {
    mockWorkShift({ totalMinutes: 500 });

    await evaluateShiftExit("employee-1", "shift-13g", new Date("2026-08-18T19:20:00.000Z"), [
      { startAt: new Date("2026-08-18T19:00:00.000Z"), minutes: 20, conceptStatus: "SIN_CONCEPTO_COMPATIBLE" },
    ]);

    expect(upsertedAlertTypes()).toEqual(expect.arrayContaining(["SALIDA_TARDIA", "SEGMENTO_SIN_CLASIFICAR"]));
    expect(notifiedTitles()).toEqual(["Salida fuera de tolerancia"]);
  });

  it("Parte 5.7: segmento sin clasificar solo, con concepto adicional esperado -- notifica (Etapa 13D, sin cambios)", async () => {
    mockWorkShift({ totalMinutes: 480 }); // salida puntual, sin otra alerta

    await evaluateShiftExit("employee-1", "shift-13g", new Date("2026-08-18T19:00:00.000Z"), [
      { startAt: new Date("2026-08-18T18:30:00.000Z"), minutes: 30, conceptStatus: "SIN_CONCEPTO_COMPATIBLE" },
    ]);

    expect(upsertedAlertTypes()).toEqual(["SEGMENTO_SIN_CLASIFICAR"]);
    expect(notifiedTitles()).toEqual(["Tramo de jornada sin concepto horario compatible"]);
  });

  it("Parte 5.8: segmento sin clasificar solo, sin concepto adicional esperado -- ni se persiste ni notifica (Etapa 13H.1, antes: se persistía interna)", async () => {
    mockedPrisma.employeeHourConcept.findFirst.mockResolvedValue(null);
    mockWorkShift({ totalMinutes: 480 });

    await evaluateShiftExit("employee-1", "shift-13g", new Date("2026-08-18T19:00:00.000Z"), [
      { startAt: new Date("2026-08-18T18:30:00.000Z"), minutes: 30, conceptStatus: "SIN_CONCEPTO_COMPATIBLE" },
    ]);

    expect(upsertedAlertTypes()).toHaveLength(0);
    expect(notifiedTitles()).toHaveLength(0);
  });

  it("Parte 5.9 / Tests obligatorios #7: reevaluar el mismo cierre dos veces no duplica la notificación -- misma fila upserteada, notifyUsers llamado una vez por evaluación", async () => {
    mockWorkShift({ totalMinutes: 500 });

    await evaluateShiftExit("employee-1", "shift-13g", new Date("2026-08-18T19:20:00.000Z"), [
      { startAt: new Date("2026-08-18T19:00:00.000Z"), minutes: 20, conceptStatus: "CONCEPTO_NO_HABILITADO" },
    ]);
    await evaluateShiftExit("employee-1", "shift-13g", new Date("2026-08-18T19:20:00.000Z"), [
      { startAt: new Date("2026-08-18T19:00:00.000Z"), minutes: 20, conceptStatus: "CONCEPTO_NO_HABILITADO" },
    ]);

    const conceptoCalls = mockedPrisma.shiftAlert.upsert.mock.calls.filter((call) => call[0]?.create?.type === "CONCEPTO_NO_HABILITADO");
    expect(conceptoCalls).toHaveLength(2); // dos evaluaciones -> dos upserts...
    expect(conceptoCalls[0]![0]!.where).toEqual(conceptoCalls[1]![0]!.where); // ...contra la misma fila, nunca una nueva
    expect(notifiedTitles()).toEqual(["Concepto horario detectado pero no habilitado para el empleado", "Concepto horario detectado pero no habilitado para el empleado"]); // 1 aviso por evaluación, nunca 2 tipos distintos en la misma
  });
});

// Etapa 13I (docs/decisions/SHIFT_REST_BETWEEN_SHIFTS_DISABLED_13I.md):
// DESCANSO_INSUFICIENTE deja de generarse -- sin ningún campo de Turno/
// Régimen que respalde el umbral hardcodeado (480 min, Etapa 13C), generaba
// ruido para regímenes flexibles/turnos partidos. El resto de las alertas de
// entrada (INGRESO_TARDE/INGRESO_ANTICIPADO/TURNO_NO_IDENTIFICADO/
// SHIFT_NOT_ENABLED_FOR_EMPLOYEE) y de salida no cambian.
describe("evaluateShiftEntry — Etapa 13I (DESCANSO_INSUFICIENTE desactivado)", () => {
  const ownShift = {
    id: "shift-13i",
    code: "SHIFT-13I",
    startTime: "08:00",
    endTime: "16:00",
    crossesMidnight: false,
    entryToleranceBeforeMinutes: 10,
    entryToleranceAfterMinutes: 10,
    exitToleranceBeforeMinutes: 15,
    exitToleranceAfterMinutes: 15,
    minimumMinutesForCompliance: null,
    maximumInformativeMinutes: null,
    missingOutAlertAfterMinutes: null,
    absoluteOpenShiftLimitMinutes: 1200,
    status: "ACTIVO",
  };

  function notifiedTitles(): string[] {
    return vi.mocked(notifyUsers).mock.calls.map((call) => call[1]?.title);
  }

  it("Tests obligatorios #1/#2: entrada con muy poco descanso desde la jornada previa (antes generaba DESCANSO_INSUFICIENTE) ya no crea ShiftAlert ni SystemNotification, y ni siquiera consulta la jornada previa", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ shiftTemplateId: "shift-13i", status: "HABILITADO" }]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([ownShift]);
    // Si la consulta de jornada previa todavía corriera, esto simularía un
    // descanso de sólo 1h (muy por debajo de los 480 min que exigía el
    // umbral hardcodeado) -- pero ya no debería ni llamarse.
    mockedPrisma.workShift.findFirst.mockResolvedValue({ id: "shift-anterior", endAt: new Date("2026-08-18T10:00:00.000Z") });

    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T11:00:00.000Z")); // 08:00 ART, dentro de tolerancia

    expect(upsertedAlertTypes()).not.toContain("DESCANSO_INSUFICIENTE");
    expect(upsertedAlertTypes()).toHaveLength(0); // entrada puntual, ninguna otra alerta debería dispararse tampoco
    expect(notifiedTitles()).toHaveLength(0);
    expect(mockedPrisma.workShift.findFirst).not.toHaveBeenCalled(); // la consulta de jornada previa se eliminó, no sólo se ignora su resultado
  });

  it("Tests obligatorios #3: entrada tarde sigue notificando INGRESO_TARDE, sin verse afectada por la desactivación de DESCANSO_INSUFICIENTE", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ shiftTemplateId: "shift-13i", status: "HABILITADO" }]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([ownShift]);

    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T11:20:00.000Z")); // 08:20 ART, 10 min tarde (fuera de tolerancia)

    expect(upsertedAlertTypes()).toEqual(["INGRESO_TARDE"]);
    expect(notifiedTitles()).toEqual(["Ingreso fuera de tolerancia"]);
  });

  it("Tests obligatorios #3: entrada anticipada sigue notificando INGRESO_ANTICIPADO, sin verse afectada por la desactivación de DESCANSO_INSUFICIENTE", async () => {
    mockedPrisma.shiftAssignment.findMany.mockResolvedValue([{ shiftTemplateId: "shift-13i", status: "HABILITADO" }]);
    mockedPrisma.shiftTemplate.findMany.mockResolvedValue([ownShift]);

    await evaluateShiftEntry("employee-1", "shift-1", new Date("2026-08-18T10:45:00.000Z")); // 07:45 ART, 15 min antes (fuera de tolerancia)

    expect(upsertedAlertTypes()).toEqual(["INGRESO_ANTICIPADO"]);
    expect(notifiedTitles()).toEqual(["Ingreso anticipado"]);
  });
});
