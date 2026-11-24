import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { notifyUsers, workforceService } from "../workforce-management/workforce.service";
import { classifyFixedEntry, hasVigentEnabledAssignment, loadEntryDayFacts, unscheduledWorkNote } from "./unscheduledWork";
import { evaluateShiftEntry, evaluateShiftExit } from "./workShiftEvaluationRunner";

/**
 * R4.5 — trabajo no programado (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.7).
 * Juanjo: fijo L–V 07:00–15:00, sin rotación. Calendario 2026-11: sábado 07,
 * domingo 08, lunes 09 (feriado en los casos que lo dicen).
 */
vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    shiftAssignment: { findMany: vi.fn(), findUnique: vi.fn() },
    shiftTemplate: { findMany: vi.fn(), findUnique: vi.fn() },
    workShift: { update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    shiftAlert: { upsert: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    employeeWorkRegime: { findFirst: vi.fn() },
    employeeHourConcept: { findFirst: vi.fn() },
    employeeDayOff: { findMany: vi.fn() },
    holidayWorkAssignment: { findMany: vi.fn() },
  },
}));

vi.mock("../workforce-management/workforce.service", () => ({
  attendanceRecipients: vi.fn().mockResolvedValue([]),
  notifyUsers: vi.fn().mockResolvedValue(undefined),
  workforceService: { holidayDatesInRange: vi.fn() },
}));

type MockedPrisma = {
  shiftAssignment: { findMany: Mock; findUnique: Mock };
  shiftTemplate: { findMany: Mock; findUnique: Mock };
  workShift: { update: Mock; findFirst: Mock; findUnique: Mock };
  shiftAlert: { upsert: Mock; updateMany: Mock; findUnique: Mock; findFirst: Mock };
  employeeWorkRegime: { findFirst: Mock };
  employeeHourConcept: { findFirst: Mock };
  employeeDayOff: { findMany: Mock };
  holidayWorkAssignment: { findMany: Mock };
};
const db = prisma as unknown as MockedPrisma;
const holidayDates = workforceService.holidayDatesInRange as unknown as Mock;

const EMPLOYEE = "juanjo";
const SATURDAY = "2026-11-07";
const SUNDAY = "2026-11-08";
const MONDAY = "2026-11-09";
const art = (dateKey: string, time: string) => new Date(`${dateKey}T${time}:00.000-03:00`);

const template = (overrides: Record<string, unknown> = {}) => ({
  id: "planta-07-15",
  code: "PLANTA-07-15",
  startTime: "07:00",
  endTime: "15:00",
  crossesMidnight: false,
  entryToleranceBeforeMinutes: 10,
  entryToleranceAfterMinutes: 10,
  exitToleranceBeforeMinutes: 10,
  exitToleranceAfterMinutes: 10,
  minimumMinutesForCompliance: 420,
  maximumInformativeMinutes: 600,
  missingOutAlertAfterMinutes: 60,
  absoluteOpenShiftLimitMinutes: 1200,
  status: "ACTIVO",
  ...overrides,
});
const DAY = template();
const NIGHT = template({ id: "noche-23-07", code: "NOCHE-23-07", startTime: "23:00", endTime: "07:00", crossesMidnight: true, minimumMinutesForCompliance: null });
const weekdaysAssignment = (shiftTemplateId: string, weekdays = [1, 2, 3, 4, 5], status = "HABILITADO") => ({
  employeeId: EMPLOYEE, shiftTemplateId, status, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null, weekdays,
});

const upserts = () => db.shiftAlert.upsert.mock.calls.map((call) => call[0]);
const alertTypes = () => upserts().map((call) => call.create.type);
const adopted = () => db.workShift.update.mock.calls.find((call) => call[0]?.data?.shiftTemplateId)?.[0]?.data ?? null;

