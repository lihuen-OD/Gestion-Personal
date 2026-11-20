import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../../shared/prisma/client";
import { workforceService } from "../../workforce-management/workforce.service";
import { resolveWorkObligationCandidates } from "../workObligation.service";
import { readOnlyClient } from "./readOnlyDiagnostic";
import {
  buildShiftAssignmentDiagnostic,
  currentWorkObligationPick,
  formatShiftAssignmentDiagnostic,
  resolveDiagnosticRange,
  runShiftAssignmentDiagnostic,
  summarizeCategoryNames,
  type DiagnosticAssignment,
  type DiagnosticTemplate,
  type ShiftDiagnosticReader,
} from "./shiftAssignmentDiagnostic";

// Sólo para el test de paridad contra la función real de obligación.
vi.mock("../../../shared/prisma/client", () => ({
  prisma: {
    // R4.3b: sin membresías de rotación (camino legacy).
    shiftRotationCrewMember: { findMany: vi.fn(async () => []) },
    holidayWorkAssignment: { findMany: vi.fn() },
    shiftAssignment: { findMany: vi.fn() },
    employeeDayOff: { findMany: vi.fn() },
    employeeWorkRegime: { findMany: vi.fn() },
  },
}));
vi.mock("../../workforce-management/workforce.service", () => ({ workforceService: { holidayDatesInRange: vi.fn() } }));

const db = prisma as unknown as Record<string, { findMany: Mock }>;
const holidayDates = workforceService.holidayDatesInRange as unknown as Mock;

const MONDAY = "2026-11-16";
const SATURDAY = "2026-11-21";

function template(overrides: Partial<DiagnosticTemplate> & Pick<DiagnosticTemplate, "id" | "code" | "startTime" | "endTime">): DiagnosticTemplate {
  return {
    name: overrides.code,
    categoryName: null,
    crossesMidnight: false,
    expectedMinutes: null,
    status: "ACTIVO",
    entryToleranceBeforeMinutes: 10,
    entryToleranceAfterMinutes: 10,
    exitToleranceBeforeMinutes: 10,
    exitToleranceAfterMinutes: 10,
    minimumMinutesForCompliance: null,
    maximumInformativeMinutes: 900,
    missingOutAlertAfterMinutes: null,
    absoluteOpenShiftLimitMinutes: 1200,
    ...overrides,
  };
}

const MANANA = template({ id: "manana", code: "PLANTA-M", name: "Planta mañana", categoryName: "Planta", startTime: "07:00", endTime: "17:00", expectedMinutes: 600 });
const TARDE = template({ id: "tarde", code: "PLANTA-T", name: "Planta tarde", categoryName: "Planta", startTime: "17:00", endTime: "03:00", crossesMidnight: true, expectedMinutes: 600 });
const INTERMEDIO = template({ id: "intermedio", code: "INTER", startTime: "12:00", endTime: "20:00", expectedMinutes: 480 });
const OFICINA = template({ id: "oficina", code: "OF-01", categoryName: "Administrativo", startTime: "06:30", endTime: "15:00", expectedMinutes: 510 });

const employee = (id: string, status = "ACTIVO") => ({ id, legajo: id.replace("e", "00"), firstName: "Nombre", lastName: `Apellido ${id}`, status });

function assignment(employeeId: string, shift: DiagnosticTemplate, overrides: Partial<DiagnosticAssignment> = {}): DiagnosticAssignment {
  return {
    id: `${employeeId}-${shift.id}`,
    employeeId,
    shiftTemplateId: shift.id,
    status: "HABILITADO",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    weekdays: [1, 2, 3, 4, 5],
    employee: employee(employeeId),
    ...overrides,
  };
}

