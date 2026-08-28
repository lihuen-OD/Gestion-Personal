import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { timeEntriesRepository } from "./timeEntries.repository";
import { flagOpenShiftOverflowForReview, resolveOpenShiftOverflowAlert } from "../shifts/workShiftEvaluationRunner";

vi.mock("../shifts/workShiftEvaluationRunner", () => ({
  flagOpenShiftOverflowForReview: vi.fn().mockResolvedValue(undefined),
  resolveOpenShiftOverflowAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../shared/prisma/client", () => {
  const tx = {
    workShift: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    employeeHourConcept: { findFirst: vi.fn() },
    timeEntry: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    attendancePunch: { create: vi.fn(), findMany: vi.fn() },
    timeSegment: { create: vi.fn() },
    doubleHourRule: { findMany: vi.fn() },
    hourConcept: { findMany: vi.fn() },
    specialHourRuleApplication: { create: vi.fn() },
    employee: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
    hourConceptBreakdown: { findMany: vi.fn() },
    novelty: { findMany: vi.fn() },
  };
  return {
    prisma: {
      workShift: { findMany: vi.fn(), count: vi.fn() },
      employeeHourConcept: { findFirst: vi.fn() },
      hourConcept: { findFirst: vi.fn() },
      employeeWorkRegime: { findFirst: vi.fn() },
      attendancePunch: { findMany: vi.fn(), count: vi.fn() },
      attendanceInactivityIncident: { findMany: vi.fn(), count: vi.fn() },
      // Etapa 11A: create()/update() manuales resuelven el multiplicador de
      // Horas Especiales vía `prisma` directo (no `tx`) — ver comentario de
      // resolveDoubleHourMultiplierForManualEntry en timeEntries.repository.ts.
      employee: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
      doubleHourRule: { findMany: vi.fn() },
      timeEntry: { aggregate: vi.fn(), groupBy: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
      hourConceptBreakdown: { findMany: vi.fn() },
      // $transaction real acepta un callback (uso transaccional clásico) o un
      // array de promesas (uso de "varias queries en paralelo" tipo
      // attendanceObservations) — el mock soporta ambas formas.
      $transaction: vi.fn((arg: ((tx: unknown) => unknown) | Promise<unknown>[]) =>
        Array.isArray(arg) ? Promise.all(arg) : arg(tx),
      ),
      __tx: tx,
    },
  };
});

type TxMocks = {
  workShift: { findFirst: Mock; findMany: Mock; updateMany: Mock; create: Mock; update: Mock };
  employeeHourConcept: { findFirst: Mock };
  timeEntry: { create: Mock; findFirst: Mock; update: Mock; findMany: Mock };
  attendancePunch: { create: Mock; findMany: Mock };
  timeSegment: { create: Mock };
  doubleHourRule: { findMany: Mock };
  hourConcept: { findMany: Mock };
  specialHourRuleApplication: { create: Mock };
  employee: { findMany: Mock; count: Mock; findUnique: Mock };
  hourConceptBreakdown: { findMany: Mock };
  novelty: { findMany: Mock };
};

const mockedPrisma = prisma as unknown as {
  workShift: { findMany: Mock; count: Mock };
  employeeHourConcept: { findFirst: Mock };
  hourConcept: { findFirst: Mock };
  employeeWorkRegime: { findFirst: Mock };
  attendancePunch: { findMany: Mock; count: Mock };
  attendanceInactivityIncident: { findMany: Mock; count: Mock };
  employee: { count: Mock; findMany: Mock; findUnique: Mock };
  doubleHourRule: { findMany: Mock };
  timeEntry: { aggregate: Mock; groupBy: Mock; findMany: Mock; create: Mock; update: Mock };
  hourConceptBreakdown: { findMany: Mock };
  $transaction: Mock;
  __tx: TxMocks;
};

const mockedFlagOpenShiftOverflowForReview = flagOpenShiftOverflowForReview as unknown as Mock;
const mockedResolveOpenShiftOverflowAlert = resolveOpenShiftOverflowAlert as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null); // sin régimen vigente: comportamiento igual que hoy (ver Etapa 5)
  mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([]);
  mockedPrisma.__tx.hourConcept.findMany.mockResolvedValue([]);
  mockedPrisma.__tx.timeEntry.findFirst.mockResolvedValue(null);
  // Etapa 8B: empleado "general" por default — sin sector/centro de
  // costo/puesto/empresa — para que los tests que no configuran scope sigan
  // representando "una regla sin alcance restringido matchea a cualquiera".
  mockedPrisma.__tx.employee.findUnique.mockResolvedValue({ sectorId: null, costCenterId: null, positionId: null, companies: [] });
  // Etapa 11A: mismo default "empleado general sin regla" para el camino de
  // carga manual (create()/update()), que resuelve el multiplicador vía
  // `prisma` directo en vez de `tx` (ver resolveDoubleHourMultiplierForManualEntry).
  mockedPrisma.employee.findUnique.mockResolvedValue({ sectorId: null, costCenterId: null, positionId: null, companies: [] });
  mockedPrisma.doubleHourRule.findMany.mockResolvedValue([]);
  let segmentCounter = 0;
  let specialApplicationCounter = 0;
  mockedPrisma.__tx.timeSegment.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `segment-${++segmentCounter}`, ...data }));
  mockedPrisma.__tx.timeEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `entry-${segmentCounter}`, ...data }));
  mockedPrisma.__tx.specialHourRuleApplication.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `special-application-${++specialApplicationCounter}`, ...data }));
});

describe("findDefaultHourConcept — Hora normal es base universal, resuelta por systemRole (Etapa 6K)", () => {
  it("sin hourConceptId, resuelve HourConcept directo por systemRole = NORMAL_BASE, sin exigir un vínculo EmployeeHourConcept por empleado", async () => {
    mockedPrisma.hourConcept.findFirst.mockResolvedValue({ id: "concept-normal", systemRole: "NORMAL_BASE" });

    const result = await timeEntriesRepository.findDefaultHourConcept("employee-1");

    expect(mockedPrisma.hourConcept.findFirst).toHaveBeenCalledWith({
      where: { systemRole: "NORMAL_BASE", status: "ACTIVO", deletedAt: null },
    });
    expect(mockedPrisma.employeeHourConcept.findFirst).not.toHaveBeenCalled();
    expect(result).toEqual({ hourConcept: { id: "concept-normal", systemRole: "NORMAL_BASE" } });
  });

  it("sin hourConceptId, si no existe ningún HourConcept con systemRole NORMAL_BASE activo, devuelve null (no lanza)", async () => {
    mockedPrisma.hourConcept.findFirst.mockResolvedValue(null);

    const result = await timeEntriesRepository.findDefaultHourConcept("employee-1");

    expect(result).toBeNull();
  });

  it("con hourConceptId, sigue resolviendo por la clave compuesta de EmployeeHourConcept (sin cambios)", async () => {
    const employeeHourConcept = mockedPrisma.employeeHourConcept as unknown as { findFirst: Mock; findUnique: Mock };
    employeeHourConcept.findUnique = vi.fn().mockResolvedValue({ hourConcept: { id: "concept-sereno", systemRole: null } });

    await timeEntriesRepository.findDefaultHourConcept("employee-1", "concept-sereno");

    expect(employeeHourConcept.findUnique).toHaveBeenCalledWith({
      where: { employeeId_hourConceptId: { employeeId: "employee-1", hourConceptId: "concept-sereno" } },
      include: { hourConcept: true },
    });
  });
});

describe("create/update TimeEntry — aplicación directa por rol (Etapa 6L.3)", () => {
  const date = new Date("2026-08-10T00:00:00Z");
  const input = { employeeId: "employee-1", hourConceptId: "concept-normal", date, hours: 8 } as never;

  it("create sin autoApprovedByUserId (Nivel 2/3) crea en BORRADOR sin approvedByUserId/approvedAt", async () => {
    mockedPrisma.timeEntry.create.mockResolvedValue({ id: "entry-1" });

    await timeEntriesRepository.create(input, "user-nivel3");

    const call = mockedPrisma.timeEntry.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data).toMatchObject({ status: "BORRADOR", createdByUserId: "user-nivel3" });
    expect(call.data).not.toHaveProperty("approvedByUserId");
    expect(call.data).not.toHaveProperty("approvedAt");
  });

  it("create con autoApprovedByUserId (RRHH) crea en APROBADO con approvedByUserId/approvedAt", async () => {
    mockedPrisma.timeEntry.create.mockResolvedValue({ id: "entry-1" });

    await timeEntriesRepository.create(input, "user-rrhh", "user-rrhh");

    const call = mockedPrisma.timeEntry.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data).toMatchObject({ status: "APROBADO", approvedByUserId: "user-rrhh" });
    expect(call.data.approvedAt).toBeInstanceOf(Date);
  });

  it("update sin autoApprovedByUserId (Nivel 2/3) no toca el status ni el aprobador", async () => {
    mockedPrisma.timeEntry.update.mockResolvedValue({ id: "entry-1" });

    await timeEntriesRepository.update("entry-1", { employeeId: "employee-1", hourConceptId: "concept-normal", date }, { hours: 6 } as never);

    const call = mockedPrisma.timeEntry.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data).not.toHaveProperty("status");
    expect(call.data).not.toHaveProperty("approvedByUserId");
  });

  it("update con autoApprovedByUserId (RRHH) fuerza APROBADO sin importar el status anterior", async () => {
    mockedPrisma.timeEntry.update.mockResolvedValue({ id: "entry-1" });

    await timeEntriesRepository.update("entry-1", { employeeId: "employee-1", hourConceptId: "concept-normal", date }, { hours: 6 } as never, "user-rrhh");

    const call = mockedPrisma.timeEntry.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data).toMatchObject({ status: "APROBADO", approvedByUserId: "user-rrhh", rejectedAt: null });
    expect(call.data.approvedAt).toBeInstanceOf(Date);
  });

  it("create/update piden el registro completo (empleado + concepto) para que el frontend pueda actualizar la celda sin otro request (Etapa 6L.4)", async () => {
    mockedPrisma.timeEntry.create.mockResolvedValue({ id: "entry-1" });
    mockedPrisma.timeEntry.update.mockResolvedValue({ id: "entry-1" });

    await timeEntriesRepository.create(input, "user-rrhh", "user-rrhh");
    await timeEntriesRepository.update("entry-1", { employeeId: "employee-1", hourConceptId: "concept-normal", date }, { hours: 6 } as never, "user-rrhh");

    const expectedInclude = { include: { employee: { select: expect.objectContaining({ legajo: true }) }, hourConcept: true } };
    expect(mockedPrisma.timeEntry.create.mock.calls[0]![0]).toMatchObject(expectedInclude);
    expect(mockedPrisma.timeEntry.update.mock.calls[0]![0]).toMatchObject(expectedInclude);
  });
});

