import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { normalHoursReconciliationRepository as repository } from "./normalHoursReconciliation.repository";
import { normalHoursReconciliationService as service } from "./normalHoursReconciliation.service";
import { auditService } from "../audit/audit.service";
import { automaticHourConceptBreakdownsService } from "../employees/automaticHourConceptBreakdowns.service";
import { clearEmployeeReadCaches } from "../employees/employees.controller";
import { clearTimeEntriesReadCaches } from "./timeEntries.cache";

vi.mock("./normalHoursReconciliation.repository", () => ({
  normalHoursReconciliationRepository: {
    findEmployeeByLegajo: vi.fn(),
    findNormalConcept: vi.fn(),
    findEmployeeIdsWithSegmentActivity: vi.fn(),
    findEmployeesByIds: vi.fn(),
    findSegmentsForEmployee: vi.fn(),
    findNormalEntriesForEmployee: vi.fn(),
  },
}));

vi.mock("../audit/audit.service", () => ({ auditService: { register: vi.fn().mockResolvedValue(null) } }));
vi.mock("../employees/automaticHourConceptBreakdowns.service", () => ({
  automaticHourConceptBreakdownsService: { recalculateForEmployeePeriod: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../employees/employees.controller", () => ({ clearEmployeeReadCaches: vi.fn() }));
vi.mock("./timeEntries.cache", () => ({ clearTimeEntriesReadCaches: vi.fn() }));

vi.mock("../../shared/prisma/client", () => {
  const tx = {
    timeSegment: { findMany: vi.fn(), findFirst: vi.fn() },
    timeEntry: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  };
  return {
    prisma: {
      $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback(tx)),
      __tx: tx,
    },
  };
});

const repo = repository as unknown as {
  findEmployeeByLegajo: Mock; findNormalConcept: Mock; findEmployeeIdsWithSegmentActivity: Mock;
  findEmployeesByIds: Mock; findSegmentsForEmployee: Mock; findNormalEntriesForEmployee: Mock;
};
const mockedTx = (prisma as unknown as { __tx: { timeSegment: { findMany: Mock; findFirst: Mock }; timeEntry: { findMany: Mock; findFirst: Mock; update: Mock; create: Mock } } }).__tx;
const mockedAuditRegister = auditService.register as unknown as Mock;
const mockedRecalculate = automaticHourConceptBreakdownsService.recalculateForEmployeePeriod as unknown as Mock;
const mockedClearEmployeeReadCaches = clearEmployeeReadCaches as unknown as Mock;
const mockedClearTimeEntriesReadCaches = clearTimeEntriesReadCaches as unknown as Mock;

const employeeId = "employee-30";
const legajo = "30";
const normalConceptId = "concept-normal";
const day16 = new Date("2026-09-16T00:00:00.000Z");

function segment(overrides: Partial<{ date: Date; minutes: number; workShiftId: string; toDateTime: Date; source: string }> = {}) {
  return {
    id: `segment-${Math.random()}`,
    date: overrides.date ?? day16,
    minutes: overrides.minutes ?? 60,
    workShiftId: overrides.workShiftId ?? "shift-1",
    toDateTime: overrides.toDateTime ?? new Date("2026-09-16T14:00:00.000Z"),
    workShift: { source: overrides.source ?? "PUBLIC_CLOCK_PHOTO" },
  };
}

function entryRow(overrides: Partial<{ id: string; date: Date; totalMinutes: number; actualMinutes: number | null; hours: number; status: string; workShiftId: string | null; createdAt: Date; updatedAt: Date; observation: string | null }> = {}) {
  return {
    id: overrides.id ?? "entry-1",
    date: overrides.date ?? day16,
    period: "2026-09",
    day: 16,
    hours: overrides.hours ?? (overrides.totalMinutes ?? 61) / 60,
    totalMinutes: overrides.totalMinutes ?? 61,
    actualMinutes: overrides.actualMinutes === undefined ? (overrides.totalMinutes ?? 61) : overrides.actualMinutes,
    status: overrides.status ?? "APROBADO",
    workShiftId: overrides.workShiftId === undefined ? "shift-1" : overrides.workShiftId,
    timeSegmentId: "segment-x",
    source: "PUBLIC_CLOCK_PHOTO",
    observation: overrides.observation === undefined ? "Generado por fichada." : overrides.observation,
    createdAt: overrides.createdAt ?? new Date("2026-09-16T15:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-09-16T15:00:00.000Z"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.findNormalConcept.mockResolvedValue({ id: normalConceptId, name: "Hora normal" });
  repo.findEmployeeByLegajo.mockResolvedValue({ id: employeeId, legajo });
  mockedTx.timeEntry.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ id: where.id, ...data }));
  mockedTx.timeEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "entry-new", ...data }));
});

