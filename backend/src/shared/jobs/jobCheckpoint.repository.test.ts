import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../prisma/client";
import { jobCheckpointRepository } from "./jobCheckpoint.repository";

vi.mock("../prisma/client", () => ({
  prisma: {
    jobCheckpoint: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  jobCheckpoint: { findUnique: Mock; upsert: Mock; updateMany: Mock };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.jobCheckpoint.upsert.mockResolvedValue({});
  mockedPrisma.jobCheckpoint.updateMany.mockResolvedValue({ count: 0 });
});

describe("jobCheckpointRepository.findLastProcessedDateKey — Etapa 15M.19A", () => {
  it("sin fila para ese key: null (nunca corrió, ver bootstrap en attendanceInactivityScheduler)", async () => {
    mockedPrisma.jobCheckpoint.findUnique.mockResolvedValue(null);

    const result = await jobCheckpointRepository.findLastProcessedDateKey("attendance-inactivity-daily");

    expect(result).toBeNull();
    expect(mockedPrisma.jobCheckpoint.findUnique).toHaveBeenCalledWith({ where: { key: "attendance-inactivity-daily" } });
  });

  it("fila con lastProcessedDate null (recién creada por bootstrap con create vacío): null", async () => {
    mockedPrisma.jobCheckpoint.findUnique.mockResolvedValue({ key: "attendance-inactivity-daily", lastProcessedDate: null });

    const result = await jobCheckpointRepository.findLastProcessedDateKey("attendance-inactivity-daily");

    expect(result).toBeNull();
  });

  it("fila con lastProcessedDate: devuelve la clave YYYY-MM-DD, sin corrimiento de huso horario", async () => {
    mockedPrisma.jobCheckpoint.findUnique.mockResolvedValue({
      key: "attendance-inactivity-daily",
      lastProcessedDate: new Date("2026-09-13T00:00:00.000Z"),
    });

    const result = await jobCheckpointRepository.findLastProcessedDateKey("attendance-inactivity-daily");

    expect(result).toBe("2026-09-13");
  });
});

describe("jobCheckpointRepository.advance — Etapa 15M.19A", () => {
  it("crea la fila si no existe, con lastProcessedDate en la fecha dada", async () => {
    await jobCheckpointRepository.advance("attendance-inactivity-daily", "2026-09-13");

    expect(mockedPrisma.jobCheckpoint.upsert).toHaveBeenCalledWith({
      where: { key: "attendance-inactivity-daily" },
      create: { key: "attendance-inactivity-daily", lastProcessedDate: new Date("2026-09-13T00:00:00.000Z") },
      update: {},
    });
  });

  it("sólo avanza lastProcessedDate hacia adelante (lt: date) — nunca lo pisa hacia atrás", async () => {
    await jobCheckpointRepository.advance("attendance-inactivity-daily", "2026-09-13");

    expect(mockedPrisma.jobCheckpoint.updateMany).toHaveBeenCalledWith({
      where: { key: "attendance-inactivity-daily", lastProcessedDate: { lt: new Date("2026-09-13T00:00:00.000Z") } },
      data: { lastProcessedDate: new Date("2026-09-13T00:00:00.000Z") },
    });
  });
});
