import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditService } from "../audit/audit.service";
import { clockDevicesRepository as repository } from "./clockDevices.repository";
import { clockDevicesService } from "./clockDevices.service";

vi.mock("./clockDevices.repository", () => ({
  clockDevicesRepository: {
    countPending: vi.fn(), create: vi.fn(), setPairing: vi.fn(), touch: vi.fn(), findSafeById: vi.fn(),
    list: vi.fn(), findPendingByPairingHash: vi.fn(), activate: vi.fn(), revoke: vi.fn(), deletePending: vi.fn(),
    recordHeartbeat: vi.fn(), updateEditable: vi.fn(), deleteStalePending: vi.fn(),
  },
}));
vi.mock("../audit/audit.service", () => ({ auditService: { register: vi.fn() } }));

const pending = { id: "00000000-0000-4000-8000-000000000001", name: null, status: "PENDING", createdAt: new Date(), sector: null };

describe("clockDevicesService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repository.countPending).mockResolvedValue(0);
    vi.mocked(repository.create).mockResolvedValue(pending as never);
    vi.mocked(repository.setPairing).mockResolvedValue(pending as never);
  });

  it("registra PENDING con secreto de 256 bits, pero persiste sólo SHA-256", async () => {
    const result = await clockDevicesService.register({ appVersion: "1.0.0" }, { ip: "127.0.0.1", userAgent: "test" });
    const create = vi.mocked(repository.create).mock.calls[0]![0];
    expect(Buffer.from(result.secret, "base64url")).toHaveLength(32);
    expect(create.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(create)).not.toContain(result.secret);
    expect(result.device.pairingCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(auditService.register).not.toHaveBeenCalled();
  });

  it("renueva pairing sólo para PENDING", async () => {
    vi.mocked(repository.findSafeById).mockResolvedValue(pending as never);
    await expect(clockDevicesService.refreshPairing(pending.id, { ip: null, userAgent: null })).resolves.toMatchObject({ pairingCode: expect.any(String) });
    vi.mocked(repository.findSafeById).mockResolvedValue({ ...pending, status: "ACTIVE" } as never);
    await expect(clockDevicesService.refreshPairing(pending.id, { ip: null, userAgent: null })).rejects.toMatchObject({ code: "CLOCK_DEVICE_NOT_PENDING" });
  });

  it("activa y revoca mediante transiciones del repositorio, con auditoría humana", async () => {
    const active = { ...pending, name: "iPad Recepción", status: "ACTIVE" };
    vi.mocked(repository.activate).mockResolvedValue(active as never);
    await clockDevicesService.activate(pending.id, { pairingCode: "ABCD-2345", name: active.name, establishmentId: null }, "user-1");
    expect(auditService.register).toHaveBeenCalledWith(expect.objectContaining({ action: "ACTIVATE", description: "Se aprobó el dispositivo de fichada iPad Recepción." }));

    vi.mocked(repository.findSafeById).mockResolvedValue(active as never);
    vi.mocked(repository.revoke).mockResolvedValue({ ...active, status: "REVOKED" } as never);
    await clockDevicesService.revoke(pending.id, "user-1");
    expect(auditService.register).toHaveBeenCalledWith(expect.objectContaining({ action: "DEACTIVATE", description: "Se revocó el dispositivo de fichada iPad Recepción." }));
  });

  it("sólo confirma borrado cuando el repositorio eliminó un pendiente sin historia", async () => {
    vi.mocked(repository.deletePending).mockResolvedValue({ id: pending.id, name: null, status: "PENDING", _count: { punches: 0, attempts: 0 } } as never);
    await clockDevicesService.deletePending(pending.id);
    expect(auditService.register).toHaveBeenCalledWith(expect.objectContaining({ action: "DELETE", description: "Se eliminó una solicitud pendiente de dispositivo de fichada." }));
    vi.mocked(repository.deletePending).mockResolvedValue(null);
    await expect(clockDevicesService.deletePending(pending.id)).rejects.toMatchObject({ code: "CLOCK_DEVICE_DELETE_FORBIDDEN" });
  });
});

