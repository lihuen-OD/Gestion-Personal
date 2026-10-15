import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app";
import { env } from "../../config/env";
import { generateClockDeviceSecret, hashClockDeviceSecret } from "../../shared/security/clockDeviceCredentials";
import { auditService } from "../audit/audit.service";
import { timeEntriesService } from "../time-entries/timeEntries.service";
import { clockDevicesRepository } from "./clockDevices.repository";

/**
 * F9 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §28) sobre la app real
 * (createApp, limitadores, requireClockDevice, controller y servicio reales):
 * POST /api/clock/heartbeat. Sólo el repositorio de dispositivos está
 * mockeado: nada toca una base.
 */

vi.mock("./clockDevices.repository", () => ({
  clockDevicesRepository: { findCredentialById: vi.fn(), touchIfStale: vi.fn(), recordHeartbeat: vi.fn() },
}));
vi.mock("../time-entries/timeEntries.service", async (importOriginal) => {
  const original = await importOriginal<typeof import("../time-entries/timeEntries.service")>();
  return { ...original, timeEntriesService: { ...original.timeEntriesService, clockSearch: vi.fn() } };
});
// El errorHandler audita los 403: sin este mock escribiría en la base del .env.
vi.mock("../audit/audit.service", () => ({ auditService: { register: vi.fn().mockResolvedValue(null) } }));

