import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { buildExpectedBlock } from "../shifts/rotationPlan";
import type { LoadedRotationTemplate } from "../shifts/rotationPlan.loader";
import { resolveWorkObligationCandidates, type WorkObligationCandidate } from "../shifts/workObligation.service";
import * as inactivity from "./attendanceInactivity.service";
import { checkMissingEntriesForElapsedDate, checkMissingExpectedEntries } from "./missingEntry.service";

/**
 * R4.3b (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.5): camino POR BLOQUE de la falta de
 * ingreso con Prisma mockeado — orden de las operaciones dentro de la transacción, reversión si la
 * verificación falla, sólo bloques vencidos, novedad, evidencia por `obligationKey` y forma del
 * resultado. La persistencia y la concurrencia reales están en rotationAttendance.integration.test.ts.
 */
const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  attendanceInactivityIncident: { findFirst: vi.fn(), createMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
}));

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    clockPunchAttempt: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (work: (client: unknown) => unknown) => work(tx)),
    attendanceInactivityIncident: { findMany: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock("../shifts/workObligation.service", () => ({
  resolveWorkObligationCandidates: vi.fn(),
  resolveRotationBlockCandidates: vi.fn(async () => ({ rotation: new Map(), candidates: [] })),
}));

vi.mock("./attendanceInactivity.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./attendanceInactivity.service")>()),
  findSatisfiedBlockObligationKeys: vi.fn(),
  findInFlightBlockObligationKeys: vi.fn(),
  findEmployeeIdsExcludedByNovelty: vi.fn(),
  claimAndNotifyInactivityIncidents: vi.fn(async () => 0),
}));

const db = prisma as unknown as { $transaction: Mock; attendanceInactivityIncident: { findMany: Mock; updateMany: Mock } };
const satisfiedKeys = inactivity.findSatisfiedBlockObligationKeys as unknown as Mock;
const inFlightKeys = inactivity.findInFlightBlockObligationKeys as unknown as Mock;
const excludedByNovelty = inactivity.findEmployeeIdsExcludedByNovelty as unknown as Mock;
const notify = inactivity.claimAndNotifyInactivityIncidents as unknown as Mock;

const FRI = "2026-11-06";
const at = (time: string) => new Date(`${FRI}T${time.length === 5 ? `${time}:00` : time}-03:00`);

const template = (code: string, startTime: string, endTime: string): LoadedRotationTemplate => ({
  id: code,
  code,
  startTime,
  endTime,
  crossesMidnight: endTime <= startTime,
  status: "ACTIVO",
  entryToleranceBeforeMinutes: 10,
  entryToleranceAfterMinutes: 10,
  exitToleranceBeforeMinutes: 20,
  exitToleranceAfterMinutes: 20,
  minimumMinutesForCompliance: null,
  maximumInformativeMinutes: null,
  missingOutAlertAfterMinutes: null,
  absoluteOpenShiftLimitMinutes: 1200,
});

function blockCandidate(blockIndex: number, tpl: LoadedRotationTemplate): WorkObligationCandidate {
  const block = buildExpectedBlock({ employeeId: "jose", dateKey: FRI, blockIndex, template: tpl, source: "ROTATION", origin: null })!;
  return { employeeId: "jose", template: tpl, scheduledStartAt: block.scheduledStartAt, block };
}

const MORNING = blockCandidate(0, template("PLANTA-07-11", "07:00", "11:00"));
const NIGHT = blockCandidate(1, template("PLANTA-19-07", "19:00", "07:00"));

beforeEach(() => {
  vi.clearAllMocks();
  (resolveWorkObligationCandidates as Mock).mockResolvedValue({ isHoliday: false, candidates: [MORNING, NIGHT] });
  satisfiedKeys.mockResolvedValue(new Set());
  inFlightKeys.mockResolvedValue(new Set());
  excludedByNovelty.mockResolvedValue(new Set());
  tx.attendanceInactivityIncident.findFirst.mockResolvedValue(null);
  tx.attendanceInactivityIncident.count.mockImplementation(async (args: { where: { scheduledStartAt: { in: Date[] } } }) => args.where.scheduledStartAt.in.length);
  db.attendanceInactivityIncident.findMany.mockResolvedValue([]);
});