function givenJuanjo(assignments = [weekdaysAssignment(DAY.id)], templates: unknown[] = [DAY]) {
  db.shiftAssignment.findMany.mockResolvedValue(assignments);
  db.shiftTemplate.findMany.mockResolvedValue(templates);
}
const givenHoliday = (dateKey: string) => holidayDates.mockImplementation(async (from: Date) => (from.toISOString().slice(0, 10) === dateKey ? [{ date: dateKey, rules: [{ id: "f", name: "Feriado" }] }] : []));
const givenDayOff = (dateKey: string) => db.employeeDayOff.findMany.mockImplementation(async ({ where }: { where: { date: Date } }) => (where.date.toISOString().slice(0, 10) === dateKey ? [{ employeeId: EMPLOYEE }] : []));
const givenConvoked = () => db.holidayWorkAssignment.findMany.mockResolvedValue([{ employeeId: EMPLOYEE }]);

beforeEach(() => {
  vi.clearAllMocks();
  holidayDates.mockResolvedValue([]);
  db.employeeDayOff.findMany.mockResolvedValue([]);
  db.holidayWorkAssignment.findMany.mockResolvedValue([]);
  db.employeeWorkRegime.findFirst.mockResolvedValue(null);
  db.shiftAlert.upsert.mockResolvedValue({ id: "alert-1" });
  db.shiftAlert.updateMany.mockResolvedValue({ count: 0 });
  db.shiftAlert.findUnique.mockResolvedValue(null);
  db.employeeHourConcept.findFirst.mockResolvedValue({ employeeId: EMPLOYEE });
  db.shiftTemplate.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => [DAY, NIGHT].find((item) => item.id === where.id) ?? null);
  db.shiftAssignment.findUnique.mockImplementation(async ({ where }: { where: { employeeId_shiftTemplateId: { shiftTemplateId: string } } }) => ({ status: "HABILITADO", shiftTemplateId: where.employeeId_shiftTemplateId.shiftTemplateId }));
});

describe("classifyFixedEntry — precedencia de la fecha operativa", () => {
  const none = { dayOff: false, holiday: false, convoked: false };
  it.each([
    ["asignado en día normal", { case: "ENABLED" }, none, true, { kind: "ASSIGNED" }],
    ["deshabilitado en día normal (SHIFT_NOT_ENABLED, como siempre)", { case: "DISABLED_FOR_EMPLOYEE" }, none, true, { kind: "ASSIGNED" }],
    ["franco gana sobre el turno asignado", { case: "ENABLED" }, { ...none, dayOff: true }, true, { kind: "DAY_OFF" }],
    ["franco gana sobre el feriado convocado", { case: "ENABLED" }, { dayOff: true, holiday: true, convoked: true }, true, { kind: "DAY_OFF" }],
    ["feriado no convocado con turno asignado", { case: "ENABLED" }, { ...none, holiday: true }, true, { kind: "UNSCHEDULED", reason: "FERIADO_NO_CONVOCADO" }],
    ["feriado no convocado sin turno ese día", { case: "NO_MATCH" }, { ...none, holiday: true }, true, { kind: "UNSCHEDULED", reason: "FERIADO_NO_CONVOCADO" }],
    ["feriado convocado con su turno habitual (P8)", { case: "ENABLED" }, { ...none, holiday: true, convoked: true }, true, { kind: "ASSIGNED" }],
    ["feriado convocado sin turno ese día", { case: "NO_MATCH" }, { ...none, holiday: true, convoked: true }, true, { kind: "CONVOKED_WITHOUT_SCHEDULE" }],
    ["día no incluido en su asignación (Juanjo sábado)", { case: "NO_MATCH" }, none, true, { kind: "UNSCHEDULED", reason: "DIA_NO_PROGRAMADO" }],
    ["sin ninguna asignación vigente", { case: "NO_MATCH" }, none, false, { kind: "NO_ASSIGNMENTS" }],
  ] as const)("%s", (_label, match, facts, vigent, expected) => {
    expect(classifyFixedEntry({ match, facts, hasVigentEnabledAssignment: vigent })).toEqual(expected);
  });
});