describe("carga manual aplica Horas Especiales (Etapa 11A)", () => {
  // Bug reportado: una Hora Especial (feriado/domingo x2) configurada no
  // tenía ningún efecto si la hora se cargaba a mano en vez de por fichador
  // — create()/update() nunca consultaban DoubleHourRule. Estos tests
  // verifican que ahora sí lo hacen, reutilizando el mismo motor puro
  // (matchingDoubleHourRules/resolveWinningRules) que ya usa el fichador —
  // sin crear TimeSegment ni SpecialHourRuleApplication (una carga manual no
  // tiene jornada real que partir en tramos, ver comentario de
  // resolveDoubleHourMultiplierForManualEntry).
  const holiday = new Date("2026-08-27T00:00:00.000Z"); // feriado (día 27 del reporte)
  const sunday = new Date("2026-08-16T00:00:00.000Z"); // domingo (weekday 0)
  const monday = new Date("2026-08-17T00:00:00.000Z"); // lunes, sin regla

  function manualRule(overrides: Partial<{ id: string; recurrenceType: string; fromDate: Date; toDate: Date | null; weekdays: number[]; multiplier: number; priority: number; dates: Array<{ date: Date; isActive: boolean }>; companyId: string | null; sectorId: string | null; costCenterId: string | null; positionId: string | null }>) {
    const recurrenceType = overrides.recurrenceType ?? "FECHA";
    const fromDate = overrides.fromDate ?? holiday;
    return {
      id: "rule-manual-1",
      recurrenceType,
      fromDate,
      toDate: null,
      weekdays: [0],
      multiplier: 2,
      priority: 0,
      companyId: null,
      sectorId: null,
      costCenterId: null,
      positionId: null,
      dates: recurrenceType === "FECHA" ? [{ date: fromDate, isActive: true }] : [],
      ...overrides,
    };
  }

  it("create — sin ninguna regla activa: appliedMultiplier queda en 1, hours/totalMinutes nunca se inflan", async () => {
    mockedPrisma.doubleHourRule.findMany.mockResolvedValue([]);
    mockedPrisma.timeEntry.create.mockResolvedValue({ id: "entry-1" });

    await timeEntriesRepository.create({ employeeId: "employee-1", hourConceptId: "concept-normal", date: monday, hours: 8 } as never, "user-1");

    const call = mockedPrisma.timeEntry.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data).toMatchObject({ appliedMultiplier: 1, hours: 8, totalMinutes: 480 });
  });

  it("create — regla FECHA activa que matchea el día 27 (feriado x2): appliedMultiplier=2, horas reales siguen en 8", async () => {
    mockedPrisma.doubleHourRule.findMany.mockResolvedValue([manualRule({ id: "rule-feriado", recurrenceType: "FECHA", fromDate: holiday, multiplier: 2 })]);
    mockedPrisma.timeEntry.create.mockResolvedValue({ id: "entry-1" });

    await timeEntriesRepository.create({ employeeId: "employee-1", hourConceptId: "concept-normal", date: holiday, hours: 8 } as never, "user-1");

    const call = mockedPrisma.timeEntry.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data).toMatchObject({ appliedMultiplier: 2, hours: 8, totalMinutes: 480 });
  });

  it("create — regla SEMANAL domingo activa: appliedMultiplier=2 para una carga manual un domingo", async () => {
    mockedPrisma.doubleHourRule.findMany.mockResolvedValue([manualRule({ id: "rule-domingo", recurrenceType: "SEMANAL", fromDate: new Date("2026-01-01T00:00:00.000Z"), weekdays: [0], multiplier: 2 })]);
    mockedPrisma.timeEntry.create.mockResolvedValue({ id: "entry-1" });

    await timeEntriesRepository.create({ employeeId: "employee-1", hourConceptId: "concept-normal", date: sunday, hours: 8 } as never, "user-1");

    const call = mockedPrisma.timeEntry.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data).toMatchObject({ appliedMultiplier: 2 });
  });

  it("create — misma fecha de feriado pero regla con fecha inactiva: no aplica, appliedMultiplier=1", async () => {
    mockedPrisma.doubleHourRule.findMany.mockResolvedValue([manualRule({ id: "rule-feriado-inactivo", recurrenceType: "FECHA", fromDate: holiday, dates: [{ date: holiday, isActive: false }], multiplier: 2 })]);
    mockedPrisma.timeEntry.create.mockResolvedValue({ id: "entry-1" });

    await timeEntriesRepository.create({ employeeId: "employee-1", hourConceptId: "concept-normal", date: holiday, hours: 8 } as never, "user-1");

    const call = mockedPrisma.timeEntry.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data).toMatchObject({ appliedMultiplier: 1 });
  });

  it("create — dos reglas que matchean, gana la de mayor multiplicador (misma política que el fichador)", async () => {
    mockedPrisma.doubleHourRule.findMany.mockResolvedValue([
      manualRule({ id: "rule-feriado-x2", recurrenceType: "FECHA", fromDate: holiday, multiplier: 2 }),
      manualRule({ id: "rule-feriado-x3", recurrenceType: "FECHA", fromDate: holiday, multiplier: 3 }),
    ]);
    mockedPrisma.timeEntry.create.mockResolvedValue({ id: "entry-1" });

    await timeEntriesRepository.create({ employeeId: "employee-1", hourConceptId: "concept-normal", date: holiday, hours: 8 } as never, "user-1");

    const call = mockedPrisma.timeEntry.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data).toMatchObject({ appliedMultiplier: 3 });
  });

  it("create — resuelve el scope del empleado (sector) y lo pasa al AND de la query, igual que el fichador", async () => {
    mockedPrisma.employee.findUnique.mockResolvedValue({ sectorId: "panol", costCenterId: null, positionId: null, companies: [{ companyId: "odwyer" }] });
    mockedPrisma.doubleHourRule.findMany.mockResolvedValue([]);
    mockedPrisma.timeEntry.create.mockResolvedValue({ id: "entry-1" });

    await timeEntriesRepository.create({ employeeId: "employee-1", hourConceptId: "concept-normal", date: holiday, hours: 8 } as never, "user-1");

    expect(mockedPrisma.doubleHourRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { OR: [{ companyId: null }, { companyId: { in: ["odwyer"] } }] },
            { OR: [{ sectorId: null }, { sectorId: "panol" }] },
          ]),
        }),
      }),
    );
  });

  it("create — si la base ya excluyó la regla por scope (mock simula 'sin coincidencias'), appliedMultiplier queda en 1", async () => {
    mockedPrisma.employee.findUnique.mockResolvedValue({ sectorId: "panol", costCenterId: null, positionId: null, companies: [] });
    mockedPrisma.doubleHourRule.findMany.mockResolvedValue([]); // "Feriado Tropa" no matchea a un empleado de Pañol
    mockedPrisma.timeEntry.create.mockResolvedValue({ id: "entry-1" });

    await timeEntriesRepository.create({ employeeId: "employee-1", hourConceptId: "concept-normal", date: holiday, hours: 8 } as never, "user-1");

    const call = mockedPrisma.timeEntry.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data).toMatchObject({ appliedMultiplier: 1 });
  });

  it("create — no crea TimeSegment ni SpecialHourRuleApplication (no hay jornada real que partir en tramos)", async () => {
    mockedPrisma.doubleHourRule.findMany.mockResolvedValue([manualRule({ id: "rule-feriado", recurrenceType: "FECHA", fromDate: holiday, multiplier: 2 })]);
    mockedPrisma.timeEntry.create.mockResolvedValue({ id: "entry-1" });

    await timeEntriesRepository.create({ employeeId: "employee-1", hourConceptId: "concept-normal", date: holiday, hours: 8 } as never, "user-1");

    expect(mockedPrisma.__tx.timeSegment.create).not.toHaveBeenCalled();
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).not.toHaveBeenCalled();
  });

  it("update — re-resuelve el multiplicador contra la fecha nueva al editar una carga existente", async () => {
    mockedPrisma.doubleHourRule.findMany.mockResolvedValue([manualRule({ id: "rule-feriado", recurrenceType: "FECHA", fromDate: holiday, multiplier: 2 })]);
    mockedPrisma.timeEntry.update.mockResolvedValue({ id: "entry-1" });

    await timeEntriesRepository.update("entry-1", { employeeId: "employee-1", hourConceptId: "concept-normal", date: monday }, { date: holiday, hours: 8 } as never);

    const call = mockedPrisma.timeEntry.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data).toMatchObject({ appliedMultiplier: 2 });
  });
});

describe("expireOpenWorkShifts — regresión de atribución de día/período (Etapa 2)", () => {
  it("un turno abierto que arrancó a las 23:15 hora Argentina se atribuye a agosto/día 14, no a septiembre/día 1 en UTC", async () => {
    // 2026-08-14 23:15 ART = 2026-08-15 02:15 UTC.
    const startAt = new Date("2026-08-15T02:15:00.000Z");
    const now = new Date("2026-08-15T04:00:00.000Z"); // ~1h45 después: supera maxAllowedMinutes de 60.

    mockedPrisma.workShift.findMany.mockResolvedValue([
      {
        id: "shift-1",
        employeeId: "employee-1",
        startAt,
        maxAllowedMinutes: 60,
        source: "PORTAL_DNI",
        hourConcept: { id: "concept-1", name: "Normal" },
      },
    ]);
    mockedPrisma.__tx.workShift.updateMany.mockResolvedValue({ count: 1 });
    mockedPrisma.__tx.timeEntry.create.mockResolvedValue({});

    const result = await timeEntriesRepository.expireOpenWorkShifts(now);

    expect(result.count).toBe(1);
    expect(mockedPrisma.__tx.timeEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ period: "2026-08", day: 14 }),
      }),
    );
  });
});

