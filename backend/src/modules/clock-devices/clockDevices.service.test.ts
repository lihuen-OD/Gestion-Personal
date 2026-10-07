import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditService } from "../audit/audit.service";
import { clockDevicesRepository as repository } from "./clockDevices.repository";
import { clockDevicesService } from "./clockDevices.service";

vi.mock("./clockDevices.repository", () => ({
  clockDevicesRepository: {
    countPending: vi.fn(), create: vi.fn(), setPairing: vi.fn(), touch: vi.fn(), findSafeById: vi.fn(),
    list: vi.fn(), findPendingByPairingHash: vi.fn(), activate: vi.fn(), revoke: vi.fn(), deletePending: vi.fn(),
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
