import { describe, expect, it } from "vitest";
import { publicClockGuidance } from "../../shared/errors/clockGuidance";
import { classifyRotationEntry, classifyRotationExit, isBlockChangeFromUnblockedShift, isRotationBlockShift, type OpenBlockShift } from "./rotationEntry";
import type { RotationObligation } from "./rotationObligation.service";
import { buildExpectedBlock, type ExpectedDayPlan } from "./rotationPlan";
import type { LoadedRotationTemplate } from "./rotationPlan.loader";

/** R4.4 (SHIFT_ROTATION_AUDIT_PLAN.md §25.6): clasificación pura de fichadas de miembros de rotación. */
const at = (dateKey: string, time: string) => new Date(`${dateKey}T${time}:00-03:00`);
const THU = "2026-11-05";
const FRI = "2026-11-06";
const SAT = "2026-11-07";

const template = (code: string, startTime: string, endTime: string, overrides: Partial<LoadedRotationTemplate> = {}): LoadedRotationTemplate => ({
  id: `tpl-${code}`, code, startTime, endTime, crossesMidnight: endTime <= startTime, status: "ACTIVO",
  entryToleranceBeforeMinutes: 10, entryToleranceAfterMinutes: 10, exitToleranceBeforeMinutes: 20, exitToleranceAfterMinutes: 20,
  minimumMinutesForCompliance: null, maximumInformativeMinutes: null, missingOutAlertAfterMinutes: null, absoluteOpenShiftLimitMinutes: 1200,
  ...overrides,
});
const block = (dateKey: string, index: number, tpl: LoadedRotationTemplate) => buildExpectedBlock({ employeeId: "jose", dateKey, blockIndex: index, template: tpl, source: "ROTATION", origin: null })!;

const B1 = block(FRI, 0, template("PLANTA-07-11", "07:00", "11:00"));
const B2 = block(FRI, 1, template("PLANTA-19-07", "19:00", "07:00"));
const SAT_NIGHT = block(SAT, 0, template("PLANTA-19-07", "19:00", "07:00"));
const BLOCKS = [B1, B2, SAT_NIGHT];

const openB1 = (overrides: Partial<OpenBlockShift> = {}): OpenBlockShift => ({
  id: "shift-b1", startAt: at(FRI, "07:00"), scheduledStartAt: B1.scheduledStartAt, maxAllowedMinutes: 1200,
  template: { code: "PLANTA-07-11", startTime: "07:00", endTime: "11:00", crossesMidnight: false, exitToleranceAfterMinutes: 20 },
  scheduledEndAt: B1.scheduledEndAt, ...overrides,
});

const obligation = (dateKey: string, plan: Partial<ExpectedDayPlan> & { kind: ExpectedDayPlan["kind"] }, reason: string | null = null): RotationObligation =>
  ({ employeeId: "jose", dateKey, plan: { dateKey, employeeId: "jose", source: "ROTATION", ...plan }, resolution: { reason } as never, blocks: [], dayOff: reason === "DAY_OFF" }) as unknown as RotationObligation;