/** Lector falso con la forma de Prisma; las lecturas del cargador real de Novedades se resuelven desde los fixtures. */
function fakeReader(input: {
  templates: DiagnosticTemplate[];
  assignments: DiagnosticAssignment[];
  dayOffs?: Array<{ employeeId: string; date: Date }>;
  convocations?: Array<{ employeeId: string; date: Date }>;
  regimes?: Array<{ employeeId: string; kind: "TURNO_OBLIGATORIO" | "TURNO_FLEXIBLE" | "SIN_TURNO" }>;
}) {
  const templatesById = new Map(input.templates.map((item) => [item.id, item]));
  const reader = {
    shiftTemplate: { findMany: vi.fn().mockResolvedValue(input.templates) },
    shiftAssignment: {
      findMany: vi.fn(async (args: { where?: { employeeId?: { in: string[] } } }) => {
        if (!args.where) return input.assignments;
        const ids = new Set(args.where.employeeId?.in ?? []);
        return input.assignments
          .filter((row) => ids.has(row.employeeId) && row.status === "HABILITADO")
          .map((row) => ({ ...row, shiftTemplate: templatesById.get(row.shiftTemplateId) }));
      }),
    },
    employeeDayOff: { findMany: vi.fn().mockResolvedValue(input.dayOffs ?? []) },
    holidayWorkAssignment: { findMany: vi.fn().mockResolvedValue((input.convocations ?? []).map((row) => ({ ...row, expectedStartTime: null, expectedEndTime: null, shiftTemplate: null }))) },
    employeeWorkRegime: {
      findMany: vi.fn().mockResolvedValue((input.regimes ?? []).map((row) => ({ employeeId: row.employeeId, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null, workRegime: { kind: row.kind } }))),
    },
    doubleHourRule: { findMany: vi.fn().mockResolvedValue([]) },
    // R4.3b: sin membresías de rotación (camino legacy).
    shiftRotationCrewMember: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return reader;
}

async function run(input: Parameters<typeof fakeReader>[0], range = { from: MONDAY, to: "2026-11-22" }) {
  const reader = fakeReader(input);
  // El diagnóstico corre siempre detrás del proxy de sólo lectura: si usara
  // cualquier operación que no sea de lectura, este test fallaría.
  const report = await runShiftAssignmentDiagnostic(readOnlyClient(reader) as unknown as ShiftDiagnosticReader, range);
  return { report, reader };
}

describe("B1 — categoryName", () => {
  it("agrupa por valor exacto, null aparte y al final; informa colisiones sin fusionarlas", () => {
    const { categories, collisions } = summarizeCategoryNames([
      template({ id: "a", code: "B", startTime: "07:00", endTime: "15:00", categoryName: "Planta" }),
      template({ id: "b", code: "A", startTime: "07:00", endTime: "15:00", categoryName: "Planta" }),
      template({ id: "c", code: "C", startTime: "07:00", endTime: "15:00", categoryName: "planta " }),
      template({ id: "d", code: "D", startTime: "07:00", endTime: "15:00", categoryName: null, status: "INACTIVO" }),
      template({ id: "e", code: "E", startTime: "07:00", endTime: "15:00", categoryName: "Sereno" }),
    ]);
    expect(categories.map((item) => [item.value, item.count, item.templates.map((t) => t.code)])).toEqual([
      ["Planta", 2, ["A", "B"]],
      ["planta ", 1, ["C"]],
      ["Sereno", 1, ["E"]],
      [null, 1, ["D"]],
    ]);
    expect(collisions).toEqual([{ normalized: "planta", values: ["Planta", "planta "] }]);
  });
});

describe("rango", () => {
  it("por defecto: 28 días desde hoy (Argentina), explícito y acotado", () => {
    expect(resolveDiagnosticRange(null, null, MONDAY)).toEqual({ from: MONDAY, to: "2026-12-13", days: 28 });
    expect(resolveDiagnosticRange("2026-11-01", "2026-11-30", MONDAY)).toEqual({ from: "2026-11-01", to: "2026-11-30", days: 30 });
    expect(() => resolveDiagnosticRange("2026-01-01", "2027-12-31", MONDAY)).toThrow();
  });
});

describe("paridad: currentWorkObligationPick replica a resolveWorkObligationCandidates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holidayDates.mockResolvedValue([]);
    db.holidayWorkAssignment!.findMany.mockResolvedValue([]);
    db.employeeDayOff!.findMany.mockResolvedValue([]);
    db.employeeWorkRegime!.findMany.mockResolvedValue([]);
  });

  const scenarios: Array<{
    name: string;
    templates: DiagnosticTemplate[];
    holiday?: boolean;
    convoked?: boolean;
    dayOff?: boolean;
    regime?: "TURNO_OBLIGATORIO" | "TURNO_FLEXIBLE" | "SIN_TURNO";
  }> = [
    { name: "Mañana + Tarde", templates: [TARDE, MANANA] },
    { name: "Tarde + Intermedio", templates: [TARDE, INTERMEDIO] },
    { name: "empate de inicio (gana el primero leído)", templates: [template({ id: "x", code: "X", startTime: "07:00", endTime: "12:00" }), template({ id: "y", code: "Y", startTime: "07:00", endTime: "15:00" })] },
    { name: "un solo turno", templates: [OFICINA] },
    { name: "feriado sin convocatoria", templates: [TARDE, MANANA], holiday: true },
    { name: "feriado convocado", templates: [TARDE, MANANA], holiday: true, convoked: true },
    { name: "franco", templates: [TARDE, MANANA], dayOff: true },
    { name: "SIN_TURNO", templates: [TARDE, MANANA], regime: "SIN_TURNO" },
    { name: "TURNO_FLEXIBLE", templates: [TARDE, MANANA], regime: "TURNO_FLEXIBLE" },
  ];

  it.each(scenarios)("$name", async (scenario) => {
    db.shiftAssignment!.findMany.mockResolvedValue(scenario.templates.map((shift) => ({ ...assignment("e1", shift), shiftTemplate: shift })));
    if (scenario.holiday) holidayDates.mockResolvedValue([{ date: MONDAY, rules: [] }]);
    if (scenario.convoked) db.holidayWorkAssignment!.findMany.mockResolvedValue([{ employeeId: "e1" }]);
    if (scenario.dayOff) db.employeeDayOff!.findMany.mockResolvedValue([{ employeeId: "e1" }]);
    if (scenario.regime) db.employeeWorkRegime!.findMany.mockResolvedValue([{ employeeId: "e1", workRegime: { kind: scenario.regime } }]);

    const real = await resolveWorkObligationCandidates(MONDAY);
    const replica = currentWorkObligationPick({
      dateKey: MONDAY,
      applicable: scenario.templates,
      isHolidayByCalendar: Boolean(scenario.holiday),
      convoked: Boolean(scenario.convoked),
      regimeKind: scenario.regime ?? null,
      dayOff: Boolean(scenario.dayOff),
    });
    expect(replica.code).toBe(real.candidates[0]?.template.code ?? null);
    if (replica.code) expect(replica.scheduledStart).toBe(real.candidates[0]!.template.startTime);
  });
});

