import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { readFileSync } from "node:fs";
import { prisma } from "../../shared/prisma/client";
import { employeesRepository } from "./employees.repository";
import { upsertManualHourConceptBreakdownSchema } from "./employees.schemas";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    $transaction: vi.fn(),
    hourConceptBreakdown: { deleteMany: vi.fn() },
  },
}));

const base = {
  employeeId: "employee-1",
  hourConceptId: "11111111-1111-4111-8111-111111111111",
  date: new Date("2026-08-12T00:00:00.000Z"),
  period: "2026-08",
  day: 12,
  minutes: 120,
  observation: "Traslado",
  createdByUserId: "user-1",
};

describe("manual HourConceptBreakdown persistence", () => {
  it("crea un registro MANUAL BORRADOR cuando todavía no existe", async () => {
    const tx = {
      hourConceptBreakdown: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "breakdown-1", source: "MANUAL", status: "BORRADOR" }),
      },
    };
    (prisma.$transaction as unknown as Mock).mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    await expect(employeesRepository.saveManualHourConceptBreakdown(base)).resolves.toMatchObject({ operation: "CREATE" });
    expect(tx.hourConceptBreakdown.create).toHaveBeenCalledWith({ data: expect.objectContaining({ source: "MANUAL", status: "BORRADOR", minutes: 120 }) });
  });

  it("actualiza el registro existente y elimina duplicados defensivamente", async () => {
    const tx = {
      hourConceptBreakdown: {
        findFirst: vi.fn().mockResolvedValue({ id: "breakdown-1" }),
        update: vi.fn().mockResolvedValue({ id: "breakdown-1", minutes: 120 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn(),
      },
    };
    (prisma.$transaction as unknown as Mock).mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const result = await employeesRepository.saveManualHourConceptBreakdown(base);
    expect(result.operation).toBe("UPDATE");
    expect(tx.hourConceptBreakdown.create).not.toHaveBeenCalled();
    expect(tx.hourConceptBreakdown.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "breakdown-1" }, data: expect.objectContaining({ status: "BORRADOR", minutes: 120 }) }));
  });

  it("minutes cero elimina todos los registros MANUAL del día", async () => {
    const tx = { hourConceptBreakdown: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    (prisma.$transaction as unknown as Mock).mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    await expect(employeesRepository.saveManualHourConceptBreakdown({ ...base, minutes: 0 })).resolves.toMatchObject({ item: null, deleted: 1, operation: "DELETE" });
    expect(tx.hourConceptBreakdown.deleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({ source: "MANUAL" }) });
  });

  it("valida fecha real y límites de 0 a 1440 minutos", () => {
    expect(upsertManualHourConceptBreakdownSchema.safeParse({ date: "2026-02-30", hourConceptId: base.hourConceptId, minutes: 60 }).success).toBe(false);
    expect(upsertManualHourConceptBreakdownSchema.safeParse({ date: "2026-08-12", hourConceptId: base.hourConceptId, minutes: -1 }).success).toBe(false);
    expect(upsertManualHourConceptBreakdownSchema.safeParse({ date: "2026-08-12", hourConceptId: base.hourConceptId, minutes: 1441 }).success).toBe(false);
    expect(upsertManualHourConceptBreakdownSchema.safeParse({ date: "2026-08-12", hourConceptId: base.hourConceptId, minutes: 1440 }).success).toBe(true);
  });
});

describe("manual breakdown partial unique migration", () => {
  const sql = readFileSync("prisma/migrations/20260824183000_manual_breakdown_unique_index/migration.sql", "utf8");

  it("sanea y restringe exclusivamente source MANUAL", () => {
    expect(sql).toContain('WHERE "source" = \'MANUAL\'');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "HourConceptBreakdown_manual_unique"');
    expect(sql).toContain('ON "HourConceptBreakdown" ("employeeId", "date", "hourConceptId")');
  });

  it("no crea una constraint global que limite AUTOMATIC", () => {
    expect(sql).not.toMatch(/UNIQUE\s*\([^)]*"source"/i);
    expect(sql).not.toContain('WHERE "source" = \'AUTOMATIC\'');
  });
});
