import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app";
import { env } from "../../config/env";
import { AppError } from "../../shared/errors/AppError";
import { generateClockDeviceSecret, hashClockDeviceSecret } from "../../shared/security/clockDeviceCredentials";
import { clockDevicesRepository } from "../clock-devices/clockDevices.repository";
import { clockDevicesService } from "../clock-devices/clockDevices.service";
import { timeEntriesService } from "../time-entries/timeEntries.service";

/**
 * F7 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §26) sobre la app real
 * (createApp: CORS, limitadores, routers, errorHandler): el namespace
 * `/api/clock/*`, su autenticación, su cupo y el source KIOSK. F11 (§30)
 * retiró el alias legacy `/api/time-entries/clock/*`: sobre la app real
 * responde 404 ROUTE_NOT_FOUND, sin header de deprecación.
 * Servicios y repositorio de dispositivos mockeados: nada toca una base.
 */

vi.mock("../clock-devices/clockDevices.repository", () => ({
  clockDevicesRepository: { findCredentialById: vi.fn(), touchIfStale: vi.fn() },
}));
vi.mock("../clock-devices/clockDevices.service", () => ({
  clockDevicesService: { status: vi.fn() },
}));
vi.mock("../time-entries/timeEntries.service", async (importOriginal) => {
  const original = await importOriginal<typeof import("../time-entries/timeEntries.service")>();
  return {
    ...original,
    timeEntriesService: { ...original.timeEntriesService, clockSearch: vi.fn(), clockStatusByEmployee: vi.fn(), clockPhotoPunchIdempotent: vi.fn(), clockPunchAttemptStatus: vi.fn() },
  };
});
// El errorHandler audita los 403: sin este mock escribiría en la base del .env.
vi.mock("../audit/audit.service", () => ({ auditService: { register: vi.fn().mockResolvedValue(null) } }));

type Status = "PENDING" | "ACTIVE" | "REVOKED";
type FakeDevice = { id: string; secret: string; status: Status; name: string };
const device = (id: string, status: Status, name = "Pañol 01"): FakeDevice => ({ id, secret: generateClockDeviceSecret(), status, name });

const ACTIVE = device("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "ACTIVE");
const OTHER_ACTIVE = device("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "ACTIVE", "Oficina 01");
const PENDING = device("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "PENDING");
const REVOKED = device("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "REVOKED");
const SHARED_QUOTA = device("ffffffff-ffff-4fff-8fff-ffffffffffff", "ACTIVE");
const DEVICES = [ACTIVE, OTHER_ACTIVE, PENDING, REVOKED, SHARED_QUOTA];

const EMPLOYEE_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";
const credential = (entry: FakeDevice) => `ClockDevice ${entry.id}.${entry.secret}`;
const validPunch = { requestId: REQUEST_ID, employeeId: EMPLOYEE_ID, punchType: "IN", photo: `data:image/jpeg;base64,${"A".repeat(400)}`, faceValidationStatus: "VALID" };

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
    return Promise.resolve(found ? { id: found.id, tokenHash: hashClockDeviceSecret(found.secret), status: found.status, name: found.name, lastSeenAt: new Date() } : null);
  }) as never);
  vi.mocked(clockDevicesRepository.touchIfStale).mockResolvedValue({ count: 1 });
  vi.mocked(clockDevicesService.status).mockResolvedValue({ status: "PENDING" } as never);
  vi.mocked(timeEntriesService.clockSearch).mockResolvedValue([]);
  vi.mocked(timeEntriesService.clockStatusByEmployee).mockResolvedValue({ employee: { id: EMPLOYEE_ID }, openShift: null } as never);
  vi.mocked(timeEntriesService.clockPhotoPunchIdempotent).mockResolvedValue({ workShift: { id: "shift-1" } } as never);
  vi.mocked(timeEntriesService.clockPunchAttemptStatus).mockResolvedValue({ requestId: REQUEST_ID, status: "COMPLETED" } as never);
});

async function call(method: string, path: string, options: { authorization?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.authorization) headers.authorization = options.authorization;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const payload = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string; retryAfterSeconds?: number } } | null;
  return { status: response.status, error: payload?.error, deprecation: response.headers.get("deprecation"), rateLimit: response.headers.get("ratelimit-limit") };
}

function serviceCalls() {
  return [timeEntriesService.clockSearch, timeEntriesService.clockStatusByEmployee, timeEntriesService.clockPhotoPunchIdempotent, timeEntriesService.clockPunchAttemptStatus]
    .reduce((total, fn) => total + vi.mocked(fn).mock.calls.length, 0);
}

const routes = [
  { name: "GET /clock/employees", method: "GET", path: "/clock/employees?search=ana", body: undefined, ok: 200 },
  { name: "POST /clock/status", method: "POST", path: "/clock/status", body: { employeeId: EMPLOYEE_ID }, ok: 200 },
  { name: "POST /clock/photo-punch", method: "POST", path: "/clock/photo-punch", body: validPunch, ok: 201 },
  { name: "GET /clock/attempts/:requestId", method: "GET", path: `/clock/attempts/${REQUEST_ID}?employeeId=${EMPLOYEE_ID}`, body: undefined, ok: 200 },
] as const;

