/**
 * Etapa R1 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §18.1): tests de
 * CARACTERIZACIÓN del sistema de turnos tal como funciona HOY.
 *
 * Congelan el comportamiento actual —incluido el que es incorrecto para el
 * negocio (marcado "COMPORTAMIENTO ACTUAL (bug conocido)")— para poder
 * demostrar paridad cuando la resolución del turno esperado se centralice (R2).
 * No se cambian expectativas para "mejorar" nada: si una etapa futura cambia
 * deliberadamente un comportamiento, el test correspondiente se actualiza en
 * esa misma etapa, con su decisión documentada.
 *
 * Piezas reales: resolveWorkObligationCandidates, checkMissingExpectedEntries
 * (+ evidencia, persistencia y destinatarios), evaluateShiftEntry,
 * evaluateShiftExit, workRegimes.service, y los núcleos puros de
 * workShiftEvaluation.service y expectedWorkday. Mockeados: Prisma (sin base)
 * y los avisos/feriados de workforce.service.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { notifyUsers, workforceService } from "../workforce-management/workforce.service";
import { checkMissingExpectedEntries } from "../time-entries/missingEntry.service";
import { findEmployeeIdsWithMatchingEntryEvidence } from "../time-entries/attendanceInactivity.service";
import { resolveWorkObligationCandidates } from "./workObligation.service";
import { evaluateShiftEntry, evaluateShiftExit } from "./workShiftEvaluationRunner";
import { evaluateEmployeeWorkday, type EmployeeWorkdayContext, type HolidayScopeStatus, type WorkdayConvocation, type WorkdayRegimePeriod } from "./expectedWorkday";
import {
  closestOccurrence,
  evaluateExitPunctuality,
  evaluateOpenShiftRisk,
  evaluateOutOfShiftWorkday,
  matchShiftForEmployee,
  workShiftOperationalDateKey,
  type EmployeeShiftAssignmentRef,
  type ShiftTemplateRef,
} from "./workShiftEvaluation.service";
import { toTemplateRef } from "./workShiftEvaluationRunner";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    // R4.3b: sin membresías de rotación (camino legacy).
    shiftRotationCrewMember: { findMany: vi.fn(async () => []) },
    shiftAssignment: { findMany: vi.fn(), findUnique: vi.fn() },
    shiftTemplate: { findMany: vi.fn(), findUnique: vi.fn() },
    holidayWorkAssignment: { findMany: vi.fn() },
    employeeDayOff: { findMany: vi.fn() },
    employeeWorkRegime: { findMany: vi.fn(), findFirst: vi.fn() },
    workShift: { update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    shiftAlert: { upsert: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
    employeeHourConcept: { findFirst: vi.fn() },
    employee: { findMany: vi.fn() },
    attendancePunch: { findMany: vi.fn() },
    timeEntry: { findMany: vi.fn() },
    novelty: { findMany: vi.fn() },
    attendanceInactivityIncident: { createMany: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    user: { findMany: vi.fn() },
    employeeAssignment: { findMany: vi.fn() },
    userSupervisionAssignment: { findMany: vi.fn() },
    $transaction: vi.fn(),
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
  holidayWorkAssignment: { findMany: Mock };
  employeeDayOff: { findMany: Mock };
  employeeWorkRegime: { findMany: Mock; findFirst: Mock };
  workShift: { update: Mock; findUnique: Mock; findFirst: Mock; findMany: Mock };
  shiftAlert: { upsert: Mock; updateMany: Mock; findUnique: Mock };
  employeeHourConcept: { findFirst: Mock };
  employee: { findMany: Mock };
  attendancePunch: { findMany: Mock };
  timeEntry: { findMany: Mock };
  novelty: { findMany: Mock };
  attendanceInactivityIncident: { createMany: Mock; findMany: Mock; updateMany: Mock };
  user: { findMany: Mock };
  employeeAssignment: { findMany: Mock };
  userSupervisionAssignment: { findMany: Mock };
  $transaction: Mock;
};
const db = prisma as unknown as MockedPrisma;
const holidayDates = workforceService.holidayDatesInRange as unknown as Mock;
const notificationTx = { systemNotification: { createMany: vi.fn() }, attendanceInactivityIncident: { update: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) } };

// ── Fechas (lunes 16/11/2026, sábado 21/11/2026, domingo 22/11/2026) ────────
const MONDAY = "2026-11-16";
const TUESDAY = "2026-11-17";
const SATURDAY = "2026-11-21";
const SUNDAY = "2026-11-22";
const MONDAY_TO_FRIDAY = [1, 2, 3, 4, 5];

/** Instante real a partir de fecha + hora de Argentina (UTC-3, sin horario de verano). */
const art = (dateKey: string, hhmm: string) => new Date(`${dateKey}T${hhmm}:00.000-03:00`);

// ── Fixtures ────────────────────────────────────────────────────────────────

type TemplateRow = ShiftTemplateRef & { expectedMinutes: number | null; status: "ACTIVO" | "INACTIVO" };

function template(overrides: Partial<TemplateRow> & Pick<TemplateRow, "id" | "code" | "startTime" | "endTime">): TemplateRow {
  return {
    crossesMidnight: false,
    expectedMinutes: null,
    entryToleranceBeforeMinutes: 10,
    entryToleranceAfterMinutes: 10,
    exitToleranceBeforeMinutes: 10,
    exitToleranceAfterMinutes: 10,
    minimumMinutesForCompliance: null,
    maximumInformativeMinutes: 900,
    missingOutAlertAfterMinutes: null,
    absoluteOpenShiftLimitMinutes: 1200,
    status: "ACTIVO",
    ...overrides,
  };
}

// A1: turno fijo Oficina, lunes a viernes 06:30-15:00, 510 min, tolerancias de 15 min.
const OFICINA = template({
  id: "oficina",
  code: "OF-01",
  startTime: "06:30",
  endTime: "15:00",
  expectedMinutes: 510,
  entryToleranceBeforeMinutes: 15,
  entryToleranceAfterMinutes: 15,
  exitToleranceBeforeMinutes: 15,
  exitToleranceAfterMinutes: 15,
});
// A6/A7: Planta.
const MANANA = template({ id: "manana", code: "PLANTA-M", startTime: "07:00", endTime: "17:00", expectedMinutes: 600 });
const TARDE = template({ id: "tarde", code: "PLANTA-T", startTime: "17:00", endTime: "03:00", crossesMidnight: true, expectedMinutes: 600 });
const SERENO_FDS = template({ id: "sereno-fds", code: "SERENO-FDS", startTime: "19:00", endTime: "07:00", crossesMidnight: true, expectedMinutes: 720 });
const NOCHE = template({ id: "noche", code: "NOCHE", startTime: "23:00", endTime: "07:00", crossesMidnight: true, expectedMinutes: 480 });
// A3: turno propio de la convocatoria a feriado (distinto del habitual).
const GUARDIA = template({ id: "guardia", code: "GUARDIA-FERIADO", startTime: "08:00", endTime: "12:00", expectedMinutes: 240 });

const EMPLOYEE = "employee-1";

type AssignmentRow = {
  employeeId: string;
  shiftTemplateId: string;
  status: "HABILITADO" | "DESHABILITADO";
  effectiveFrom: Date;
  effectiveTo: Date | null;
  weekdays: number[];
  shiftTemplate: TemplateRow;
};