describe("expireOpenWorkShifts — política de rollover por régimen (Etapa 5)", () => {
  const startAt = new Date("2026-08-14T04:00:00.000Z");
  const now = new Date("2026-08-15T05:00:00.000Z"); // 25h después: supera maxAllowedMinutes de 20h.

  function overLimitShift() {
    return {
      id: "shift-overflow",
      employeeId: "employee-1",
      startAt,
      maxAllowedMinutes: 20 * 60,
      source: "PORTAL_DNI",
      hourConcept: { id: "concept-1", name: "Normal" },
    };
  }

  it("Caso A — sin régimen vigente: conserva el cierre automático como FALTA_SALIDA (comportamiento actual)", async () => {
    mockedPrisma.workShift.findMany.mockResolvedValue([overLimitShift()]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);
    mockedPrisma.__tx.workShift.updateMany.mockResolvedValue({ count: 1 });
    mockedPrisma.__tx.timeEntry.create.mockResolvedValue({});

    const result = await timeEntriesRepository.expireOpenWorkShifts(now);

    expect(result.count).toBe(1);
    expect(mockedPrisma.__tx.workShift.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FALTA_SALIDA" }) }));
    expect(mockedFlagOpenShiftOverflowForReview).not.toHaveBeenCalled();
  });

  it("Caso B — régimen ROLLOVER: conserva el cierre automático como FALTA_SALIDA (comportamiento actual)", async () => {
    mockedPrisma.workShift.findMany.mockResolvedValue([overLimitShift()]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({
      workRegime: { kind: "TURNO_OBLIGATORIO", alertOnOutOfShift: true, openShiftOverflowAction: "ROLLOVER" },
    });
    mockedPrisma.__tx.workShift.updateMany.mockResolvedValue({ count: 1 });
    mockedPrisma.__tx.timeEntry.create.mockResolvedValue({});

    const result = await timeEntriesRepository.expireOpenWorkShifts(now);

    expect(result.count).toBe(1);
    expect(mockedPrisma.__tx.workShift.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FALTA_SALIDA" }) }));
    expect(mockedFlagOpenShiftOverflowForReview).not.toHaveBeenCalled();
  });

  it("Caso C — régimen ALERT_ONLY: NO cierra automáticamente, NO crea TimeEntry, marca para revisión con alerta crítica", async () => {
    mockedPrisma.workShift.findMany.mockResolvedValue([overLimitShift()]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({
      workRegime: { kind: "TURNO_FLEXIBLE", alertOnOutOfShift: false, openShiftOverflowAction: "ALERT_ONLY" },
    });

    const result = await timeEntriesRepository.expireOpenWorkShifts(now);

    expect(result.count).toBe(0);
    expect(mockedPrisma.__tx.workShift.updateMany).not.toHaveBeenCalled();
    expect(mockedPrisma.__tx.timeEntry.create).not.toHaveBeenCalled();
    expect(mockedFlagOpenShiftOverflowForReview).toHaveBeenCalledTimes(1);
    expect(mockedFlagOpenShiftOverflowForReview).toHaveBeenCalledWith("employee-1", "shift-overflow", 25 * 60, now);
  });

  it("Caso G — idempotencia: evaluar la misma jornada ALERT_ONLY dos veces no la cierra ni cambia de comportamiento la segunda vez", async () => {
    mockedPrisma.workShift.findMany.mockResolvedValue([overLimitShift()]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({
      workRegime: { kind: "TURNO_FLEXIBLE", alertOnOutOfShift: false, openShiftOverflowAction: "ALERT_ONLY" },
    });

    await timeEntriesRepository.expireOpenWorkShifts(now);
    await timeEntriesRepository.expireOpenWorkShifts(now);

    expect(mockedPrisma.__tx.workShift.updateMany).not.toHaveBeenCalled();
    expect(mockedFlagOpenShiftOverflowForReview).toHaveBeenCalledTimes(2);
    // Mismo workShiftId en ambas — createShiftAlert (mockeado acá) es quien
    // deduplica por [workShiftId, type] vía upsert; ver
    // workShiftEvaluationRunner.test.ts para esa garantía de fondo.
    expect(mockedFlagOpenShiftOverflowForReview.mock.calls[0]![1]).toBe("shift-overflow");
    expect(mockedFlagOpenShiftOverflowForReview.mock.calls[1]![1]).toBe("shift-overflow");
  });
});

describe("expireOpenWorkShifts — resolución de alertas huérfanas (Etapa 10B, hallazgo 10A §11.2)", () => {
  const startAt = new Date("2026-08-14T04:00:00.000Z");
  const now = new Date("2026-08-15T05:00:00.000Z");

  function overLimitShift() {
    return {
      id: "shift-overflow",
      employeeId: "employee-1",
      startAt,
      maxAllowedMinutes: 20 * 60,
      source: "PORTAL_DNI",
      hourConcept: { id: "concept-1", name: "Normal" },
    };
  }

  it("al cerrar automáticamente la jornada (ROLLOVER/sin régimen), resuelve la alerta POSIBLE_OLVIDO_SALIDA de esa misma jornada", async () => {
    mockedPrisma.workShift.findMany.mockResolvedValue([overLimitShift()]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);
    mockedPrisma.__tx.workShift.updateMany.mockResolvedValue({ count: 1 });
    mockedPrisma.__tx.timeEntry.create.mockResolvedValue({});

    await timeEntriesRepository.expireOpenWorkShifts(now);

    expect(mockedResolveOpenShiftOverflowAlert).toHaveBeenCalledTimes(1);
    expect(mockedResolveOpenShiftOverflowAlert).toHaveBeenCalledWith("shift-overflow", expect.any(String));
  });

  it("bajo régimen ALERT_ONLY (la jornada NO se cierra), no intenta resolver ninguna alerta — sigue pendiente a propósito", async () => {
    mockedPrisma.workShift.findMany.mockResolvedValue([overLimitShift()]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue({
      workRegime: { kind: "TURNO_FLEXIBLE", alertOnOutOfShift: false, openShiftOverflowAction: "ALERT_ONLY" },
    });

    await timeEntriesRepository.expireOpenWorkShifts(now);

    expect(mockedResolveOpenShiftOverflowAlert).not.toHaveBeenCalled();
  });

  it("no rompe el batch de cierre automático si la resolución de una alerta falla puntualmente", async () => {
    mockedPrisma.workShift.findMany.mockResolvedValue([overLimitShift()]);
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);
    mockedPrisma.__tx.workShift.updateMany.mockResolvedValue({ count: 1 });
    mockedPrisma.__tx.timeEntry.create.mockResolvedValue({});
    mockedResolveOpenShiftOverflowAlert.mockRejectedValueOnce(new Error("db hiccup"));

    const result = await timeEntriesRepository.expireOpenWorkShifts(now);

    expect(result.count).toBe(1); // el cierre automático ya había sido reportado como exitoso
  });
});

describe("attendanceSummary / attendanceObservations — select unificado de TimeSegment/TimeEntry (Etapa 8F)", () => {
  const baseInput = { startAt: new Date("2026-08-18T00:00:00.000Z"), endAt: new Date("2026-08-19T00:00:00.000Z"), employeeAccessWhere: {} };

  it("attendanceSummary pide hourConceptId, hourConceptRuleId y conceptStatus en el select de timeSegments", async () => {
    mockedPrisma.__tx.workShift.findMany.mockResolvedValue([]);
    mockedPrisma.__tx.attendancePunch.findMany.mockResolvedValue([]);

    await timeEntriesRepository.attendanceSummary(baseInput);

    const call = mockedPrisma.__tx.workShift.findMany.mock.calls[0]![0] as { select: { timeSegments: { select: Record<string, unknown> } } };
    expect(call.select.timeSegments.select).toMatchObject({ hourConceptId: true, hourConceptRuleId: true, conceptStatus: true });
  });

  it("attendanceSummary pide appliedMultiplier y actualMinutes en el select de timeEntries", async () => {
    mockedPrisma.__tx.workShift.findMany.mockResolvedValue([]);
    mockedPrisma.__tx.attendancePunch.findMany.mockResolvedValue([]);

    await timeEntriesRepository.attendanceSummary(baseInput);

    const call = mockedPrisma.__tx.workShift.findMany.mock.calls[0]![0] as { select: { timeEntries: { select: Record<string, unknown> } } };
    expect(call.select.timeEntries.select).toMatchObject({ appliedMultiplier: true, actualMinutes: true });
  });

  it("attendanceSummary pide specialHourRuleApplications con doubleHourRule.name", async () => {
    mockedPrisma.__tx.workShift.findMany.mockResolvedValue([]);
    mockedPrisma.__tx.attendancePunch.findMany.mockResolvedValue([]);

    await timeEntriesRepository.attendanceSummary(baseInput);

    const call = mockedPrisma.__tx.workShift.findMany.mock.calls[0]![0] as {
      select: { timeSegments: { select: { specialHourRuleApplications: { select: { doubleHourRule: { select: Record<string, unknown> } } } } } };
    };
    expect(call.select.timeSegments.select.specialHourRuleApplications.select.doubleHourRule.select).toMatchObject({ name: true });
  });

  it("attendanceSummary devuelve conceptStatus/hourConceptRuleId/appliedMultiplier/actualMinutes tal como los trae la base, sin recortarlos en código", async () => {
    mockedPrisma.__tx.workShift.findMany.mockResolvedValue([
      {
        id: "shift-1",
        employeeId: "employee-1",
        timeSegments: [
          { id: "segment-1", conceptStatus: "SIN_CONCEPTO_COMPATIBLE", hourConceptId: "concept-1", hourConceptRuleId: null, specialHourRuleApplications: [] },
        ],
        timeEntries: [{ id: "entry-1", appliedMultiplier: 2, actualMinutes: 180, totalMinutes: 360 }],
      },
    ]);
    mockedPrisma.__tx.attendancePunch.findMany.mockResolvedValue([]);

    const result = await timeEntriesRepository.attendanceSummary(baseInput);

    expect(result.workShifts[0]!.timeSegments[0]).toMatchObject({ conceptStatus: "SIN_CONCEPTO_COMPATIBLE", hourConceptId: "concept-1" });
    expect(result.workShifts[0]!.timeEntries[0]).toMatchObject({ appliedMultiplier: 2, actualMinutes: 180 });
  });

  it("attendanceObservations sigue funcionando y ahora pide el mismo select unificado (antes traía todo por default de Prisma)", async () => {
    mockedPrisma.workShift.findMany.mockResolvedValue([]);
    mockedPrisma.attendancePunch.findMany.mockResolvedValue([]);
    mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([]);
    mockedPrisma.workShift.count.mockResolvedValue(0);
    mockedPrisma.attendancePunch.count.mockResolvedValue(0);
    mockedPrisma.attendanceInactivityIncident.count.mockResolvedValue(0);

    const result = await timeEntriesRepository.attendanceObservations({ type: "ALL", reviewStatus: "PENDIENTE", take: 10, employeeAccessWhere: {} });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    const call = mockedPrisma.workShift.findMany.mock.calls[0]![0] as {
      include: { timeSegments: { select: Record<string, unknown> }; timeEntries: { select: Record<string, unknown> } };
    };
    expect(call.include.timeSegments.select).toMatchObject({ hourConceptId: true, hourConceptRuleId: true, conceptStatus: true });
    expect(call.include.timeEntries.select).toMatchObject({ appliedMultiplier: true, actualMinutes: true });
  });

  it("attendanceObservations devuelve el segmento SHIFT con conceptStatus/appliedMultiplier intactos (misma calidad de datos que attendanceSummary)", async () => {
    mockedPrisma.workShift.findMany.mockResolvedValue([
      {
        id: "shift-2",
        startAt: new Date("2026-08-18T10:00:00.000Z"),
        timeSegments: [{ id: "segment-2", conceptStatus: "CONCEPTO_NO_HABILITADO", hourConceptRuleId: "rule-1", specialHourRuleApplications: [] }],
        timeEntries: [{ id: "entry-2", appliedMultiplier: 1.5, actualMinutes: 60 }],
      },
    ]);
    mockedPrisma.attendancePunch.findMany.mockResolvedValue([]);
    mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([]);
    mockedPrisma.workShift.count.mockResolvedValue(1);
    mockedPrisma.attendancePunch.count.mockResolvedValue(0);
    mockedPrisma.attendanceInactivityIncident.count.mockResolvedValue(0);

    const result = await timeEntriesRepository.attendanceObservations({ type: "SHIFT", reviewStatus: "PENDIENTE", take: 10, employeeAccessWhere: {} });

    expect(result.items).toHaveLength(1);
    const item = result.items[0]! as unknown as { kind: "SHIFT"; shift: { timeSegments: Array<{ conceptStatus: string }>; timeEntries: Array<{ appliedMultiplier: number }> } };
    expect(item.shift.timeSegments[0]!.conceptStatus).toBe("CONCEPTO_NO_HABILITADO");
    expect(item.shift.timeEntries[0]!.appliedMultiplier).toBe(1.5);
  });
});

describe("createFromWorkShift — persistencia de segmentos clasificados (Turnos V1, etapa de clasificación)", () => {
  const employeeId = "employee-1";
  const day = new Date("2026-08-18T00:00:00.000Z");

  it("Etapa 6L — TimeSegment conserva el hourConceptId clasificado (evidencia técnica) pero todo TimeEntry usa la Hora normal canónica, nunca el concepto especial del segmento", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-1" });

    const startAt = new Date("2026-08-18T20:00:00.000Z"); // 17:00 ART
    const midpoint = new Date("2026-08-19T00:00:00.000Z"); // 21:00 ART
    const endAt = new Date("2026-08-19T07:00:00.000Z"); // 04:00 ART

    const result = await timeEntriesRepository.createFromWorkShift({
      employeeId,
      normalHourConceptId: "concept-normal",
      normalHourConceptName: "Hora normal",
      source: "ADMIN" as never,
      startAt,
      endAt,
      totalMinutes: 660,
      segments: [
        { date: day, startAt, endAt: midpoint, minutes: 240, hours: 4, hourConceptId: "concept-normal", hourConceptName: "Hora normal", conceptStatus: "SUGERIDO", hourConceptRuleId: "rule-normal" },
        { date: day, startAt: midpoint, endAt, minutes: 420, hours: 7, hourConceptId: "concept-guardia", hourConceptName: "Guardia", conceptStatus: "SUGERIDO", hourConceptRuleId: "rule-guardia" },
      ],
    });

    // TimeSegment sigue reflejando el clasificador legacy tal cual (evidencia técnica, sin cambios).
    expect(mockedPrisma.__tx.timeSegment.create).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.__tx.timeSegment.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ hourConceptId: "concept-normal", hourConceptRuleId: "rule-normal", conceptStatus: "SUGERIDO", minutes: 240 }),
    }));
    expect(mockedPrisma.__tx.timeSegment.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ hourConceptId: "concept-guardia", hourConceptRuleId: "rule-guardia", conceptStatus: "SUGERIDO", minutes: 420 }),
    }));
    // TimeEntry, en cambio, siempre usa normalHourConceptId — nunca "concept-guardia" del segundo segmento.
    expect(mockedPrisma.__tx.timeEntry.create).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.__tx.timeEntry.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ hourConceptId: "concept-normal", totalMinutes: 240 }) }));
    expect(mockedPrisma.__tx.timeEntry.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ hourConceptId: "concept-normal", totalMinutes: 420 }) }));

    const totalPersistedMinutes = result.entries.reduce((sum, entry) => sum + (entry as { totalMinutes: number }).totalMinutes, 0);
    expect(totalPersistedMinutes).toBe(660); // == minutos reales entre startAt y endAt (17:00 a 04:00), sólo repartidos ahora en filas todas de Normal
  });

  it("Etapa 6L — si dos segmentos clasificados del mismo día ya no compiten por concepto, el segundo se fusiona en el TimeEntry Normal recién creado por el primero (misma fecha + mismo hourConceptId)", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-1b" });

    const startAt = new Date("2026-08-18T13:00:00.000Z"); // 10:00 ART
    const midpoint = new Date("2026-08-18T18:00:00.000Z"); // 15:00 ART
    const endAt = new Date("2026-08-18T21:00:00.000Z"); // 18:00 ART

    const createdEntryOne = { id: "entry-1", totalMinutes: 300, actualMinutes: 300, status: "BORRADOR", observation: null };
    mockedPrisma.__tx.timeEntry.findFirst
      .mockResolvedValueOnce(null) // primer segmento: todavía no hay TimeEntry ese día para Normal
      .mockResolvedValueOnce(createdEntryOne); // segundo segmento: ya existe el de Normal creado por el primero
    mockedPrisma.__tx.timeEntry.create.mockResolvedValueOnce(createdEntryOne);
    mockedPrisma.__tx.timeEntry.update.mockResolvedValueOnce({ ...createdEntryOne, totalMinutes: 480 });

    await timeEntriesRepository.createFromWorkShift({
      employeeId,
      normalHourConceptId: "concept-normal",
      normalHourConceptName: "Hora normal",
      source: "ADMIN" as never,
      startAt,
      endAt,
      totalMinutes: 480,
      segments: [
        { date: day, startAt, endAt: midpoint, minutes: 300, hours: 5, hourConceptId: "concept-normal", hourConceptName: "Hora normal", conceptStatus: "SUGERIDO", hourConceptRuleId: "rule-normal" },
        { date: day, startAt: midpoint, endAt, minutes: 180, hours: 3, hourConceptId: "concept-guardia", hourConceptName: "Guardia", conceptStatus: "SUGERIDO", hourConceptRuleId: "rule-guardia" },
      ],
    });

    expect(mockedPrisma.__tx.timeEntry.create).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.__tx.timeEntry.update).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.__tx.timeEntry.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "entry-1" },
      data: expect.objectContaining({ totalMinutes: 480 }), // 300 (ya existente) + 180 (segundo segmento), ambos Normal
    }));
  });

  it("marca conceptStatus SIN_CONCEPTO_COMPATIBLE / CONCEPTO_NO_HABILITADO cuando corresponde, sin bloquear la creación", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-2" });

    await timeEntriesRepository.createFromWorkShift({
      employeeId,
      normalHourConceptId: "concept-normal",
      normalHourConceptName: "Hora normal",
      source: "ADMIN" as never,
      startAt: day,
      endAt: new Date(day.getTime() + 4 * 60 * 60_000),
      totalMinutes: 240,
      segments: [
        { date: day, startAt: day, endAt: new Date(day.getTime() + 60 * 60_000), minutes: 60, hours: 1, hourConceptId: "concept-normal", hourConceptName: "Hora normal", conceptStatus: "SIN_CONCEPTO_COMPATIBLE", hourConceptRuleId: null },
        { date: day, startAt: new Date(day.getTime() + 60 * 60_000), endAt: new Date(day.getTime() + 4 * 60 * 60_000), minutes: 180, hours: 3, hourConceptId: "concept-guardia", hourConceptName: "Guardia", conceptStatus: "CONCEPTO_NO_HABILITADO", hourConceptRuleId: "rule-guardia" },
      ],
    });

    expect(mockedPrisma.__tx.timeSegment.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ conceptStatus: "SIN_CONCEPTO_COMPATIBLE", hourConceptRuleId: null }) }));
    expect(mockedPrisma.__tx.timeSegment.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ conceptStatus: "CONCEPTO_NO_HABILITADO", hourConceptRuleId: "rule-guardia" }) }));
  });

  it("crossesMidnight se calcula por fechas distintas entre los segmentos, no por la cantidad de segmentos (2 conceptos el mismo día no cruzan medianoche)", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-3" });

    await timeEntriesRepository.createFromWorkShift({
      employeeId,
      normalHourConceptId: "concept-normal",
      normalHourConceptName: "Hora normal",
      source: "ADMIN" as never,
      startAt: day,
      endAt: new Date(day.getTime() + 4 * 60 * 60_000),
      totalMinutes: 240,
      segments: [
        { date: day, startAt: day, endAt: new Date(day.getTime() + 60 * 60_000), minutes: 60, hours: 1, hourConceptId: "concept-normal", hourConceptName: "Hora normal", conceptStatus: "SUGERIDO", hourConceptRuleId: "rule-normal" },
        { date: day, startAt: new Date(day.getTime() + 60 * 60_000), endAt: new Date(day.getTime() + 4 * 60 * 60_000), minutes: 180, hours: 3, hourConceptId: "concept-guardia", hourConceptName: "Guardia", conceptStatus: "SUGERIDO", hourConceptRuleId: "rule-guardia" },
      ],
    });

    expect(mockedPrisma.__tx.workShift.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ crossesMidnight: false }) }));
  });
});