describe("hasVigentEnabledAssignment", () => {
  const active = new Set([DAY.id]);
  it("HABILITADA y vigente aunque no incluya ese día de la semana → true", () => {
    expect(hasVigentEnabledAssignment([weekdaysAssignment(DAY.id)], active, SATURDAY)).toBe(true);
  });
  it("vencida, futura, DESHABILITADA o con plantilla inactiva → false", () => {
    expect(hasVigentEnabledAssignment([{ ...weekdaysAssignment(DAY.id), effectiveTo: new Date("2026-10-31T00:00:00.000Z") }], active, SATURDAY)).toBe(false);
    expect(hasVigentEnabledAssignment([{ ...weekdaysAssignment(DAY.id), effectiveFrom: new Date("2026-12-01T00:00:00.000Z") }], active, SATURDAY)).toBe(false);
    expect(hasVigentEnabledAssignment([weekdaysAssignment(DAY.id, [1, 2, 3, 4, 5], "DESHABILITADO")], active, SATURDAY)).toBe(false);
    expect(hasVigentEnabledAssignment([weekdaysAssignment(DAY.id)], new Set(), SATURDAY)).toBe(false);
  });
});

describe("unscheduledWorkNote — texto visible sin ids", () => {
  it.each([
    ["DIA_NO_PROGRAMADO", SATURDAY, "Informativa: trabajo sin turno programado el sábado 07/11/2026 (día no incluido en su turno asignado). No requiere revisión."],
    ["FERIADO_NO_CONVOCADO", MONDAY, "Informativa: trabajo sin turno programado el lunes 09/11/2026 (feriado sin convocatoria). No requiere revisión."],
    ["DESCANSO_ROTACION", SUNDAY, "Informativa: trabajo sin turno programado el domingo 08/11/2026 (día de descanso de su rotación). No requiere revisión."],
    ["FUERA_DEL_TURNO", MONDAY, "Informativa: trabajo sin turno programado el lunes 09/11/2026 (fuera de los turnos programados del día). No requiere revisión."],
  ] as const)("%s", (reason, dateKey, text) => {
    expect(unscheduledWorkNote(reason, dateKey)).toBe(text);
  });
});

describe("loadEntryDayFacts — mismos criterios que la obligación", () => {
  it("día común: sin feriado no consulta convocatorias", async () => {
    expect(await loadEntryDayFacts(EMPLOYEE, SATURDAY)).toEqual({ dayOff: false, holiday: false, convoked: false });
    expect(db.holidayWorkAssignment.findMany).not.toHaveBeenCalled();
  });
  it("feriado, convocatoria y franco: filtra por persona y fecha", async () => {
    givenHoliday(MONDAY);
    givenDayOff(MONDAY);
    db.holidayWorkAssignment.findMany.mockResolvedValue([{ employeeId: "otra-persona" }]);
    expect(await loadEntryDayFacts(EMPLOYEE, MONDAY)).toEqual({ dayOff: true, holiday: true, convoked: false });
    expect(db.holidayWorkAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ employeeId: EMPLOYEE, status: "ACTIVA" }) }));
    givenConvoked();
    expect((await loadEntryDayFacts(EMPLOYEE, MONDAY)).convoked).toBe(true);
  });
});