describe("checkMissingExpectedEntries — camino por bloque (R4.3b)", () => {
  it("sólo bloques VENCIDOS: a las 07:10:30 (frontera de puntualidad, O2) se crea la falta del bloque 07:00, nunca la del 19:00", async () => {
    // O2: hasta +10:29.999 la entrada todavía sería puntual (Math.round) → nada vencido.
    expect(await checkMissingExpectedEntries(at("07:10:29.999"))).toMatchObject({ due: 0, created: 0 });
    const result = await checkMissingExpectedEntries(at("07:10:30"));
    expect(result).toEqual({ candidates: 2, due: 1, created: 1, resolved: 0 });
    expect(result).not.toHaveProperty("reconciliationRequired");
    // lock de jornada → lock global compartido de cobertura → lock del legajo.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(3);
    expect(tx.$executeRaw.mock.invocationCallOrder[2]).toBeLessThan(tx.attendanceInactivityIncident.findFirst.mock.invocationCallOrder[0]!);
    expect(tx.attendanceInactivityIncident.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ employeeId: "jose", scheduledStartAt: MORNING.scheduledStartAt })],
      skipDuplicates: true,
    });
  });

  it("evidencia por obligationKey: la entrada del bloque 07:00 no evita la falta del 19:00", async () => {
    satisfiedKeys.mockResolvedValue(new Set([MORNING.block!.obligationKey]));
    await checkMissingExpectedEntries(at("19:10:30"));
    const created = tx.attendanceInactivityIncident.createMany.mock.calls[0]![0].data;
    expect(created.map((row: { scheduledStartAt: Date }) => row.scheduledStartAt)).toEqual([NIGHT.scheduledStartAt]);
  });

  it("O2: un intento en curso del bloque 19:00 pospone SÓLO ese bloque; el 07:00 vencido se crea igual (José viernes A)", async () => {
    inFlightKeys.mockResolvedValue(new Set([NIGHT.block!.obligationKey]));
    await checkMissingExpectedEntries(at("19:10:31"));
    const created = tx.attendanceInactivityIncident.createMany.mock.calls[0]![0].data;
    expect(created.map((row: { scheduledStartAt: Date }) => row.scheduledStartAt)).toEqual([MORNING.scheduledStartAt]);
    // Intentos leídos ANTES que la evidencia de fichadas.
    expect(inFlightKeys.mock.invocationCallOrder[0]).toBeLessThan(satisfiedKeys.mock.invocationCallOrder[0]!);
    expect(inFlightKeys).toHaveBeenCalledWith(expect.any(Array), at("19:10:31"));
  });

  it("O2: con ambos bloques en curso no se crea nada ni se abre transacción", async () => {
    inFlightKeys.mockResolvedValue(new Set([MORNING.block!.obligationKey, NIGHT.block!.obligationKey]));
    expect((await checkMissingExpectedEntries(at("19:10:31"))).created).toBe(0);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("novedad que excluye el día: no abre transacción ni avisa", async () => {
    excludedByNovelty.mockResolvedValue(new Set(["jose"]));
    const result = await checkMissingExpectedEntries(at("19:10:30"));
    expect(result.created).toBe(0);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("si la verificación de persistencia falla, lanza ANTES de reemplazar el incidente de día y sin avisar (la transacción se revierte)", async () => {
    tx.attendanceInactivityIncident.findFirst.mockResolvedValue({ id: "day-1", status: "PENDIENTE", reviewedByUserId: null });
    tx.attendanceInactivityIncident.count.mockResolvedValue(1);
    await expect(checkMissingExpectedEntries(at("19:10:30"))).rejects.toThrow(/no persistidas \(1\/2\)/);
    expect(tx.attendanceInactivityIncident.updateMany).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("incidente de día PENDIENTE sin revisión: se reemplaza DESPUÉS de crear y verificar, con filtro que no pisa una revisión concurrente", async () => {
    tx.attendanceInactivityIncident.findFirst.mockResolvedValue({ id: "day-1", status: "PENDIENTE", reviewedByUserId: null });
    await checkMissingExpectedEntries(at("07:10:30"));
    const order = [tx.attendanceInactivityIncident.createMany, tx.attendanceInactivityIncident.count, tx.attendanceInactivityIncident.updateMany].map((fn) => fn.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((left, right) => left! - right!));
    expect(tx.attendanceInactivityIncident.updateMany).toHaveBeenCalledWith({
      where: { id: "day-1", status: "PENDIENTE", reviewedByUserId: null },
      data: expect.objectContaining({ status: "RESUELTA", reviewNote: "Reemplazado por las faltas de ingreso por bloque de la programación por rotación." }),
    });
  });

  it.each([
    ["revisado por una persona", { id: "day-1", status: "RESUELTA", reviewedByUserId: "user-1" }],
    ["revisado por una persona y aún PENDIENTE", { id: "day-1", status: "PENDIENTE", reviewedByUserId: "user-1" }],
    ["DESCARTADO", { id: "day-1", status: "DESCARTADA", reviewedByUserId: null }],
  ])("incidente de día %s: ni faltas por bloque, ni cambios, ni avisos; preserva la decisión y emite telemetría sin PII", async (_label, dayIncident) => {
    const telemetry = vi.spyOn(console, "error").mockImplementation(() => undefined);
    tx.attendanceInactivityIncident.findFirst.mockResolvedValue(dayIncident);
    const result = await checkMissingExpectedEntries(at("19:10:30"));
    expect(result.reconciliationRequired).toEqual([{ employeeId: "jose", dateKey: FRI, dayIncidentId: "day-1", blockKeys: [MORNING.block!.obligationKey, NIGHT.block!.obligationKey] }]);
    expect(result.created).toBe(0);
    expect(tx.attendanceInactivityIncident.createMany).not.toHaveBeenCalled();
    expect(tx.attendanceInactivityIncident.updateMany).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(telemetry).toHaveBeenCalledWith("ROTATION_ATTENDANCE_HISTORY_CONFLICT_DETECTED", {
      severity: "error",
      conflicts: 1,
      dates: [FRI],
      suppressedBlockObligations: 2,
    });
    expect(JSON.stringify(telemetry.mock.calls)).not.toContain("jose");
    expect(JSON.stringify(telemetry.mock.calls)).not.toContain("day-1");
    telemetry.mockRestore();
  });

  it("resolución por bloque: sólo el incidente cuyo bloque tiene evidencia; un incidente de día se resuelve con cualquier bloque cumplido", async () => {
    db.attendanceInactivityIncident.findMany.mockImplementation(async (args: { where: { status?: string } }) =>
      args.where.status === "PENDIENTE"
        ? [
            { id: "inc-morning", employeeId: "jose", scheduledStartAt: MORNING.scheduledStartAt },
            { id: "inc-night", employeeId: "jose", scheduledStartAt: NIGHT.scheduledStartAt },
            { id: "inc-day", employeeId: "jose", scheduledStartAt: null },
          ]
        : [],
    );
    satisfiedKeys.mockResolvedValue(new Set([NIGHT.block!.obligationKey]));
    const result = await checkMissingExpectedEntries(at("19:30"));
    expect(result.resolved).toBe(2);
    expect(db.attendanceInactivityIncident.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["inc-night"] }, status: "PENDIENTE" } }));
    expect(db.attendanceInactivityIncident.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["inc-day"] }, status: "PENDIENTE" } }));
  });

  it("catch-up de una fecha elapsada: también sólo bloques vencidos respecto del instante real", async () => {
    await checkMissingEntriesForElapsedDate(FRI, at("19:05"));
    const created = tx.attendanceInactivityIncident.createMany.mock.calls[0]![0].data;
    expect(created.map((row: { scheduledStartAt: Date }) => row.scheduledStartAt)).toEqual([MORNING.scheduledStartAt]);
  });
});