describe("SpecialHourRuleApplication y multiplicador efectivo (Etapa 3)", () => {
  const employeeId = "employee-1";
  const sunday = new Date("2026-08-16T00:00:00.000Z"); // domingo (weekday 0)
  const monday = new Date("2026-08-17T00:00:00.000Z"); // lunes (weekday 1)

  function rule(overrides: Partial<{ id: string; name: string; recurrenceType: string; fromDate: Date; toDate: Date | null; weekdays: number[]; multiplier: number; priority: number; dates: Array<{ date: Date; isActive: boolean }> }>) {
    const recurrenceType = overrides.recurrenceType ?? "SEMANAL";
    const fromDate = overrides.fromDate ?? new Date("2026-01-01T00:00:00.000Z");
    return {
      id: "rule-1",
      name: "Regla",
      recurrenceType,
      fromDate,
      toDate: null,
      weekdays: [0],
      multiplier: 2,
      priority: 0,
      companyId: null,
      sectorId: null,
      costCenterId: null,
      positionId: null,
      status: "ACTIVO",
      reason: "Domingo",
      // Etapa 8B: FECHA ya no matchea por fromDate — si no se pasa `dates`
      // explícito, se asume que la única fecha alcanzada es fromDate (mismo
      // comportamiento observable que antes de 8B para estos tests).
      dates: recurrenceType === "FECHA" ? [{ date: fromDate, isActive: true }] : [],
      ...overrides,
    };
  }

  function oneSegmentInput(date: Date, overrides: Partial<{ hourConceptId: string }> = {}) {
    const startAt = date;
    const endAt = new Date(date.getTime() + 4 * 60 * 60_000);
    return {
      employeeId,
      normalHourConceptId: "concept-normal",
      normalHourConceptName: "Hora normal",
      source: "ADMIN" as never,
      startAt,
      endAt,
      totalMinutes: 240,
      segments: [{ date, startAt, endAt, minutes: 240, hours: 4, hourConceptId: overrides.hourConceptId ?? "concept-normal", hourConceptName: "Hora normal", conceptStatus: "SUGERIDO" as const, hourConceptRuleId: null }],
    };
  }

  it("Caso A — sin regla especial: no crea SpecialHourRuleApplication, appliedMultiplier queda en 1, isSpecial false", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-a" });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([]);

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(monday));

    expect(mockedPrisma.__tx.specialHourRuleApplication.create).not.toHaveBeenCalled();
    expect(mockedPrisma.__tx.timeSegment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isSpecial: false }) }));
    expect(mockedPrisma.__tx.timeEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ appliedMultiplier: 1 }) }));
  });

  it("Caso B — una regla especial: crea 1 SpecialHourRuleApplication, appliedMultiplier = multiplier de la regla, isSpecial true", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-b" });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([rule({ id: "rule-domingo", multiplier: 2 })]);

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday));

    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ doubleHourRuleId: "rule-domingo", multiplierApplied: 2 }) }),
    );
    expect(mockedPrisma.__tx.timeSegment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isSpecial: true }) }));
    expect(mockedPrisma.__tx.timeEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ appliedMultiplier: 2 }) }));
  });

  it("Caso C — dos reglas aplicables al mismo segmento: registra ambas, usa el mayor multiplicador, no multiplica ni suma", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-c" });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([
      rule({ id: "rule-domingo", multiplier: 2 }),
      rule({ id: "rule-especial", multiplier: 1.5, recurrenceType: "RANGO", fromDate: new Date("2026-08-01T00:00:00.000Z"), toDate: new Date("2026-08-31T00:00:00.000Z") }),
    ]);

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday));

    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledTimes(2);
    const ruleIds = mockedPrisma.__tx.specialHourRuleApplication.create.mock.calls.map((call) => call[0]?.data?.doubleHourRuleId);
    expect(new Set(ruleIds)).toEqual(new Set(["rule-domingo", "rule-especial"]));
    // Mayor multiplicador (2), nunca 2*1.5=3 ni 2+1.5=3.5.
    expect(mockedPrisma.__tx.timeEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ appliedMultiplier: 2 }) }));
  });

  it("Caso D — dos segmentos (HourConceptRule) el mismo día: la regla semanal se registra en cada uno por separado, sin perder minutos", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-d" });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([rule({ id: "rule-domingo", multiplier: 2 })]);

    const startAt = sunday;
    const mid = new Date(sunday.getTime() + 3 * 60 * 60_000);
    const endAt = new Date(sunday.getTime() + 8 * 60 * 60_000);

    await timeEntriesRepository.createFromWorkShift({
      employeeId,
      normalHourConceptId: "concept-normal",
      normalHourConceptName: "Hora normal",
      source: "ADMIN" as never,
      startAt,
      endAt,
      totalMinutes: 480,
      segments: [
        { date: sunday, startAt, endAt: mid, minutes: 180, hours: 3, hourConceptId: "concept-normal", hourConceptName: "Hora normal", conceptStatus: "SUGERIDO", hourConceptRuleId: "rule-normal" },
        { date: sunday, startAt: mid, endAt, minutes: 300, hours: 5, hourConceptId: "concept-guardia", hourConceptName: "Guardia", conceptStatus: "SUGERIDO", hourConceptRuleId: "rule-guardia" },
      ],
    });

    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledTimes(2); // una por segmento
    const timeSegmentIds = mockedPrisma.__tx.specialHourRuleApplication.create.mock.calls.map((call) => call[0]?.data?.timeSegmentId);
    expect(new Set(timeSegmentIds).size).toBe(2); // cada aplicación referencia un TimeSegment distinto

    const totalActualMinutes = mockedPrisma.__tx.timeEntry.create.mock.calls.reduce((sum, call) => sum + (call[0]?.data?.actualMinutes ?? 0), 0);
    expect(totalActualMinutes).toBe(480); // minutos reales (no multiplicados) == 08:00 reales entre startAt y endAt
  });

  it("Caso E — regla por fecha exacta: aplica solo ese día, no en otro", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValue({ id: "punch" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-e" });
    const feriado = rule({ id: "rule-feriado", recurrenceType: "FECHA", fromDate: sunday, toDate: null, multiplier: 2 });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([feriado]);

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday));
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([feriado]);
    mockedPrisma.__tx.hourConcept.findMany.mockResolvedValue([]);
    mockedPrisma.__tx.timeEntry.findFirst.mockResolvedValue(null);
    mockedPrisma.__tx.timeSegment.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "segment-x", ...data }));
    mockedPrisma.__tx.timeEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "entry-x", ...data }));
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValue({ id: "punch" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-e2" });

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(monday)); // un día distinto al de la regla FECHA
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).not.toHaveBeenCalled();
  });

  it("Caso F — regla por rango: aplica dentro del rango, no fuera de él", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValue({ id: "punch" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-f" });
    const rango = rule({ id: "rule-rango", recurrenceType: "RANGO", fromDate: new Date("2026-08-01T00:00:00.000Z"), toDate: new Date("2026-08-10T00:00:00.000Z"), multiplier: 1.5 });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([rango]);

    const fueraDeRango = new Date("2026-08-18T00:00:00.000Z"); // posterior al toDate
    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(fueraDeRango));
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([rango]);
    mockedPrisma.__tx.hourConcept.findMany.mockResolvedValue([]);
    mockedPrisma.__tx.timeEntry.findFirst.mockResolvedValue(null);
    mockedPrisma.__tx.timeSegment.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "segment-y", ...data }));
    mockedPrisma.__tx.timeEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "entry-y", ...data }));
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValue({ id: "punch" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-f2" });

    const dentroDeRango = new Date("2026-08-05T00:00:00.000Z");
    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(dentroDeRango));
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledTimes(1);
  });

  it("Caso G — regla semanal: aplica en el weekday configurado, no en otro", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValue({ id: "punch" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-g" });
    const semanal = rule({ id: "rule-semanal", recurrenceType: "SEMANAL", weekdays: [0], multiplier: 2 }); // solo domingo

    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([semanal]);
    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(monday)); // lunes: no matchea
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([semanal]);
    mockedPrisma.__tx.hourConcept.findMany.mockResolvedValue([]);
    mockedPrisma.__tx.timeEntry.findFirst.mockResolvedValue(null);
    mockedPrisma.__tx.timeSegment.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "segment-z", ...data }));
    mockedPrisma.__tx.timeEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "entry-z", ...data }));
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValue({ id: "punch" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-g2" });

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday)); // domingo: matchea
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledTimes(1);
  });

  it("Caso H — un único cierre no duplica SpecialHourRuleApplication (no hay recálculo implementado todavía)", async () => {
    mockedPrisma.__tx.workShift.updateMany.mockResolvedValue({ count: 1 });
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValue({ id: "punch-out" });
    mockedPrisma.__tx.workShift.update.mockResolvedValue({ id: "shift-h" });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([rule({ id: "rule-domingo", multiplier: 2 })]);

    await timeEntriesRepository.closeOpenWorkShift({
      workShiftId: "shift-h",
      employeeId,
      normalHourConceptId: "concept-normal",
      normalHourConceptName: "Hora normal",
      source: "PORTAL_DNI" as never,
      endAt: new Date(sunday.getTime() + 4 * 60 * 60_000),
      totalMinutes: 240,
      segments: [{ date: sunday, startAt: sunday, endAt: new Date(sunday.getTime() + 4 * 60 * 60_000), minutes: 240, hours: 4, hourConceptId: "concept-normal", hourConceptName: "Hora normal", conceptStatus: "SUGERIDO", hourConceptRuleId: null }],
    });

    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledTimes(1); // una regla, un segmento -> una sola fila, sin duplicar
  });

  it("Caso I (Etapa 8F) — invariante: totalMinutes/hours/actualMinutes son siempre minutos reales, nunca inflados por appliedMultiplier", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-i" });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([rule({ id: "rule-domingo", multiplier: 2 })]);

    const result = await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday));

    // Etapa 8F: un domingo real de 4hs (240 min) con regla x2 nunca debe
    // aparecer como "8hs trabajadas" — totalMinutes/hours/actualMinutes
    // quedan los tres en el valor real; appliedMultiplier (2) es lo único
    // que cambia, y es de ahí de donde se deriva después el valor liquidable
    // (real × appliedMultiplier), nunca al revés.
    const entry = result.entries[0] as unknown as { totalMinutes: number; actualMinutes: number; hours: unknown; appliedMultiplier: unknown };
    expect(entry.totalMinutes).toBe(240);
    expect(entry.actualMinutes).toBe(240);
    expect(Number(entry.hours)).toBe(4);
    expect(Number(entry.appliedMultiplier)).toBe(2);

    const totalActualMinutes = result.entries.reduce((sum, e) => sum + (e as { actualMinutes: number }).actualMinutes, 0);
    const totalRealMinutes = result.entries.reduce((sum, e) => sum + (e as { totalMinutes: number }).totalMinutes, 0);
    expect(totalActualMinutes).toBe(240);
    expect(totalRealMinutes).toBe(240); // ya no 480: el equivalente liquidable se calcula aparte, no se persiste acá
  });

  it("Caso J (Etapa 8F) — un TimeEntry Normal ya existente e inflado por una etapa previa se autocorrige al recibir un nuevo tramo", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-j" });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([rule({ id: "rule-domingo", multiplier: 2 })]);
    // Fila legada (pre-8F): totalMinutes=480 (240 reales x2 ya persistidos inflados),
    // pero actualMinutes=240 sí guardaba el valor real correctamente.
    mockedPrisma.__tx.timeEntry.findFirst.mockResolvedValueOnce({
      id: "entry-legacy", totalMinutes: 480, actualMinutes: 240, status: "BORRADOR", observation: null,
    });
    mockedPrisma.__tx.timeEntry.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "entry-legacy", ...data }));

    const result = await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday));

    // Se recalcula desde actualMinutes (240 + 240 nuevos = 480 reales), no desde
    // el totalMinutes legado (480 + 240 hubiera dado 720, arrastrando el error).
    const entry = result.entries[0] as { totalMinutes: number; actualMinutes: number };
    expect(entry.totalMinutes).toBe(480);
    expect(entry.actualMinutes).toBe(480);
  });

  it("Caso K (Etapa 8F) — cruce de medianoche sábado 22:00 → domingo 02:00: sólo el tramo domingo recibe la regla, los dos TimeEntry quedan en minutos reales (nunca 120+240)", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-k" });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([rule({ id: "rule-domingo", multiplier: 2 })]);

    const saturday = new Date("2026-08-15T00:00:00.000Z");
    const startAt = new Date("2026-08-15T22:00:00.000Z"); // sábado 22:00
    const midnight = new Date("2026-08-16T00:00:00.000Z");
    const endAt = new Date("2026-08-16T02:00:00.000Z"); // domingo 02:00

    const result = await timeEntriesRepository.createFromWorkShift({
      employeeId,
      normalHourConceptId: "concept-normal",
      normalHourConceptName: "Hora normal",
      source: "ADMIN" as never,
      startAt,
      endAt,
      totalMinutes: 240,
      segments: [
        { date: saturday, startAt, endAt: midnight, minutes: 120, hours: 2, hourConceptId: "concept-normal", hourConceptName: "Hora normal", conceptStatus: "SUGERIDO", hourConceptRuleId: null },
        { date: sunday, startAt: midnight, endAt, minutes: 120, hours: 2, hourConceptId: "concept-normal", hourConceptName: "Hora normal", conceptStatus: "SUGERIDO", hourConceptRuleId: null },
      ],
    });

    expect(mockedPrisma.__tx.timeSegment.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ isSpecial: false }) }));
    expect(mockedPrisma.__tx.timeSegment.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ isSpecial: true }) }));
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledTimes(1); // sólo el tramo domingo matchea

    expect(result.entries).toHaveLength(2); // fechas distintas -> dos TimeEntry, uno por día
    const totalRealMinutes = result.entries.reduce((sum, e) => sum + (e as { totalMinutes: number }).totalMinutes, 0);
    expect(totalRealMinutes).toBe(240); // 120 + 120 reales, nunca 120 + 240
    expect(Number((result.entries[0] as unknown as { appliedMultiplier: unknown }).appliedMultiplier)).toBe(1); // tramo sábado: sin regla
    expect(Number((result.entries[1] as unknown as { appliedMultiplier: unknown }).appliedMultiplier)).toBe(2); // tramo domingo: regla aplicada
  });

  it("Caso L (Etapa 8B) — regla general (sin empresa/sector/centro de costo/puesto/empleados): construye el AND de scope como 'sin restricción' en las 4 dimensiones", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-l" });
    mockedPrisma.__tx.employee.findUnique.mockResolvedValue({ sectorId: null, costCenterId: null, positionId: null, companies: [] });

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday));

    expect(mockedPrisma.__tx.doubleHourRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { companyId: null },
            { sectorId: null },
            { costCenterId: null },
            { positionId: null },
          ]),
        }),
      }),
    );
  });

  it("Caso L.2 (Etapa 8B) — el AND de scope siempre exige 'sin empleados cargados O este empleado está en la lista' — una regla de empleados específicos nunca matchea a alguien fuera de esa lista", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-l2" });

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday));

    expect(mockedPrisma.__tx.doubleHourRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ OR: [{ employees: { none: {} } }, { employees: { some: { employeeId } } }] }]),
        }),
      }),
    );
  });

  it("Caso M (Etapa 8B) — empleado con empresa: el AND de scope permite companyId null o esa empresa (nunca cualquier empresa)", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-m" });
    mockedPrisma.__tx.employee.findUnique.mockResolvedValue({ sectorId: null, costCenterId: null, positionId: null, companies: [{ companyId: "odwyer" }] });

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday));

    expect(mockedPrisma.__tx.doubleHourRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ OR: [{ companyId: null }, { companyId: { in: ["odwyer"] } }] }]),
        }),
      }),
    );
  });

  it("Caso N (Etapa 8B) — empleado con empresa + sector: el AND de scope combina ambas dimensiones", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-n" });
    mockedPrisma.__tx.employee.findUnique.mockResolvedValue({ sectorId: "panol", costCenterId: null, positionId: null, companies: [{ companyId: "odwyer" }] });

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday));

    expect(mockedPrisma.__tx.doubleHourRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { OR: [{ companyId: null }, { companyId: { in: ["odwyer"] } }] },
            { OR: [{ sectorId: null }, { sectorId: "panol" }] },
          ]),
        }),
      }),
    );
  });

  it("Caso O (Etapa 8B) — Domingo general (scope no aplicado por la base, simulado por el mock) aplica igual a un empleado sin scope", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-o" });
    mockedPrisma.__tx.employee.findUnique.mockResolvedValue({ sectorId: null, costCenterId: null, positionId: null, companies: [] });
    // Sin employeeIds ni empresa/sector/centro de costo/puesto — regla 100% general.
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([rule({ id: "rule-domingo-general" })]);

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday));

    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ doubleHourRuleId: "rule-domingo-general" }) }),
    );
  });

  it("Caso P (Etapa 8B) — si la base ya excluyó la regla por scope (empresa distinta), el motor no la aplica (mock devuelve [])", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-p" });
    mockedPrisma.__tx.employee.findUnique.mockResolvedValue({ sectorId: null, costCenterId: null, positionId: null, companies: [{ companyId: "tropa" }] });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([]); // "Domingo Odwyer" no matchea a un empleado de Tropa

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday));

    expect(mockedPrisma.__tx.specialHourRuleApplication.create).not.toHaveBeenCalled();
    expect(mockedPrisma.__tx.timeEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ appliedMultiplier: 1 }) }));
  });

  it("Caso Q (Etapa 8B) — prioridad distinta: gana Domingo Pañol (mayor prioridad) sobre Domingo Odwyer, sin conflicto", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-q" });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([
      rule({ id: "domingo-odwyer", priority: 1, multiplier: 2 }),
      rule({ id: "domingo-panol", priority: 5, multiplier: 2.5 }),
    ]);

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday));

    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ doubleHourRuleId: "domingo-odwyer", isWinner: false, wasConflicting: false }) }));
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ doubleHourRuleId: "domingo-panol", isWinner: true, wasConflicting: false }) }));
    expect(mockedPrisma.__tx.timeEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ appliedMultiplier: 2.5 }) }));
  });

  it("Caso R (Etapa 8B) — empate de prioridad: ambas quedan marcadas wasConflicting=true, y se sigue aplicando (no rompe el pipeline)", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-r" });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([
      rule({ id: "domingo", priority: 3, multiplier: 2 }),
      rule({ id: "feriado", priority: 3, multiplier: 2 }),
    ]);

    const result = await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday));

    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ doubleHourRuleId: "domingo", isWinner: true, wasConflicting: true }) }));
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ doubleHourRuleId: "feriado", isWinner: true, wasConflicting: true }) }));
    // No rompe el pipeline: sigue generando el TimeEntry, con horas reales intactas.
    const entry = result.entries[0] as unknown as { totalMinutes: number; appliedMultiplier: unknown };
    expect(entry.totalMinutes).toBe(240);
    expect(Number(entry.appliedMultiplier)).toBe(2);
  });

  it("Caso S (Etapa 8B — corrección) — una sola regla 'Feriado' con muchas fechas (01/01, 24/03, 02/04, 01/05, 25/05, 09/07, 25/12) aplica a fichadas reales en cualquiera de esas fechas, sin crear una regla por feriado", async () => {
    const feriados = [
      new Date("2026-01-01"), new Date("2026-03-24"), new Date("2026-04-02"),
      new Date("2026-05-01"), new Date("2026-05-25"), new Date("2026-07-09"), new Date("2026-12-25"),
    ];
    const feriado = rule({ id: "rule-feriado", recurrenceType: "FECHA", multiplier: 2, dates: feriados.map((date) => ({ date, isActive: true })) });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([feriado]);
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValue({ id: "punch-in" });
    mockedPrisma.__tx.workShift.create.mockResolvedValueOnce({ id: "shift-navidad" }).mockResolvedValueOnce({ id: "shift-anio-nuevo" });

    const navidadResult = await timeEntriesRepository.createFromWorkShift(oneSegmentInput(new Date("2026-12-25T00:00:00.000Z")));
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ doubleHourRuleId: "rule-feriado" }) }));
    expect(Number((navidadResult.entries[0] as unknown as { appliedMultiplier: unknown }).appliedMultiplier)).toBe(2);

    vi.clearAllMocks();
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([feriado]);
    mockedPrisma.__tx.hourConcept.findMany.mockResolvedValue([]);
    mockedPrisma.__tx.timeEntry.findFirst.mockResolvedValue(null);
    mockedPrisma.__tx.employee.findUnique.mockResolvedValue({ sectorId: null, costCenterId: null, positionId: null, companies: [] });
    mockedPrisma.__tx.timeSegment.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "segment-9-julio", ...data }));
    mockedPrisma.__tx.timeEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "entry-9-julio", ...data }));
    mockedPrisma.__tx.specialHourRuleApplication.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "app-9-julio", ...data }));
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValue({ id: "punch-in" });

    // Misma regla ("rule-feriado"), otra fecha distinta del mismo array de `dates` (09/07): también aplica.
    const nueveDeJulioResult = await timeEntriesRepository.createFromWorkShift(oneSegmentInput(new Date("2026-07-09T00:00:00.000Z")));
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ doubleHourRuleId: "rule-feriado" }) }));
    expect(Number((nueveDeJulioResult.entries[0] as unknown as { appliedMultiplier: unknown }).appliedMultiplier)).toBe(2);

    vi.clearAllMocks();
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([feriado]);
    mockedPrisma.__tx.hourConcept.findMany.mockResolvedValue([]);
    mockedPrisma.__tx.timeEntry.findFirst.mockResolvedValue(null);
    mockedPrisma.__tx.employee.findUnique.mockResolvedValue({ sectorId: null, costCenterId: null, positionId: null, companies: [] });
    mockedPrisma.__tx.timeSegment.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "segment-junio", ...data }));
    mockedPrisma.__tx.timeEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "entry-junio", ...data }));
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValue({ id: "punch-in" });

    // Un día que NO está en la lista de fechas de la regla: no aplica.
    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(new Date("2026-06-15T00:00:00.000Z")));
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).not.toHaveBeenCalled();
  });

  it("Caso T (Etapa 8B — corrección) — dentro de una misma regla FECHA con varias fechas, una fecha desactivada (isActive=false) no matchea aunque otra fecha de la misma regla sí", async () => {
    const navidad = new Date("2026-12-25");
    const anioNuevoDesactivado = new Date("2027-01-01");
    const feriado = rule({ id: "rule-feriado", recurrenceType: "FECHA", multiplier: 2, dates: [{ date: navidad, isActive: true }, { date: anioNuevoDesactivado, isActive: false }] });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([feriado]);
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValue({ id: "punch-in" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-navidad" });

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(new Date("2026-12-25T00:00:00.000Z")));
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([feriado]);
    mockedPrisma.__tx.hourConcept.findMany.mockResolvedValue([]);
    mockedPrisma.__tx.timeEntry.findFirst.mockResolvedValue(null);
    mockedPrisma.__tx.employee.findUnique.mockResolvedValue({ sectorId: null, costCenterId: null, positionId: null, companies: [] });
    mockedPrisma.__tx.timeSegment.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "segment-x", ...data }));
    mockedPrisma.__tx.timeEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "entry-x", ...data }));
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValue({ id: "punch-in" });

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(new Date("2027-01-01T00:00:00.000Z")));
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).not.toHaveBeenCalled();
  });

  it("Caso U (Etapa 8C) — empleado con centro de costo: el AND de scope permite costCenterId null o ese centro (nunca cualquier centro)", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-u" });
    mockedPrisma.__tx.employee.findUnique.mockResolvedValue({ sectorId: null, costCenterId: "cc-tropa", positionId: null, companies: [] });

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday));

    expect(mockedPrisma.__tx.doubleHourRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ OR: [{ costCenterId: null }, { costCenterId: "cc-tropa" }] }]),
        }),
      }),
    );
  });

  it("Caso V (Etapa 8C) — empleado con puesto: el AND de scope permite positionId null o ese puesto (nunca cualquier puesto)", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-v" });
    mockedPrisma.__tx.employee.findUnique.mockResolvedValue({ sectorId: null, costCenterId: null, positionId: "pos-sereno", companies: [] });

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday));

    expect(mockedPrisma.__tx.doubleHourRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ OR: [{ positionId: null }, { positionId: "pos-sereno" }] }]),
        }),
      }),
    );
  });

  it("Caso W (Etapa 8C) — empleados específicos + empresa + sector: las 3 dimensiones conviven en el mismo AND (empleados no reemplaza a empresa/sector, se combinan)", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-w" });
    mockedPrisma.__tx.employee.findUnique.mockResolvedValue({ sectorId: "panol", costCenterId: null, positionId: null, companies: [{ companyId: "odwyer" }] });

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday));

    expect(mockedPrisma.__tx.doubleHourRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            { OR: [{ employees: { none: {} } }, { employees: { some: { employeeId } } }] },
            { OR: [{ companyId: null }, { companyId: { in: ["odwyer"] } }] },
            { OR: [{ sectorId: null }, { sectorId: "panol" }] },
            { costCenterId: null },
            { positionId: null },
          ],
        }),
      }),
    );
  });

  it("Caso X (Etapa 8C) — el motor sólo trae reglas con status ACTIVO: una regla inactiva nunca llega a matchear (filtro estructural, no de aplicación)", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-x" });

    await timeEntriesRepository.createFromWorkShift(oneSegmentInput(sunday));

    expect(mockedPrisma.__tx.doubleHourRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "ACTIVO" }) }),
    );
  });

  it("Caso Y (Etapa 8C) — regla FECHA (feriado) que cruza medianoche hacia un día normal: sólo el tramo del feriado recibe la regla", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-y" });
    const navidad = new Date("2026-12-25T00:00:00.000Z");
    const diaNormal = new Date("2026-12-26T00:00:00.000Z");
    const feriado = rule({ id: "rule-navidad", recurrenceType: "FECHA", multiplier: 2, dates: [{ date: navidad, isActive: true }] });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([feriado]);

    const startAt = new Date("2026-12-25T22:00:00.000Z");
    const midnight = new Date("2026-12-26T00:00:00.000Z");
    const endAt = new Date("2026-12-26T02:00:00.000Z");

    const result = await timeEntriesRepository.createFromWorkShift({
      employeeId,
      normalHourConceptId: "concept-normal",
      normalHourConceptName: "Hora normal",
      source: "ADMIN" as never,
      startAt,
      endAt,
      totalMinutes: 240,
      segments: [
        { date: navidad, startAt, endAt: midnight, minutes: 120, hours: 2, hourConceptId: "concept-normal", hourConceptName: "Hora normal", conceptStatus: "SUGERIDO", hourConceptRuleId: null },
        { date: diaNormal, startAt: midnight, endAt, minutes: 120, hours: 2, hourConceptId: "concept-normal", hourConceptName: "Hora normal", conceptStatus: "SUGERIDO", hourConceptRuleId: null },
      ],
    });

    expect(mockedPrisma.__tx.timeSegment.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ isSpecial: true }) }));
    expect(mockedPrisma.__tx.timeSegment.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ isSpecial: false }) }));
    expect(mockedPrisma.__tx.specialHourRuleApplication.create).toHaveBeenCalledTimes(1); // sólo el tramo 25/12 matchea
    expect(result.entries).toHaveLength(2);
    expect(Number((result.entries[0] as unknown as { appliedMultiplier: unknown }).appliedMultiplier)).toBe(2); // tramo feriado
    expect(Number((result.entries[1] as unknown as { appliedMultiplier: unknown }).appliedMultiplier)).toBe(1); // tramo día normal
    const totalRealMinutes = result.entries.reduce((sum, e) => sum + (e as { totalMinutes: number }).totalMinutes, 0);
    expect(totalRealMinutes).toBe(240); // nunca 120 + 240
  });

  it("isNight se deriva del HourConceptKind (NOCTURNA/GUARDIA/SERENO) del concepto del segmento, sin comparar nombres", async () => {
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValueOnce({ id: "punch-in" }).mockResolvedValueOnce({ id: "punch-out" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-night" });
    mockedPrisma.__tx.doubleHourRule.findMany.mockResolvedValue([]);
    mockedPrisma.__tx.hourConcept.findMany.mockResolvedValue([
      { id: "concept-guardia", kind: "GUARDIA" },
      { id: "concept-normal", kind: "NORMAL" },
    ]);

    const startAt = sunday;
    const mid = new Date(sunday.getTime() + 2 * 60 * 60_000);
    const endAt = new Date(sunday.getTime() + 4 * 60 * 60_000);

    await timeEntriesRepository.createFromWorkShift({
      employeeId,
      normalHourConceptId: "concept-normal",
      normalHourConceptName: "Hora normal",
      source: "ADMIN" as never,
      startAt,
      endAt,
      totalMinutes: 240,
      segments: [
        { date: sunday, startAt, endAt: mid, minutes: 120, hours: 2, hourConceptId: "concept-normal", hourConceptName: "Hora normal", conceptStatus: "SUGERIDO", hourConceptRuleId: null },
        { date: sunday, startAt: mid, endAt, minutes: 120, hours: 2, hourConceptId: "concept-guardia", hourConceptName: "Guardia", conceptStatus: "SUGERIDO", hourConceptRuleId: null },
      ],
    });

    expect(mockedPrisma.__tx.timeSegment.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ hourConceptId: "concept-normal", isNight: false }) }));
    expect(mockedPrisma.__tx.timeSegment.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ hourConceptId: "concept-guardia", isNight: true }) }));
  });
});

