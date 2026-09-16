import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { finnegansExportBatchRepository, type CreateBatchInput } from "./finnegansExport.batch.repository";

vi.mock("../../shared/prisma/client", () => {
  const tx = {
    finnegansExportBatch: { create: vi.fn() },
    finnegansExportBatchItem: { createMany: vi.fn() },
  };
  return {
    prisma: {
      finnegansExportBatch: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
      $transaction: vi.fn((arg: unknown) => (arg as (tx: unknown) => unknown)(tx)),
      __tx: tx,
    },
  };
});

const mockedPrisma = prisma as unknown as {
  finnegansExportBatch: { findFirst: Mock; findMany: Mock; findUnique: Mock };
  $transaction: Mock;
  __tx: { finnegansExportBatch: { create: Mock }; finnegansExportBatchItem: { createMany: Mock } };
};

function p2002(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test", meta: { target } });
}

function batchInput(overrides: Partial<CreateBatchInput> = {}): CreateBatchInput {
  return {
    period: "2026-07",
    format: "XLSX",
    hash: "hash-1",
    reason: null,
    idempotencyKey: "idem-1",
    createdByUserId: "user-1",
    items: [
      {
        noveltyId: "novelty-1",
        employeeId: "employee-1",
        legajo: "100",
        employeeName: "Gomez, Ana",
        noveltyCode: "VAC",
        detail: "Vacaciones",
        costCenter: "",
        value1: "5",
        applicationDate: "01/07/2026",
        validFrom: "",
        validTo: "",
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.finnegansExportBatch.findFirst.mockResolvedValue(null);
  mockedPrisma.__tx.finnegansExportBatch.create.mockImplementation((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "batch-1", createdBy: null, previousBatch: null, ...args.data }),
  );
  mockedPrisma.__tx.finnegansExportBatchItem.createMany.mockResolvedValue({ count: 1 });
});

describe("finnegansExportBatchRepository.createBatchWithItems — Etapa 15L.4 §8/§18", () => {
  it("primera exportación de un período: version=1, previousBatchId=null", async () => {
    mockedPrisma.finnegansExportBatch.findFirst.mockResolvedValue(null);

    const batch = await finnegansExportBatchRepository.createBatchWithItems(batchInput());

    expect(mockedPrisma.__tx.finnegansExportBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 1, previousBatchId: null }) }),
    );
    expect(batch).toMatchObject({ version: 1, previousBatchId: null });
  });

  it("segunda exportación: version = anterior+1, previousBatchId = id del anterior", async () => {
    mockedPrisma.finnegansExportBatch.findFirst.mockResolvedValue({ id: "batch-prev", version: 1 });

    await finnegansExportBatchRepository.createBatchWithItems(batchInput());

    expect(mockedPrisma.__tx.finnegansExportBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 2, previousBatchId: "batch-prev" }) }),
    );
  });

  it("crea los items dentro de la misma transacción, con el batchId correcto", async () => {
    mockedPrisma.__tx.finnegansExportBatch.create.mockResolvedValue({ id: "batch-xyz", version: 1, previousBatchId: null, createdBy: null, previousBatch: null });

    await finnegansExportBatchRepository.createBatchWithItems(batchInput());

    expect(mockedPrisma.__tx.finnegansExportBatchItem.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ batchId: "batch-xyz", legajo: "100" })],
    });
  });

  it("colisión de versión (P2002 en period+version): reintenta con la siguiente versión", async () => {
    mockedPrisma.finnegansExportBatch.findFirst
      .mockResolvedValueOnce({ id: "batch-prev", version: 1 }) // primer intento: cree que la próxima es v2
      .mockResolvedValueOnce({ id: "batch-prev-2", version: 2 }); // reintento: alguien ya creó v2, ahora la próxima es v3

    mockedPrisma.__tx.finnegansExportBatch.create
      .mockRejectedValueOnce(p2002(["period", "version"]))
      .mockResolvedValueOnce({ id: "batch-3", version: 3, previousBatchId: "batch-prev-2", createdBy: null, previousBatch: null });

    const batch = await finnegansExportBatchRepository.createBatchWithItems(batchInput());

    expect(batch).toMatchObject({ version: 3 });
    expect(mockedPrisma.__tx.finnegansExportBatch.create).toHaveBeenCalledTimes(2);
  });

  it("mismo idempotencyKey en dos requests concurrentes (P2002 en idempotencyKey): devuelve el batch que ya se creó, no crea uno nuevo", async () => {
    mockedPrisma.__tx.finnegansExportBatch.create.mockRejectedValue(p2002(["idempotencyKey"]));
    mockedPrisma.finnegansExportBatch.findUnique.mockResolvedValue({ id: "batch-winner", version: 1, idempotencyKey: "idem-1" });

    const batch = await finnegansExportBatchRepository.createBatchWithItems(batchInput({ idempotencyKey: "idem-1" }));

    expect(batch).toMatchObject({ id: "batch-winner" });
    expect(mockedPrisma.__tx.finnegansExportBatch.create).toHaveBeenCalledTimes(1);
  });

  it("un error no relacionado con P2002 se propaga sin reintentar", async () => {
    mockedPrisma.__tx.finnegansExportBatch.create.mockRejectedValue(new Error("boom"));

    await expect(finnegansExportBatchRepository.createBatchWithItems(batchInput())).rejects.toThrow("boom");
    expect(mockedPrisma.__tx.finnegansExportBatch.create).toHaveBeenCalledTimes(1);
  });
});

describe("finnegansExportBatchRepository — lecturas (Etapa 15L.4)", () => {
  it("hasAnyBatch: true si existe algún batch para el período", async () => {
    mockedPrisma.finnegansExportBatch.findFirst.mockResolvedValue({ id: "batch-1" });
    expect(await finnegansExportBatchRepository.hasAnyBatch("2026-07")).toBe(true);
  });

  it("hasAnyBatch: false si no existe ninguno", async () => {
    mockedPrisma.finnegansExportBatch.findFirst.mockResolvedValue(null);
    expect(await finnegansExportBatchRepository.hasAnyBatch("2026-07")).toBe(false);
  });

  it("findManyForPeriod: ordena por version desc", async () => {
    await finnegansExportBatchRepository.findManyForPeriod("2026-07");
    expect(mockedPrisma.finnegansExportBatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { period: "2026-07" }, orderBy: { version: "desc" } }),
    );
  });
});