describe("classifyRotationExit — disparador excepcional de la confirmación (José viernes A)", () => {
  it.each([
    ["11:02", "NORMAL"],
    ["12:30", "NORMAL"],
    ["15:00", "NORMAL"],
    ["18:49", "NORMAL"],
    ["18:50", "LIKELY_FORGOTTEN_EXIT"],
    ["18:55", "LIKELY_FORGOTTEN_EXIT"],
    ["19:02", "LIKELY_FORGOTTEN_EXIT"],
    ["23:30", "LIKELY_FORGOTTEN_EXIT"],
  ])("salida a las %s → %s", (time, kind) => {
    expect(classifyRotationExit(at(FRI, time), openB1(), BLOCKS).kind).toBe(kind);
  });

  it("la confirmación trae el bloque siguiente y la duración que quedaría", () => {
    const result = classifyRotationExit(at(FRI, "19:02"), openB1(), BLOCKS);
    expect(result).toMatchObject({ kind: "LIKELY_FORGOTTEN_EXIT", nextBlock: { obligationKey: B2.obligationKey }, minutesAfterScheduledEnd: 482, exitDurationMinutes: 722 });
  });

  it("límite absoluto primero: con 600 min configurados, 18:55 se rechaza aunque fuese un posible olvido", () => {
    expect(classifyRotationExit(at(FRI, "18:55"), openB1({ maxAllowedMinutes: 600 }), BLOCKS)).toMatchObject({ kind: "LIMIT_EXCEEDED", minutesOpen: 715, limitMinutes: 600, nextBlock: { obligationKey: B2.obligationKey } });
    expect(classifyRotationExit(at(FRI, "16:59"), openB1({ maxAllowedMinutes: 600 }), BLOCKS).kind).toBe("NORMAL");
  });

  it("nocturno legítimo: la salida del sereno 07:05 del sábado no pregunta (el siguiente bloque abre a las 18:50)", () => {
    const openNight: OpenBlockShift = { ...openB1(), id: "shift-b2", startAt: at(FRI, "19:00"), scheduledStartAt: B2.scheduledStartAt, scheduledEndAt: B2.scheduledEndAt, template: { code: "PLANTA-19-07", startTime: "19:00", endTime: "07:00", crossesMidnight: true, exitToleranceAfterMinutes: 20 } };
    expect(classifyRotationExit(at(SAT, "07:05"), openNight, BLOCKS).kind).toBe("NORMAL");
    // 19:00 → 18:55 del día siguiente son 1435 min (> 1200): el límite absoluto gana siempre.
    expect(classifyRotationExit(at(SAT, "18:55"), openNight, BLOCKS).kind).toBe("LIMIT_EXCEEDED");
  });

  it("bloques contiguos (07–15 y 15–23): la salida 15:05 dentro de tolerancia no pregunta; 15:21 sí", () => {
    const early = block(FRI, 0, template("A", "07:00", "15:00"));
    const late = block(FRI, 1, template("B", "15:00", "23:00"));
    const open: OpenBlockShift = { ...openB1(), scheduledStartAt: early.scheduledStartAt, scheduledEndAt: early.scheduledEndAt, template: { code: "A", startTime: "07:00", endTime: "15:00", crossesMidnight: false, exitToleranceAfterMinutes: 20 } };
    expect(classifyRotationExit(at(FRI, "15:05"), open, [early, late]).kind).toBe("NORMAL");
    expect(classifyRotationExit(at(FRI, "15:21"), open, [early, late]).kind).toBe("LIKELY_FORGOTTEN_EXIT");
  });
});