describe("normalHoursReconciliationService.dryRun", () => {
  it("exige period o date", async () => {
    await expect(service.dryRun({ legajo })).rejects.toMatchObject({ code: "RECONCILIATION_SCOPE_REQUIRED" });
  });

  it("regresión legajo 30 / 16-09: clasifica UNDERCOUNT (61 persistidos vs 250 esperados)", async () => {
    repo.findSegmentsForEmployee.mockResolvedValue([
      segment({ minutes: 1, workShiftId: "shift-a" }),
      segment({ minutes: 69, workShiftId: "shift-b" }),
      segment({ minutes: 120, workShiftId: "shift-b" }),
      segment({ minutes: 60, workShiftId: "shift-b" }),
    ]);
    repo.findNormalEntriesForEmployee.mockResolvedValue([entryRow({ totalMinutes: 61 })]);

    const report = await service.dryRun({ legajo, period: "2026-09" });

    expect(report.employees[0]!.dates[0]).toMatchObject({
      date: "2026-09-16",
      discrepancy: { kind: "UNDERCOUNT", expectedMinutes: 250, currentTotalMinutes: 61, differenceMinutes: 61 - 250 },
    });
    expect(report.summary.UNDERCOUNT).toBe(1);
    expect(report.summary.totalDatesNeedingRepair).toBe(1);
  });

  it("regresión legajo 30 / 14-15-09 (variante sin fila previa): dos WorkShift con TimeSegment repartidos en 2 fechas producen DUPLICATE en ambas", async () => {
    const day14 = new Date("2026-09-14T00:00:00.000Z");
    const day15 = new Date("2026-09-15T00:00:00.000Z");
    repo.findSegmentsForEmployee.mockResolvedValue([
      segment({ date: day14, minutes: 421 }),
      segment({ date: day14, minutes: 180 }),
      segment({ date: day15, minutes: 180 }),
      segment({ date: day15, minutes: 263 }),
    ]);
    repo.findNormalEntriesForEmployee.mockResolvedValue([
      entryRow({ id: "e14a", date: day14, totalMinutes: 421 }),
      entryRow({ id: "e14b", date: day14, totalMinutes: 180 }),
      entryRow({ id: "e15a", date: day15, totalMinutes: 180 }),
      entryRow({ id: "e15b", date: day15, totalMinutes: 263 }),
    ]);

    const report = await service.dryRun({ legajo, period: "2026-09" });

    const byDate = Object.fromEntries(report.employees[0]!.dates.map((d) => [d.date, d.discrepancy.kind]));
    expect(byDate["2026-09-14"]).toBe("DUPLICATE");
    expect(byDate["2026-09-15"]).toBe("DUPLICATE");
    expect(report.summary.DUPLICATE).toBe(2);
  });

  it("resuelve alcance global (sin legajo) a partir de la actividad de TimeSegment del período", async () => {
    repo.findEmployeeIdsWithSegmentActivity.mockResolvedValue([employeeId]);
    repo.findEmployeesByIds.mockResolvedValue([{ id: employeeId, legajo }]);
    repo.findSegmentsForEmployee.mockResolvedValue([segment({ minutes: 249 })]);
    repo.findNormalEntriesForEmployee.mockResolvedValue([entryRow({ totalMinutes: 249 })]);

    const report = await service.dryRun({ period: "2026-09" });

    expect(repo.findEmployeeByLegajo).not.toHaveBeenCalled();
    expect(report.employees).toHaveLength(1);
    expect(report.summary.OK).toBe(1);
  });
});

