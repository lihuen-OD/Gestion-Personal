import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type ErrorRequestHandler } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env";
import { AppError } from "../../shared/errors/AppError";
import { generateClockDeviceSecret, hashClockDeviceSecret } from "../../shared/security/clockDeviceCredentials";
import { clockDevicesRepository } from "../clock-devices/clockDevices.repository";
import { timeEntriesRouter } from "./timeEntries.routes";
import { timeEntriesService } from "./timeEntries.service";

/**
 * Prueba a nivel HTTP (router real de Express, servicio y repositorio de
 * dispositivos mockeados) el contrato de las cuatro rutas del fichador:
 *
 * - F0: las rutas de fichada sin foto ya no existen (404 con o sin
 *   credencial) y el namespace /clock queda cerrado.
 * - F6: cada ruta exige un ClockDevice ACTIVE autenticado individualmente
 *   (`Authorization: ClockDevice <id>.<secret>`); el token compartido
 *   `x-clock-device-token` ya no autentica nada y el deviceId que llega al
 *   servicio sale de la autenticación, nunca del body.
 */

vi.mock("./timeEntries.service", () => ({
  timeEntriesService: {
    clockSearch: vi.fn(),
    clockStatusByEmployee: vi.fn(),
    clockPhotoPunchIdempotent: vi.fn(),
    clockPunchAttemptStatus: vi.fn(),
  },
  timeEntriesExportToCsv: vi.fn(),
}));

vi.mock("../employees/employees.controller", () => ({
  clearEmployeeReadCaches: vi.fn(),
  clearEmployeeTimeGridCache: vi.fn(),
}));

vi.mock("../clock-devices/clockDevices.repository", () => ({
  clockDevicesRepository: { findCredentialById: vi.fn(), touchIfStale: vi.fn() },
}));

type Status = "PENDING" | "ACTIVE" | "REVOKED";
type FakeDevice = { id: string; secret: string; status: Status; lastSeenAt: Date | null };

function device(id: string, status: Status, lastSeenAt: Date | null = new Date()): FakeDevice {
  return { id, secret: generateClockDeviceSecret(), status, lastSeenAt };
}