describe("rolloverExpiredOpenWorkShift — regresión de atribución de día/período (Etapa 2)", () => {
  it("la jornada anterior que arrancó a las 23:30 hora Argentina se atribuye a agosto/día 14, no a septiembre/día 1 en UTC", async () => {
    // 2026-08-14 23:30 ART = 2026-08-15 02:30 UTC.
    const previousStartAt = new Date("2026-08-15T02:30:00.000Z");

    mockedPrisma.__tx.workShift.findFirst.mockResolvedValue({
      id: "shift-prev",
      startAt: previousStartAt,
      source: "PORTAL_DNI",
      hourConcept: { id: "concept-1", name: "Normal" },
    });
    mockedPrisma.__tx.workShift.updateMany.mockResolvedValue({ count: 1 });
    mockedPrisma.__tx.timeEntry.create.mockResolvedValue({});
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValue({ id: "punch-1" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-new" });

    await timeEntriesRepository.rolloverExpiredOpenWorkShift({
      openWorkShiftId: "shift-prev",
      employeeId: "employee-1",
      source: "PORTAL_DNI" as never,
      startAt: new Date("2026-08-15T10:00:00.000Z"),
      missingOutObservation: "Olvido de salida.",
    });

    expect(mockedPrisma.__tx.timeEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ period: "2026-08", day: 14 }),
      }),
    );
  });

  it("resuelve la alerta POSIBLE_OLVIDO_SALIDA de la jornada vieja que quedó marcada FALTA_SALIDA (Etapa 10B, hallazgo 10A §11.2)", async () => {
    mockedPrisma.__tx.workShift.findFirst.mockResolvedValue({
      id: "shift-prev",
      startAt: new Date("2026-08-15T02:30:00.000Z"),
      source: "PORTAL_DNI",
      hourConcept: { id: "concept-1", name: "Normal" },
    });
    mockedPrisma.__tx.workShift.updateMany.mockResolvedValue({ count: 1 });
    mockedPrisma.__tx.timeEntry.create.mockResolvedValue({});
    mockedPrisma.__tx.attendancePunch.create.mockResolvedValue({ id: "punch-1" });
    mockedPrisma.__tx.workShift.create.mockResolvedValue({ id: "shift-new" });

    await timeEntriesRepository.rolloverExpiredOpenWorkShift({
      openWorkShiftId: "shift-prev",
      employeeId: "employee-1",
      source: "PORTAL_DNI" as never,
      startAt: new Date("2026-08-15T10:00:00.000Z"),
      missingOutObservation: "Olvido de salida.",
    });

    expect(mockedResolveOpenShiftOverflowAlert).toHaveBeenCalledWith("shift-prev", expect.any(String));
  });
});

