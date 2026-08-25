import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { readFileSync } from "node:fs";
import { prisma } from "../../shared/prisma/client";
import { employeesRepository } from "./employees.repository";
import { upsertManualHourConceptBreakdownSchema } from "./employees.schemas";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    $transaction: vi.fn(),
    hourConceptBreakdown: { deleteMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  },
}));

const mockedPrisma = prisma as unknown as { hourConceptBreakdown: { findFirst: Mock; update: Mock } };

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
  it("crea un registro MANUAL EN_REVISION cuando todavía no existe y no viene de RRHH (Etapa 6L.3)", async () => {
    const tx = {
      hourConceptBreakdown: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "breakdown-1", source: "MANUAL", status: "EN_REVISION" }),
      },
    };
    (prisma.$transaction as unknown as Mock).mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    await expect(employeesRepository.saveManualHourConceptBreakdown(base)).resolves.toMatchObject({ operation: "CREATE" });
    expect(tx.hourConceptBreakdown.create).toHaveBeenCalledWith({ data: expect.objectContaining({ source: "MANUAL", status: "EN_REVISION", minutes: 120 }) });
    expect(tx.hourConceptBreakdown.create).toHaveBeenCalledWith({ data: expect.not.objectContaining({ approvedByUserId: expect.anything() }) });
  });

  it("crea un registro MANUAL APROBADO cuando lo carga RRHH (approvedByUserId presente)", async () => {
    const tx = {
      hourConceptBreakdown: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "breakdown-1", source: "MANUAL", status: "APROBADO" }),
      },
    };
    (prisma.$transaction as unknown as Mock).mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    await expect(employeesRepository.saveManualHourConceptBreakdown({ ...base, approvedByUserId: "user-rrhh" })).resolves.toMatchObject({ operation: "CREATE" });
    expect(tx.hourConceptBreakdown.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ source: "MANUAL", status: "APROBADO", minutes: 120, approvedByUserId: "user-rrhh", approvedAt: expect.any(Date) }),
    });
  });

  it("actualiza el registro existente a EN_REVISION y elimina duplicados defensivamente cuando no viene de RRHH", async () => {
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
    expect(tx.hourConceptBreakdown.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "breakdown-1" },
      data: expect.objectContaining({ status: "EN_REVISION", minutes: 120, approvedByUserId: null, approvedAt: null }),
    }));
  });

  it("actualiza el registro existente a APROBADO cuando lo corrige RRHH", async () => {
    const tx = {
      hourConceptBreakdown: {
        findFirst: vi.fn().mockResolvedValue({ id: "breakdown-1" }),
        update: vi.fn().mockResolvedValue({ id: "breakdown-1", minutes: 120 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn(),
      },
    };
    (prisma.$transaction as unknown as Mock).mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const result = await employeesRepository.saveManualHourConceptBreakdown({ ...base, approvedByUserId: "user-rrhh" });
    expect(result.operation).toBe("UPDATE");
    expect(tx.hourConceptBreakdown.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "breakdown-1" },
      data: expect.objectContaining({ status: "APROBADO", minutes: 120, approvedByUserId: "user-rrhh", approvedAt: expect.any(Date) }),
    }));
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

describe("resolución RRHH de HourConceptBreakdown manual — approve/reject/return (Etapa 6L.3, ajuste)", () => {
  it("findManualBreakdownById filtra por source MANUAL y scope del usuario", () => {
    mockedPrisma.hourConceptBreakdown.findFirst.mockResolvedValue(null);
    const accessWhere = { id: "employee-1" };

    employeesRepository.findManualBreakdownById("breakdown-1", accessWhere as never);

    expect(mockedPrisma.hourConceptBreakdown.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "breakdown-1", source: "MANUAL", employee: accessWhere },
    }));
  });

  it("approveManualHourConceptBreakdown escribe APROBADO con approvedByUserId/approvedAt", async () => {
    mockedPrisma.hourConceptBreakdown.update.mockResolvedValue({ id: "breakdown-1", status: "APROBADO" });

    await employeesRepository.approveManualHourConceptBreakdown("breakdown-1", "user-rrhh");

    expect(mockedPrisma.hourConceptBreakdown.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "breakdown-1" },
      data: expect.objectContaining({ status: "APROBADO", approvedByUserId: "user-rrhh", approvedAt: expect.any(Date) }),
    }));
  });

  it("rejectManualHourConceptBreakdown escribe RECHAZADO y limpia el aprobador", async () => {
    mockedPrisma.hourConceptBreakdown.update.mockResolvedValue({ id: "breakdown-1", status: "RECHAZADO" });

    await employeesRepository.rejectManualHourConceptBreakdown("breakdown-1");

    expect(mockedPrisma.hourConceptBreakdown.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "breakdown-1" },
      data: { status: "RECHAZADO", approvedByUserId: null, approvedAt: null },
    }));
  });

  it("returnManualHourConceptBreakdown escribe DEVUELTO y limpia el aprobador", async () => {
    mockedPrisma.hourConceptBreakdown.update.mockResolvedValue({ id: "breakdown-1", status: "DEVUELTO" });

    await employeesRepository.returnManualHourConceptBreakdown("breakdown-1");

    expect(mockedPrisma.hourConceptBreakdown.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "breakdown-1" },
      data: { status: "DEVUELTO", approvedByUserId: null, approvedAt: null },
    }));
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
