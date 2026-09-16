import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { finnegansExportRepository } from "./finnegansExport.repository";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    novelty: { findMany: vi.fn().mockResolvedValue([]) },
    monthlyTimeClosure: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

async function whereFor(period: string): Promise<Prisma.NoveltyWhereInput> {
  await finnegansExportRepository.findExportableNovelties(period);
  return vi.mocked(prisma.novelty.findMany).mock.calls.at(-1)![0]!.where as Prisma.NoveltyWhereInput;
}

// Etapa 15L.3B.1: el `where` de Prisma usa `gte`/`lte` — esto es exactamente
// la misma comparación que hace Postgres, así que evaluarla acá con Date
// nativo prueba el comportamiento observable real (no sólo la forma del
// objeto) sin necesitar una base de datos.
function matchesFromDate(where: Prisma.NoveltyWhereInput, fromDate: Date) {
  const condition = where.fromDate as { gte: Date; lte: Date };
  return fromDate >= condition.gte && fromDate <= condition.lte;
}

describe("finnegansExportRepository.findExportableNovelties — Etapa 15L.3A/15L.3B.1", () => {
  it("filtra por status APROBADO, tipo ACTIVO+exportsToFinnegans y fromDate dentro del período, sin exigir vínculo activo ni ninguna cláusula sobre toDate", async () => {
    const where = await whereFor("2026-09");
    expect(where).toEqual({
      status: "APROBADO",
      fromDate: { gte: new Date(Date.UTC(2026, 8, 1, 0, 0, 0, 0)), lte: new Date(Date.UTC(2026, 8, 30, 23, 59, 59, 999)) },
      noveltyType: { status: "ACTIVO", exportsToFinnegans: true },
    });
    expect(where).not.toHaveProperty("OR");
  });

  it("agrega employeeId al WHERE cuando se pasa", async () => {
    await finnegansExportRepository.findExportableNovelties("2026-09", "emp-1");
    const call = vi.mocked(prisma.novelty.findMany).mock.calls[0]![0]!;
    expect(call.where).toMatchObject({ employeeId: "emp-1" });
  });

  it("sólo trae vínculos Finnegans ACTIVO (un vínculo INACTIVO nunca puede ser principal)", async () => {
    await finnegansExportRepository.findExportableNovelties("2026-09");
    const call = vi.mocked(prisma.novelty.findMany).mock.calls[0]![0]! as { include: { noveltyType: { include: { finnegansLinks: { where: { status: string } } } } } };
    expect(call.include.noveltyType.include.finnegansLinks.where).toEqual({ status: "ACTIVO" });
  });
});

describe("finnegansExportRepository.findExportableNovelties — pertenencia mensual única (Etapa 15L.3B.1)", () => {
  it("cross-month (30/07 → 02/08): candidata en julio, NO candidata en agosto — comportamiento observable, no sólo forma del where", async () => {
    const fromDate = new Date(Date.UTC(2026, 6, 30)); // 30/07/2026

    expect(matchesFromDate(await whereFor("2026-07"), fromDate)).toBe(true);
    expect(matchesFromDate(await whereFor("2026-08"), fromDate)).toBe(false);
  });

  it("cross-month: el where de julio no tiene ninguna cláusula OR sobre toDate (antes permitía que un toDate de agosto la colara)", async () => {
    const where = await whereFor("2026-07");
    expect(where).not.toHaveProperty("OR");
    expect(where).toEqual({
      status: "APROBADO",
      fromDate: { gte: new Date(Date.UTC(2026, 6, 1, 0, 0, 0, 0)), lte: new Date(Date.UTC(2026, 6, 31, 23, 59, 59, 999)) },
      noveltyType: { status: "ACTIVO", exportsToFinnegans: true },
    });
  });

  it("open-ended (15/07, toDate=null): candidata sólo en julio, nunca en agosto/septiembre — toDate=null ya no tiene ningún efecto en la selección", async () => {
    const fromDate = new Date(Date.UTC(2026, 6, 15));

    expect(matchesFromDate(await whereFor("2026-07"), fromDate)).toBe(true);
    expect(matchesFromDate(await whereFor("2026-08"), fromDate)).toBe(false);
    expect(matchesFromDate(await whereFor("2026-09"), fromDate)).toBe(false);
  });

  it("01/08 → 01/08: candidata sólo en agosto, no en julio", async () => {
    const fromDate = new Date(Date.UTC(2026, 7, 1));

    expect(matchesFromDate(await whereFor("2026-07"), fromDate)).toBe(false);
    expect(matchesFromDate(await whereFor("2026-08"), fromDate)).toBe(true);
  });

  it("31/12 → 02/01 del año siguiente: candidata sólo en diciembre — confirma periodRange en el cambio de año", async () => {
    const fromDate = new Date(Date.UTC(2026, 11, 31));

    expect(matchesFromDate(await whereFor("2026-12"), fromDate)).toBe(true);
    expect(matchesFromDate(await whereFor("2027-01"), fromDate)).toBe(false);
  });
});

describe("finnegansExportRepository.findClosuresForExport — Etapa 15L.3A", () => {
  it("no consulta Prisma si la lista de empleados está vacía", async () => {
    const result = await finnegansExportRepository.findClosuresForExport([], "2026-09");
    expect(result).toEqual([]);
    expect(prisma.monthlyTimeClosure.findMany).not.toHaveBeenCalled();
  });

  it("filtra por employeeId in / period, con select mínimo", async () => {
    await finnegansExportRepository.findClosuresForExport(["emp-1", "emp-2"], "2026-09");
    expect(prisma.monthlyTimeClosure.findMany).toHaveBeenCalledWith({
      where: { employeeId: { in: ["emp-1", "emp-2"] }, period: "2026-09" },
      select: { employeeId: true, status: true },
    });
  });
});