describe("summary — horas contables = sólo Horas normales (Etapa 6M)", () => {
  const employeeAccessWhere = { costCenterId: { in: ["cc-1"] } };

  beforeEach(() => {
    mockedPrisma.employee.count.mockResolvedValueOnce(10).mockResolvedValueOnce(7).mockResolvedValueOnce(3);
    mockedPrisma.timeEntry.groupBy.mockResolvedValue([]);
    mockedPrisma.timeEntry.aggregate.mockResolvedValue({ _sum: { hours: { toString: () => "56" } } });
  });

  it("filtra el aggregate por hourConcept.systemRole = NORMAL_BASE, excluyendo conceptos adicionales", async () => {
    await timeEntriesRepository.summary("2026-08", employeeAccessWhere);

    expect(mockedPrisma.timeEntry.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ hourConcept: { systemRole: "NORMAL_BASE" } }),
      }),
    );
  });

  it("countableHours refleja únicamente la suma de Horas normales devuelta por Prisma", async () => {
    const result = await timeEntriesRepository.summary("2026-08", employeeAccessWhere);

    expect(result.countableHours).toBe(56);
  });
});

describe("findMany(view=byEmployee) — resumen por empleado suma sólo Horas normales (Etapa 6M)", () => {
  const employeeAccessWhere = {};
  const baseQuery = { view: "byEmployee" as const, page: 1, take: 200 };

  beforeEach(() => {
    mockedPrisma.__tx.employee.findMany.mockResolvedValue([
      { id: "employee-1", legajo: "0001", legajoFinnegans: null, cuil: "20-1-1", dni: "1", firstName: "Juan", lastName: "Perez", status: "ACTIVO", sector: null, costCenter: null, position: null, companies: [] },
    ]);
    mockedPrisma.__tx.employee.count.mockResolvedValue(1);
  });

  it("filtra timeEntry.findMany por hourConcept.systemRole = NORMAL_BASE, excluyendo conceptos adicionales del total", async () => {
    mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([{ employeeId: "employee-1", hours: { toString: () => "8" } }]);

    await timeEntriesRepository.findMany(baseQuery, employeeAccessWhere);

    expect(mockedPrisma.__tx.timeEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ hourConcept: { systemRole: "NORMAL_BASE" } }),
      }),
    );
  });

  it("suma las horas normales ya filtradas por empleado", async () => {
    mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([
      { employeeId: "employee-1", hours: { toString: () => "8" } },
      { employeeId: "employee-1", hours: { toString: () => "4" } },
    ]);

    const [items] = (await timeEntriesRepository.findMany(baseQuery, employeeAccessWhere)) as unknown as [Array<{ summary: { total: number } }>, number];

    expect(items[0]!.summary.total).toBe(12);
  });

  // Etapa 11C: "Por persona" ni siquiera consultaba HourConceptBreakdown ni
  // appliedMultiplier — quedaba completamente ciega a Horas Especiales,
  // a diferencia de "Por registro" (11B) y la grilla principal (11A/11A.1).
  describe("Horas Especiales en el resumen por persona (Etapa 11C)", () => {
    const queryWithPeriod = { view: "byEmployee" as const, page: 1, take: 200, period: "2026-08", status: "EN_REVISION" as const };

    it("caso obligatorio — 8hs normales + 4hs Sereno en domingo x2: total real=8, total liquidable=24", async () => {
      mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([{
        employeeId: "employee-1", day: 27, hours: { toString: () => "8" }, appliedMultiplier: 2,
        timeSegment: { specialHourRuleApplications: [{ wasConflicting: false, doubleHourRule: { name: "Domingo" } }] },
      }]);
      mockedPrisma.__tx.hourConceptBreakdown.findMany.mockResolvedValue([{ employeeId: "employee-1", day: 27, minutes: 240 }]);

      const [items] = (await timeEntriesRepository.findMany(queryWithPeriod, employeeAccessWhere)) as unknown as [
        Array<{ summary: { total: number; specialHourAdditionalHours: number; specialHourLiquidableTotal: number; specialHourRuleNames: string[]; specialHourConflict: boolean } }>,
        number,
      ];

      expect(items[0]!.summary).toMatchObject({
        total: 8, // real, nunca 24
        specialHourAdditionalHours: 12, // 8*(2-1) + 4*(2-1)
        specialHourLiquidableTotal: 24, // (8+4) + 12
        specialHourRuleNames: ["Domingo"],
        specialHourConflict: false,
      });
    });

    it("sin ninguna Hora Especial: adicional=0, liquidable=total real", async () => {
      mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([
        { employeeId: "employee-1", day: 10, hours: { toString: () => "8" }, appliedMultiplier: 1, timeSegment: null },
      ]);
      mockedPrisma.__tx.hourConceptBreakdown.findMany.mockResolvedValue([]);

      const [items] = (await timeEntriesRepository.findMany(queryWithPeriod, employeeAccessWhere)) as unknown as [
        Array<{ summary: { total: number; specialHourAdditionalHours: number; specialHourLiquidableTotal: number } }>,
        number,
      ];

      expect(items[0]!.summary).toMatchObject({ total: 8, specialHourAdditionalHours: 0, specialHourLiquidableTotal: 8 });
    });

    it("carga manual (sin timeSegment): igual expone multiplicador/liquidable, sin nombre de regla — coherente con carga automática", async () => {
      mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([
        { employeeId: "employee-1", day: 27, hours: { toString: () => "8" }, appliedMultiplier: 2, timeSegment: null },
      ]);
      mockedPrisma.__tx.hourConceptBreakdown.findMany.mockResolvedValue([]);

      const [items] = (await timeEntriesRepository.findMany(queryWithPeriod, employeeAccessWhere)) as unknown as [
        Array<{ summary: { specialHourAdditionalHours: number; specialHourRuleNames: string[] } }>,
        number,
      ];

      expect(items[0]!.summary).toMatchObject({ specialHourAdditionalHours: 8, specialHourRuleNames: [] });
    });

    it("conflicto de prioridad (empate): specialHourConflict=true por empleado", async () => {
      mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([{
        employeeId: "employee-1", day: 16, hours: { toString: () => "8" }, appliedMultiplier: 2.5,
        timeSegment: {
          specialHourRuleApplications: [
            { wasConflicting: true, doubleHourRule: { name: "Domingo Odwyer" } },
            { wasConflicting: true, doubleHourRule: { name: "Domingo Pañol" } },
          ],
        },
      }]);
      mockedPrisma.__tx.hourConceptBreakdown.findMany.mockResolvedValue([]);

      const [items] = (await timeEntriesRepository.findMany(queryWithPeriod, employeeAccessWhere)) as unknown as [
        Array<{ summary: { specialHourConflict: boolean } }>,
        number,
      ];

      expect(items[0]!.summary.specialHourConflict).toBe(true);
    });

    it("no consulta HourConceptBreakdown si la query no trae period (evita una consulta innecesaria)", async () => {
      mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([]);

      await timeEntriesRepository.findMany({ view: "byEmployee", page: 1, take: 200 }, employeeAccessWhere);

      expect(mockedPrisma.__tx.hourConceptBreakdown.findMany).not.toHaveBeenCalled();
    });
  });
});