describe("B2/B3 — conflictos y comportamiento actual", () => {
  it("Mañana + Tarde L–V: conflicto sólo de lunes a viernes, con el comportamiento actual de cada consumidor", async () => {
    const { report } = await run({ templates: [MANANA, TARDE, OFICINA], assignments: [assignment("e1", MANANA), assignment("e1", TARDE), assignment("e2", OFICINA)] });

    expect(report.summary).toMatchObject({
      templates: 3,
      activeEmployeesWithEnabledAssignments: 2,
      employeesWithMultipleEnabledAssignments: 1,
      employeesWithConflict: 1,
      conflictingEmployeeDays: 5,
      conflictDaysWithObligation: 5,
      conflictDaysWithSummedExpectedMinutes: 5,
      conflictDaysUnresolved: 0,
      conflictDaysWithOverlap: 0,
      templatesByCategory: { Administrativo: 1, Planta: 2 },
    });
    const [conflict] = report.conflicts;
    expect(conflict).toMatchObject({ legajo: "001", conflictDays: 5, potentialOverlaps: [{ codes: ["PLANTA-M", "PLANTA-T"], from: "2026-01-01", to: null, weekdays: [1, 2, 3, 4, 5] }] });
    expect(conflict!.assignments.map((item) => [item.code, item.crossesMidnight])).toEqual([["PLANTA-M", false], ["PLANTA-T", true]]);
    // Lunes y viernes difieren sólo en el día de semana de la firma: varios grupos con el mismo comportamiento.
    for (const group of conflict!.groups) {
      expect(group.workObligation).toEqual({ code: "PLANTA-M", scheduledStart: "07:00", reason: "EARLIEST_START" });
      expect(group.entryCandidates).toEqual([{ code: "PLANTA-M", status: "HABILITADO" }, { code: "PLANTA-T", status: "HABILITADO" }]);
      expect(group.expectedWorkday).toEqual({ obligation: "WORKDAY", expectedMinutes: 1200, unresolvedReason: null, source: "SHIFT_PLAN" });
      expect(group.overlap).toBe(false);
    }
    expect(conflict!.groups.flatMap((group) => group.dates).sort()).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
  });

  it("ruteo de la entrada con la función real: 11:30 → Mañana, 16:55 → Tarde", async () => {
    const { report } = await run({ templates: [MANANA, TARDE], assignments: [assignment("e1", MANANA), assignment("e1", TARDE)] });
    const routing = report.conflicts[0]!.groups[0]!.entryRouting;
    const routeAt = (time: string) => routing.find((range) => range.from <= time && time <= range.to)?.code;
    expect(routeAt("11:30")).toBe("PLANTA-M");
    expect(routeAt("11:59")).toBe("PLANTA-M");
    expect(routeAt("12:01")).toBe("PLANTA-T");
    expect(routeAt("16:55")).toBe("PLANTA-T");
    expect(routing[0]!.from).toBe("00:00");
    expect(routing[routing.length - 1]!.to).toBe("23:59");
  });

  it("turnos superpuestos → Novedades UNRESOLVED y overlap = YES", async () => {
    const { report } = await run({ templates: [MANANA, INTERMEDIO], assignments: [assignment("e1", MANANA), assignment("e1", INTERMEDIO)] });
    expect(report.summary).toMatchObject({ conflictDaysUnresolved: 5, conflictDaysWithOverlap: 5, conflictDaysWithSummedExpectedMinutes: 0 });
    expect(report.conflicts[0]!.groups[0]).toMatchObject({ overlap: true, expectedWorkday: { obligation: "UNRESOLVED", unresolvedReason: "SHIFT_ASSIGNMENTS_OVERLAP" } });
  });

  it("no es conflicto: días disjuntos, vigencias alternadas, asignación DESHABILITADA, turno INACTIVO, empleado inactivo", async () => {
    const weekend = { ...TARDE, id: "tarde-fds", code: "PLANTA-T-FDS" };
    const inactiveTemplate = { ...INTERMEDIO, id: "inactivo", code: "INACTIVO", status: "INACTIVO" as const };
    const { report } = await run({
      templates: [MANANA, TARDE, weekend, inactiveTemplate],
      assignments: [
        assignment("e1", MANANA),
        assignment("e1", weekend, { weekdays: [0, 6] }),
        assignment("e2", MANANA, { effectiveTo: new Date("2026-11-18T00:00:00.000Z") }),
        assignment("e2", TARDE, { effectiveFrom: new Date("2026-11-19T00:00:00.000Z") }),
        assignment("e3", MANANA),
        assignment("e3", TARDE, { status: "DESHABILITADO" }),
        assignment("e4", MANANA),
        assignment("e4", inactiveTemplate),
        assignment("e5", MANANA, { employee: employee("e5", "INACTIVO") }),
        assignment("e5", TARDE, { employee: employee("e5", "INACTIVO") }),
      ],
    });
    expect(report.conflicts).toEqual([]);
    expect(report.summary).toMatchObject({
      activeEmployeesWithEnabledAssignments: 4,
      employeesWithMultipleEnabledAssignments: 2,
      inactiveEmployeesWithMultipleEnabledAssignments: 1,
      employeesWithConflict: 0,
      conflictingEmployeeDays: 0,
    });
  });

  it("asignación DESHABILITADA aplicable aparece entre los candidatos de entrada (y gana el ruteo cerca de su horario)", async () => {
    const { report } = await run({
      templates: [MANANA, TARDE, INTERMEDIO],
      assignments: [assignment("e1", MANANA), assignment("e1", INTERMEDIO), assignment("e1", TARDE, { status: "DESHABILITADO" })],
    });
    const group = report.conflicts[0]!.groups[0]!;
    expect(group.entryCandidates).toEqual([
      { code: "PLANTA-M", status: "HABILITADO" },
      { code: "INTER", status: "HABILITADO" },
      { code: "PLANTA-T", status: "DESHABILITADO" },
    ]);
    expect(group.entryRouting.find((range) => range.from <= "16:55" && "16:55" <= range.to)).toMatchObject({ code: "PLANTA-T", case: "DISABLED_FOR_EMPLOYEE" });
  });

  it("franco, feriado convocado y SIN_TURNO quedan reflejados con el resultado real de cada consumidor", async () => {
    const { report } = await run(
      {
        templates: [MANANA, TARDE],
        assignments: [assignment("e1", MANANA), assignment("e1", TARDE), assignment("e2", MANANA), assignment("e2", TARDE)],
        dayOffs: [{ employeeId: "e1", date: new Date(`${MONDAY}T00:00:00.000Z`) }],
        regimes: [{ employeeId: "e2", kind: "SIN_TURNO" }],
      },
      { from: MONDAY, to: MONDAY },
    );
    const [first, second] = report.conflicts;
    expect(first!.groups[0]).toMatchObject({ dayOff: true, workObligation: { code: null, reason: "DAY_OFF" }, expectedWorkday: { obligation: "DAY_OFF", expectedMinutes: 0 } });
    expect(second!.groups[0]).toMatchObject({ regimeKind: "SIN_TURNO", workObligation: { code: null, reason: "REGIME_SIN_TURNO" }, expectedWorkday: { obligation: "UNRESOLVED", unresolvedReason: "REGIME_WITHOUT_SCHEDULE" } });
    expect(report.summary.conflictDaysWithObligation).toBe(0);
  });

  it("el contexto de Novedades se carga sólo para empleados con 2+ HABILITADAS", async () => {
    const { reader } = await run({ templates: [MANANA, TARDE, OFICINA], assignments: [assignment("e1", MANANA), assignment("e1", TARDE), assignment("e2", OFICINA)] });
    expect(reader.employeeDayOff.findMany.mock.calls[0]![0].where.employeeId).toEqual({ in: ["e1"] });
  });
});

