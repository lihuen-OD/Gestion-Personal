import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateClockDeviceSecret, hashClockDeviceSecret } from "../../shared/security/clockDeviceCredentials";

/**
 * §33 del plan del fichador, sobre la app REAL (createApp: limitador global,
 * trust proxy, routers y guardas reales; servicios y repositorio de
 * dispositivos mockeados). Cupos chicos para ejercitar los bordes: se fijan en
 * `env` ANTES de importar la app, porque los limitadores se crean al cargar
 * los módulos de rutas. Cada caso sale por su propia IP (X-Forwarded-For con
 * TRUST_PROXY_HOPS=1), así no comparten buckets.
 */

const LIMITS = { RATE_LIMIT_MAX: 5, CLOCK_IP_RATE_LIMIT_MAX: 40, CLOCK_AUTH_FAILURE_RATE_LIMIT_MAX: 3, TRUST_PROXY_HOPS: 1 };

vi.mock("../time-entries/timeEntries.service", async (importOriginal) => {
  const original = await importOriginal<typeof import("../time-entries/timeEntries.service")>();
  return {
    ...original,
    timeEntriesService: {
      ...original.timeEntriesService,
      clockSearch: vi.fn(),
      clockStatusByEmployee: vi.fn(),
      clockPhotoPunchIdempotent: vi.fn(),
      clockPunchAttemptStatus: vi.fn(),
    },
  };
});

vi.mock("../clock-devices/clockDevices.service", async (importOriginal) => {
  const original = await importOriginal<typeof import("../clock-devices/clockDevices.service")>();
  return { ...original, clockDevicesService: { ...original.clockDevicesService, heartbeat: vi.fn(), status: vi.fn() } };
});

vi.mock("../clock-devices/clockDevices.repository", () => ({
  clockDevicesRepository: { findCredentialById: vi.fn(), touchIfStale: vi.fn() },
}));