describe("findPeriodEmployees — total=Normal, adicionales desde HourConceptBreakdown (Etapa 6M)", () => {
  const employeeAccessWhere = {};
  const baseQuery = { period: "2026-08", page: 1, take: 25 };

  beforeEach(() => {
    mockedPrisma.__tx.employee.findMany.mockResolvedValue([
      { id: "employee-1", legajo: "0001", legajoFinnegans: null, cuil: "20-1-1", dni: "1", firstName: "Juan", lastName: "Perez", status: "ACTIVO", sector: null, costCenter: null, position: null, companies: [] },
    ]);
    mockedPrisma.__tx.employee.count.mockResolvedValue(1);
    mockedPrisma.__tx.novelty.findMany.mockResolvedValue([]);
  });

  it("un TimeEntry legacy no-Normal (systemRole distinto de NORMAL_BASE) no infla el total ni 'normal'", async () => {
    mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([
      { employeeId: "employee-1", day: 1, hours: { toString: () => "8" }, status: "APROBADO", hourConcept: { systemRole: "NORMAL_BASE" }, workShift: null },
      // Entrada especial legacy previa a la Etapa 6L: no debe sumar a total/normal.
      { employeeId: "employee-1", day: 1, hours: { toString: () => "2" }, status: "APROBADO", hourConcept: { systemRole: null }, workShift: null },
    ]);
    mockedPrisma.__tx.hourConceptBreakdown.findMany.mockResolvedValue([]);

    const result = await timeEntriesRepository.findPeriodEmployees(baseQuery, employeeAccessWhere);

    expect(result.items[0]!.summary.total).toBe(8);
    expect(result.items[0]!.summary.normal).toBe(8);
  });

  it("HourConceptBreakdown aparece como 'special' separado, sin sumarse a 'total'", async () => {
    mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([
      { employeeId: "employee-1", day: 1, hours: { toString: () => "8" }, status: "APROBADO", hourConcept: { systemRole: "NORMAL_BASE" }, workShift: null },
    ]);
    mockedPrisma.__tx.hourConceptBreakdown.findMany.mockResolvedValue([{ employeeId: "employee-1", day: 1, minutes: 120 }]);

    const result = await timeEntriesRepository.findPeriodEmployees(baseQuery, employeeAccessWhere);

    expect(result.items[0]!.summary).toMatchObject({ total: 8, normal: 8, special: 2 });
    expect(result.items[0]!.summary.dailyBreakdown.find((day) => day.day === 1)).toMatchObject({ normal: 8, special: 2, total: 8 });
  });

  it("excluye breakdowns RECHAZADO vía el where de hourConceptBreakdown.findMany", async () => {
    mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([]);
    mockedPrisma.__tx.hourConceptBreakdown.findMany.mockResolvedValue([]);

    await timeEntriesRepository.findPeriodEmployees(baseQuery, employeeAccessWhere);

    expect(mockedPrisma.__tx.hourConceptBreakdown.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: "RECHAZADO" } }),
      }),
    );
  });

  // Etapa 11A: bug del día 27 feriado x2 — antes de esta etapa la grilla no
  // leía appliedMultiplier/specialHourRuleApplications en absoluto (ver
  // docs/decisions/HOURS_GRID_REVIEW_SPECIAL_HOURS_AUDIT_11A.md). Estos tests
  // verifican que ahora sí, sin tocar total/normal (horas reales intactas).
  it("un día con appliedMultiplier=2 expone specialHourMultiplier/specialHourAdditionalHours sin sumarse a total/normal", async () => {
    mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([
      {
        employeeId: "employee-1", day: 27, hours: { toString: () => "8" }, status: "APROBADO",
        appliedMultiplier: 2, hourConcept: { systemRole: "NORMAL_BASE" }, workShift: null,
        timeSegment: { specialHourRuleApplications: [{ wasConflicting: false, doubleHourRule: { name: "Feriado" } }] },
      },
    ]);
    mockedPrisma.__tx.hourConceptBreakdown.findMany.mockResolvedValue([]);

    const result = await timeEntriesRepository.findPeriodEmployees(baseQuery, employeeAccessWhere);

    expect(result.items[0]!.summary).toMatchObject({ total: 8, normal: 8, specialHourAdditionalHours: 8 });
    expect(result.items[0]!.summary.dailyBreakdown.find((day) => day.day === 27)).toMatchObject({
      total: 8,
      normal: 8,
      specialHourMultiplier: 2,
      specialHourAdditionalHours: 8,
      specialHourRuleNames: ["Feriado"],
      specialHourConflict: false,
    });
  });

  it("appliedMultiplier=1 (sin regla): specialHourMultiplier queda en 1 y specialHourAdditionalHours en 0", async () => {
    mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([
      { employeeId: "employee-1", day: 5, hours: { toString: () => "8" }, status: "APROBADO", appliedMultiplier: 1, hourConcept: { systemRole: "NORMAL_BASE" }, workShift: null, timeSegment: null },
    ]);
    mockedPrisma.__tx.hourConceptBreakdown.findMany.mockResolvedValue([]);

    const result = await timeEntriesRepository.findPeriodEmployees(baseQuery, employeeAccessWhere);

    expect(result.items[0]!.summary.dailyBreakdown.find((day) => day.day === 5)).toMatchObject({
      specialHourMultiplier: 1,
      specialHourAdditionalHours: 0,
      specialHourRuleNames: [],
    });
  });

  it("una carga manual con appliedMultiplier=2 pero sin timeSegment (sin trazabilidad por regla): igual expone el multiplicador/adicional, sin nombre de regla", async () => {
    mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([
      { employeeId: "employee-1", day: 27, hours: { toString: () => "8" }, status: "APROBADO", appliedMultiplier: 2, hourConcept: { systemRole: "NORMAL_BASE" }, workShift: null, timeSegment: null },
    ]);
    mockedPrisma.__tx.hourConceptBreakdown.findMany.mockResolvedValue([]);

    const result = await timeEntriesRepository.findPeriodEmployees(baseQuery, employeeAccessWhere);

    expect(result.items[0]!.summary.dailyBreakdown.find((day) => day.day === 27)).toMatchObject({
      specialHourMultiplier: 2,
      specialHourAdditionalHours: 8,
      specialHourRuleNames: [],
    });
  });

  it("marca specialHourConflict cuando alguna regla ganadora quedó wasConflicting=true (empate de prioridad)", async () => {
    mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([
      {
        employeeId: "employee-1", day: 16, hours: { toString: () => "8" }, status: "APROBADO",
        appliedMultiplier: 2.5, hourConcept: { systemRole: "NORMAL_BASE" }, workShift: null,
        timeSegment: {
          specialHourRuleApplications: [
            { wasConflicting: true, doubleHourRule: { name: "Domingo Odwyer" } },
            { wasConflicting: true, doubleHourRule: { name: "Domingo Pañol" } },
          ],
        },
      },
    ]);
    mockedPrisma.__tx.hourConceptBreakdown.findMany.mockResolvedValue([]);

    const result = await timeEntriesRepository.findPeriodEmployees(baseQuery, employeeAccessWhere);

    const day = result.items[0]!.summary.dailyBreakdown.find((entry) => entry.day === 16);
    expect(day).toMatchObject({ specialHourConflict: true });
    expect(day!.specialHourRuleNames).toEqual(["Domingo Odwyer", "Domingo Pañol"]);
  });

  it("consulta timeSegment.specialHourRuleApplications filtrado a isWinner=true (nunca las reglas perdedoras)", async () => {
    mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([]);
    mockedPrisma.__tx.hourConceptBreakdown.findMany.mockResolvedValue([]);

    await timeEntriesRepository.findPeriodEmployees(baseQuery, employeeAccessWhere);

    expect(mockedPrisma.__tx.timeEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          appliedMultiplier: true,
          timeSegment: expect.objectContaining({
            select: expect.objectContaining({
              specialHourRuleApplications: expect.objectContaining({ where: { isWinner: true } }),
            }),
          }),
        }),
      }),
    );
  });

  // Etapa 11A.1: el multiplicador de Hora Especial ahora también alcanza a
  // los Conceptos Horarios adicionales del mismo día/empleado, y se expone
  // un "total liquidable" real (antes sólo se exponía el delta adicional).
  describe("liquidable de Horas Especiales sobre total y conceptos horarios (Etapa 11A.1)", () => {
    function normalEntry(day: number, hours: string, appliedMultiplier: number, ruleNames: string[] = [], wasConflicting = false) {
      return {
        employeeId: "employee-1", day, hours: { toString: () => hours }, status: "APROBADO",
        appliedMultiplier, hourConcept: { systemRole: "NORMAL_BASE" }, workShift: null,
        timeSegment: ruleNames.length ? { specialHourRuleApplications: ruleNames.map((name) => ({ wasConflicting, doubleHourRule: { name } })) } : null,
      };
    }
    function breakdown(day: number, minutes: number) {
      return { employeeId: "employee-1", day, minutes };
    }

    it("Caso C — 8 normales + 4hs Sereno en feriado x2: liquidable normal 16, liquidable conceptos 8, total liquidable 24, reales sin inflar", async () => {
      mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([normalEntry(27, "8", 2, ["Feriado"])]);
      mockedPrisma.__tx.hourConceptBreakdown.findMany.mockResolvedValue([breakdown(27, 240)]); // 4hs Sereno

      const result = await timeEntriesRepository.findPeriodEmployees(baseQuery, employeeAccessWhere);

      const day = result.items[0]!.summary.dailyBreakdown.find((entry) => entry.day === 27)!;
      expect(day).toMatchObject({
        normal: 8, special: 4, total: 8, // reales, nunca inflados
        specialHourMultiplier: 2,
        specialHourAdditionalHours: 12, // 8*(2-1) + 4*(2-1) = 8 + 4
        specialHourLiquidableTotal: 24, // (8+4) + 12
      });
      expect(result.items[0]!.summary.specialHourLiquidableTotal).toBe(24);
    });

    it("Caso B (regresión) — 8 normales sin conceptos en domingo x2: liquidable 16, adicional 8, sin conceptos que multiplicar", async () => {
      mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([normalEntry(16, "8", 2, ["Domingo"])]);
      mockedPrisma.__tx.hourConceptBreakdown.findMany.mockResolvedValue([]);

      const result = await timeEntriesRepository.findPeriodEmployees(baseQuery, employeeAccessWhere);

      const day = result.items[0]!.summary.dailyBreakdown.find((entry) => entry.day === 16)!;
      expect(day).toMatchObject({ normal: 8, special: 0, total: 8, specialHourAdditionalHours: 8, specialHourLiquidableTotal: 16 });
    });

    it("Caso A — 8 normales sin regla: total liquidable = total real, sin adicional", async () => {
      mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([normalEntry(10, "8", 1)]);
      mockedPrisma.__tx.hourConceptBreakdown.findMany.mockResolvedValue([]);

      const result = await timeEntriesRepository.findPeriodEmployees(baseQuery, employeeAccessWhere);

      const day = result.items[0]!.summary.dailyBreakdown.find((entry) => entry.day === 10)!;
      expect(day).toMatchObject({ specialHourMultiplier: 1, specialHourAdditionalHours: 0, specialHourLiquidableTotal: 8 });
    });

    it("Caso D — día común (sin regla) con 8 normales + 4hs Sereno: total liquidable = normal+special (12), sin adicional — decisión documentada: los conceptos ya liquidan como adicionales, con o sin Hora Especial", async () => {
      mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([normalEntry(5, "8", 1)]);
      mockedPrisma.__tx.hourConceptBreakdown.findMany.mockResolvedValue([breakdown(5, 240)]);

      const result = await timeEntriesRepository.findPeriodEmployees(baseQuery, employeeAccessWhere);

      const day = result.items[0]!.summary.dailyBreakdown.find((entry) => entry.day === 5)!;
      expect(day).toMatchObject({ normal: 8, special: 4, total: 8, specialHourMultiplier: 1, specialHourAdditionalHours: 0, specialHourLiquidableTotal: 12 });
    });

    it("Caso E — multiplicador x1.5 con 2hs de concepto adicional: liquidable con decimales correctos", async () => {
      mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([normalEntry(3, "8", 1.5, ["Feriado 1.5x"])]);
      mockedPrisma.__tx.hourConceptBreakdown.findMany.mockResolvedValue([breakdown(3, 120)]); // 2hs

      const result = await timeEntriesRepository.findPeriodEmployees(baseQuery, employeeAccessWhere);

      const day = result.items[0]!.summary.dailyBreakdown.find((entry) => entry.day === 3)!;
      // adicional: 8*0.5 + 2*0.5 = 4 + 1 = 5; liquidable total: (8+2) + 5 = 15
      expect(day).toMatchObject({ specialHourAdditionalHours: 5, specialHourLiquidableTotal: 15 });
    });

    it("Caso F — conflicto de prioridad (empate): usa el multiplicador ya resuelto por el motor (ganador), no inventa uno nuevo, y sigue marcando el conflicto", async () => {
      // El motor (resolveWinningRules, ya probado en doubleHourRuleMatching.test.ts) resolvió el empate
      // y appliedMultiplier ya llegó con el multiplicador ganador — acá sólo se verifica que la grilla
      // no recalcula ni ignora ese valor, y que el conceptBreakdown también lo recibe.
      mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([normalEntry(16, "8", 2.5, ["Domingo Odwyer", "Domingo Pañol"], true)]);
      mockedPrisma.__tx.hourConceptBreakdown.findMany.mockResolvedValue([breakdown(16, 240)]);

      const result = await timeEntriesRepository.findPeriodEmployees(baseQuery, employeeAccessWhere);

      const day = result.items[0]!.summary.dailyBreakdown.find((entry) => entry.day === 16)!;
      expect(day.specialHourConflict).toBe(true);
      expect(day.specialHourMultiplier).toBe(2.5);
      // liquidable: normal 8*2.5=20, concepto 4*2.5=10, total real 12, adicional 18, liquidable 30
      expect(day.specialHourLiquidableTotal).toBe(30);
    });

    it("breakdown sin Hora normal ese día (huérfano): no se puede resolver el multiplicador sin otra fuente — queda en 1 (limitación documentada, no una consulta extra por fila)", async () => {
      mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([]); // ninguna Hora normal cargada ese día
      mockedPrisma.__tx.hourConceptBreakdown.findMany.mockResolvedValue([breakdown(20, 240)]);

      const result = await timeEntriesRepository.findPeriodEmployees(baseQuery, employeeAccessWhere);

      const day = result.items[0]!.summary.dailyBreakdown.find((entry) => entry.day === 20)!;
      expect(day).toMatchObject({ special: 4, specialHourMultiplier: 1, specialHourAdditionalHours: 0, specialHourLiquidableTotal: 4 });
    });

    it("Caso G — empleado fuera de alcance de la regla: appliedMultiplier ya llegó en 1 (resuelto por el motor al cargar), sus Conceptos Horarios tampoco se multiplican", async () => {
      // El scope (alcance) ya se resuelve en el motor de escritura (createFromWorkShift/
      // closeOpenWorkShift/resolveDoubleHourMultiplierForManualEntry, Casos L-Y/11A) — acá
      // sólo se confirma que la grilla no reintroduce una multiplicación por su cuenta
      // cuando el appliedMultiplier persistido ya es 1 por estar fuera de alcance.
      mockedPrisma.__tx.timeEntry.findMany.mockResolvedValue([normalEntry(27, "8", 1)]); // fuera de alcance -> multiplicador 1
      mockedPrisma.__tx.hourConceptBreakdown.findMany.mockResolvedValue([breakdown(27, 240)]);

      const result = await timeEntriesRepository.findPeriodEmployees(baseQuery, employeeAccessWhere);

      const day = result.items[0]!.summary.dailyBreakdown.find((entry) => entry.day === 27)!;
      expect(day).toMatchObject({ normal: 8, special: 4, specialHourMultiplier: 1, specialHourAdditionalHours: 0, specialHourLiquidableTotal: 12 });
    });
  });
});

