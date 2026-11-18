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

// Etapa 15L.3B.1 / etapa 9 de cobertura / §16.2: evalúa el `where` con Date
// nativo (misma comparación que Postgres). Desde §16.2 el repositorio sólo
// filtra por novedad; si el tipo exporta, está activo o tiene cobertura lo
// decide el servicio con la configuración congelada en el cierre (ver
// finnegansExport.service.test.ts, "configuración del período").
type Candidate = { fromDate: Date; toDate: Date | null };
type DateFilter = { gte?: Date; gt?: Date; lt?: Date; lte?: Date };
function matchesDate(value: Date | null, filter: DateFilter | undefined) {
  if (!filter) return true;
  if (value === null) return false;
  return (!filter.gte || value >= filter.gte) && (!filter.gt || value > filter.gt) && (!filter.lt || value < filter.lt) && (!filter.lte || value <= filter.lte);
}
function isCandidate(where: Prisma.NoveltyWhereInput, candidate: Candidate) {
  return (where.OR as Prisma.NoveltyWhereInput[]).some((branch) => matchesDate(candidate.fromDate, branch.fromDate as DateFilter | undefined) && matchesDate(candidate.toDate, branch.toDate as DateFilter | undefined));
}
const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));

describe("finnegansExportRepository.findExportableNovelties", () => {
  it("filtra sólo por novedad: APROBADA, con fecha desde en el mes o un rango que llega al mes", async () => {
    const where = await whereFor("2026-09");
    expect(where).toEqual({
      status: "APROBADO",
      OR: [
        { fromDate: { gte: new Date(Date.UTC(2026, 8, 1, 0, 0, 0, 0)), lte: new Date(Date.UTC(2026, 8, 30, 23, 59, 59, 999)) } },
        { fromDate: { lt: new Date(Date.UTC(2026, 8, 1, 0, 0, 0, 0)) }, toDate: { gte: new Date(Date.UTC(2026, 8, 1, 0, 0, 0, 0)) } },
      ],
    });
    expect(where).not.toHaveProperty("noveltyType");
  });

  it("agrega employeeId al WHERE cuando se pasa", async () => {
    await finnegansExportRepository.findExportableNovelties("2026-09", "emp-1");
    const call = vi.mocked(prisma.novelty.findMany).mock.calls[0]![0]!;
    expect(call.where).toMatchObject({ employeeId: "emp-1" });
  });

  it("trae el NoveltyType completo (finnegansCode/finnegansName son columnas propias, 1:1 físico desde la Etapa 15L.6)", async () => {
    await finnegansExportRepository.findExportableNovelties("2026-09");
    const call = vi.mocked(prisma.novelty.findMany).mock.calls[0]![0]! as { include: { noveltyType: boolean } };
    expect(call.include.noveltyType).toBe(true);
  });

  it("selección observable: empieza en el mes, o empezó antes y su rango llega al mes; toDate nulo es un día", async () => {
    expect(isCandidate(await whereFor("2026-08"), { fromDate: utc(2026, 8, 1), toDate: utc(2026, 8, 1) })).toBe(true);
    expect(isCandidate(await whereFor("2026-08"), { fromDate: utc(2026, 7, 30), toDate: utc(2026, 8, 2) })).toBe(true);
    expect(isCandidate(await whereFor("2026-09"), { fromDate: utc(2026, 7, 30), toDate: utc(2026, 8, 2) })).toBe(false);
    expect(isCandidate(await whereFor("2026-08"), { fromDate: utc(2026, 7, 15), toDate: null })).toBe(false);
    expect(isCandidate(await whereFor("2027-01"), { fromDate: utc(2026, 12, 31), toDate: utc(2027, 1, 2) })).toBe(true);
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
      select: { employeeId: true, status: true, snapshot: true },
    });
  });
});