describe("formato humano", () => {
  it("incluye modo, categorías, conflicto y resumen", async () => {
    const { report } = await run({ templates: [MANANA, TARDE], assignments: [assignment("e1", MANANA), assignment("e1", TARDE)] }, { from: MONDAY, to: SATURDAY });
    const text = formatShiftAssignmentDiagnostic(report);
    expect(text).toContain("Mode: READ ONLY DIAGNOSTIC");
    expect(text).toContain('- "Planta": 2 plantilla(s)');
    expect(text).toContain("Employee 001 - Apellido e1, Nombre (5 día(s) en conflicto)");
    expect(text).toContain("- PLANTA-T 17:00–03:00 (cruza medianoche) · HABILITADO · vigencia 2026-01-01 → sin fin · días Lu Ma Mi Ju Vi");
    expect(text).toContain("- Work obligation (falta de ingreso / inactividad): PLANTA-M 07:00");
    expect(text).toContain("- Expected schedule (Novedades): WORKDAY 1200 min");
    expect(text).toContain("- Overlap: NO");
    expect(text).toContain("- conflicting employee-days: 5");
  });

  it("sin conflictos lo dice explícitamente", () => {
    const report = buildShiftAssignmentDiagnostic({ from: MONDAY, to: MONDAY, templates: [], assignments: [], workdayContexts: new Map() });
    expect(formatShiftAssignmentDiagnostic(report)).toContain("- ninguno en el rango analizado");
  });
});