describe("findForExport — filtra specialHourRuleApplications a isWinner=true (Etapa 11B)", () => {
  it("consulta timeSegment.specialHourRuleApplications con where: { isWinner: true } y trae wasConflicting", async () => {
    mockedPrisma.timeEntry.findMany.mockResolvedValue([]);

    await timeEntriesRepository.findForExport({ period: "2026-08", includeInReview: false }, {});

    expect(mockedPrisma.timeEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          timeSegment: expect.objectContaining({
            select: expect.objectContaining({
              specialHourRuleApplications: expect.objectContaining({
                where: { isWinner: true },
                select: expect.objectContaining({ wasConflicting: true }),
              }),
            }),
          }),
        }),
      }),
    );
  });
});

describe("findBreakdownHoursForExport — horas adicionales para exportación (Etapa 6M)", () => {
  it("no consulta Prisma si employeeIds está vacío", async () => {
    const result = await timeEntriesRepository.findBreakdownHoursForExport([], "2026-08");

    expect(result).toEqual([]);
    expect(mockedPrisma.hourConceptBreakdown.findMany).not.toHaveBeenCalled();
  });

  it("filtra por employeeIds, period y excluye status RECHAZADO", async () => {
    mockedPrisma.hourConceptBreakdown.findMany.mockResolvedValue([{ employeeId: "employee-1", day: 27, minutes: 360 }]);

    const result = await timeEntriesRepository.findBreakdownHoursForExport(["employee-1"], "2026-08");

    expect(mockedPrisma.hourConceptBreakdown.findMany).toHaveBeenCalledWith({
      where: { employeeId: { in: ["employee-1"] }, period: "2026-08", status: { not: "RECHAZADO" } },
      // Etapa 11B: `day` se agrega para poder derivar el liquidable de
      // Conceptos Horarios en exportByPerson (multiplicador por día/empleado).
      select: { employeeId: true, day: true, minutes: true },
    });
    expect(result).toEqual([{ employeeId: "employee-1", day: 27, minutes: 360 }]);
  });
});