describe("classifyRotationEntry — motor único y precedencias", () => {
  it("asignada con puntualidad según tolerancias del bloque (no recalcula la asignación)", () => {
    expect(classifyRotationEntry(at(FRI, "07:05"), undefined, BLOCKS)).toMatchObject({ kind: "ASSIGNED", block: { obligationKey: B1.obligationKey }, punctuality: "ON_TIME", differenceMinutes: 5 });
    expect(classifyRotationEntry(at(FRI, "07:25"), undefined, BLOCKS)).toMatchObject({ kind: "ASSIGNED", punctuality: "LATE", differenceMinutes: 25 });
    expect(classifyRotationEntry(at(FRI, "15:00"), undefined, BLOCKS)).toMatchObject({ kind: "ASSIGNED", block: { obligationKey: B2.obligationKey }, punctuality: "EARLY", differenceMinutes: -240 });
  });

  it("fuera de ventana con un bloque más tarde en la misma fecha → OUTSIDE_WINDOW con los minutos de anticipación", () => {
    expect(classifyRotationEntry(at(FRI, "13:00"), undefined, BLOCKS)).toMatchObject({ kind: "OUTSIDE_WINDOW", nearestBlock: { obligationKey: B2.obligationKey }, minutesBefore: 360 });
  });

  it("configuración faltante o contradictoria de la fecha (sin franco ni feriado) → CONFIGURATION", () => {
    const missing = new Map([[FRI, obligation(FRI, { kind: "MISSING", reason: "NO_DAY_ROW" } as never, "ROTATION_DAY_MISSING")]]);
    expect(classifyRotationEntry(at(FRI, "08:00"), missing, [])).toMatchObject({ kind: "CONFIGURATION", reason: "MISSING", planReason: "NO_DAY_ROW" });
    const conflict = new Map([[FRI, obligation(FRI, { kind: "CONFLICT", reason: "OVERLAPPING_BLOCKS", detail: ["x"] } as never, "ROTATION_CONFIG_CONFLICT")]]);
    expect(classifyRotationEntry(at(FRI, "08:00"), conflict, [])).toMatchObject({ kind: "CONFIGURATION", reason: "CONFLICT", detail: ["x"] });
  });

  // R4.5 (SHIFT_ROTATION_AUDIT_PLAN.md §25.7): cambio aprobado — antes la
  // configuración ganaba sobre el franco. Sin obligación ese día, el problema
  // de configuración no se informa por la fichada pero queda en `planIssue`.
  it("R4.5: franco y feriado no convocado ganan sobre MISSING/CONFLICT, conservando el problema en planIssue", () => {
    const conflictDayOff = new Map([[FRI, { ...obligation(FRI, { kind: "CONFLICT", reason: "OVERLAPPING_BLOCKS", detail: ["x"] } as never, "DAY_OFF"), dayOff: true }]]);
    expect(classifyRotationEntry(at(FRI, "08:00"), conflictDayOff, [])).toEqual({ kind: "DAY_OFF", planIssue: { kind: "CONFLICT", planReason: "OVERLAPPING_BLOCKS", detail: ["x"] } });
    const missingHoliday = new Map([[FRI, obligation(FRI, { kind: "MISSING", reason: "NO_DAY_ROW" } as never, "HOLIDAY_NOT_CONVOKED")]]);
    expect(classifyRotationEntry(at(FRI, "08:00"), missingHoliday, [])).toEqual({ kind: "UNSCHEDULED", reason: "HOLIDAY_NOT_CONVOKED", planIssue: { kind: "MISSING", planReason: "NO_DAY_ROW", detail: [] } });
  });

  it("R4.5: el franco gana aunque la resolución informe otro motivo (feriado no convocado o SIN_TURNO preceden en la obligación)", () => {
    for (const reason of ["HOLIDAY_NOT_CONVOKED", "REGIME_SIN_TURNO"]) {
      const map = new Map([[FRI, { ...obligation(FRI, { kind: "REST" } as never, reason), dayOff: true }]]);
      expect(classifyRotationEntry(at(FRI, "08:00"), map, []).kind).toBe("DAY_OFF");
    }
  });

  it("R4.5: un bloque asignado de D−1 (fecha operativa sin franco) no se oculta por el franco de D", () => {
    const dayOffSaturday = new Map([[SAT, { ...obligation(SAT, { kind: "SHIFTS" } as never, "DAY_OFF"), dayOff: true }]]);
    // El bloque 19:00 del viernes sigue abierto el sábado 02:00: la fichada es del viernes.
    expect(classifyRotationEntry(at(SAT, "02:00"), dayOffSaturday, [B2])).toMatchObject({ kind: "ASSIGNED", block: { obligationKey: B2.obligationKey } });
  });

  it("R4.5: convocado al feriado sin horario → CONVOKED_WITHOUT_SCHEDULE (sólo diagnóstico)", () => {
    const map = new Map([[FRI, obligation(FRI, { kind: "REST" } as never, "HOLIDAY_CONVOCATION_WITHOUT_SCHEDULE")]]);
    expect(classifyRotationEntry(at(FRI, "08:00"), map, [])).toEqual({ kind: "CONVOKED_WITHOUT_SCHEDULE" });
  });

  it("franco, feriado no convocado, régimen sin turno y REST", () => {
    expect(classifyRotationEntry(at(FRI, "08:00"), new Map([[FRI, obligation(FRI, { kind: "SHIFTS" } as never, "DAY_OFF")]]), []).kind).toBe("DAY_OFF");
    expect(classifyRotationEntry(at(FRI, "08:00"), new Map([[FRI, obligation(FRI, { kind: "SHIFTS" } as never, "HOLIDAY_NOT_CONVOKED")]]), [])).toMatchObject({ kind: "UNSCHEDULED", reason: "HOLIDAY_NOT_CONVOKED" });
    expect(classifyRotationEntry(at(FRI, "08:00"), new Map([[FRI, obligation(FRI, { kind: "SHIFTS" } as never, "REGIME_SIN_TURNO")]]), [])).toMatchObject({ kind: "UNSCHEDULED", reason: "REGIME_SIN_TURNO" });
    expect(classifyRotationEntry(at(FRI, "08:00"), new Map([[FRI, obligation(FRI, { kind: "REST" } as never, "ROTATION_REST_DAY")]]), [])).toMatchObject({ kind: "UNSCHEDULED", reason: "REST" });
  });
});