const ACTIVE = device("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "ACTIVE");
const OTHER_ACTIVE = device("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "ACTIVE");
const PENDING = device("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "PENDING");
const REVOKED = device("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "REVOKED");
const STALE = device("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "ACTIVE", new Date(Date.now() - 5 * 60_000));
const RATE_LIMITED = device("ffffffff-ffff-4fff-8fff-ffffffffffff", "ACTIVE");
const RATE_LIMITED_NEIGHBOUR = device("12121212-1212-4212-8212-121212121212", "ACTIVE");
const DEVICES = [ACTIVE, OTHER_ACTIVE, PENDING, REVOKED, STALE, RATE_LIMITED, RATE_LIMITED_NEIGHBOUR];

const LEGACY_SHARED_TOKEN = "test-clock-device-token-0123456789";
const EMPLOYEE_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";

const credential = (entry: FakeDevice) => `ClockDevice ${entry.id}.${entry.secret}`;

let server: Server;
let baseUrl: string;

const testErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const appError = error instanceof AppError ? error : new AppError("Unexpected server error", 500, "INTERNAL_ERROR");
  res.status(appError.statusCode).json({ error: { code: appError.code } });
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/time-entries", timeEntriesRouter);
  app.use(testErrorHandler);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/time-entries`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clockDevicesRepository.findCredentialById).mockImplementation(((id: string) => {
    const found = DEVICES.find((entry) => entry.id === id);
    return Promise.resolve(found ? { id: found.id, tokenHash: hashClockDeviceSecret(found.secret), status: found.status, name: "Kiosco", sectorId: null, lastSeenAt: found.lastSeenAt } : null);
  }) as never);
  vi.mocked(clockDevicesRepository.touchIfStale).mockResolvedValue({ count: 1 });
  vi.mocked(timeEntriesService.clockSearch).mockResolvedValue([]);
  vi.mocked(timeEntriesService.clockStatusByEmployee).mockResolvedValue({ employee: { id: EMPLOYEE_ID }, openShift: null } as never);
  vi.mocked(timeEntriesService.clockPhotoPunchIdempotent).mockResolvedValue({ workShift: { id: "shift-1" } } as never);
  vi.mocked(timeEntriesService.clockPunchAttemptStatus).mockResolvedValue({ requestId: REQUEST_ID, status: "COMPLETED" } as never);
});

type CallOptions = { authorization?: string; legacyToken?: string; body?: unknown };

async function call(method: string, path: string, options: CallOptions = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.authorization) headers.authorization = options.authorization;
  if (options.legacyToken) headers["x-clock-device-token"] = options.legacyToken;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
  return { status: response.status, code: payload?.error?.code, rateLimit: response.headers.get("ratelimit-limit") };
}

const validPunch = {
  requestId: REQUEST_ID,
  employeeId: EMPLOYEE_ID,
  punchType: "IN",
  photo: `data:image/jpeg;base64,${"A".repeat(400)}`,
  faceValidationStatus: "VALID",
};

const operationalRoutes = [
  { name: "GET /clock/employees", method: "GET", path: "/clock/employees?search=ana", body: undefined, ok: 200 },
  { name: "POST /clock/status", method: "POST", path: "/clock/status", body: { employeeId: EMPLOYEE_ID }, ok: 200 },
  { name: "POST /clock/photo-punch", method: "POST", path: "/clock/photo-punch", body: validPunch, ok: 201 },
  { name: "GET /clock/attempts/:requestId", method: "GET", path: `/clock/attempts/${REQUEST_ID}?employeeId=${EMPLOYEE_ID}`, body: undefined, ok: 200 },
] as const;

function serviceCalls() {
  return [
    timeEntriesService.clockSearch,
    timeEntriesService.clockStatusByEmployee,
    timeEntriesService.clockPhotoPunchIdempotent,
    timeEntriesService.clockPunchAttemptStatus,
  ].reduce((total, fn) => total + vi.mocked(fn).mock.calls.length, 0);
}

describe("F0 — rutas de fichada sin foto retiradas", () => {
  const retired = [
    { path: "/clock/in", body: { employeeId: EMPLOYEE_ID } },
    { path: "/clock/out", body: { employeeId: EMPLOYEE_ID } },
    { path: "/clock/status-by-dni", body: { dni: "30123456" } },
    { path: "/clock/in-by-dni", body: { dni: "30123456" } },
    { path: "/clock/out-by-dni", body: { dni: "30123456" } },
  ];

  it.each(retired)("POST $path responde 404 aun con un dispositivo ACTIVE", async ({ path, body }) => {
    expect(await call("POST", path, { authorization: credential(ACTIVE), body })).toMatchObject({ status: 404, code: "ROUTE_NOT_FOUND" });
  });

  it.each(retired)("POST $path responde 404 sin credencial (no 401/403: la ruta no existe)", async ({ path, body }) => {
    expect(await call("POST", path, { body })).toMatchObject({ status: 404, code: "ROUTE_NOT_FOUND" });
  });

  it("ninguna ruta retirada llega a ejecutar lógica de fichada", async () => {
    for (const { path, body } of retired) await call("POST", path, { authorization: credential(ACTIVE), body });
    expect(serviceCalls()).toBe(0);
  });

  it("una ruta /clock/* desconocida responde 404 y nunca cae en requireAuth (ni con un Bearer cualquiera)", async () => {
    expect(await call("POST", "/clock/anything", { authorization: credential(ACTIVE), body: {} })).toMatchObject({ status: 404, code: "ROUTE_NOT_FOUND" });
    expect(await call("GET", "/clock", { authorization: credential(ACTIVE) })).toMatchObject({ status: 404, code: "ROUTE_NOT_FOUND" });
    expect(await call("POST", "/clock/in", { authorization: "Bearer not-a-real-jwt", body: { employeeId: EMPLOYEE_ID } })).toMatchObject({ status: 404, code: "ROUTE_NOT_FOUND" });
  });
});

describe.each(operationalRoutes)("F6 — $name exige un ClockDevice ACTIVE individual", ({ method, path, body, ok }) => {
  it("ACTIVE con su secreto → opera", async () => {
    expect((await call(method, path, { authorization: credential(ACTIVE), body })).status).toBe(ok);
    expect(serviceCalls()).toBe(1);
  });

  it.each([
    ["PENDING", PENDING, "CLOCK_DEVICE_NOT_ACTIVE"],
    ["REVOKED", REVOKED, "CLOCK_DEVICE_REVOKED"],
  ] as const)("%s con secreto correcto → 403 con código propio, sin ejecutar nada", async (_label, entry, code) => {
    expect(await call(method, path, { authorization: credential(entry), body })).toMatchObject({ status: 403, code });
    expect(serviceCalls()).toBe(0);
  });

  it.each([
    ["sin credencial", undefined],
    ["id inexistente", `ClockDevice ${UNKNOWN_ID}.${ACTIVE.secret}`],
    ["secreto de otro dispositivo", `ClockDevice ${ACTIVE.id}.${OTHER_ACTIVE.secret}`],
    ["secreto revocado presentado con id activo", `ClockDevice ${ACTIVE.id}.${REVOKED.secret}`],
    ["formato inválido", `ClockDevice ${ACTIVE.id}:${ACTIVE.secret}`],
    ["secreto truncado", `ClockDevice ${ACTIVE.id}.${ACTIVE.secret.slice(0, 20)}`],
    ["Bearer de usuario", "Bearer eyJhbGciOiJIUzI1NiJ9.e30.signature"],
  ])("%s → el mismo 401 CLOCK_DEVICE_INVALID_CREDENTIAL", async (_label, authorization) => {
    expect(await call(method, path, { authorization, body })).toMatchObject({ status: 401, code: "CLOCK_DEVICE_INVALID_CREDENTIAL" });
    expect(serviceCalls()).toBe(0);
  });

  it("el token compartido legacy (x-clock-device-token) ya no autentica", async () => {
    expect(await call(method, path, { legacyToken: LEGACY_SHARED_TOKEN, body })).toMatchObject({ status: 401, code: "CLOCK_DEVICE_INVALID_CREDENTIAL" });
    expect(serviceCalls()).toBe(0);
  });
});

describe("F6 — el dispositivo autenticado es la única fuente de deviceId", () => {
  it("photo-punch pasa al servicio el id autenticado aunque el body intente otro", async () => {
    const result = await call("POST", "/clock/photo-punch", { authorization: credential(ACTIVE), body: { ...validPunch, deviceId: OTHER_ACTIVE.id } });
    expect(result.status).toBe(201);
    const [input, deviceId] = vi.mocked(timeEntriesService.clockPhotoPunchIdempotent).mock.calls[0]!;
    expect(deviceId).toBe(ACTIVE.id);
    expect(input).not.toHaveProperty("deviceId");
  });

  it("attempts consulta en nombre del dispositivo autenticado", async () => {
    await call("GET", `/clock/attempts/${REQUEST_ID}?employeeId=${EMPLOYEE_ID}`, { authorization: credential(OTHER_ACTIVE) });
    expect(timeEntriesService.clockPunchAttemptStatus).toHaveBeenCalledWith(REQUEST_ID, EMPLOYEE_ID, OTHER_ACTIVE.id);
  });

  it("la autenticación corre antes que la validación: un body inválido sin credencial es 401, no 400", async () => {
    expect(await call("POST", "/clock/photo-punch", { body: { ...validPunch, photo: undefined } })).toMatchObject({ status: 401 });
    expect((await call("POST", "/clock/photo-punch", { authorization: credential(ACTIVE), body: { ...validPunch, photo: undefined } })).status).toBe(400);
  });
});

describe("F6 — presencia con throttle", () => {
  it("un dispositivo visto hace más de 60 s actualiza lastSeen una vez, con IP/UA de la request", async () => {
    await call("GET", "/clock/employees?search=ana", { authorization: credential(STALE) });
    expect(clockDevicesRepository.touchIfStale).toHaveBeenCalledWith(STALE.id, expect.any(Date), expect.objectContaining({ ip: expect.any(String) }));
  });

  it("un dispositivo visto recién no escribe nada", async () => {
    await call("GET", "/clock/employees?search=ana", { authorization: credential(ACTIVE) });
    expect(clockDevicesRepository.touchIfStale).not.toHaveBeenCalled();
  });

  it("un rechazo nunca actualiza la presencia", async () => {
    await call("GET", "/clock/employees?search=ana", { authorization: credential(REVOKED) });
    await call("GET", "/clock/employees?search=ana", { authorization: `ClockDevice ${STALE.id}.${ACTIVE.secret}` });
    expect(clockDevicesRepository.touchIfStale).not.toHaveBeenCalled();
  });
});

describe("F6 — rate limit por dispositivo", () => {
  it("agotar el cupo de un dispositivo no bloquea a otro que sale por la misma IP", async () => {
    for (let index = 0; index < env.CLOCK_RATE_LIMIT_MAX; index += 1) {
      expect((await call("GET", "/clock/employees?search=ana", { authorization: credential(RATE_LIMITED) })).status).toBe(200);
    }
    expect((await call("GET", "/clock/employees?search=ana", { authorization: credential(RATE_LIMITED) })).status).toBe(429);
    expect((await call("GET", "/clock/employees?search=ana", { authorization: credential(RATE_LIMITED_NEIGHBOUR) })).status).toBe(200);
  });

  it("una credencial rechazada sólo consume el cupo por IP: nunca crea un bucket de dispositivo", async () => {
    const rejected = await call("GET", "/clock/employees?search=ana", { authorization: `ClockDevice ${UNKNOWN_ID}.${ACTIVE.secret}` });
    const accepted = await call("GET", "/clock/employees?search=ana", { authorization: credential(OTHER_ACTIVE) });
    expect(rejected).toMatchObject({ status: 401, rateLimit: String(env.CLOCK_IP_RATE_LIMIT_MAX) });
    expect(accepted).toMatchObject({ status: 200, rateLimit: String(env.CLOCK_RATE_LIMIT_MAX) });
  });
});