function assignment(shift: TemplateRow, overrides: Partial<AssignmentRow> = {}): AssignmentRow {
  return {
    employeeId: EMPLOYEE,
    shiftTemplateId: shift.id,
    status: "HABILITADO",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    weekdays: MONDAY_TO_FRIDAY,
    shiftTemplate: shift,
    ...overrides,
  };
}

/** Lo que leen la obligación (findMany con include) y el matching de entrada (findMany sin include). */
function givenAssignments(rows: AssignmentRow[], templates: TemplateRow[] = [...new Map(rows.map((row) => [row.shiftTemplate.id, row.shiftTemplate])).values()]) {
  db.shiftAssignment.findMany.mockResolvedValue(rows);
  db.shiftTemplate.findMany.mockResolvedValue(templates);
}

function givenRegime(kind: "TURNO_OBLIGATORIO" | "TURNO_FLEXIBLE" | "SIN_TURNO", alertOnOutOfShift = kind === "TURNO_OBLIGATORIO") {
  const workRegime = { kind, alertOnOutOfShift, openShiftOverflowAction: "ROLLOVER", extendedShiftAlertMinutes: null };
  db.employeeWorkRegime.findMany.mockResolvedValue([{ employeeId: EMPLOYEE, workRegime }]);
  db.employeeWorkRegime.findFirst.mockResolvedValue({ employeeId: EMPLOYEE, workRegime });
}

/** Jornada cerrada que evalúa la salida (el turno lo adoptó la entrada). */
function givenClosedShift(shift: TemplateRow, assignmentStatus: "HABILITADO" | "DESHABILITADO" | null = "HABILITADO") {
  db.shiftTemplate.findUnique.mockResolvedValue(shift);
  db.shiftAssignment.findUnique.mockResolvedValue(assignmentStatus ? { status: assignmentStatus } : null);
}

function upserted(): Array<{ type: string; differenceMinutes?: number; severity: string }> {
  return db.shiftAlert.upsert.mock.calls.map((call) => call[0].create);
}
const alertTypes = () => upserted().map((alert) => alert.type);

function adoptedTemplate(): { shiftTemplateId: string; maxAllowedMinutes: number } | null {
  const call = db.workShift.update.mock.calls[0];
  return call ? call[0].data : null;
}

async function exitAlerts(shift: TemplateRow, startAt: Date, exitAt: Date) {
  const totalMinutes = Math.round((exitAt.getTime() - startAt.getTime()) / 60_000);
  await evaluateShiftExit(EMPLOYEE, "shift-1", exitAt, [], { startAt, totalMinutes, shiftTemplateId: shift.id }, { rethrow: true });
  return alertTypes();
}

// Contexto del núcleo puro de Novedades (lo que arma loadEmployeeWorkdayContext).
function workdayContext(input: {
  assignments?: AssignmentRow[];
  dayOffs?: string[];
  convocations?: Record<string, WorkdayConvocation>;
  regimes?: WorkdayRegimePeriod[];
  holidays?: Record<string, HolidayScopeStatus>;
}): EmployeeWorkdayContext {
  return {
    employeeId: EMPLOYEE,
    assignments: (input.assignments ?? []).map((row) => ({ status: row.status, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, weekdays: row.weekdays, template: row.shiftTemplate })),
    dayOffDates: new Set(input.dayOffs ?? []),
    convocations: new Map(Object.entries(input.convocations ?? {})),
    regimes: input.regimes ?? [],
    holidays: new Map(Object.entries(input.holidays ?? {})),
  };
}
const regimePeriod = (kind: WorkdayRegimePeriod["kind"]): WorkdayRegimePeriod => ({ kind, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null });

// Matching puro (lo que hace evaluateShiftEntry sin Prisma).
function matchRefs(rows: AssignmentRow[]): EmployeeShiftAssignmentRef[] {
  return rows.map((row) => ({ shiftTemplateId: row.shiftTemplateId, status: row.status, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, weekdays: row.weekdays }));
}

// ── Falta de ingreso (cadena real) ──────────────────────────────────────────

let pendingIncidents: Array<{ id: string; employeeId: string }> = [];

function givenNoEntryPunches() {
  db.attendancePunch.findMany.mockResolvedValue([]);
}
function givenEntryPunchAt(instant: Date) {
  db.attendancePunch.findMany.mockResolvedValue([{ employeeId: EMPLOYEE, timestamp: instant }]);
}
const incidentObservations = (): string[] => db.attendanceInactivityIncident.createMany.mock.calls.flatMap((call) => call[0].data.map((row: { observation: string }) => row.observation));
const notificationMessages = (): string[] => notificationTx.systemNotification.createMany.mock.calls.flatMap((call) => call[0].data.map((row: { message: string }) => row.message));

beforeEach(() => {
  vi.clearAllMocks();
  pendingIncidents = [];
  holidayDates.mockResolvedValue([]);
  db.holidayWorkAssignment.findMany.mockResolvedValue([]);
  db.employeeDayOff.findMany.mockResolvedValue([]);
  db.employeeWorkRegime.findMany.mockResolvedValue([]);
  db.employeeWorkRegime.findFirst.mockResolvedValue(null);
  db.shiftAssignment.findMany.mockResolvedValue([]);
  db.shiftTemplate.findMany.mockResolvedValue([]);
  db.workShift.findFirst.mockResolvedValue(null);
  db.workShift.findMany.mockResolvedValue([]);
  db.shiftAlert.upsert.mockImplementation(async (args: { create: { type: string } }) => ({ id: `alert-${args.create.type}` }));
  db.shiftAlert.updateMany.mockResolvedValue({ count: 0 });
  db.shiftAlert.findUnique.mockResolvedValue(null);
  db.employeeHourConcept.findFirst.mockResolvedValue(null);
  db.employee.findMany.mockResolvedValue([{ id: EMPLOYEE, legajo: "000125", firstName: "Roberto", lastName: "Prueba" }]);
  givenNoEntryPunches();
  db.timeEntry.findMany.mockResolvedValue([]);
  db.novelty.findMany.mockResolvedValue([]);
  db.attendanceInactivityIncident.createMany.mockResolvedValue({ count: 1 });
  db.attendanceInactivityIncident.updateMany.mockResolvedValue({ count: 1 });
  // Con `include` = incidentes a notificar; sin él = PENDIENTES a resolver.
  db.attendanceInactivityIncident.findMany.mockImplementation(async (args: { include?: unknown }) =>
    args.include ? [{ id: "incident-1", employeeId: EMPLOYEE, employee: { id: EMPLOYEE, legajo: "000125", firstName: "Roberto", lastName: "Prueba" } }] : pendingIncidents,
  );
  db.user.findMany.mockResolvedValue([{ id: "rrhh-1" }]);
  db.employeeAssignment.findMany.mockResolvedValue([]);
  db.userSupervisionAssignment.findMany.mockResolvedValue([]);
  db.$transaction.mockImplementation(async (callback: (tx: typeof notificationTx) => unknown) => callback(notificationTx));
});

