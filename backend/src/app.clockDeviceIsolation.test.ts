import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { env } from "./config/env";
import { clockDevicesRepository } from "./modules/clock-devices/clockDevices.repository";
import { timeEntriesService } from "./modules/time-entries/timeEntries.service";
import { generateClockDeviceSecret, hashClockDeviceSecret } from "./shared/security/clockDeviceCredentials";

/**
 * F6 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §11): las dos
 * identidades del sistema nunca se cruzan, probado sobre la app real.
 * - Una credencial ClockDevice ACTIVE válida no abre ninguna ruta
 *   administrativa (requireAuth sólo acepta Bearer).
 * - Un JWT válido de RRHH no abre ninguna ruta operativa del fichador
 *   (requireClockDevice sólo acepta ClockDevice).
 */

vi.mock("./modules/clock-devices/clockDevices.repository", () => ({
  clockDevicesRepository: { findCredentialById: vi.fn(), touchIfStale: vi.fn() },
}));
vi.mock("./modules/time-entries/timeEntries.service", async (importOriginal) => {
  const original = await importOriginal<typeof import("./modules/time-entries/timeEntries.service")>();
  return {
    ...original,
    timeEntriesService: { ...original.timeEntriesService, clockSearch: vi.fn(), clockStatusByEmployee: vi.fn(), clockPhotoPunchIdempotent: vi.fn(), clockPunchAttemptStatus: vi.fn() },
  };
});

const DEVICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE_SECRET = generateClockDeviceSecret();
const DEVICE_AUTHORIZATION = `ClockDevice ${DEVICE_ID}.${DEVICE_SECRET}`;
const EMPLOYEE_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";

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
  vi.mocked(clockDevicesRepository.findCredentialById).mockResolvedValue({
    id: DEVICE_ID, tokenHash: hashClockDeviceSecret(DEVICE_SECRET), status: "ACTIVE", name: "Kiosco", lastSeenAt: new Date(),
  });
});

async function call(method: string, path: string, authorization: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
  return { status: response.status, code: payload?.error?.code };
}

describe("F6 — aislamiento entre identidad de dispositivo y sesión de usuario", () => {
  it.each([
    ["GET", "/employees"],
    ["GET", "/users"],
    ["GET", "/workforce/home"],
    ["GET", "/hour-concepts"],
    ["GET", "/audit"],
    ["GET", "/clock-devices"],
    ["GET", "/time-entries"],
    ["GET", `/time-entries/attendance/punches/${EMPLOYEE_ID}/photo`],
  ])("una credencial ClockDevice ACTIVE válida contra %s %s → 401", async (method, path) => {
    const result = await call(method, path, DEVICE_AUTHORIZATION);
    expect(result.status).toBe(401);
    expect(result.code).toBe("AUTH_REQUIRED");
  });

  it.each([
    ["GET", "/time-entries/clock/employees?search=ana", undefined],
    ["POST", "/time-entries/clock/status", { employeeId: EMPLOYEE_ID }],
    ["POST", "/time-entries/clock/photo-punch", { requestId: REQUEST_ID, employeeId: EMPLOYEE_ID, punchType: "IN", photo: `data:image/jpeg;base64,${"A".repeat(400)}`, faceValidationStatus: "VALID" }],
    ["GET", `/time-entries/clock/attempts/${REQUEST_ID}?employeeId=${EMPLOYEE_ID}`, undefined],
  ])("un JWT válido de RRHH contra %s %s → 401 sin ejecutar la fichada", async (method, path, body) => {
    const token = jwt.sign({ sub: "user-rrhh", email: "rrhh@example.com", role: "NIVEL_1_RRHH" }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
    expect(await call(method, path, `Bearer ${token}`, body)).toEqual({ status: 401, code: "CLOCK_DEVICE_INVALID_CREDENTIAL" });
    expect(timeEntriesService.clockPhotoPunchIdempotent).not.toHaveBeenCalled();
    expect(timeEntriesService.clockSearch).not.toHaveBeenCalled();
  });
});
