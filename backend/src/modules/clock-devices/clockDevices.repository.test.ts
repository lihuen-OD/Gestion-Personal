import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { clockDevicesRepository } from "./clockDevices.repository";

vi.mock("../../shared/prisma/client", () => ({
  prisma: { $transaction: vi.fn(), clockDevice: { update: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn(), updateManyAndReturn: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() } },
}));

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

// F9 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §28)
describe("clockDevicesRepository — heartbeat, edición y limpieza (F9)", () => {
  const clockDevice = prisma.clockDevice as unknown as { update: Mock; findMany: Mock; deleteMany: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("heartbeat: escribe presencia sólo si sigue ACTIVE y devuelve lo que el dispositivo puede ver de sí mismo", async () => {
    clockDevice.update.mockResolvedValue({ id: "d1", name: "Pañol", status: "ACTIVE", establishment: null });

    await clockDevicesRepository.recordHeartbeat("d1", { ip: "10.0.0.5", userAgent: "iPad", appVersion: "1.4.0" });

    const args = clockDevice.update.mock.calls[0]![0];
    expect(args.where).toEqual({ id: "d1", status: "ACTIVE" });
    expect(args.data).toMatchObject({ lastIp: "10.0.0.5", lastUserAgent: "iPad", lastAppVersion: "1.4.0", lastSeenAt: expect.any(Date) });
    expect(Object.keys(args.select).sort()).toEqual(["establishment", "id", "name", "status"]);
  });

  it("heartbeat: sin versión válida no pisa la última conocida; P2025 (ya no ACTIVE) → null", async () => {
    clockDevice.update.mockRejectedValueOnce(Object.assign(new Error("not found"), { code: "P2025" }));
    await expect(clockDevicesRepository.recordHeartbeat("d1", { ip: null, userAgent: null })).resolves.toBeNull();
    expect(clockDevice.update.mock.calls[0]![0].data).not.toHaveProperty("lastAppVersion");
  });

  it("edición: un establecimiento inexistente, inactivo o legado sin zona → 400 CLOCK_DEVICE_ESTABLISHMENT_INVALID, sin escribir", async () => {
    for (const establishment of [null, { id: "e", name: "Inactivo", status: "INACTIVO", zoneId: "z", archivedAt: null }, { id: "e", name: "Legado", status: "ACTIVO", zoneId: null, archivedAt: null }]) {
      tx.establishment.findFirst.mockResolvedValueOnce(establishment);
      await expect(clockDevicesRepository.updateEditable("d1", { establishmentId: "e" })).rejects.toMatchObject({ statusCode: 400, code: "CLOCK_DEVICE_ESTABLISHMENT_INVALID" });
    }
    expect(tx.clockDevice.updateMany).not.toHaveBeenCalled();
  });

  it("edición: un establecimiento archivado conserva su propio código", async () => {
    tx.establishment.findFirst.mockResolvedValue({ id: "e", name: "Planta Vieja", status: "ACTIVO", zoneId: null, archivedAt: new Date() });
    await expect(clockDevicesRepository.updateEditable("d1", { establishmentId: "e" })).rejects.toMatchObject({ code: "CLOCK_DEVICE_ESTABLISHMENT_ARCHIVED" });
  });

  it("edición: escribe sólo los campos pedidos y sólo si sigue PENDING o ACTIVE; sin establecimiento no lo valida", async () => {
    tx.clockDevice.updateMany.mockResolvedValue({ count: 1 });
    tx.clockDevice.findUnique.mockResolvedValue({ id: "d1", name: "Nuevo" });

    await clockDevicesRepository.updateEditable("d1", { name: "Nuevo", establishmentId: null });

    expect(tx.establishment.findFirst).not.toHaveBeenCalled();
    expect(tx.clockDevice.updateMany).toHaveBeenCalledWith({ where: { id: "d1", status: { in: ["PENDING", "ACTIVE"] } }, data: { name: "Nuevo", establishmentId: null } });

    tx.clockDevice.updateMany.mockResolvedValue({ count: 0 });
    await expect(clockDevicesRepository.updateEditable("d1", { name: "Otro" })).resolves.toBeNull();
  });

  it("limpieza: sólo PENDING nunca activados, vencidos, sin contacto, sin fichadas ni intentos; repite las condiciones en cada DELETE", async () => {
    const staleBefore = new Date("2026-10-13T12:00:00.000Z");
    const now = new Date("2026-10-14T12:00:00.000Z");
    clockDevice.findMany.mockResolvedValue([{ id: "p1", createdAt: new Date() }, { id: "p2", createdAt: new Date() }]);
    // p2 cambió entre la lectura y el borrado (lo aprobaron o volvió a conectarse).
    clockDevice.deleteMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const deleted = await clockDevicesRepository.deleteStalePending(staleBefore, now, 50);

    expect(deleted.map((device) => device.id)).toEqual(["p1"]);
    const where = clockDevice.findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({
      status: "PENDING", activatedAt: null, activatedByUserId: null, revokedAt: null,
      createdAt: { lt: staleBefore }, punches: { none: {} }, attempts: { none: {} },
    });
    expect(where.AND).toEqual([
      { OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: staleBefore } }] },
      { OR: [{ pairingExpiresAt: null }, { pairingExpiresAt: { lt: now } }] },
    ]);
    expect(clockDevice.findMany.mock.calls[0]![0].take).toBe(50);
    expect(clockDevice.deleteMany.mock.calls[0]![0]).toEqual({ where: { AND: [where, { id: "p1" }] } });
    expect(clockDevice.deleteMany.mock.calls[1]![0]).toEqual({ where: { AND: [where, { id: "p2" }] } });
  });
});