type Status = "PENDING" | "ACTIVE" | "REVOKED";
type FakeDevice = { id: string; secret: string; status: Status };
const device = (id: string, status: Status): FakeDevice => ({ id, secret: generateClockDeviceSecret(), status });
const ACTIVE = device("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "ACTIVE");
const OTHER_ACTIVE = device("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "ACTIVE");
const PENDING = device("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "PENDING");
const REVOKED = device("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "REVOKED");
const QUOTA = device("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "ACTIVE");
const DEVICES = [ACTIVE, OTHER_ACTIVE, PENDING, REVOKED, QUOTA];
const credential = (entry: FakeDevice) => `ClockDevice ${entry.id}.${entry.secret}`;
const self = (id: string) => ({ id, name: "Pañol 01", status: "ACTIVE", establishment: { id: "est-1", name: "Planta Norte", zone: { id: "z-1", name: "Zona Centro" } } });

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}${env.API_PREFIX}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clockDevicesRepository.findCredentialById).mockImplementation(((id: string) => {
    const found = DEVICES.find((entry) => entry.id === id);
    return Promise.resolve(found ? { id: found.id, tokenHash: hashClockDeviceSecret(found.secret), status: found.status, name: "Pañol 01", lastSeenAt: new Date() } : null);
  }) as never);
  vi.mocked(clockDevicesRepository.touchIfStale).mockResolvedValue({ count: 1 });
  vi.mocked(clockDevicesRepository.recordHeartbeat).mockImplementation(((id: string) => Promise.resolve(self(id))) as never);
  vi.mocked(timeEntriesService.clockSearch).mockResolvedValue([]);
});

async function heartbeat(options: { authorization?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...options.headers };
  if (options.authorization) headers.authorization = options.authorization;
  const response = await fetch(`${baseUrl}/clock/heartbeat`, { method: "POST", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const text = await response.text();
  // El 429 de express-rate-limit es texto plano.
  const payload = (response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : null) as { data?: { device: Record<string, unknown>; serverTime: string }; error?: { code?: string } } | null;
  return { status: response.status, data: payload?.data, error: payload?.error, raw: text, rateLimit: response.headers.get("ratelimit-limit") };
}

describe("F9 — POST /api/clock/heartbeat", () => {
  it("ACTIVE → 200 con el dispositivo y la hora DEL SERVIDOR; actualiza la presencia con IP, user-agent y versión del header", async () => {
    const before = Date.now();
    const result = await heartbeat({ authorization: credential(ACTIVE), headers: { "user-agent": "iPad Safari 17", "x-clock-app-version": "1.4.0" } });

    expect(result.status).toBe(200);
    expect(result.data!.device).toEqual(self(ACTIVE.id));
    expect(Date.parse(result.data!.serverTime)).toBeGreaterThanOrEqual(before - 1_000);
    expect(result.data!.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(clockDevicesRepository.recordHeartbeat).toHaveBeenCalledWith(ACTIVE.id, {
      ip: expect.stringMatching(/127\.0\.0\.1$/),
      userAgent: "iPad Safari 17",
      appVersion: "1.4.0",
    });
  });

  it("ignora identidad y metadata del body: el dispositivo sale de la credencial, IP y user-agent de la request", async () => {
    await heartbeat({
      authorization: credential(ACTIVE),
      headers: { "user-agent": "iPad real" },
      body: { deviceId: OTHER_ACTIVE.id, ip: "10.9.9.9", userAgent: "falso", appVersion: "9.9.9", lastSeenAt: "2020-01-01T00:00:00.000Z", status: "ACTIVE" },
    });

    expect(clockDevicesRepository.recordHeartbeat).toHaveBeenCalledTimes(1);
    const [id, metadata] = vi.mocked(clockDevicesRepository.recordHeartbeat).mock.calls[0]!;
    expect(id).toBe(ACTIVE.id);
    expect(metadata).toEqual({ ip: expect.stringMatching(/127\.0\.0\.1$/), userAgent: "iPad real", appVersion: undefined });
  });

  it("una versión de app mal formada en el header no se guarda", async () => {
    await heartbeat({ authorization: credential(ACTIVE), headers: { "x-clock-app-version": "<script>" } });
    expect(vi.mocked(clockDevicesRepository.recordHeartbeat).mock.calls[0]![1].appVersion).toBeUndefined();
  });

  it("la respuesta no expone hashes, secretos ni metadata técnica, y no genera AuditLog", async () => {
    const result = await heartbeat({ authorization: credential(ACTIVE) });
    expect(result.raw).not.toMatch(/tokenHash|pairingCode|secret|lastIp|lastUserAgent|activatedBy/);
    expect(result.raw).not.toContain(ACTIVE.secret);
    expect(auditService.register).not.toHaveBeenCalled();
  });

  it.each([
    ["PENDING", PENDING, "CLOCK_DEVICE_NOT_ACTIVE"],
    ["REVOKED", REVOKED, "CLOCK_DEVICE_REVOKED"],
  ] as const)("%s → 403 %s sin tocar la presencia", async (_label, entry, code) => {
    expect(await heartbeat({ authorization: credential(entry) })).toMatchObject({ status: 403, error: { code } });
    expect(clockDevicesRepository.recordHeartbeat).not.toHaveBeenCalled();
  });

  it.each([
    ["sin credencial", undefined],
    ["secreto incorrecto", `ClockDevice ${ACTIVE.id}.${OTHER_ACTIVE.secret}`],
    ["Bearer de usuario", "Bearer eyJhbGciOiJIUzI1NiJ9.e30.signature"],
  ])("%s → 401 CLOCK_DEVICE_INVALID_CREDENTIAL", async (_label, authorization) => {
    expect(await heartbeat({ authorization })).toMatchObject({ status: 401, error: { code: "CLOCK_DEVICE_INVALID_CREDENTIAL" } });
    expect(clockDevicesRepository.recordHeartbeat).not.toHaveBeenCalled();
  });

  it("revocado entre la autenticación y la escritura → 403 CLOCK_DEVICE_REVOKED", async () => {
    vi.mocked(clockDevicesRepository.recordHeartbeat).mockResolvedValueOnce(null);
    expect(await heartbeat({ authorization: credential(ACTIVE) })).toMatchObject({ status: 403, error: { code: "CLOCK_DEVICE_REVOKED" } });
  });

  it("no existe bajo /time-entries/clock (alias legacy retirado en F11)", async () => {
    const response = await fetch(`${baseUrl}/time-entries/clock/heartbeat`, { method: "POST", headers: { authorization: credential(ACTIVE) } });
    expect(response.status).toBe(404);
    expect(clockDevicesRepository.recordHeartbeat).not.toHaveBeenCalled();
  });
});

describe("F9 — cupo propio del heartbeat", () => {
  it("10 cada 5 minutos por dispositivo; agotarlo no consume el cupo operativo de ese dispositivo", async () => {
    for (let index = 0; index < 10; index += 1) {
      const result = await heartbeat({ authorization: credential(QUOTA) });
      expect(result.status).toBe(200);
      expect(result.rateLimit).toBe("10");
    }
    expect((await heartbeat({ authorization: credential(QUOTA) })).status).toBe(429);
    expect((await heartbeat({ authorization: credential(OTHER_ACTIVE) })).status).toBe(200);

    const operational = await fetch(`${baseUrl}/clock/employees?search=ana`, { headers: { authorization: credential(QUOTA) } });
    expect(operational.status).toBe(200);
    expect(operational.headers.get("ratelimit-remaining")).toBe(String(env.CLOCK_RATE_LIMIT_MAX - 1));
  });
});