// F9 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §28)
describe("clockDevicesService — heartbeat (F9)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("actualiza la presencia y devuelve el dispositivo con la hora del servidor, sin auditar", async () => {
    const self = { id: "d1", name: "Pañol 01", status: "ACTIVE", establishment: null };
    vi.mocked(repository.recordHeartbeat).mockResolvedValue(self as never);
    const metadata = { ip: "10.0.0.5", userAgent: "iPad", appVersion: "1.4.0" };

    const result = await clockDevicesService.heartbeat("d1", metadata);

    expect(repository.recordHeartbeat).toHaveBeenCalledWith("d1", metadata);
    expect(result.device).toBe(self);
    expect(Math.abs(Date.parse(result.serverTime) - Date.now())).toBeLessThan(5_000);
    expect(auditService.register).not.toHaveBeenCalled();
  });

  it("si ya no está ACTIVE al escribir → 403 CLOCK_DEVICE_REVOKED", async () => {
    vi.mocked(repository.recordHeartbeat).mockResolvedValue(null);
    await expect(clockDevicesService.heartbeat("d1", { ip: null, userAgent: null })).rejects.toMatchObject({ statusCode: 403, code: "CLOCK_DEVICE_REVOKED" });
  });
});

describe("clockDevicesService — edición RRHH (F9)", () => {
  const zone = { id: "z-1", name: "Zona Centro" };
  const active = {
    id: "d1", name: "Pañol 01", status: "ACTIVE", establishmentId: "est-1", establishment: { id: "est-1", name: "Planta Norte", zone },
    lastSeenAt: new Date(), lastIp: "10.0.0.5", lastUserAgent: "iPad", lastAppVersion: "1.4.0",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repository.findSafeById).mockResolvedValue(active as never);
  });

  it("renombra: escribe sólo el nombre y audita antes/después sin metadata técnica", async () => {
    vi.mocked(repository.updateEditable).mockResolvedValue({ ...active, name: "Pañol principal" } as never);

    const result = await clockDevicesService.update("d1", { name: "Pañol principal" }, { userId: "rrhh-1" });

    expect(repository.updateEditable).toHaveBeenCalledWith("d1", { name: "Pañol principal" });
    expect(result).toMatchObject({ name: "Pañol principal", connectivity: "ONLINE" });
    const audit = vi.mocked(auditService.register).mock.calls[0]![0];
    expect(audit).toMatchObject({
      action: "UPDATE", entity: "ClockDevice", entityId: "d1", userId: "rrhh-1",
      description: "Se actualizó el dispositivo de fichada Pañol principal: nombre “Pañol 01” → “Pañol principal”.",
      before: { name: "Pañol 01", establishmentId: "est-1", establishment: "Zona Centro · Planta Norte" },
      after: { name: "Pañol principal", establishmentId: "est-1", establishment: "Zona Centro · Planta Norte" },
    });
    expect(JSON.stringify(audit)).not.toMatch(/10\.0\.0\.5|iPad|tokenHash|secret|pairing/);
  });

  it("cambia el establecimiento (o lo deja sin asignar) con una descripción humana", async () => {
    vi.mocked(repository.updateEditable).mockResolvedValue({ ...active, establishmentId: null, establishment: null } as never);

    await clockDevicesService.update("d1", { establishmentId: null });

    expect(repository.updateEditable).toHaveBeenCalledWith("d1", { establishmentId: null });
    expect(vi.mocked(auditService.register).mock.calls[0]![0].description).toBe(
      "Se actualizó el dispositivo de fichada Pañol 01: ubicación “Zona Centro · Planta Norte” → “Sin establecimiento”.",
    );
  });

  it("sin cambios reales no escribe ni audita", async () => {
    const result = await clockDevicesService.update("d1", { name: "Pañol 01", establishmentId: "est-1" });
    expect(result).toMatchObject({ id: "d1", name: "Pañol 01" });
    expect(repository.updateEditable).not.toHaveBeenCalled();
    expect(auditService.register).not.toHaveBeenCalled();
  });

  it("REVOKED es terminal: 409 CLOCK_DEVICE_NOT_EDITABLE sin escribir", async () => {
    vi.mocked(repository.findSafeById).mockResolvedValue({ ...active, status: "REVOKED" } as never);
    await expect(clockDevicesService.update("d1", { name: "Otro" })).rejects.toMatchObject({ statusCode: 409, code: "CLOCK_DEVICE_NOT_EDITABLE" });
    expect(repository.updateEditable).not.toHaveBeenCalled();
  });

  it("revocado entre la lectura y la escritura → 409, sin auditoría", async () => {
    vi.mocked(repository.updateEditable).mockResolvedValue(null);
    await expect(clockDevicesService.update("d1", { name: "Otro" })).rejects.toMatchObject({ code: "CLOCK_DEVICE_NOT_EDITABLE" });
    expect(auditService.register).not.toHaveBeenCalled();
  });

  it("un PENDING también se puede nombrar antes de aprobarlo", async () => {
    vi.mocked(repository.findSafeById).mockResolvedValue({ ...active, name: null, status: "PENDING", establishmentId: null, establishment: null } as never);
    vi.mocked(repository.updateEditable).mockResolvedValue({ ...active, name: "iPad Recepción", status: "PENDING", establishmentId: null, establishment: null } as never);
    const result = await clockDevicesService.update("d1", { name: "iPad Recepción" });
    expect(result).toMatchObject({ status: "PENDING", connectivity: null });
    expect(vi.mocked(auditService.register).mock.calls[0]![0].description).toContain("nombre “sin nombre” → “iPad Recepción”");
  });

  it("404 si no existe", async () => {
    vi.mocked(repository.findSafeById).mockResolvedValue(null);
    await expect(clockDevicesService.update("nope", { name: "X1" })).rejects.toMatchObject({ statusCode: 404, code: "CLOCK_DEVICE_NOT_FOUND" });
  });
});