describe("isBlockChangeFromUnblockedShift — R4.5 (jornada abierta sin bloque)", () => {
  it("abierta antes de la ventana del bloque (13:00) y ENTRADA asignada a B2 → cambio de bloque", () => {
    expect(isBlockChangeFromUnblockedShift(at(FRI, "13:00"), B2, BLOCKS)).toBe(true);
    // Una jornada no programada de la víspera también.
    expect(isBlockChangeFromUnblockedShift(at(THU, "20:00"), B1, BLOCKS)).toBe(true);
  });
  it("la jornada abierta ya se asignaría al mismo bloque (misma llegada) o empezó después → no", () => {
    expect(isBlockChangeFromUnblockedShift(at(FRI, "15:01"), B2, BLOCKS)).toBe(false);
    expect(isBlockChangeFromUnblockedShift(at(FRI, "19:30"), B2, BLOCKS)).toBe(false);
  });
});

describe("isRotationBlockShift", () => {
  it("sólo jornadas con bloque congelado (ROTATION/HOLIDAY_CONVOCATION + inicio programado + plantilla)", () => {
    expect(isRotationBlockShift({ shiftTemplateSource: "ROTATION", scheduledStartAt: new Date(), shiftTemplateId: "t" })).toBe(true);
    expect(isRotationBlockShift({ shiftTemplateSource: "HOLIDAY_CONVOCATION", scheduledStartAt: new Date(), shiftTemplateId: "t" })).toBe(true);
    expect(isRotationBlockShift({ shiftTemplateSource: null, scheduledStartAt: null, shiftTemplateId: "t" })).toBe(false);
    expect(isRotationBlockShift({ shiftTemplateSource: "FIXED_ASSIGNMENT", scheduledStartAt: new Date(), shiftTemplateId: "t" })).toBe(false);
    expect(isRotationBlockShift({ shiftTemplateSource: "ROTATION", scheduledStartAt: null, shiftTemplateId: "t" })).toBe(false);
  });
});

describe("publicClockGuidance — allowlist pública", () => {
  const valid = {
    kind: "EXIT_CONFIRMATION_REQUIRED", openShiftId: "s", openShiftStartAt: "2026-11-06T10:00:00.000Z",
    previousBlock: { startAt: "2026-11-06T10:00:00.000Z", endAt: "2026-11-06T14:00:00.000Z" },
    nextBlock: { key: "k", startAt: "2026-11-06T22:00:00.000Z" }, exitAt: "2026-11-06T22:02:00.000Z", exitDurationMinutes: 722,
  };
  it("acepta la forma exacta y descarta campos extra", () => {
    expect(publicClockGuidance({ ...valid, details: "interno" })).toEqual(valid);
  });
  it("rechaza formas inválidas (nunca se publican)", () => {
    expect(publicClockGuidance({ ...valid, kind: "OTRO" })).toBeUndefined();
    expect(publicClockGuidance({ ...valid, nextBlock: null })).toBeUndefined();
    expect(publicClockGuidance({ ...valid, exitDurationMinutes: -1 })).toBeUndefined();
    expect(publicClockGuidance({ ...valid, exitAt: "no-es-fecha" })).toBeUndefined();
    expect(publicClockGuidance({ ...valid, kind: "SHIFT_LIMIT_EXCEEDED", nextBlock: null })).toMatchObject({ kind: "SHIFT_LIMIT_EXCEEDED", nextBlock: null });
  });
});
