import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as credentials from "../../shared/security/clockDeviceCredentials";
import { ALL_CLOCK_DEVICE_STATUSES, clockDeviceRequestMetadata, requireClockDevice } from "./clockDeviceAuthentication";
import { clockDevicesRepository } from "./clockDevices.repository";

vi.mock("./clockDevices.repository", () => ({
  clockDevicesRepository: { findCredentialById: vi.fn(), touchIfStale: vi.fn() },
}));
vi.mock("../../shared/security/clockDeviceCredentials", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../shared/security/clockDeviceCredentials")>();
  return { ...original, verifyClockDeviceSecret: vi.fn(original.verifyClockDeviceSecret) };
});

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECRET = credentials.generateClockDeviceSecret();
const TOKEN_HASH = credentials.hashClockDeviceSecret(SECRET);

function stored(status: "PENDING" | "ACTIVE" | "REVOKED", lastSeenAt: Date | null = new Date()) {
  return { id: ID, tokenHash: TOKEN_HASH, status, name: "Recepción", sectorId: "sector-1", lastSeenAt };
}

function fakeReq(authorization?: string, headers: Record<string, string> = {}): Request {
  const all: Record<string, string | undefined> = { authorization, ...headers };
  return { ip: "203.0.113.7", get: (name: string) => all[name.toLowerCase()] } as unknown as Request;
}

async function run(handler: ReturnType<typeof requireClockDevice>, req: Request) {
  const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
  await handler(req, {} as Response, next);
  return next.mock.calls[0]?.[0] as { statusCode?: number; code?: string } | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clockDevicesRepository.touchIfStale).mockResolvedValue({ count: 1 });
});

