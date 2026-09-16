import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("finnegansExportRepository.findExportableNovelties — Etapa 15L.3A", () => {
  it("filtra por status APROBADO, tipo ACTIVO+exportsToFinnegans y superposición con el período, sin exigir vínculo activo en el WHERE", async () => {
    await finnegansExportRepository.findExportableNovelties("2026-09");

    const call = vi.mocked(prisma.novelty.findMany).mock.calls[0]![0]!;
    expect(call.where).toEqual({
      status: "APROBADO",
      fromDate: { lte: new Date(Date.UTC(2026, 8, 30, 23, 59, 59, 999)) },
      OR: [{ toDate: null }, { toDate: { gte: new Date(Date.UTC(2026, 8, 1, 0, 0, 0, 0)) } }],
      noveltyType: { status: "ACTIVO", exportsToFinnegans: true },
    });
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