describe("Juanjo (fijo L–V) — fines de semana", () => {
  it.each([SATURDAY, SUNDAY])("%s: trabajo no programado informativo, ya RESUELTO, sin adoptar turno y sin ningún aviso", async (dateKey) => {
    givenJuanjo();
    await evaluateShiftEntry(EMPLOYEE, "shift-weekend", art(dateKey, "08:00"));
    expect(adopted()).toBeNull();
    expect(upserts()).toEqual([expect.objectContaining({
      where: { workShiftId_type: { workShiftId: "shift-weekend", type: "TRABAJO_NO_PROGRAMADO" } },
      create: expect.objectContaining({ type: "TRABAJO_NO_PROGRAMADO", severity: "INFO", status: "RESUELTA", resolvedAt: expect.any(Date), resolutionNote: expect.stringContaining("día no incluido en su turno asignado") }),
      update: {},
    })]);
    expect(upserts()[0].create).not.toHaveProperty("resolvedByUserId");
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("reintento del paso: el mismo upsert vacío (nunca reabre ni avisa)", async () => {
    givenJuanjo();
    await evaluateShiftEntry(EMPLOYEE, "shift-sat", art(SATURDAY, "08:00"));
    await evaluateShiftEntry(EMPLOYEE, "shift-sat", art(SATURDAY, "08:00"));
    expect(upserts()).toHaveLength(2);
    expect(upserts().every((call) => Object.keys(call.update).length === 0)).toBe(true);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("sábado con franco: ninguna alerta en la entrada (el paso de francos deja sólo ACTIVIDAD_EN_FRANCO; antes eran dos avisos)", async () => {
    givenJuanjo();
    givenDayOff(SATURDAY);
    await evaluateShiftEntry(EMPLOYEE, "shift-sat", art(SATURDAY, "08:00"));
    expect(upserts()).toEqual([]);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("salida del sábado sin plantilla: sin alertas de turno; JORNADA_EXTENDIDA sigue siendo una anomalía propia", async () => {
    givenJuanjo();
    await evaluateShiftExit(EMPLOYEE, "shift-sat", art(SATURDAY, "14:00"), [], { startAt: art(SATURDAY, "08:00"), totalMinutes: 360, shiftTemplateId: null });
    expect(upserts()).toEqual([]);
    await evaluateShiftExit(EMPLOYEE, "shift-sat", art(SATURDAY, "20:00"), [], { startAt: art(SATURDAY, "08:00"), totalMinutes: 720, shiftTemplateId: null });
    expect(alertTypes()).toEqual(["JORNADA_EXTENDIDA"]);
  });

  it("sin ninguna asignación vigente: TURNO_NO_IDENTIFICADO con aviso, como siempre (configuración legacy)", async () => {
    givenJuanjo([], []);
    await evaluateShiftEntry(EMPLOYEE, "shift-sat", art(SATURDAY, "08:00"));
    expect(alertTypes()).toEqual(["TURNO_NO_IDENTIFICADO"]);
    expect(notifyUsers).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["SIN_TURNO", { kind: "SIN_TURNO", alertOnOutOfShift: true }],
    ["TURNO_FLEXIBLE", { kind: "TURNO_FLEXIBLE", alertOnOutOfShift: true }],
    ["alertOnOutOfShift=false", { kind: "TURNO_OBLIGATORIO", alertOnOutOfShift: false }],
  ])("régimen %s: ninguna fila ni aviso (D5)", async (_label, workRegime) => {
    givenJuanjo();
    db.employeeWorkRegime.findFirst.mockResolvedValue({ workRegime });
    await evaluateShiftEntry(EMPLOYEE, "shift-sat", art(SATURDAY, "08:00"));
    expect(upserts()).toEqual([]);
    expect(notifyUsers).not.toHaveBeenCalled();
  });
});

describe("Juanjo (fijo L–V) — feriados y francos en día hábil", () => {
  it("día hábil normal (regresión): adopta su turno e INGRESO_TARDE con aviso", async () => {
    givenJuanjo();
    await evaluateShiftEntry(EMPLOYEE, "shift-mon", art(MONDAY, "07:25"));
    expect(adopted()).toMatchObject({ shiftTemplateId: DAY.id });
    expect(alertTypes()).toEqual(["INGRESO_TARDE"]);
    expect(notifyUsers).toHaveBeenCalledTimes(1);
  });

  it("feriado no convocado: adopta su turno (fecha operativa y límites) pero sin puntualidad; informativa, sin aviso", async () => {
    givenJuanjo();
    givenHoliday(MONDAY);
    await evaluateShiftEntry(EMPLOYEE, "shift-mon", art(MONDAY, "07:25"));
    expect(adopted()).toMatchObject({ shiftTemplateId: DAY.id, maxAllowedMinutes: 1200 });
    expect(alertTypes()).toEqual(["TRABAJO_NO_PROGRAMADO"]);
    expect(upserts()[0].create.resolutionNote).toContain("feriado sin convocatoria");
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("feriado convocado: su turno habitual con puntualidad, como siempre (P8)", async () => {
    givenJuanjo();
    givenHoliday(MONDAY);
    givenConvoked();
    await evaluateShiftEntry(EMPLOYEE, "shift-mon", art(MONDAY, "07:25"));
    expect(alertTypes()).toEqual(["INGRESO_TARDE"]);
  });

  it("franco en día hábil: adopta su turno, ninguna alerta de turno ni aviso en la entrada", async () => {
    givenJuanjo();
    givenDayOff(MONDAY);
    await evaluateShiftEntry(EMPLOYEE, "shift-mon", art(MONDAY, "07:25"));
    expect(adopted()).toMatchObject({ shiftTemplateId: DAY.id });
    expect(upserts()).toEqual([]);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("salida en feriado no convocado: sin salida anticipada ni jornada insuficiente; JORNADA_EXTENDIDA sí", async () => {
    givenJuanjo();
    givenHoliday(MONDAY);
    await evaluateShiftExit(EMPLOYEE, "shift-mon", art(MONDAY, "10:00"), [], { startAt: art(MONDAY, "07:00"), totalMinutes: 180, shiftTemplateId: DAY.id });
    expect(upserts()).toEqual([]);
    await evaluateShiftExit(EMPLOYEE, "shift-mon", art(MONDAY, "18:30"), [], { startAt: art(MONDAY, "07:00"), totalMinutes: 690, shiftTemplateId: DAY.id });
    expect(alertTypes()).toEqual(["JORNADA_EXTENDIDA"]);
  });

  it("salida con franco cargado después del ingreso: el franco también prevalece al cerrar", async () => {
    givenJuanjo();
    givenDayOff(MONDAY);
    await evaluateShiftExit(EMPLOYEE, "shift-mon", art(MONDAY, "10:00"), [], { startAt: art(MONDAY, "07:00"), totalMinutes: 180, shiftTemplateId: DAY.id });
    expect(upserts()).toEqual([]);
  });

  it("salida en día hábil normal (regresión): SALIDA_ANTICIPADA y JORNADA_INSUFICIENTE como siempre", async () => {
    givenJuanjo();
    await evaluateShiftExit(EMPLOYEE, "shift-mon", art(MONDAY, "10:00"), [], { startAt: art(MONDAY, "07:00"), totalMinutes: 180, shiftTemplateId: DAY.id });
    expect(alertTypes()).toEqual(expect.arrayContaining(["SALIDA_ANTICIPADA", "JORNADA_INSUFICIENTE"]));
  });
});

describe("turno fijo nocturno (23:00–07:00) — la fecha operativa decide franco y feriado", () => {
  const givenNight = () => givenJuanjo([weekdaysAssignment(NIGHT.id, [0, 1, 2, 3, 4, 5, 6])], [NIGHT]);

  it("ingreso anticipado el domingo 22:00 para el turno del domingo: franco el lunes NO lo afecta", async () => {
    givenNight();
    givenDayOff(MONDAY);
    await evaluateShiftEntry(EMPLOYEE, "shift-night", art(SUNDAY, "22:00"));
    expect(alertTypes()).toEqual(["INGRESO_ANTICIPADO"]);
    expect(db.employeeDayOff.findMany.mock.calls[0]![0].where.date.toISOString().slice(0, 10)).toBe(SUNDAY);
  });

  it("ingreso tardío el lunes 00:30 del turno del domingo (fecha operativa domingo): franco el domingo prevalece", async () => {
    givenNight();
    givenDayOff(SUNDAY);
    await evaluateShiftEntry(EMPLOYEE, "shift-night", art(MONDAY, "00:30"));
    expect(adopted()).toMatchObject({ shiftTemplateId: NIGHT.id });
    expect(upserts()).toEqual([]);
  });

  it("ingreso tardío el lunes 00:30 del turno del domingo: un feriado el lunes NO lo afecta (INGRESO_TARDE)", async () => {
    givenNight();
    givenHoliday(MONDAY);
    await evaluateShiftEntry(EMPLOYEE, "shift-night", art(MONDAY, "00:30"));
    expect(alertTypes()).toEqual(["INGRESO_TARDE"]);
  });

  it("salida 07:05 del lunes de un turno del domingo feriado no convocado: sin alertas de turno", async () => {
    givenNight();
    givenHoliday(SUNDAY);
    await evaluateShiftExit(EMPLOYEE, "shift-night", art(MONDAY, "05:00"), [], { startAt: art(SUNDAY, "23:00"), totalMinutes: 360, shiftTemplateId: NIGHT.id });
    expect(upserts()).toEqual([]);
  });
});

describe("miembro de rotación — clasificación congelada en la fichada", () => {
  const block = { obligationKey: `${EMPLOYEE}|x`, operationalDate: MONDAY, templateCode: "PLANTA-17-03", scheduledStartAt: art(MONDAY, "17:00"), scheduledEndAt: art(MONDAY, "03:00") };
  const entry = (rotationEntry: Record<string, unknown>) => evaluateShiftEntry(EMPLOYEE, "shift-r", art(MONDAY, "11:30"), { rotationEntry: { version: 2, evaluatedAt: art(MONDAY, "11:30"), ...rotationEntry } as never });

  it.each([
    ["REST", "día de descanso de su rotación"],
    ["HOLIDAY_NOT_CONVOKED", "feriado sin convocatoria"],
    ["NO_BLOCKS", "fuera de los turnos programados del día"],
  ])("UNSCHEDULED %s → TRABAJO_NO_PROGRAMADO informativo, sin aviso", async (reason, text) => {
    await entry({ kind: "UNSCHEDULED", reason });
    expect(upserts()).toEqual([expect.objectContaining({ create: expect.objectContaining({ type: "TRABAJO_NO_PROGRAMADO", status: "RESUELTA", resolutionNote: expect.stringContaining(text) }), update: {} })]);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("UNSCHEDULED de régimen SIN_TURNO, o con alertOnOutOfShift=false: ninguna fila", async () => {
    await entry({ kind: "UNSCHEDULED", reason: "REGIME_SIN_TURNO" });
    db.employeeWorkRegime.findFirst.mockResolvedValue({ workRegime: { kind: "TURNO_OBLIGATORIO", alertOnOutOfShift: false } });
    await entry({ kind: "UNSCHEDULED", reason: "REST" });
    expect(upserts()).toEqual([]);
  });

  it("DAY_OFF y CONVOKED_WITHOUT_SCHEDULE: ninguna alerta en la entrada", async () => {
    await entry({ kind: "DAY_OFF", planIssue: { kind: "CONFLICT", planReason: "OVERLAPPING_BLOCKS", detail: [] } });
    await entry({ kind: "CONVOKED_WITHOUT_SCHEDULE" });
    expect(upserts()).toEqual([]);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("OUTSIDE_WINDOW → INGRESO_FUERA_DE_VENTANA (ADVERTENCIA) con su aviso inmediato; nunca TURNO_NO_IDENTIFICADO", async () => {
    await entry({ kind: "OUTSIDE_WINDOW", nearestBlock: block, minutesBefore: 330 });
    expect(upserts()).toEqual([expect.objectContaining({ create: expect.objectContaining({ type: "INGRESO_FUERA_DE_VENTANA", severity: "ADVERTENCIA", differenceMinutes: -330 }) })]);
    expect(notifyUsers).toHaveBeenCalledTimes(1);
    expect((notifyUsers as unknown as Mock).mock.calls[0]![1]).toMatchObject({ title: "Ingreso fuera del horario del turno" });
  });
});
