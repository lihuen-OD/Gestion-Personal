import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { automaticHourConceptBreakdownsRepository as repository } from "./automaticHourConceptBreakdowns.repository";

vi.mock("../../shared/prisma/client", () => ({ prisma: {
  employeeHourConcept: { findMany: vi.fn() },
  workShift: { findMany: vi.fn() },
  $transaction: vi.fn(),
} }));

beforeEach(() => vi.clearAllMocks());

describe("automaticHourConceptBreakdownsRepository", () => {
  it("filtra asignación, modo, estado, baja lógica y reglas activas sin priority", async () => {
    (prisma.employeeHourConcept.findMany as Mock).mockResolvedValue([]);
    await repository.findEligibleConcepts("employee-1");
    const args = (prisma.employeeHourConcept.findMany as Mock).mock.calls.at(0)?.[0];
    expect(args).toBeDefined();
    expect(args!.where).toEqual({ employeeId: "employee-1", hourConcept: {
      systemRole: null, status: "ACTIVO", deletedAt: null, loadMode: { in: ["AUTOMATIC", "BOTH"] },
    } });
    expect(args!.select.hourConcept.select.rules.where).toEqual({ status: "ACTIVO" });
    expect(args!.select.hourConcept.select.rules.select).not.toHaveProperty("priority");
  });

  it("lee sólo turnos PROCESADO completos que intersectan el período", async () => {
    (prisma.workShift.findMany as Mock).mockResolvedValue([]);
    const startAt = new Date("2026-08-01T03:00:00Z");
    const endAt = new Date("2026-09-01T03:00:00Z");
    await repository.findProcessedShifts("employee-1", startAt, endAt);
    expect(prisma.workShift.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      employeeId: "employee-1", status: "PROCESADO", endAt: { not: null, gt: startAt }, startAt: { lt: endAt },
    } }));
  });

  it("reemplaza sólo AUTOMATIC y crea BORRADOR sin tocar MANUAL", async () => {
    const tx = {
      hourConceptBreakdown: {
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    (prisma.$transaction as Mock).mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx));
    const row = { date: new Date("2026-08-10T00:00:00Z"), period: "2026-08", day: 10, hourConceptId: "sereno", minutes: 120, workShiftId: "shift-1", hourConceptRuleId: "rule-1" };
    await expect(repository.replaceAutomatic("employee-1", "2026-08", [row], "user-1")).resolves.toEqual({ deleted: 2, created: 1 });
    expect(tx.hourConceptBreakdown.deleteMany).toHaveBeenCalledWith({ where: { employeeId: "employee-1", period: "2026-08", source: "AUTOMATIC" } });
    expect(tx.hourConceptBreakdown.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ source: "AUTOMATIC", status: "BORRADOR" })] });
  });
});
