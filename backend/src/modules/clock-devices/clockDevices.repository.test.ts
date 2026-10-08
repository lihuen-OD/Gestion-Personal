import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { clockDevicesRepository } from "./clockDevices.repository";

vi.mock("../../shared/prisma/client", () => ({ prisma: { $transaction: vi.fn() } }));

const tx = {
  establishment: { findFirst: vi.fn() },
  clockDevice: { updateMany: vi.fn(), findUnique: vi.fn() },
};

const transaction = prisma.$transaction as unknown as Mock;
transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));

describe("clockDevicesRepository.activate — destino de establecimiento (A8 §12.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rechaza un establecimiento ARCHIVADO con su propio código, sin escribir", async () => {
    tx.establishment.findFirst.mockResolvedValue({
      id: "est-arch", name: "Planta Archivada", status: "ACTIVO", zoneId: "z-1",
      archivedAt: new Date("2026-10-01T00:00:00.000Z"),
    });

    await expect(
      clockDevicesRepository.activate("dev-1", "hash", { name: "iPad Recepción", establishmentId: "est-arch" }, "user-1"),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "CLOCK_DEVICE_ESTABLISHMENT_ARCHIVED",
      message: expect.stringContaining("Planta Archivada"),
    });
    expect(tx.clockDevice.updateMany).not.toHaveBeenCalled();
  });

  it("sigue devolviendo null para un establecimiento legado sin zona (no es archivado)", async () => {
    tx.establishment.findFirst.mockResolvedValue({ id: "est-legacy", name: "Casa Central", status: "ACTIVO", zoneId: null, archivedAt: null });

    await expect(
      clockDevicesRepository.activate("dev-1", "hash", { name: "iPad Recepción", establishmentId: "est-legacy" }, "user-1"),
    ).resolves.toBeNull();
    expect(tx.clockDevice.updateMany).not.toHaveBeenCalled();
  });

  it("activa normalmente con un establecimiento del modelo objetivo", async () => {
    tx.establishment.findFirst.mockResolvedValue({ id: "est-ok", name: "Planta Norte", status: "ACTIVO", zoneId: "z-1", archivedAt: null });
    tx.clockDevice.updateMany.mockResolvedValue({ count: 1 });
    tx.clockDevice.findUnique.mockResolvedValue({ id: "dev-1", name: "iPad Recepción", status: "ACTIVE" });

    const device = await clockDevicesRepository.activate("dev-1", "hash", { name: "iPad Recepción", establishmentId: "est-ok" }, "user-1");

    expect(device).toMatchObject({ id: "dev-1", status: "ACTIVE" });
    expect(tx.clockDevice.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "dev-1", status: "PENDING" }),
      data: expect.objectContaining({ establishmentId: "est-ok" }),
    }));
  });
});
