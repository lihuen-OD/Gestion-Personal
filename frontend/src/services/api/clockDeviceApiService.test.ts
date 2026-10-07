import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./apiClient", () => ({ apiRequest: vi.fn() }));
const { apiRequest } = await import("./apiClient");
const { clockDeviceApiService } = await import("./clockDeviceApiService");

describe("clockDeviceApiService administrativo", () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  it("resuelve el código antes de activar y nunca envía hashes", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { id: "d1", status: "PENDING" } }).mockResolvedValueOnce({ data: { id: "d1", status: "ACTIVE" } });
    await clockDeviceApiService.resolvePairing("ABCD-2345");
    await clockDeviceApiService.activate("d1", { pairingCode: "ABCD-2345", name: "iPad Recepción", establishmentId: null });
    expect(apiRequest).toHaveBeenNthCalledWith(1, "/clock-devices/resolve-pairing", { method: "POST", body: { pairingCode: "ABCD-2345" } });
    expect(apiRequest).toHaveBeenNthCalledWith(2, "/clock-devices/d1/activate", { method: "POST", body: { pairingCode: "ABCD-2345", name: "iPad Recepción", establishmentId: null } });
    expect(JSON.stringify(vi.mocked(apiRequest).mock.calls)).not.toMatch(/tokenHash|pairingCodeHash|secret/);
  });

  it("revoca y sólo expone delete explícito para pendientes", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: {} });
    await clockDeviceApiService.revoke("d1");
    await clockDeviceApiService.deletePending("d2");
    expect(apiRequest).toHaveBeenNthCalledWith(1, "/clock-devices/d1/revoke", { method: "POST" });
    expect(apiRequest).toHaveBeenNthCalledWith(2, "/clock-devices/d2", { method: "DELETE" });
  });
});
