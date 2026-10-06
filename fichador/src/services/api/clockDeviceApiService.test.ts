import { afterEach, describe, expect, it, vi } from "vitest";
import { clockDeviceApiService } from "./clockDeviceApiService";

function response(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }); }

afterEach(() => { vi.unstubAllGlobals(); });

describe("API de enrolamiento del fichador", () => {
  it("registra sólo ante una llamada explícita y devuelve identidad separada", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: { device: { id: "device-1", status: "PENDING", pairingCode: "ABCD-2345" }, secret: "secret" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(clockDeviceApiService.register()).resolves.toMatchObject({ identity: { id: "device-1", secret: "secret" }, device: { status: "PENDING" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("autentica estado y renovación con ClockDevice id.secret, nunca Bearer", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => response({ data: { id: "device-1", status: "PENDING", pairingCode: "ABCD-2345", pairingExpiresAt: new Date().toISOString() } }));
    vi.stubGlobal("fetch", fetchMock);
    const identity = { id: "device-1", secret: "top-secret" };
    await clockDeviceApiService.status(identity);
    await clockDeviceApiService.refreshPairing(identity);
    for (const [, init] of fetchMock.mock.calls) {
      const headers = new Headers((init as RequestInit).headers);
      expect(headers.get("authorization")).toBe("ClockDevice device-1.top-secret");
      expect(headers.get("authorization")).not.toMatch(/^Bearer/);
    }
  });
});