describe("clockDevicesService — limpieza de PENDING abandonados (F9)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pide al repositorio los creados y sin contacto hace más de 24 h, y audita cada borrado con el sistema como actor", async () => {
    const now = new Date("2026-10-14T12:00:00.000Z");
    vi.mocked(repository.deleteStalePending).mockResolvedValue([{ id: "p1", createdAt: new Date("2026-10-10T08:00:00.000Z") }, { id: "p2", createdAt: new Date("2026-10-12T09:00:00.000Z") }]);

    expect(await clockDevicesService.cleanupStalePending(now)).toEqual({ deleted: 2 });

    expect(repository.deleteStalePending).toHaveBeenCalledWith(new Date("2026-10-13T12:00:00.000Z"), now, 50);
    expect(auditService.register).toHaveBeenCalledTimes(2);
    const audit = vi.mocked(auditService.register).mock.calls[0]![0];
    expect(audit).toMatchObject({ action: "DELETE", entity: "ClockDevice", entityId: "p1" });
    expect(audit.userId).toBeUndefined();
    expect(audit.description).toBe("Se eliminó automáticamente una solicitud pendiente de dispositivo de fichada sin uso por más de 24 horas.");
  });

  it("sin candidatos no audita nada", async () => {
    vi.mocked(repository.deleteStalePending).mockResolvedValue([]);
    expect(await clockDevicesService.cleanupStalePending()).toEqual({ deleted: 0 });
    expect(auditService.register).not.toHaveBeenCalled();
  });
});

describe("clockDevicesService — conectividad en el listado RRHH (F9)", () => {
  it("cada dispositivo trae su conectividad derivada; PENDING y REVOKED no", async () => {
    vi.mocked(repository.list).mockResolvedValue([[
      { id: "a", status: "ACTIVE", lastSeenAt: new Date() },
      { id: "b", status: "ACTIVE", lastSeenAt: new Date(Date.now() - 10 * 60_000) },
      { id: "c", status: "ACTIVE", lastSeenAt: null },
      { id: "d", status: "PENDING", lastSeenAt: new Date() },
      { id: "e", status: "REVOKED", lastSeenAt: new Date() },
    ], 5] as never);

    const result = await clockDevicesService.list({ page: 1, take: 25 });

    expect(result.items.map((item) => [item.id, item.connectivity])).toEqual([["a", "ONLINE"], ["b", "OFFLINE"], ["c", "NEVER_SEEN"], ["d", null], ["e", null]]);
  });
});