// ═══════════════════════════════════════════════════════════════════════════
describe("A1 — turno fijo Oficina (L–V 06:30–15:00, 510 min, tolerancias 15)", () => {
  const rows = [assignment(OFICINA)];

  it("lunes: obligación con inicio 06:30 del mismo día", async () => {
    givenAssignments(rows);
    const { isHoliday, candidates } = await resolveWorkObligationCandidates(MONDAY);
    expect(isHoliday).toBe(false);
    expect(candidates).toEqual([{ employeeId: EMPLOYEE, template: toTemplateRef(OFICINA), scheduledStartAt: art(MONDAY, "06:30") }]);
  });

  it("sábado: sin obligación (weekdays excluye el día) y no consulta francos", async () => {
    givenAssignments(rows);
    expect((await resolveWorkObligationCandidates(SATURDAY)).candidates).toEqual([]);
    expect(db.employeeDayOff.findMany).not.toHaveBeenCalled();
  });

  it("falta de ingreso: 06:44 todavía no vence; 06:45 sin fichada sí (deadline = inicio + 15)", async () => {
    givenAssignments(rows);
    expect((await checkMissingExpectedEntries(art(MONDAY, "06:44"))).due).toBe(0);
    const result = await checkMissingExpectedEntries(art(MONDAY, "06:45"));
    expect(result).toMatchObject({ candidates: 1, due: 1, created: 1 });
    expect(incidentObservations()[0]).toContain("OF-01 (06:30)");
  });

  it("entrada dentro de tolerancia (06:40 y 06:16): adopta OF-01 sin alertas", async () => {
    givenAssignments(rows);
    await evaluateShiftEntry(EMPLOYEE, "shift-1", art(MONDAY, "06:40"));
    expect(adoptedTemplate()).toEqual({ shiftTemplateId: "oficina", maxAllowedMinutes: 1200, templateRulesSnapshot: expect.objectContaining({ version: 1, templateId: "oficina" }) }); // R4.6: + snapshot de reglas
    await evaluateShiftEntry(EMPLOYEE, "shift-2", art(MONDAY, "06:16"));
    expect(alertTypes()).toEqual([]);
  });

  it("entrada fuera de tolerancia: 06:46 → INGRESO_TARDE (+16); 06:14 → INGRESO_ANTICIPADO (−16, INFO)", async () => {
    givenAssignments(rows);
    await evaluateShiftEntry(EMPLOYEE, "shift-1", art(MONDAY, "06:46"));
    await evaluateShiftEntry(EMPLOYEE, "shift-2", art(MONDAY, "06:14"));
    expect(upserted()).toEqual([
      expect.objectContaining({ type: "INGRESO_TARDE", differenceMinutes: 16, severity: "ADVERTENCIA" }),
      expect.objectContaining({ type: "INGRESO_ANTICIPADO", differenceMinutes: -16, severity: "INFO" }),
    ]);
  });

  // R4.5 (SHIFT_ROTATION_AUDIT_PLAN.md §25.7): cambio aprobado — antes TURNO_NO_IDENTIFICADO con aviso.
  it("entrada de sábado (sin turno aplicable ese día, sin régimen): TRABAJO_NO_PROGRAMADO informativo y no adopta turno (R4.5)", async () => {
    givenAssignments(rows);
    await evaluateShiftEntry(EMPLOYEE, "shift-1", art(SATURDAY, "06:30"));
    expect(adoptedTemplate()).toBeNull();
    expect(alertTypes()).toEqual(["TRABAJO_NO_PROGRAMADO"]);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("salida: usa las tolerancias de salida del turno adoptado (±15 sobre 15:00)", async () => {
    givenClosedShift(OFICINA);
    const startAt = art(MONDAY, "06:30");
    expect(await exitAlerts(OFICINA, startAt, art(MONDAY, "14:45"))).toEqual([]);
    expect(await exitAlerts(OFICINA, startAt, art(MONDAY, "15:15"))).toEqual([]);
    expect(await exitAlerts(OFICINA, startAt, art(MONDAY, "14:44"))).toEqual(["SALIDA_ANTICIPADA"]);
    db.shiftAlert.upsert.mockClear();
    expect(await exitAlerts(OFICINA, startAt, art(MONDAY, "15:16"))).toEqual(["SALIDA_TARDIA"]);
    expect(upserted()[0]).toMatchObject({ differenceMinutes: 16 });
  });

  it("Novedades: lunes 510 min del turno asignado; sábado 0 confirmado (NO_WORK_OBLIGATION)", () => {
    const context = workdayContext({ assignments: rows });
    expect(evaluateEmployeeWorkday(context, MONDAY)).toEqual({
      dateKey: MONDAY,
      obligation: "WORKDAY",
      unresolvedReason: null,
      expectedMinutes: 510,
      shiftTemplateIds: ["oficina"],
      isHoliday: false,
      convoked: false,
      source: "SHIFT_PLAN",
      minutesSource: "SHIFT_ASSIGNMENT",
    });
    expect(evaluateEmployeeWorkday(context, SATURDAY)).toMatchObject({ obligation: "NO_WORK_OBLIGATION", expectedMinutes: 0, source: "SHIFT_PLAN" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("A2 — feriado sin convocatoria", () => {
  const rows = [assignment(OFICINA)];

  beforeEach(() => holidayDates.mockResolvedValue([{ date: MONDAY, rules: [{ id: "feriado", name: "Feriado" }] }]));

  it("obligación: ninguna, y corta antes de leer asignaciones", async () => {
    givenAssignments(rows);
    expect(await resolveWorkObligationCandidates(MONDAY)).toEqual({ isHoliday: true, candidates: [] });
    expect(db.shiftAssignment.findMany).not.toHaveBeenCalled();
  });

  it("falta de ingreso: ninguna, aunque la tolerancia del turno habitual haya vencido", async () => {
    givenAssignments(rows);
    expect(await checkMissingExpectedEntries(art(MONDAY, "09:00"))).toEqual({ candidates: 0, due: 0, created: 0, resolved: 0 });
    expect(db.attendanceInactivityIncident.createMany).not.toHaveBeenCalled();
  });

  it("Novedades: HOLIDAY_NOT_CONVOKED (0 confirmado) cuando la regla FERIADO alcanza al legajo", () => {
    expect(evaluateEmployeeWorkday(workdayContext({ assignments: rows, holidays: { [MONDAY]: "IN_SCOPE" } }), MONDAY)).toMatchObject({
      obligation: "HOLIDAY_NOT_CONVOKED",
      expectedMinutes: 0,
      isHoliday: true,
      convoked: false,
      source: "HOLIDAY_RULE",
    });
  });

  it("COMPORTAMIENTO ACTUAL (deuda P7): feriado fuera del alcance del legajo — alertas lo tratan como feriado (sin obligación) y Novedades como día normal (510)", async () => {
    givenAssignments(rows);
    expect((await resolveWorkObligationCandidates(MONDAY)).candidates).toEqual([]);
    expect(evaluateEmployeeWorkday(workdayContext({ assignments: rows, holidays: { [MONDAY]: "OUT_OF_SCOPE" } }), MONDAY)).toMatchObject({
      obligation: "WORKDAY",
      expectedMinutes: 510,
      isHoliday: false,
    });
  });

  // R4.5 (§25.7): el matching sigue sin mirar feriados (adopta OF-01, que fija
  // la fecha operativa), pero sin convocatoria no hay turno exigible: sólo la
  // clasificación informativa, sin alertas de turno ni aviso.
  it("la entrada no mira feriados: fichar 06:35 en feriado adopta OF-01 sin alertas de turno; trabajo no programado informativo (R4.5)", async () => {
    givenAssignments(rows);
    await evaluateShiftEntry(EMPLOYEE, "shift-1", art(MONDAY, "06:35"));
    expect(adoptedTemplate()?.shiftTemplateId).toBe("oficina");
    expect(alertTypes()).toEqual(["TRABAJO_NO_PROGRAMADO"]);
    expect(notifyUsers).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("A3 — feriado con convocatoria ACTIVA", () => {
  const rows = [assignment(OFICINA)];

  beforeEach(() => {
    holidayDates.mockResolvedValue([{ date: MONDAY, rules: [{ id: "feriado", name: "Feriado" }] }]);
    db.holidayWorkAssignment.findMany.mockResolvedValue([{ employeeId: EMPLOYEE }]);
  });

  it("obligación (alertas): usa el turno HABITUAL aplicable (OF-01 06:30), nunca el turno de la convocatoria", async () => {
    givenAssignments(rows);
    const { isHoliday, candidates } = await resolveWorkObligationCandidates(MONDAY);
    expect(isHoliday).toBe(true);
    expect(candidates.map((candidate) => [candidate.template.code, candidate.scheduledStartAt])).toEqual([["OF-01", art(MONDAY, "06:30")]]);
    // La lectura de asignaciones se restringe a los convocados.
    expect(db.shiftAssignment.findMany.mock.calls[0]![0].where.employeeId).toEqual({ in: [EMPLOYEE] });
  });

  it("COMPORTAMIENTO ACTUAL (P8): convocado sin asignación aplicable → alertas no ven obligación", async () => {
    givenAssignments([]);
    expect((await resolveWorkObligationCandidates(MONDAY)).candidates).toEqual([]);
  });

  it("Novedades: el turno de la convocatoria gana (GUARDIA 240 min); sin turno, el habitual (510); sin ninguno, el horario de la convocatoria", () => {
    const holidays = { [MONDAY]: "IN_SCOPE" as const };
    const withTemplate = evaluateEmployeeWorkday(
      workdayContext({ assignments: rows, holidays, convocations: { [MONDAY]: { template: GUARDIA, expectedStartTime: null, expectedEndTime: null } } }),
      MONDAY,
    );
    expect(withTemplate).toMatchObject({ obligation: "WORKDAY", expectedMinutes: 240, shiftTemplateIds: ["guardia"], convoked: true, isHoliday: true, source: "HOLIDAY_CONVOCATION", minutesSource: "CONVOCATION_SHIFT_TEMPLATE" });

    const habitual = evaluateEmployeeWorkday(workdayContext({ assignments: rows, holidays, convocations: { [MONDAY]: { template: null, expectedStartTime: null, expectedEndTime: null } } }), MONDAY);
    expect(habitual).toMatchObject({ obligation: "WORKDAY", expectedMinutes: 510, shiftTemplateIds: ["oficina"], source: "HOLIDAY_CONVOCATION", minutesSource: "SHIFT_ASSIGNMENT" });

    const times = evaluateEmployeeWorkday(workdayContext({ holidays, convocations: { [MONDAY]: { template: null, expectedStartTime: "09:00", expectedEndTime: "13:00" } } }), MONDAY);
    expect(times).toMatchObject({ obligation: "WORKDAY", expectedMinutes: 240, shiftTemplateIds: [], source: "HOLIDAY_CONVOCATION", minutesSource: "CONVOCATION_TIMES" });
  });

  it("entrada (turno usado por el matching): el habitual. Fichar 08:00 para la guardia 08:00 da INGRESO_TARDE +90 contra OF-01", async () => {
    givenAssignments(rows);
    await evaluateShiftEntry(EMPLOYEE, "shift-1", art(MONDAY, "08:00"));
    expect(adoptedTemplate()?.shiftTemplateId).toBe("oficina");
    expect(upserted()).toEqual([expect.objectContaining({ type: "INGRESO_TARDE", differenceMinutes: 90 })]);
  });

  it("Novedades: una convocatoria sin regla FERIADO ese día no aporta nada (día normal)", () => {
    const context = workdayContext({ assignments: rows, convocations: { [MONDAY]: { template: GUARDIA, expectedStartTime: null, expectedEndTime: null } } });
    expect(evaluateEmployeeWorkday(context, MONDAY)).toMatchObject({ obligation: "WORKDAY", expectedMinutes: 510, convoked: false, source: "SHIFT_PLAN" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("A4 — franco (EmployeeDayOff ACTIVO)", () => {
  const rows = [assignment(OFICINA)];

  it("obligación: ninguna; consulta sólo francos ACTIVO de la fecha y de los candidatos", async () => {
    givenAssignments(rows);
    db.employeeDayOff.findMany.mockResolvedValue([{ employeeId: EMPLOYEE }]);
    expect((await resolveWorkObligationCandidates(MONDAY)).candidates).toEqual([]);
    expect(db.employeeDayOff.findMany.mock.calls[0]![0].where).toMatchObject({ status: "ACTIVO", employeeId: { in: [EMPLOYEE] } });
  });

  it("falta de ingreso: ninguna", async () => {
    givenAssignments(rows);
    db.employeeDayOff.findMany.mockResolvedValue([{ employeeId: EMPLOYEE }]);
    expect((await checkMissingExpectedEntries(art(MONDAY, "09:00"))).created).toBe(0);
    expect(db.attendanceInactivityIncident.createMany).not.toHaveBeenCalled();
  });

  it("precedencia (alertas): franco gana sobre feriado convocado", async () => {
    givenAssignments(rows);
    holidayDates.mockResolvedValue([{ date: MONDAY, rules: [] }]);
    db.holidayWorkAssignment.findMany.mockResolvedValue([{ employeeId: EMPLOYEE }]);
    db.employeeDayOff.findMany.mockResolvedValue([{ employeeId: EMPLOYEE }]);
    expect((await resolveWorkObligationCandidates(MONDAY)).candidates).toEqual([]);
  });

  it("Novedades: DAY_OFF (0 confirmado), también sobre feriado convocado y sobre SIN_TURNO", () => {
    const expected = { obligation: "DAY_OFF", expectedMinutes: 0, source: "EMPLOYEE_DAY_OFF", shiftTemplateIds: [] };
    expect(evaluateEmployeeWorkday(workdayContext({ assignments: rows, dayOffs: [MONDAY] }), MONDAY)).toMatchObject(expected);
    expect(
      evaluateEmployeeWorkday(
        workdayContext({ assignments: rows, dayOffs: [MONDAY], holidays: { [MONDAY]: "IN_SCOPE" }, convocations: { [MONDAY]: { template: GUARDIA, expectedStartTime: null, expectedEndTime: null } } }),
        MONDAY,
      ),
    ).toMatchObject({ ...expected, convoked: true, isHoliday: true });
    expect(evaluateEmployeeWorkday(workdayContext({ assignments: rows, dayOffs: [MONDAY], regimes: [regimePeriod("SIN_TURNO")] }), MONDAY)).toMatchObject(expected);
  });

  it("la entrada no mira francos: fichar 06:35 en franco adopta OF-01 sin alertas de turno", async () => {
    givenAssignments(rows);
    db.employeeDayOff.findMany.mockResolvedValue([{ employeeId: EMPLOYEE }]);
    await evaluateShiftEntry(EMPLOYEE, "shift-1", art(MONDAY, "06:35"));
    expect(adoptedTemplate()?.shiftTemplateId).toBe("oficina");
    expect(alertTypes()).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("A5 — regímenes", () => {
  const rows = [assignment(OFICINA)];

  it.each([
    ["sin régimen", null, 1],
    ["TURNO_OBLIGATORIO", "TURNO_OBLIGATORIO", 1],
    ["TURNO_FLEXIBLE (asignación propia = obligación explícita)", "TURNO_FLEXIBLE", 1],
    ["SIN_TURNO (aunque conserve la asignación)", "SIN_TURNO", 0],
  ] as const)("obligación con %s", async (_label, kind, expectedCandidates) => {
    givenAssignments(rows);
    if (kind) givenRegime(kind);
    expect((await resolveWorkObligationCandidates(MONDAY)).candidates).toHaveLength(expectedCandidates);
  });

  it.each([
    ["sin régimen", null, ["TURNO_NO_IDENTIFICADO"]],
    ["TURNO_OBLIGATORIO con alertOnOutOfShift", "TURNO_OBLIGATORIO", ["TURNO_NO_IDENTIFICADO"]],
    ["TURNO_FLEXIBLE", "TURNO_FLEXIBLE", []],
    ["SIN_TURNO", "SIN_TURNO", []],
  ] as const)("entrada sin turno aplicable con %s", async (_label, kind, expected) => {
    givenAssignments([]);
    if (kind) givenRegime(kind);
    await evaluateShiftEntry(EMPLOYEE, "shift-1", art(MONDAY, "10:00"));
    expect(alertTypes()).toEqual(expected);
  });

  it("TURNO_OBLIGATORIO con alertOnOutOfShift = false también suprime TURNO_NO_IDENTIFICADO", async () => {
    givenAssignments([]);
    givenRegime("TURNO_OBLIGATORIO", false);
    await evaluateShiftEntry(EMPLOYEE, "shift-1", art(MONDAY, "10:00"));
    expect(alertTypes()).toEqual([]);
  });

  it("COMPORTAMIENTO ACTUAL: la puntualidad de ingreso no depende del régimen — SIN_TURNO con asignación sigue generando INGRESO_TARDE", async () => {
    givenAssignments(rows);
    givenRegime("SIN_TURNO");
    await evaluateShiftEntry(EMPLOYEE, "shift-1", art(MONDAY, "07:30"));
    expect(alertTypes()).toEqual(["INGRESO_TARDE"]);
  });

  it("salida fuera del horario del turno: JORNADA_FUERA_DE_TURNO salvo SIN_TURNO", async () => {
    givenClosedShift(OFICINA);
    givenRegime("TURNO_OBLIGATORIO");
    expect(await exitAlerts(OFICINA, art(MONDAY, "16:00"), art(MONDAY, "20:00"))).toEqual(["JORNADA_FUERA_DE_TURNO"]);
    db.shiftAlert.upsert.mockClear();
    givenRegime("SIN_TURNO");
    expect(await exitAlerts(OFICINA, art(MONDAY, "16:00"), art(MONDAY, "20:00"))).toEqual(["SALIDA_TARDIA"]);
  });

  it("Novedades: SIN_TURNO → UNRESOLVED; TURNO_FLEXIBLE sin turno aplicable → UNRESOLVED; TURNO_OBLIGATORIO fuera de días → 0 confirmado", () => {
    expect(evaluateEmployeeWorkday(workdayContext({ assignments: rows, regimes: [regimePeriod("SIN_TURNO")] }), MONDAY)).toMatchObject({ obligation: "UNRESOLVED", unresolvedReason: "REGIME_WITHOUT_SCHEDULE", expectedMinutes: null, source: "WORK_REGIME" });
    expect(evaluateEmployeeWorkday(workdayContext({ assignments: rows, regimes: [regimePeriod("TURNO_FLEXIBLE")] }), MONDAY)).toMatchObject({ obligation: "WORKDAY", expectedMinutes: 510 });
    expect(evaluateEmployeeWorkday(workdayContext({ assignments: rows, regimes: [regimePeriod("TURNO_FLEXIBLE")] }), SATURDAY)).toMatchObject({ obligation: "UNRESOLVED", unresolvedReason: "FLEXIBLE_REGIME_NO_ASSIGNMENT" });
    expect(evaluateEmployeeWorkday(workdayContext({ assignments: rows, regimes: [regimePeriod("TURNO_OBLIGATORIO")] }), SATURDAY)).toMatchObject({ obligation: "NO_WORK_OBLIGATION", expectedMinutes: 0 });
    expect(evaluateEmployeeWorkday(workdayContext({}), MONDAY)).toMatchObject({ obligation: "UNRESOLVED", unresolvedReason: "SCHEDULE_MISSING", source: "NONE" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("A6 — dos turnos HABILITADOS aplicables el mismo día (Mañana 07–17 + Tarde 17–03)", () => {
  // Orden de lectura deliberadamente "Tarde primero": el resultado no depende del orden.
  const rows = [assignment(TARDE), assignment(MANANA)];

  it("COMPORTAMIENTO ACTUAL (bug conocido P1): la obligación elige el inicio más temprano → Mañana 07:00", async () => {
    givenAssignments(rows);
    const { candidates } = await resolveWorkObligationCandidates(MONDAY);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ template: { code: "PLANTA-M" }, scheduledStartAt: art(MONDAY, "07:00") });
  });

  it("COMPORTAMIENTO ACTUAL (bug conocido P1): quien trabaja de tarde recibe falta de ingreso de la mañana a las 07:10 y se notifica", async () => {
    givenAssignments(rows);
    const result = await checkMissingExpectedEntries(art(MONDAY, "07:10"));
    expect(result).toMatchObject({ candidates: 1, due: 1, created: 1 });
    expect(incidentObservations()).toEqual([expect.stringContaining("PLANTA-M (07:00)")]);
    expect(notificationMessages()).toEqual([expect.stringContaining("PLANTA-M (07:00)")]);
    expect(notificationTx.systemNotification.createMany.mock.calls[0]![0].data[0]).toMatchObject({ recipientUserId: "rrhh-1", type: "FALTA_INGRESO" });
  });

  it("COMPORTAMIENTO ACTUAL: la fichada real de las 17:00 «cumple» la obligación de las 07:00 y auto-resuelve el incidente (la notificación ya salió)", async () => {
    givenAssignments(rows);
    givenEntryPunchAt(art(MONDAY, "17:00"));
    pendingIncidents = [{ id: "incident-1", employeeId: EMPLOYEE }];
    const result = await checkMissingExpectedEntries(art(MONDAY, "17:05"));
    expect(result).toMatchObject({ created: 0, resolved: 1 });
    expect(db.attendanceInactivityIncident.updateMany.mock.calls[0]![0]).toMatchObject({ where: { id: { in: ["incident-1"] } }, data: { status: "RESUELTA" } });
  });

  it("COMPORTAMIENTO ACTUAL: una fichada desde las 19:01 ya no pertenece a la ocurrencia 07:00 → el incidente queda PENDIENTE", async () => {
    expect(closestOccurrence(art(MONDAY, "19:00"), "07:00").scheduledAt).toEqual(art(MONDAY, "07:00"));
    expect(closestOccurrence(art(MONDAY, "19:01"), "07:00").scheduledAt).toEqual(art(TUESDAY, "07:00"));
    givenAssignments(rows);
    givenEntryPunchAt(art(MONDAY, "19:01"));
    pendingIncidents = [{ id: "incident-1", employeeId: EMPLOYEE }];
    expect((await checkMissingExpectedEntries(art(MONDAY, "19:05"))).resolved).toBe(0);
    expect(db.attendanceInactivityIncident.updateMany).not.toHaveBeenCalled();
  });

  it("entrada 16:55 → adopta Tarde (ocurrencia más cercana), sin alertas", async () => {
    givenAssignments(rows);
    await evaluateShiftEntry(EMPLOYEE, "shift-1", art(MONDAY, "16:55"));
    expect(adoptedTemplate()?.shiftTemplateId).toBe("tarde");
    expect(alertTypes()).toEqual([]);
  });

  it("COMPORTAMIENTO ACTUAL (bug conocido P3): entrada 11:30 → adopta Mañana e INGRESO_TARDE +270", async () => {
    givenAssignments(rows);
    await evaluateShiftEntry(EMPLOYEE, "shift-1", art(MONDAY, "11:30"));
    expect(adoptedTemplate()?.shiftTemplateId).toBe("manana");
    expect(upserted()).toEqual([expect.objectContaining({ type: "INGRESO_TARDE", differenceMinutes: 270 })]);
  });

  it("empate exacto 12:00 (5 h de cada lado): gana el primero leído — depende del orden de las asignaciones", () => {
    const templates = [toTemplateRef(MANANA), toTemplateRef(TARDE)];
    expect(matchShiftForEmployee({ actualAt: art(MONDAY, "12:00"), employeeAssignments: matchRefs([assignment(MANANA), assignment(TARDE)]), activeTemplates: templates }).template?.id).toBe("manana");
    expect(matchShiftForEmployee({ actualAt: art(MONDAY, "12:00"), employeeAssignments: matchRefs([assignment(TARDE), assignment(MANANA)]), activeTemplates: templates }).template?.id).toBe("tarde");
  });

  it("salida: usa SOLO el turno adoptado en la entrada (Mañana adoptada a las 11:30, salida 03:00 → SALIDA_TARDIA +600, y 930 min > 900 del turno → JORNADA_EXTENDIDA)", async () => {
    givenClosedShift(MANANA);
    expect(await exitAlerts(MANANA, art(MONDAY, "11:30"), art(TUESDAY, "03:00"))).toEqual(["SALIDA_TARDIA", "JORNADA_EXTENDIDA"]);
    expect(upserted()[0]).toMatchObject({ differenceMinutes: 600 });
    expect(db.shiftTemplate.findUnique.mock.calls[0]![0]).toEqual({ where: { id: "manana" } });
  });

  it("salida con Tarde adoptada (16:55 → 03:05): sin alertas", async () => {
    givenClosedShift(TARDE);
    expect(await exitAlerts(TARDE, art(MONDAY, "16:55"), art(TUESDAY, "03:05"))).toEqual([]);
  });

  it("COMPORTAMIENTO ACTUAL (bug conocido P2): Novedades suma los dos turnos disjuntos → 1200 min", () => {
    expect(evaluateEmployeeWorkday(workdayContext({ assignments: rows }), MONDAY)).toMatchObject({
      obligation: "WORKDAY",
      expectedMinutes: 1200,
      shiftTemplateIds: ["tarde", "manana"],
      source: "SHIFT_PLAN",
    });
  });

  it("Novedades: dos turnos superpuestos (07–17 y 12–20) → UNRESOLVED SHIFT_ASSIGNMENTS_OVERLAP", () => {
    const overlapping = template({ id: "intermedio", code: "INTERMEDIO", startTime: "12:00", endTime: "20:00", expectedMinutes: 480 });
    expect(evaluateEmployeeWorkday(workdayContext({ assignments: [assignment(MANANA), assignment(overlapping)] }), MONDAY)).toMatchObject({
      obligation: "UNRESOLVED",
      unresolvedReason: "SHIFT_ASSIGNMENTS_OVERLAP",
      expectedMinutes: null,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("A7 — turnos que cruzan medianoche (17–03, 19–07, 23–07)", () => {
  it.each([
    [TARDE, "17:00", "03:00"],
    [SERENO_FDS, "19:00", "07:00"],
    [NOCHE, "23:00", "07:00"],
  ] as const)("obligación %s: inicio el mismo día operativo", async (shift, start, _end) => {
    givenAssignments([assignment(shift, { weekdays: [] })]);
    const { candidates } = await resolveWorkObligationCandidates(MONDAY);
    expect(candidates[0]!.scheduledStartAt).toEqual(art(MONDAY, start));
  });

  it.each([
    [TARDE, "17:00", "03:00"],
    [SERENO_FDS, "19:00", "07:00"],
    [NOCHE, "23:00", "07:00"],
  ] as const)("%s: fin programado y salida esperada al día siguiente", (shift, start, end) => {
    const ref = toTemplateRef(shift);
    const startAt = art(MONDAY, start);
    expect(evaluateOpenShiftRisk({ startAt, now: art(MONDAY, start), template: ref }).expectedExitAt).toEqual(art(TUESDAY, end));
    expect(evaluateExitPunctuality({ match: { case: "ENABLED", template: ref, differenceMinutes: 0 }, startAt, actualExitAt: art(TUESDAY, end) })).toMatchObject({
      evaluated: true,
      earlyLeave: false,
      lateLeave: false,
      differenceMinutes: 0,
      scheduledExitAt: art(TUESDAY, end),
    });
    expect(evaluateOutOfShiftWorkday({ match: { case: "ENABLED", template: ref, differenceMinutes: 0 }, actualStartAt: startAt, actualEndAt: art(TUESDAY, end) })).toMatchObject({
      outsideShift: false,
      scheduledStartAt: startAt,
      scheduledEndAt: art(TUESDAY, end),
    });
  });

  it("fecha operativa: la del inicio programado, aun con ingreso tardío pasada la medianoche", () => {
    expect(workShiftOperationalDateKey(art(MONDAY, "17:02"), TARDE)).toBe(MONDAY);
    expect(workShiftOperationalDateKey(art(SUNDAY, "19:00"), SERENO_FDS)).toBe(SUNDAY);
    expect(workShiftOperationalDateKey(art(TUESDAY, "00:15"), NOCHE)).toBe(MONDAY);
    // Sin turno adoptado: fecha calendario del ingreso.
    expect(workShiftOperationalDateKey(art(TUESDAY, "00:15"), null)).toBe(TUESDAY);
  });

  it("salida al día siguiente con tolerancia: NOCHE 23:00 → 07:05 sin alertas; 07:11 SALIDA_TARDIA", async () => {
    givenClosedShift(NOCHE);
    expect(await exitAlerts(NOCHE, art(MONDAY, "23:00"), art(TUESDAY, "07:05"))).toEqual([]);
    expect(await exitAlerts(NOCHE, art(MONDAY, "23:00"), art(TUESDAY, "07:11"))).toEqual(["SALIDA_TARDIA"]);
  });

  it("falta de ingreso del turno 23:00: vence a las 23:10 del mismo día operativo", async () => {
    givenAssignments([assignment(NOCHE, { weekdays: [] })]);
    expect((await checkMissingExpectedEntries(art(MONDAY, "23:09"))).due).toBe(0);
    expect((await checkMissingExpectedEntries(art(MONDAY, "23:10"))).due).toBe(1);
  });

  it("Novedades: minutos atribuidos a la fecha operativa de inicio (600 / 720 / 480)", () => {
    for (const [shift, minutes] of [[TARDE, 600], [SERENO_FDS, 720], [NOCHE, 480]] as const) {
      expect(evaluateEmployeeWorkday(workdayContext({ assignments: [assignment(shift, { weekdays: [] })] }), MONDAY)).toMatchObject({ obligation: "WORKDAY", expectedMinutes: minutes });
    }
  });

  it("COMPORTAMIENTO ACTUAL (P9): la entrada evalúa weekdays con el día CALENDARIO de la fichada — sereno sólo domingo [0], ingreso anticipado el sábado 23:55 a un turno de 00:00 no matchea", () => {
    const midnight = template({ id: "medianoche", code: "MEDIANOCHE", startTime: "00:00", endTime: "08:00", expectedMinutes: 480 });
    const refs = matchRefs([assignment(midnight, { weekdays: [0] })]);
    expect(matchShiftForEmployee({ actualAt: art(SATURDAY, "23:55"), employeeAssignments: refs, activeTemplates: [toTemplateRef(midnight)] }).case).toBe("NO_MATCH");
    expect(matchShiftForEmployee({ actualAt: art(SUNDAY, "00:05"), employeeAssignments: refs, activeTemplates: [toTemplateRef(midnight)] }).case).toBe("ENABLED");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("A8 — estado de la asignación (HABILITADO vs DESHABILITADO)", () => {
  it("obligación: la consulta sólo trae HABILITADO, empleado ACTIVO y turno ACTIVO", async () => {
    await resolveWorkObligationCandidates(MONDAY);
    expect(db.shiftAssignment.findMany.mock.calls[0]![0]).toEqual({
      where: { status: "HABILITADO", employee: { status: "ACTIVO" }, shiftTemplate: { status: "ACTIVO" } },
      include: { shiftTemplate: true },
    });
  });

  it("entrada con asignación DESHABILITADA aplicable: adopta el turno y genera SHIFT_NOT_ENABLED_FOR_EMPLOYEE, sin puntualidad aunque llegue tarde", async () => {
    givenAssignments([assignment(OFICINA, { status: "DESHABILITADO" })]);
    await evaluateShiftEntry(EMPLOYEE, "shift-1", art(MONDAY, "08:00"));
    expect(adoptedTemplate()?.shiftTemplateId).toBe("oficina");
    expect(alertTypes()).toEqual(["SHIFT_NOT_ENABLED_FOR_EMPLOYEE"]);
  });

  it("COMPORTAMIENTO ACTUAL: HABILITADA Mañana + DESHABILITADA Tarde, entrada 16:55 → gana la deshabilitada (más cercana) y alerta SHIFT_NOT_ENABLED", async () => {
    givenAssignments([assignment(MANANA), assignment(TARDE, { status: "DESHABILITADO" })]);
    await evaluateShiftEntry(EMPLOYEE, "shift-1", art(MONDAY, "16:55"));
    expect(adoptedTemplate()?.shiftTemplateId).toBe("tarde");
    expect(alertTypes()).toEqual(["SHIFT_NOT_ENABLED_FOR_EMPLOYEE"]);
  });

  it("SHIFT_NOT_ENABLED_FOR_EMPLOYEE se suprime con régimen SIN_TURNO / TURNO_FLEXIBLE", async () => {
    givenAssignments([assignment(OFICINA, { status: "DESHABILITADO" })]);
    givenRegime("TURNO_FLEXIBLE");
    await evaluateShiftEntry(EMPLOYEE, "shift-1", art(MONDAY, "06:30"));
    expect(alertTypes()).toEqual([]);
  });

  it("salida con turno adoptado cuya asignación está DESHABILITADA: sin puntualidad de salida", async () => {
    givenClosedShift(OFICINA, "DESHABILITADO");
    expect(await exitAlerts(OFICINA, art(MONDAY, "06:30"), art(MONDAY, "18:00"))).toEqual([]);
  });

  it("COMPORTAMIENTO ACTUAL (P6): turno adoptado sin ninguna asignación (GENERAL_UNASSIGNED) → sin puntualidad de salida y la duración se mide contra el default de 600 min, no contra el turno", async () => {
    givenClosedShift(OFICINA, null);
    // 690 min: con la asignación DESHABILITADA (test anterior) no alerta porque usa el umbral del turno (900).
    expect(await exitAlerts(OFICINA, art(MONDAY, "06:30"), art(MONDAY, "18:00"))).toEqual(["JORNADA_EXTENDIDA"]);
  });

  it("salida: el estado se lee de la asignación SIN mirar su vigencia (findUnique por empleado + turno)", async () => {
    givenClosedShift(OFICINA);
    await exitAlerts(OFICINA, art(MONDAY, "06:30"), art(MONDAY, "15:00"));
    expect(db.shiftAssignment.findUnique.mock.calls[0]![0]).toEqual({ where: { employeeId_shiftTemplateId: { employeeId: EMPLOYEE, shiftTemplateId: "oficina" } } });
  });

  it("Novedades: una asignación DESHABILITADA no cuenta (sin otra planificación → UNRESOLVED SCHEDULE_MISSING)", () => {
    expect(evaluateEmployeeWorkday(workdayContext({ assignments: [assignment(OFICINA, { status: "DESHABILITADO" })] }), MONDAY)).toMatchObject({
      obligation: "UNRESOLVED",
      unresolvedReason: "SCHEDULE_MISSING",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R1.1 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.1): caracterización de
// los comportamientos legacy que las etapas R4.x van a cambiar, con el
// calendario real de Planta (noviembre 2026; lunes 02/11 = Semana A).
// ═══════════════════════════════════════════════════════════════════════════
const PLANTA_FRIDAY = "2026-11-06";
const PLANTA_SATURDAY = "2026-11-07";
const PLANTA_THURSDAY = "2026-11-05";

describe("R1.1-A — trabajo sin turno programado (Juanjo: fijo L–V 07:00–15:00, ficha un sábado)", () => {
  const JUANJO_SHIFT = template({ id: "juanjo-07-15", code: "PLANTA-07-15", startTime: "07:00", endTime: "15:00", expectedMinutes: 480, maximumInformativeMinutes: 540 });
  const rows = [assignment(JUANJO_SHIFT)];

  it("sábado sin fichada: sin obligación, sin incidente de falta de ingreso, y Novedades 0 confirmado", async () => {
    givenAssignments(rows);
    expect((await resolveWorkObligationCandidates(PLANTA_SATURDAY)).candidates).toEqual([]);
    expect(await checkMissingExpectedEntries(art(PLANTA_SATURDAY, "07:10"))).toEqual({ candidates: 0, due: 0, created: 0, resolved: 0 });
    expect(db.attendanceInactivityIncident.createMany).not.toHaveBeenCalled();
    expect(evaluateEmployeeWorkday(workdayContext({ assignments: rows }), PLANTA_SATURDAY)).toMatchObject({ obligation: "NO_WORK_OBLIGATION", expectedMinutes: 0, source: "SHIFT_PLAN" });
  });

  // R4.5 (§25.7): cambio previsto desde R1.1 — antes TURNO_NO_IDENTIFICADO (ADVERTENCIA) con aviso ALERTA_FICHADA.
  it("R4.5: la entrada del sábado no adopta plantilla y queda clasificada TRABAJO_NO_PROGRAMADO (INFO, ya RESUELTA, sin aviso)", async () => {
    givenAssignments(rows);
    await evaluateShiftEntry(EMPLOYEE, "shift-sat", art(PLANTA_SATURDAY, "07:00"));
    expect(adoptedTemplate()).toBeNull();
    expect(upserted()).toEqual([expect.objectContaining({ type: "TRABAJO_NO_PROGRAMADO", severity: "INFO", status: "RESUELTA" })]);
    expect((upserted()[0] as { resolutionNote?: string }).resolutionNote).toMatch(/^Informativa: trabajo sin turno programado el sábado 07\/11\/2026 \(día no incluido en su turno asignado\)\. No requiere revisión\.$/);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it.each([
    ["SIN_TURNO", "SIN_TURNO", true],
    ["TURNO_FLEXIBLE", "TURNO_FLEXIBLE", true],
    ["TURNO_OBLIGATORIO con alertOnOutOfShift=false", "TURNO_OBLIGATORIO", false],
  ] as const)("la alerta del sábado se suprime con régimen %s (sin aviso)", async (_label, kind, alertOnOutOfShift) => {
    givenAssignments(rows);
    givenRegime(kind, kind === "TURNO_OBLIGATORIO" ? alertOnOutOfShift : undefined);
    await evaluateShiftEntry(EMPLOYEE, "shift-sat", art(PLANTA_SATURDAY, "07:00"));
    expect(alertTypes()).toEqual([]);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("salida de la jornada sin plantilla: sin puntualidad ni FUERA_DE_TURNO; JORNADA_EXTENDIDA sólo por encima del default de 600 min; nunca JORNADA_INSUFICIENTE", async () => {
    const startAt = art(PLANTA_SATURDAY, "07:00");
    const exit = async (exitAt: Date) => {
      db.shiftAlert.upsert.mockClear();
      const totalMinutes = Math.round((exitAt.getTime() - startAt.getTime()) / 60_000);
      await evaluateShiftExit(EMPLOYEE, "shift-sat", exitAt, [], { startAt, totalMinutes, shiftTemplateId: null }, { rethrow: true });
      return alertTypes();
    };
    expect(await exit(art(PLANTA_SATURDAY, "07:30"))).toEqual([]); // 30 min: sin mínimo que exigir
    expect(await exit(art(PLANTA_SATURDAY, "17:00"))).toEqual([]); // 600 min: no supera el default
    expect(await exit(art(PLANTA_SATURDAY, "17:01"))).toEqual(["JORNADA_EXTENDIDA"]); // 601 min
    expect(db.shiftTemplate.findUnique).not.toHaveBeenCalled();
    expect(db.shiftAssignment.findUnique).not.toHaveBeenCalled();
  });
});

describe("R1.1-D — evidencia de ingreso por plantilla aislada (José viernes A: 07:00–11:00 + 19:00–07:00)", () => {
  const BLOCK_07 = template({ id: "jose-07-11", code: "PLANTA-07-11", startTime: "07:00", endTime: "11:00", expectedMinutes: 240 });
  const BLOCK_19 = template({ id: "jose-19-07", code: "PLANTA-19-07", startTime: "19:00", endTime: "07:00", crossesMidnight: true, expectedMinutes: 720 });
  const candidate07 = { employeeId: EMPLOYEE, template: toTemplateRef(BLOCK_07), scheduledStartAt: art(PLANTA_FRIDAY, "07:00") };
  const candidate19 = { employeeId: EMPLOYEE, template: toTemplateRef(BLOCK_19), scheduledStartAt: art(PLANTA_FRIDAY, "19:00") };

  it("COMPORTAMIENTO ACTUAL (bug latente, cambia en R4.3b): una fichada a las 07:02 cuenta como ingreso del bloque de las 19:00 (ocurrencia más cercana de 19:00 = viernes 19:00, a 11 h 58 m)", async () => {
    expect(closestOccurrence(art(PLANTA_FRIDAY, "07:02"), "19:00").scheduledAt).toEqual(art(PLANTA_FRIDAY, "19:00"));
    givenEntryPunchAt(art(PLANTA_FRIDAY, "07:02"));
    expect(await findEmployeeIdsWithMatchingEntryEvidence([candidate19])).toEqual(new Set([EMPLOYEE]));
  });

  it("una fichada a las 06:58 no cuenta para el bloque de las 19:00 (la ocurrencia más cercana es jueves 19:00, a 11 h 58 m)", async () => {
    expect(closestOccurrence(art(PLANTA_FRIDAY, "06:58"), "19:00").scheduledAt).toEqual(art(PLANTA_THURSDAY, "19:00"));
    givenEntryPunchAt(art(PLANTA_FRIDAY, "06:58"));
    expect(await findEmployeeIdsWithMatchingEntryEvidence([candidate19])).toEqual(new Set());
  });

  it("COMPORTAMIENTO ACTUAL (cambia en R4.3b): el resultado es por empleado — con los dos bloques y una sola fichada 07:00, el empleado figura como satisfecho", async () => {
    givenEntryPunchAt(art(PLANTA_FRIDAY, "07:00"));
    const evidence = await findEmployeeIdsWithMatchingEntryEvidence([candidate07, candidate19]);
    expect(evidence).toBeInstanceOf(Set);
    expect([...evidence]).toEqual([EMPLOYEE]);
  });

  it("la búsqueda de fichadas es una sola consulta de INGRESO en ±24 h alrededor de los inicios programados", async () => {
    givenEntryPunchAt(art(PLANTA_FRIDAY, "07:00"));
    await findEmployeeIdsWithMatchingEntryEvidence([candidate07, candidate19]);
    expect(db.attendancePunch.findMany).toHaveBeenCalledTimes(1);
    expect(db.attendancePunch.findMany.mock.calls[0]![0]).toMatchObject({
      where: { employeeId: { in: [EMPLOYEE, EMPLOYEE] }, type: "INGRESO", timestamp: { gte: art(PLANTA_THURSDAY, "07:00"), lt: art("2026-11-07", "19:00") } },
    });
  });

  it("COMPORTAMIENTO ACTUAL (cambia en R4.3a): el incidente de falta de ingreso es uno por empleado y día — createMany con skipDuplicates sobre (employeeId, operationalDate)", async () => {
    givenAssignments([assignment(BLOCK_07, { weekdays: [] })]);
    await checkMissingExpectedEntries(art(PLANTA_FRIDAY, "07:10"));
    const call = db.attendanceInactivityIncident.createMany.mock.calls[0]![0];
    expect(call.skipDuplicates).toBe(true);
    expect(call.data).toHaveLength(1);
    expect(call.data[0]).toMatchObject({ employeeId: EMPLOYEE, operationalDate: new Date(`${PLANTA_FRIDAY}T00:00:00.000Z`) });
    expect(Object.keys(call.data[0])).not.toContain("scheduledStartAt");
  });
});