// Acceso de mantenimiento (docs/decisions/FICHADOR_MAINTENANCE_MODE.md): cada
// regla vive en el WHERE del UPDATE, no en una lectura previa.
describe("clockDevicesRepository — acceso de mantenimiento", () => {
  const clockDevice = prisma.clockDevice as unknown as { updateMany: Mock; updateManyAndReturn: Mock; findFirst: Mock; findUnique: Mock };
  const NO_CODE = { maintenanceCodeHash: null, maintenanceCodeExpiresAt: null, maintenanceCodeFailedAttempts: 0 };
  const NO_SESSION = { maintenanceSessionHash: null, maintenanceSessionExpiresAt: null };

  beforeEach(() => {
    vi.clearAllMocks();
    clockDevice.updateMany.mockResolvedValue({ count: 1 });
  });

  it("revocar limpia código y sesión de mantenimiento en el MISMO UPDATE que pasa a REVOKED", async () => {
    clockDevice.findUnique.mockResolvedValue({ id: "d1", status: "REVOKED" });
    await clockDevicesRepository.revoke("d1", "rrhh-1");
    expect(clockDevice.updateMany).toHaveBeenCalledTimes(1);
    const { where, data } = clockDevice.updateMany.mock.calls[0]![0];
    expect(where).toEqual({ id: "d1", status: "ACTIVE" });
    expect(data).toMatchObject({ status: "REVOKED", revokedByUserId: "rrhh-1", ...NO_CODE, ...NO_SESSION });
  });

  it("guardar un código: sólo ACTIVE, reemplaza el anterior y reinicia los intentos", async () => {
    const expiresAt = new Date("2026-10-26T12:05:00.000Z");
    await expect(clockDevicesRepository.setMaintenanceCode("d1", "h".repeat(64), expiresAt)).resolves.toBe(true);
    expect(clockDevice.updateMany).toHaveBeenCalledWith({ where: { id: "d1", status: "ACTIVE" }, data: { maintenanceCodeHash: "h".repeat(64), maintenanceCodeExpiresAt: expiresAt, maintenanceCodeFailedAttempts: 0 } });
    clockDevice.updateMany.mockResolvedValue({ count: 0 });
    await expect(clockDevicesRepository.setMaintenanceCode("d1", "h".repeat(64), expiresAt)).resolves.toBe(false);
  });

  it("consumir: hash, vencimiento, intentos y ACTIVE en un solo UPDATE; borra el código y guarda la sesión", async () => {
    const now = new Date("2026-10-26T12:00:00.000Z");
    const session = { hash: "s".repeat(64), expiresAt: new Date("2026-10-26T12:10:00.000Z") };
    await expect(clockDevicesRepository.consumeMaintenanceCode("d1", "c".repeat(64), session, now, 5)).resolves.toBe(true);
    expect(clockDevice.updateMany).toHaveBeenCalledWith({
      where: { id: "d1", status: "ACTIVE", maintenanceCodeHash: "c".repeat(64), maintenanceCodeExpiresAt: { gt: now }, maintenanceCodeFailedAttempts: { lt: 5 } },
      data: { ...NO_CODE, maintenanceSessionHash: session.hash, maintenanceSessionExpiresAt: session.expiresAt },
    });
    clockDevice.updateMany.mockResolvedValue({ count: 0 });
    await expect(clockDevicesRepository.consumeMaintenanceCode("d1", "c".repeat(64), session, now, 5)).resolves.toBe(false);
  });

  it("intento fallido: sólo cuenta contra un código vigente; al llegar al máximo lo anula", async () => {
    const now = new Date("2026-10-26T12:00:00.000Z");
    clockDevice.updateManyAndReturn.mockResolvedValueOnce([]);
    await expect(clockDevicesRepository.registerFailedMaintenanceCode("d1", now, 5)).resolves.toBeNull();
    expect(clockDevice.updateManyAndReturn.mock.calls[0]![0].where).toEqual({ id: "d1", status: "ACTIVE", maintenanceCodeHash: { not: null }, maintenanceCodeExpiresAt: { gt: now } });
    expect(clockDevice.updateMany).not.toHaveBeenCalled();

    clockDevice.updateManyAndReturn.mockResolvedValueOnce([{ maintenanceCodeFailedAttempts: 2 }]);
    await expect(clockDevicesRepository.registerFailedMaintenanceCode("d1", now, 5)).resolves.toEqual({ failedAttempts: 2, burned: false });
    expect(clockDevice.updateMany).not.toHaveBeenCalled();

    clockDevice.updateManyAndReturn.mockResolvedValueOnce([{ maintenanceCodeFailedAttempts: 5 }]);
    await expect(clockDevicesRepository.registerFailedMaintenanceCode("d1", now, 5)).resolves.toEqual({ failedAttempts: 5, burned: true });
    expect(clockDevice.updateMany).toHaveBeenCalledWith({ where: { id: "d1", maintenanceCodeFailedAttempts: { gte: 5 } }, data: NO_CODE });
  });

  it("sesión: se busca por hash, vigente y ACTIVE; el diagnóstico no trae id, IP, user-agent ni hashes", async () => {
    const now = new Date("2026-10-26T12:00:00.000Z");
    await clockDevicesRepository.findMaintenanceSession("d1", "s".repeat(64), now);
    const args = clockDevice.findFirst.mock.calls[0]![0];
    expect(args.where).toEqual({ id: "d1", status: "ACTIVE", maintenanceSessionHash: "s".repeat(64), maintenanceSessionExpiresAt: { gt: now } });
    expect(Object.keys(args.select).sort()).toEqual(["activatedAt", "establishment", "lastAppVersion", "lastSeenAt", "maintenanceSessionExpiresAt", "name", "status"]);
  });

  it("cerrar sesión: sólo la de ese token", async () => {
    await clockDevicesRepository.endMaintenanceSession("d1", "s".repeat(64));
    expect(clockDevice.updateMany).toHaveBeenCalledWith({ where: { id: "d1", maintenanceSessionHash: "s".repeat(64) }, data: NO_SESSION });
  });
});