describe("normalHoursReconciliationService.repair", () => {
  it("UNDERCOUNT: actualiza la fila canónica al total esperado y audita el UPDATE", async () => {
    repo.findSegmentsForEmployee.mockResolvedValue([segment({ minutes: 250 })]);
    repo.findNormalEntriesForEmployee.mockResolvedValue([entryRow({ id: "entry-1", totalMinutes: 61 })]);
    mockedTx.timeSegment.findMany.mockResolvedValue([{ minutes: 250 }]);
    mockedTx.timeEntry.findMany.mockResolvedValue([entryRow({ id: "entry-1", totalMinutes: 61 })]);

    const report = await service.repair({ legajo, period: "2026-09" });

    expect(report.outcomes).toHaveLength(1);
    expect(report.outcomes[0]).toMatchObject({ action: "UPDATED_CANONICAL", date: "2026-09-16" });
    expect(mockedTx.timeEntry.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "entry-1" },
      data: expect.objectContaining({ totalMinutes: 250, actualMinutes: 250, hours: 250 / 60 }),
    }));
    expect(mockedAuditRegister).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE", entity: "TimeEntry", entityId: "entry-1" }));
  });

  // Etapa 15M.4B: reproduce el caso real encontrado en el dry-run global de
  // legajo 09 (2026-09-01) -- el bug de la Etapa 13F también podía dejar un
  // TimeEntry con MÁS minutos que los reales (no sólo de menos), según el
  // orden exacto en que se procesaron los tramos. Misma rama de código que
  // UNDERCOUNT (ver normalHoursReconciliation.ts: el ajuste no distingue
  // dirección), pero sin test explícito de repair hasta este caso real.
  it("OVERCOUNT: reduce la fila canónica al total esperado (caso real legajo 09/01-09: 660 -> 643)", async () => {
    repo.findSegmentsForEmployee.mockResolvedValue([segment({ minutes: 643 })]);
    repo.findNormalEntriesForEmployee.mockResolvedValue([entryRow({ id: "entry-1", totalMinutes: 660 })]);
    mockedTx.timeSegment.findMany.mockResolvedValue([{ minutes: 643 }]);
    mockedTx.timeEntry.findMany.mockResolvedValue([entryRow({ id: "entry-1", totalMinutes: 660 })]);

    const report = await service.repair({ legajo, period: "2026-09" });

    expect(report.outcomes[0]).toMatchObject({ action: "UPDATED_CANONICAL" });
    expect(mockedTx.timeEntry.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "entry-1" },
      data: expect.objectContaining({ totalMinutes: 643, actualMinutes: 643, hours: 643 / 60 }),
    }));
    expect(mockedAuditRegister).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE", entity: "TimeEntry", entityId: "entry-1" }));
  });

  it("MISSING_TIME_ENTRY: crea una fila nueva vinculada al último TimeSegment de la fecha", async () => {
    repo.findSegmentsForEmployee.mockResolvedValue([segment({ minutes: 250, workShiftId: "shift-b" })]);
    repo.findNormalEntriesForEmployee.mockResolvedValue([]);
    mockedTx.timeSegment.findMany.mockResolvedValue([{ minutes: 250 }]);
    mockedTx.timeEntry.findMany.mockResolvedValue([]);
    mockedTx.timeEntry.findFirst.mockResolvedValue(null); // guard: no hay ninguna fila manual sin workShiftId
    mockedTx.timeSegment.findFirst.mockResolvedValue({ id: "segment-last", workShiftId: "shift-b", fromDateTime: new Date("2026-09-16T13:00:00Z"), toDateTime: new Date("2026-09-16T14:00:00Z"), workShift: { source: "PUBLIC_CLOCK_PHOTO" } });

    const report = await service.repair({ legajo, period: "2026-09" });

    expect(report.outcomes[0]!.action).toBe("CREATED");
    expect(mockedTx.timeEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ totalMinutes: 250, actualMinutes: 250, status: "APROBADO", workShiftId: "shift-b", timeSegmentId: "segment-last" }),
    }));
    expect(mockedAuditRegister).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE", entity: "TimeEntry" }));
  });

  it("MISSING_TIME_ENTRY con guard: si ya existe una fila (manual, sin workShiftId) para esa fecha, NO crea una nueva -- se salta", async () => {
    repo.findSegmentsForEmployee.mockResolvedValue([segment({ minutes: 250 })]);
    repo.findNormalEntriesForEmployee.mockResolvedValue([]); // el filtro workShiftId:not-null no la ve
    mockedTx.timeSegment.findMany.mockResolvedValue([{ minutes: 250 }]);
    mockedTx.timeEntry.findMany.mockResolvedValue([]);
    mockedTx.timeEntry.findFirst.mockResolvedValue({ id: "entry-manual" }); // pero SÍ existe una fila manual

    const report = await service.repair({ legajo, period: "2026-09" });

    expect(report.outcomes[0]!.action).toBe("SKIPPED_UNLINKED_ENTRY_EXISTS");
    expect(mockedTx.timeEntry.create).not.toHaveBeenCalled();
  });

  it("DUPLICATE: elige canónica por estado+antigüedad, actualiza su total y retira (minutos en 0) la otra -- nunca la borra", async () => {
    const older = entryRow({ id: "older", totalMinutes: 421, createdAt: new Date("2026-09-14T17:00:00Z") });
    const newer = entryRow({ id: "newer", totalMinutes: 180, createdAt: new Date("2026-09-14T18:00:00Z") });
    repo.findSegmentsForEmployee.mockResolvedValue([segment({ minutes: 421 }), segment({ minutes: 180 })]);
    repo.findNormalEntriesForEmployee.mockResolvedValue([older, newer]);
    mockedTx.timeSegment.findMany.mockResolvedValue([{ minutes: 421 }, { minutes: 180 }]);
    mockedTx.timeEntry.findMany.mockResolvedValue([older, newer]);

    const report = await service.repair({ legajo, period: "2026-09" });

    expect(report.outcomes[0]!.action).toBe("RETIRED_DUPLICATES");
    expect(mockedTx.timeEntry.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "older" },
      data: expect.objectContaining({ totalMinutes: 601 }),
    }));
    expect(mockedTx.timeEntry.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "newer" },
      data: expect.objectContaining({ totalMinutes: 0, actualMinutes: 0, hours: 0 }),
    }));
    // Nunca un delete -- sólo dos updates (canónica + retirada).
    expect(mockedTx.timeEntry.update).toHaveBeenCalledTimes(2);
    expect(mockedAuditRegister).toHaveBeenCalledTimes(2);
  });

  it("no toca fechas OK: si expected coincide con lo persistido, repair no hace ningún UPDATE/CREATE para esa fecha", async () => {
    repo.findSegmentsForEmployee.mockResolvedValue([segment({ minutes: 250 })]);
    repo.findNormalEntriesForEmployee.mockResolvedValue([entryRow({ totalMinutes: 250 })]);

    const report = await service.repair({ legajo, period: "2026-09" });

    expect(report.outcomes).toHaveLength(0); // nunca entra al loop de reparación
    expect(mockedTx.timeEntry.update).not.toHaveBeenCalled();
    expect(mockedTx.timeEntry.create).not.toHaveBeenCalled();
  });

  it("concurrencia: si updatedAt cambió desde el dry-run, se salta esa fecha sin escribir", async () => {
    const snapshotEntry = entryRow({ id: "entry-1", totalMinutes: 61, updatedAt: new Date("2026-09-16T15:00:00Z") });
    repo.findSegmentsForEmployee.mockResolvedValue([segment({ minutes: 250 })]);
    repo.findNormalEntriesForEmployee.mockResolvedValue([snapshotEntry]);
    mockedTx.timeSegment.findMany.mockResolvedValue([{ minutes: 250 }]);
    // La lectura fresca dentro de la transacción trae la MISMA fila pero con updatedAt distinto (alguien la tocó en el medio).
    mockedTx.timeEntry.findMany.mockResolvedValue([entryRow({ id: "entry-1", totalMinutes: 61, updatedAt: new Date("2026-09-16T16:00:00Z") })]);

    const report = await service.repair({ legajo, period: "2026-09" });

    expect(report.outcomes[0]!.action).toBe("SKIPPED_CONCURRENT_MODIFICATION");
    expect(mockedTx.timeEntry.update).not.toHaveBeenCalled();
  });

  it("idempotencia: correr repair una segunda vez sobre el estado ya reparado no vuelve a escribir nada", async () => {
    // Primera corrida: dry-run ve el estado corrupto (61 min).
    repo.findSegmentsForEmployee.mockResolvedValue([segment({ minutes: 250 })]);
    repo.findNormalEntriesForEmployee.mockResolvedValueOnce([entryRow({ id: "entry-1", totalMinutes: 61 })]);
    mockedTx.timeSegment.findMany.mockResolvedValue([{ minutes: 250 }]);
    mockedTx.timeEntry.findMany.mockResolvedValueOnce([entryRow({ id: "entry-1", totalMinutes: 61 })]);

    const first = await service.repair({ legajo, period: "2026-09" });
    expect(first.outcomes[0]!.action).toBe("UPDATED_CANONICAL");

    // Segunda corrida: tanto el dry-run interno como la relectura fresca ya
    // ven la fila reparada (250 min) -- nada debería requerir reparación.
    repo.findNormalEntriesForEmployee.mockResolvedValueOnce([entryRow({ id: "entry-1", totalMinutes: 250 })]);

    const second = await service.repair({ legajo, period: "2026-09" });

    expect(second.outcomes).toHaveLength(0);
    expect(mockedTx.timeEntry.update).toHaveBeenCalledTimes(1); // sólo la primera corrida escribió.
  });

  it("Motor B: recalcula automáticos una vez por employeeId+período realmente escrito, nunca para fechas salteadas", async () => {
    repo.findSegmentsForEmployee.mockResolvedValue([segment({ minutes: 250 })]);
    repo.findNormalEntriesForEmployee.mockResolvedValue([entryRow({ id: "entry-1", totalMinutes: 61 })]);
    mockedTx.timeSegment.findMany.mockResolvedValue([{ minutes: 250 }]);
    mockedTx.timeEntry.findMany.mockResolvedValue([entryRow({ id: "entry-1", totalMinutes: 61 })]);

    await service.repair({ legajo, period: "2026-09" });

    expect(mockedRecalculate).toHaveBeenCalledTimes(1);
    expect(mockedRecalculate).toHaveBeenCalledWith(expect.objectContaining({ employeeId, period: "2026-09" }));
  });

  it("un fallo de Motor B tras el repair no rompe el reporte final (mismo criterio de aislamiento de la Etapa 15M.2)", async () => {
    repo.findSegmentsForEmployee.mockResolvedValue([segment({ minutes: 250 })]);
    repo.findNormalEntriesForEmployee.mockResolvedValue([entryRow({ id: "entry-1", totalMinutes: 61 })]);
    mockedTx.timeSegment.findMany.mockResolvedValue([{ minutes: 250 }]);
    mockedTx.timeEntry.findMany.mockResolvedValue([entryRow({ id: "entry-1", totalMinutes: 61 })]);
    mockedRecalculate.mockRejectedValueOnce(new Error("fallo inesperado de Motor B"));

    const report = await service.repair({ legajo, period: "2026-09" });

    expect(report.outcomes[0]!.action).toBe("UPDATED_CANONICAL");
    expect(report.breakdownRecalculated[0]).toMatchObject({ ok: false });
  });

  it("cache: se invalida cuando hubo al menos una escritura real", async () => {
    repo.findSegmentsForEmployee.mockResolvedValue([segment({ minutes: 250 })]);
    repo.findNormalEntriesForEmployee.mockResolvedValue([entryRow({ id: "entry-1", totalMinutes: 61 })]);
    mockedTx.timeSegment.findMany.mockResolvedValue([{ minutes: 250 }]);
    mockedTx.timeEntry.findMany.mockResolvedValue([entryRow({ id: "entry-1", totalMinutes: 61 })]);

    await service.repair({ legajo, period: "2026-09" });

    expect(mockedClearEmployeeReadCaches).toHaveBeenCalledTimes(1);
    expect(mockedClearTimeEntriesReadCaches).toHaveBeenCalledTimes(1);
  });

  it("cache: NO se invalida cuando no hubo ninguna escritura (todo OK)", async () => {
    repo.findSegmentsForEmployee.mockResolvedValue([segment({ minutes: 250 })]);
    repo.findNormalEntriesForEmployee.mockResolvedValue([entryRow({ totalMinutes: 250 })]);

    await service.repair({ legajo, period: "2026-09" });

    expect(mockedClearEmployeeReadCaches).not.toHaveBeenCalled();
    expect(mockedClearTimeEntriesReadCaches).not.toHaveBeenCalled();
  });

  it("dry-run nunca escribe ni invalida cache", async () => {
    repo.findSegmentsForEmployee.mockResolvedValue([segment({ minutes: 250 })]);
    repo.findNormalEntriesForEmployee.mockResolvedValue([entryRow({ totalMinutes: 61 })]);

    await service.dryRun({ legajo, period: "2026-09" });

    expect(mockedTx.timeEntry.update).not.toHaveBeenCalled();
    expect(mockedTx.timeEntry.create).not.toHaveBeenCalled();
    expect(mockedClearEmployeeReadCaches).not.toHaveBeenCalled();
    expect(mockedClearTimeEntriesReadCaches).not.toHaveBeenCalled();
    expect(mockedRecalculate).not.toHaveBeenCalled();
  });

  it("snapshot: se genera antes de reparar, sólo cuando hay algo que reparar", async () => {
    repo.findSegmentsForEmployee.mockResolvedValue([segment({ minutes: 250 })]);
    repo.findNormalEntriesForEmployee.mockResolvedValue([entryRow({ id: "entry-1", totalMinutes: 61 })]);
    mockedTx.timeSegment.findMany.mockResolvedValue([{ minutes: 250 }]);
    mockedTx.timeEntry.findMany.mockResolvedValue([entryRow({ id: "entry-1", totalMinutes: 61 })]);
    const snapshotFn = vi.fn().mockResolvedValue("snapshot-path.json");

    const report = await service.repair({ legajo, period: "2026-09" }, { snapshot: snapshotFn });

    expect(snapshotFn).toHaveBeenCalledTimes(1);
    const payload = snapshotFn.mock.calls[0]![0] as { entries: unknown[] };
    expect(payload.entries).toHaveLength(1);
    expect(report.snapshot).toBe("snapshot-path.json");
  });

  it("sin nada que reparar, no llama al snapshot", async () => {
    repo.findSegmentsForEmployee.mockResolvedValue([segment({ minutes: 250 })]);
    repo.findNormalEntriesForEmployee.mockResolvedValue([entryRow({ totalMinutes: 250 })]);
    const snapshotFn = vi.fn();

    await service.repair({ legajo, period: "2026-09" }, { snapshot: snapshotFn });

    expect(snapshotFn).not.toHaveBeenCalled();
  });
});