describe("requireClockDevice", () => {
  it("ACTIVE con secreto correcto adjunta un DTO sin hashes", async () => {
    vi.mocked(clockDevicesRepository.findCredentialById).mockResolvedValue(stored("ACTIVE"));
    const req = fakeReq(`ClockDevice ${ID}.${SECRET}`);

    expect(await run(requireClockDevice(), req)).toBeUndefined();
    expect(req.clockDevice).toEqual({ id: ID, status: "ACTIVE", name: "Recepción", sectorId: "sector-1" });
    expect(JSON.stringify(req.clockDevice)).not.toMatch(/tokenHash|pairingCodeHash|lastSeenAt/);
    expect(JSON.stringify(req.clockDevice)).not.toContain(TOKEN_HASH);
  });

  it("acepta el id en mayúsculas pero consulta siempre por el UUID canónico", async () => {
    vi.mocked(clockDevicesRepository.findCredentialById).mockResolvedValue(stored("ACTIVE"));
    await run(requireClockDevice(), fakeReq(`ClockDevice ${ID.toUpperCase()}.${SECRET}`));
    expect(clockDevicesRepository.findCredentialById).toHaveBeenCalledWith(ID);
  });

  it("timing safe: un id inexistente hace el mismo lookup y la misma comparación SHA-256 que uno real", async () => {
    vi.mocked(clockDevicesRepository.findCredentialById).mockResolvedValue(null);
    const error = await run(requireClockDevice(), fakeReq(`ClockDevice ${ID}.${SECRET}`));

    expect(error).toMatchObject({ statusCode: 401, code: "CLOCK_DEVICE_INVALID_CREDENTIAL" });
    expect(clockDevicesRepository.findCredentialById).toHaveBeenCalledTimes(1);
    expect(credentials.verifyClockDeviceSecret).toHaveBeenCalledTimes(1);
    expect(vi.mocked(credentials.verifyClockDeviceSecret).mock.calls[0]![1]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("secreto incorrecto e id inexistente responden exactamente igual", async () => {
    vi.mocked(clockDevicesRepository.findCredentialById).mockResolvedValueOnce(stored("ACTIVE"));
    const wrongSecret = await run(requireClockDevice(), fakeReq(`ClockDevice ${ID}.${credentials.generateClockDeviceSecret()}`));
    vi.mocked(clockDevicesRepository.findCredentialById).mockResolvedValueOnce(null);
    const unknownId = await run(requireClockDevice(), fakeReq(`ClockDevice ${ID}.${SECRET}`));

    expect(wrongSecret).toEqual(unknownId);
  });

  it.each([
    ["sin header", undefined],
    ["esquema Bearer", `Bearer ${SECRET}`],
    ["id que no es UUID", `ClockDevice device-1.${SECRET}`],
    ["secreto con caracteres fuera de base64url", `ClockDevice ${ID}.${"+".repeat(43)}`],
    ["secreto más largo que 256 bits", `ClockDevice ${ID}.${SECRET}A`],
  ])("formato inválido (%s) → 401 sin consultar la base", async (_label, authorization) => {
    expect(await run(requireClockDevice(), fakeReq(authorization))).toMatchObject({ statusCode: 401, code: "CLOCK_DEVICE_INVALID_CREDENTIAL" });
    expect(clockDevicesRepository.findCredentialById).not.toHaveBeenCalled();
  });

  it.each([
    ["PENDING", "CLOCK_DEVICE_NOT_ACTIVE"],
    ["REVOKED", "CLOCK_DEVICE_REVOKED"],
  ] as const)("por defecto sólo ACTIVE: %s → 403 %s y sin req.clockDevice", async (status, code) => {
    vi.mocked(clockDevicesRepository.findCredentialById).mockResolvedValue(stored(status));
    const req = fakeReq(`ClockDevice ${ID}.${SECRET}`);

    expect(await run(requireClockDevice(), req)).toMatchObject({ statusCode: 403, code });
    expect(req.clockDevice).toBeUndefined();
  });

  it("un secreto válido de un dispositivo REVOKED nunca se acepta como credencial de otro estado", async () => {
    vi.mocked(clockDevicesRepository.findCredentialById).mockResolvedValue(stored("REVOKED"));
    expect(await run(requireClockDevice({ allow: ["ACTIVE", "PENDING"] }), fakeReq(`ClockDevice ${ID}.${SECRET}`))).toMatchObject({ statusCode: 403, code: "CLOCK_DEVICE_REVOKED" });
  });

  it("las rutas de enrolamiento declaran explícitamente que aceptan cualquier estado", async () => {
    for (const status of ALL_CLOCK_DEVICE_STATUSES) {
      vi.mocked(clockDevicesRepository.findCredentialById).mockResolvedValueOnce(stored(status));
      expect(await run(requireClockDevice({ allow: ALL_CLOCK_DEVICE_STATUSES }), fakeReq(`ClockDevice ${ID}.${SECRET}`))).toBeUndefined();
    }
  });

  it("presencia: sólo con recordPresence, sólo ACTIVE y como máximo una vez por minuto", async () => {
    vi.mocked(clockDevicesRepository.findCredentialById).mockResolvedValue(stored("ACTIVE", new Date(Date.now() - 61_000)));
    await run(requireClockDevice(), fakeReq(`ClockDevice ${ID}.${SECRET}`));
    expect(clockDevicesRepository.touchIfStale).not.toHaveBeenCalled();

    await run(requireClockDevice({ recordPresence: true }), fakeReq(`ClockDevice ${ID}.${SECRET}`, { "x-clock-app-version": "1.4.0" }));
    expect(clockDevicesRepository.touchIfStale).toHaveBeenCalledWith(ID, expect.any(Date), { ip: "203.0.113.7", userAgent: null, appVersion: "1.4.0" });

    vi.mocked(clockDevicesRepository.findCredentialById).mockResolvedValue(stored("ACTIVE", new Date(Date.now() - 10_000)));
    await run(requireClockDevice({ recordPresence: true }), fakeReq(`ClockDevice ${ID}.${SECRET}`));
    expect(clockDevicesRepository.touchIfStale).toHaveBeenCalledTimes(1);
  });

  it("un fallo al registrar presencia nunca rechaza la request", async () => {
    vi.mocked(clockDevicesRepository.findCredentialById).mockResolvedValue(stored("ACTIVE", null));
    vi.mocked(clockDevicesRepository.touchIfStale).mockRejectedValue(new Error("db down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await run(requireClockDevice({ recordPresence: true }), fakeReq(`ClockDevice ${ID}.${SECRET}`))).toBeUndefined();
    await new Promise((resolve) => setImmediate(resolve));
    expect(consoleError).toHaveBeenCalledWith("CLOCK_DEVICE_PRESENCE_UPDATE_FAILED", expect.objectContaining({ deviceId: ID }));
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(SECRET);
    consoleError.mockRestore();
  });
});

describe("clockDeviceRequestMetadata", () => {
  it("la versión de app es informativa: se descarta si no tiene formato de versión", () => {
    expect(clockDeviceRequestMetadata(fakeReq(undefined, { "x-clock-app-version": "1.2.3+build.7" })).appVersion).toBe("1.2.3+build.7");
    expect(clockDeviceRequestMetadata(fakeReq(undefined, { "x-clock-app-version": "<script>" })).appVersion).toBeUndefined();
    expect(clockDeviceRequestMetadata(fakeReq(undefined, { "x-clock-app-version": "1".repeat(41) })).appVersion).toBeUndefined();
  });
});