describe.each(routes)("F7 — $name (namespace nuevo) exige un ClockDevice ACTIVE", ({ method, path, body, ok }) => {
  it("ACTIVE → opera, sin header de deprecación", async () => {
    const result = await call(method, path, { authorization: credential(ACTIVE), body });
    expect(result.status).toBe(ok);
    expect(result.deprecation).toBeNull();
    expect(serviceCalls()).toBe(1);
  });

  it.each([
    ["PENDING", PENDING, "CLOCK_DEVICE_NOT_ACTIVE"],
    ["REVOKED", REVOKED, "CLOCK_DEVICE_REVOKED"],
  ] as const)("%s → 403 %s sin ejecutar nada", async (_label, entry, code) => {
    expect(await call(method, path, { authorization: credential(entry), body })).toMatchObject({ status: 403, error: { code } });
    expect(serviceCalls()).toBe(0);
  });

  it.each([
    ["sin credencial", undefined],
    ["id inexistente", `ClockDevice ${UNKNOWN_ID}.${ACTIVE.secret}`],
    ["secreto de otro dispositivo", `ClockDevice ${ACTIVE.id}.${OTHER_ACTIVE.secret}`],
    ["Bearer de usuario", "Bearer eyJhbGciOiJIUzI1NiJ9.e30.signature"],
  ])("%s → 401 CLOCK_DEVICE_INVALID_CREDENTIAL", async (_label, authorization) => {
    expect(await call(method, path, { authorization, body })).toMatchObject({ status: 401, error: { code: "CLOCK_DEVICE_INVALID_CREDENTIAL" } });
    expect(serviceCalls()).toBe(0);
  });

  it("F11: el alias legacy /time-entries/clock/* ya no existe (404, sin header de deprecación, sin ejecutar nada)", async () => {
    const result = await call(method, `/time-entries${path}`, { authorization: credential(ACTIVE), body });
    expect(result).toMatchObject({ status: 404, error: { code: "ROUTE_NOT_FOUND" }, deprecation: null });
    expect(serviceCalls()).toBe(0);
  });
});

describe("F7 — source decidido por la ruta, dispositivo por la autenticación", () => {
  it("POST /api/clock/photo-punch → KIOSK con el dispositivo autenticado, aunque el body diga otra cosa", async () => {
    await call("POST", "/clock/photo-punch", { authorization: credential(ACTIVE), body: { ...validPunch, source: "ADMIN", deviceId: OTHER_ACTIVE.id } });
    const [input, origin] = vi.mocked(timeEntriesService.clockPhotoPunchIdempotent).mock.calls[0]!;
    expect(origin).toEqual({ device: { id: ACTIVE.id, name: "Pañol 01" }, source: "KIOSK" });
    expect(input).not.toHaveProperty("source");
    expect(input).not.toHaveProperty("deviceId");
  });

  it("attempts consulta en nombre del dispositivo autenticado (aislamiento F6)", async () => {
    await call("GET", `/clock/attempts/${REQUEST_ID}?employeeId=${EMPLOYEE_ID}`, { authorization: credential(OTHER_ACTIVE) });
    expect(timeEntriesService.clockPunchAttemptStatus).toHaveBeenCalledWith(REQUEST_ID, EMPLOYEE_ID, OTHER_ACTIVE.id);
  });

  it("el cooldown viaja con retryAfterSeconds en el error (también en production, a diferencia de details)", async () => {
    vi.mocked(timeEntriesService.clockPhotoPunchIdempotent).mockRejectedValueOnce(new AppError("Ya registraste una fichada hace instantes.", 409, "CLOCK_PUNCH_COOLDOWN", undefined, { retryAfterSeconds: 42 }));
    expect(await call("POST", "/clock/photo-punch", { authorization: credential(ACTIVE), body: validPunch })).toMatchObject({
      status: 409,
      error: { code: "CLOCK_PUNCH_COOLDOWN", retryAfterSeconds: 42 },
    });
  });
});

describe("F7 — convivencia con el enrolamiento y cierre del namespace", () => {
  it("las rutas de enrolamiento siguen bajo /api/clock/device/* y aceptan PENDING", async () => {
    expect((await call("GET", "/clock/device/status", { authorization: credential(PENDING) })).status).toBe(200);
    expect(clockDevicesService.status).toHaveBeenCalledWith(PENDING.id, expect.anything());
  });

  it("una ruta desconocida bajo /api/clock responde 404, con o sin credencial", async () => {
    expect(await call("POST", "/clock/in", { authorization: credential(ACTIVE), body: { employeeId: EMPLOYEE_ID } })).toMatchObject({ status: 404, error: { code: "ROUTE_NOT_FOUND" } });
    expect(await call("GET", "/clock/punches", {})).toMatchObject({ status: 404, error: { code: "ROUTE_NOT_FOUND" } });
    expect(serviceCalls()).toBe(0);
  });
});

describe("F7 — cupo por dispositivo", () => {
  it("un único cupo por dispositivo entre las cuatro rutas: agotarlo bloquea a ese dispositivo y no a otro", async () => {
    for (let index = 0; index < env.CLOCK_RATE_LIMIT_MAX; index += 1) {
      const result = index % 2 === 0
        ? await call("GET", "/clock/employees?search=ana", { authorization: credential(SHARED_QUOTA) })
        : await call("POST", "/clock/status", { authorization: credential(SHARED_QUOTA), body: { employeeId: EMPLOYEE_ID } });
      expect(result.status).toBe(200);
    }
    expect((await call("GET", "/clock/employees?search=ana", { authorization: credential(SHARED_QUOTA) })).status).toBe(429);
    expect((await call("POST", "/clock/status", { authorization: credential(SHARED_QUOTA), body: { employeeId: EMPLOYEE_ID } })).status).toBe(429);
    expect((await call("GET", "/clock/employees?search=ana", { authorization: credential(OTHER_ACTIVE) })).status).toBe(200);
  });

  it("anuncia el cupo por dispositivo", async () => {
    expect((await call("GET", "/clock/employees?search=ana", { authorization: credential(ACTIVE) })).rateLimit).toBe(String(env.CLOCK_RATE_LIMIT_MAX));
  });
});