type Status = "ACTIVE" | "REVOKED";
type FakeDevice = { id: string; secret: string; status: Status };
const device = (id: string, status: Status): FakeDevice => ({ id, secret: generateClockDeviceSecret(), status });
const ACTIVE = device("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "ACTIVE");
const NEIGHBOUR = device("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "ACTIVE");
const MISCONFIGURED = device("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "ACTIVE");
const REVOKED = device("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "REVOKED");
const FRESH = device("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "ACTIVE");
const OFFICE = device("abababab-abab-4bab-8bab-abababababab", "ACTIVE");
const DEVICES = [ACTIVE, NEIGHBOUR, MISCONFIGURED, REVOKED, FRESH, OFFICE];
const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";
const EMPLOYEE_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";

const credential = (entry: FakeDevice) => `ClockDevice ${entry.id}.${entry.secret}`;
const wrongSecret = (entry: FakeDevice) => `ClockDevice ${entry.id}.${generateClockDeviceSecret()}`;

const validPunch = {
  requestId: REQUEST_ID,
  employeeId: EMPLOYEE_ID,
  punchType: "IN",
  photo: `data:image/jpeg;base64,${"A".repeat(400)}`,
  faceValidationStatus: "VALID",
};

/** Las seis rutas exentas del global, con la respuesta esperada de un ACTIVE. */
const EXEMPT_ROUTES = [
  { method: "GET", path: "/clock/employees?search=ana", ok: 200 },
  { method: "POST", path: "/clock/status", body: { employeeId: EMPLOYEE_ID }, ok: 200 },
  { method: "POST", path: "/clock/photo-punch", body: validPunch, ok: 201 },
  { method: "GET", path: `/clock/attempts/${REQUEST_ID}?employeeId=${EMPLOYEE_ID}`, ok: 200 },
  { method: "POST", path: "/clock/heartbeat", ok: 200 },
  { method: "GET", path: "/clock/device/status", ok: 200 },
] as const;

let server: Server;
let baseUrl: string;
let isExemptFromGlobalRateLimit: typeof import("./clockRateLimits").isExemptFromGlobalRateLimit;
let mocks: {
  repository: typeof import("../clock-devices/clockDevices.repository").clockDevicesRepository;
  timeEntries: typeof import("../time-entries/timeEntries.service").timeEntriesService;
  devices: typeof import("../clock-devices/clockDevices.service").clockDevicesService;
};

beforeAll(async () => {
  const { env } = await import("../../config/env");
  Object.assign(env, LIMITS);
  const { createApp } = await import("../../app");
  ({ isExemptFromGlobalRateLimit } = await import("./clockRateLimits"));
  mocks = {
    repository: (await import("../clock-devices/clockDevices.repository")).clockDevicesRepository,
    timeEntries: (await import("../time-entries/timeEntries.service")).timeEntriesService,
    devices: (await import("../clock-devices/clockDevices.service")).clockDevicesService,
  };
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.mocked(mocks.repository.findCredentialById).mockImplementation(((id: string) => {
    const found = DEVICES.find((entry) => entry.id === id);
    return Promise.resolve(found ? { id: found.id, tokenHash: hashClockDeviceSecret(found.secret), status: found.status, name: "Kiosco", lastSeenAt: new Date() } : null);
  }) as never);
  vi.mocked(mocks.repository.touchIfStale).mockResolvedValue({ count: 1 });
  vi.mocked(mocks.timeEntries.clockSearch).mockResolvedValue([]);
  vi.mocked(mocks.timeEntries.clockStatusByEmployee).mockResolvedValue({ employee: { id: EMPLOYEE_ID }, openShift: null } as never);
  vi.mocked(mocks.timeEntries.clockPhotoPunchIdempotent).mockResolvedValue({ workShift: { id: "shift-1" } } as never);
  vi.mocked(mocks.timeEntries.clockPunchAttemptStatus).mockResolvedValue({ requestId: REQUEST_ID, status: "COMPLETED" } as never);
  vi.mocked(mocks.devices.heartbeat).mockResolvedValue({ device: { id: ACTIVE.id }, serverTime: new Date().toISOString() } as never);
  vi.mocked(mocks.devices.status).mockResolvedValue({ status: "ACTIVE" } as never);
});

async function call(ip: string, method: string, path: string, options: { authorization?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": ip };
  if (options.authorization) headers.authorization = options.authorization;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const text = await response.text();
  const payload = response.headers.get("content-type")?.includes("application/json") && text ? (JSON.parse(text) as { error?: { code?: string; retryAfterSeconds?: number } }) : null;
  return { status: response.status, code: payload?.error?.code, retryAfterSeconds: payload?.error?.retryAfterSeconds, rateLimit: response.headers.get("ratelimit-limit") };
}

describe("§33 — exención del limitador global: sólo rutas exactas", () => {
  it.each([
    ["GET", "/api/clock/employees"],
    ["POST", "/api/clock/status"],
    ["POST", "/api/clock/photo-punch"],
    ["GET", "/api/clock/attempts/22222222-2222-4222-8222-222222222222"],
    ["POST", "/api/clock/heartbeat"],
    ["GET", "/api/clock/device/status"],
  ])("%s %s queda fuera del global", (method, path) => {
    expect(isExemptFromGlobalRateLimit({ method, path }, "/api")).toBe(true);
  });

  it.each([
    ["HEAD", "/api/clock/employees"],
    ["POST", "/api/clock/employees"],
    ["GET", "/api/clock/employees/"],
    ["GET", "/api/CLOCK/employees"],
    ["GET", "/api/clock/attempts/a/b"],
    ["GET", "/api/clock/attempts/"],
    ["POST", "/api/clock/maintenance/session"],
    ["GET", "/api/clock/maintenance/session"],
    ["POST", "/api/clock/device/register"],
    ["POST", "/api/clock/device/pairing-code/refresh"],
    ["POST", "/api/clock/in"],
    ["GET", "/api/clock-devices"],
    ["GET", "/api/employees"],
    ["GET", "/apix/clock/employees"],
    ["GET", "/clock/employees"],
  ])("%s %s sigue contando en el global", (method, path) => {
    expect(isExemptFromGlobalRateLimit({ method, path }, "/api")).toBe(false);
  });
});

describe("§33 — limitador global sobre la app real", () => {
  it("las rutas exentas no gastan el cupo global y cada una tiene sus capas propias (tope por IP, credenciales y autenticación)", async () => {
    const ip = "198.51.100.1";
    // 2 por ruta = 12 requests, más que RATE_LIMIT_MAX (5): ninguna es 429.
    for (let round = 0; round < 2; round += 1) {
      for (const route of EXEMPT_ROUTES) {
        expect((await call(ip, route.method, route.path, { authorization: credential(ACTIVE), body: "body" in route ? route.body : undefined })).status).toBe(route.ok);
      }
    }
    // Una credencial bien formada pero rechazada pasa por el tope por IP (su
    // header es el último que la contó) y la autenticación responde 401.
    for (const route of EXEMPT_ROUTES) {
      const rejected = await call(ip, route.method, route.path, { authorization: wrongSecret(NEIGHBOUR), body: "body" in route ? route.body : undefined });
      expect(rejected).toMatchObject({ status: 401, code: "CLOCK_DEVICE_INVALID_CREDENTIAL", rateLimit: String(LIMITS.CLOCK_IP_RATE_LIMIT_MAX) });
    }
    // La misma IP todavía tiene intacto el cupo global para lo demás.
    for (let index = 0; index < LIMITS.RATE_LIMIT_MAX; index += 1) {
      expect((await call(ip, "POST", "/clock/in")).status).toBe(404);
    }
    expect((await call(ip, "POST", "/clock/in")).status).toBe(429);
  });

  it("rutas administrativas, desconocidas o variantes de las exentas siguen contando en el global", async () => {
    const ip = "198.51.100.2";
    await call(ip, "GET", "/employees");
    await call(ip, "GET", "/clock/unknown");
    await call(ip, "HEAD", "/clock/employees?search=ana", { authorization: credential(ACTIVE) });
    await call(ip, "GET", "/clock/employees/?search=ana", { authorization: credential(ACTIVE) });
    await call(ip, "GET", "/clock/maintenance/session", { authorization: credential(ACTIVE) });
    expect((await call(ip, "GET", "/employees")).status).toBe(429);
  });
});

describe("§33 — credenciales rechazadas: un equipo mal configurado no bloquea a sus vecinos", () => {
  it("bloquea sólo esa credencial; el equipo legítimo y otras credenciales de la misma IP siguen operando", async () => {
    const ip = "198.51.100.3";
    const misconfigured = wrongSecret(MISCONFIGURED);
    for (let index = 0; index < LIMITS.CLOCK_AUTH_FAILURE_RATE_LIMIT_MAX; index += 1) {
      expect((await call(ip, "POST", "/clock/heartbeat", { authorization: misconfigured })).status).toBe(401);
    }
    const blocked = await call(ip, "POST", "/clock/heartbeat", { authorization: misconfigured });
    expect(blocked).toMatchObject({ status: 429, code: "CLOCK_AUTH_RATE_LIMITED" });
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    const lookups = vi.mocked(mocks.repository.findCredentialById).mock.calls.length;
    // Bloqueado antes de autenticar: no vuelve a consultar la base.
    expect((await call(ip, "GET", "/clock/employees?search=ana", { authorization: misconfigured })).status).toBe(429);
    expect(vi.mocked(mocks.repository.findCredentialById).mock.calls.length).toBe(lookups);

    expect((await call(ip, "GET", "/clock/employees?search=ana", { authorization: credential(ACTIVE) })).status).toBe(200);
    expect((await call(ip, "POST", "/clock/status", { authorization: credential(MISCONFIGURED), body: { employeeId: EMPLOYEE_ID } })).status).toBe(200);
    expect((await call(ip, "GET", "/clock/employees?search=ana", { authorization: wrongSecret(NEIGHBOUR) })).status).toBe(401);
  });

  it("un 403 (revocado) o un header mal formado no cuentan como credencial rechazada", async () => {
    const ip = "198.51.100.4";
    for (let index = 0; index < LIMITS.CLOCK_AUTH_FAILURE_RATE_LIMIT_MAX + 2; index += 1) {
      expect(await call(ip, "POST", "/clock/status", { authorization: credential(REVOKED), body: { employeeId: EMPLOYEE_ID } })).toMatchObject({ status: 403, code: "CLOCK_DEVICE_REVOKED" });
      expect(await call(ip, "POST", "/clock/status", { authorization: "ClockDevice no-es-una-credencial", body: { employeeId: EMPLOYEE_ID } })).toMatchObject({ status: 401, code: "CLOCK_DEVICE_INVALID_CREDENTIAL" });
    }
  });
});

describe("§33 — tope por IP: sólo el tráfico sin credencial verificada", () => {
  it("muchas requests legítimas detrás de una IP no lo agotan; una inundación sin credencial sí, sin bloquear a los equipos ya verificados", async () => {
    const ip = "198.51.100.5";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // 50 requests legítimas (más que el tope de 40): sólo la primera, todavía
      // sin verificar, cuenta.
      for (let index = 0; index < 50; index += 1) {
        expect((await call(ip, "POST", "/clock/status", { authorization: credential(OFFICE), body: { employeeId: EMPLOYEE_ID } })).status).toBe(200);
      }
      const flood: Record<number, number> = {};
      for (let index = 0; index < LIMITS.CLOCK_IP_RATE_LIMIT_MAX + 5; index += 1) {
        const result = await call(ip, "GET", "/clock/employees?search=ana", { authorization: "ClockDevice invalida" });
        flood[result.status] = (flood[result.status] ?? 0) + 1;
      }
      expect(flood).toEqual({ 401: LIMITS.CLOCK_IP_RATE_LIMIT_MAX - 1, 429: 6 });
      const blocked = await call(ip, "GET", "/clock/employees?search=ana");
      expect(blocked).toMatchObject({ status: 429, code: "CLOCK_NETWORK_RATE_LIMITED" });
      // El equipo verificado de esa red sigue operando.
      expect((await call(ip, "GET", "/clock/employees?search=ana", { authorization: credential(OFFICE) })).status).toBe(200);
      // Un equipo todavía no verificado (p. ej. tras un reinicio del backend)
      // sí queda bajo el tope de esa red hasta que verifique desde otra.
      expect((await call(ip, "POST", "/clock/heartbeat", { authorization: credential(FRESH) })).status).toBe(429);
      expect((await call("198.51.100.6", "POST", "/clock/heartbeat", { authorization: credential(FRESH) })).status).toBe(200);
      expect((await call(ip, "POST", "/clock/heartbeat", { authorization: credential(FRESH) })).status).toBe(200);

      const logs = warn.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("RATE_LIMITED"));
      expect(logs).toHaveLength(1);
      expect(JSON.parse(logs[0]!)).toMatchObject({ event: "RATE_LIMITED", code: "CLOCK_NETWORK_RATE_LIMITED", ip: "198.51.100.5", route: "/api/clock/employees" });
      expect(logs[0]).not.toMatch(/search|ana/);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("§33 — regresión: requests simultáneas de un equipo legítimo", () => {
  it("25 requests en paralelo de una credencial válida nunca son 429 (el cupo de credenciales sólo suma rechazos)", async () => {
    const results = await Promise.all(Array.from({ length: 25 }, (_, index) => (index % 2 === 0
      ? call("198.51.100.7", "POST", "/clock/status", { authorization: credential(NEIGHBOUR), body: { employeeId: EMPLOYEE_ID } })
      : call("198.51.100.7", "GET", "/clock/employees?search=ana", { authorization: credential(NEIGHBOUR) }))));
    expect(results.map((result) => result.status)).toEqual(Array(25).fill(200));
  });
});
