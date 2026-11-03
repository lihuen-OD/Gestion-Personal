import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app";
import { env } from "../../config/env";
import { generateClockDeviceSecret, hashClockDeviceSecret } from "../../shared/security/clockDeviceCredentials";
import { auditService } from "../audit/audit.service";
import { clockDeviceMaintenanceService } from "./clockDeviceMaintenance.service";
import { clockDevicesRepository } from "./clockDevices.repository";

/**
 * Acceso de mantenimiento (docs/decisions/FICHADOR_MAINTENANCE_MODE.md) sobre
 * la app real: limitadores, requireClockDevice, validación, controller y
 * servicio reales. El repositorio es un doble en memoria con la semántica de
 * los UPDATE condicionados (hash + vencimiento + intentos + ACTIVE); nada toca
 * una base. Contra PostgreSQL: clockDeviceMaintenance.integration.test.ts.
 */

type Status = "PENDING" | "ACTIVE" | "REVOKED";
type FakeDevice = { id: string; secret: string; status: Status; name: string };
type Row = { codeHash: string | null; codeExpiresAt: Date | null; failed: number; sessionHash: string | null; sessionExpiresAt: Date | null };

const device = (id: string, status: Status, name: string): FakeDevice => ({ id, secret: generateClockDeviceSecret(), status, name });
const REVOKED = device("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "REVOKED", "Viejo");
const OTHER = device("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "ACTIVE", "Otro");
const DEVICES: FakeDevice[] = [REVOKED, OTHER];
const rows = new Map<string, Row>();
const row = (id: string) => rows.get(id)!;
const empty = (): Row => ({ codeHash: null, codeExpiresAt: null, failed: 0, sessionHash: null, sessionExpiresAt: null });
const credential = (entry: FakeDevice) => `ClockDevice ${entry.id}.${entry.secret}`;
const diagnosticsOf = (entry: FakeDevice) => ({ name: entry.name, status: entry.status, activatedAt: new Date("2026-10-20T12:00:00Z"), lastSeenAt: new Date(), lastAppVersion: "1.4.0", establishment: { name: "Planta Norte", zone: { name: "Zona Centro" } } });
const live = (entry: FakeDevice) => entry.status === "ACTIVE";
/**
 * Los limitadores son de módulo y su cupo persiste entre tests (como en
 * producción): cada caso usa sus propios dispositivos para no heredarlo.
 */
function fresh(name: string) {
  const created = device(randomUUID(), "ACTIVE", name);
  DEVICES.push(created);
  rows.set(created.id, empty());
  return created;
}

vi.mock("./clockDevices.repository", () => ({
  clockDevicesRepository: {
    findCredentialById: vi.fn(), touchIfStale: vi.fn(), findSafeById: vi.fn(), setMaintenanceCode: vi.fn(), consumeMaintenanceCode: vi.fn(),
    registerFailedMaintenanceCode: vi.fn(), findMaintenanceSession: vi.fn(), findMaintenanceDiagnostics: vi.fn(), endMaintenanceSession: vi.fn(),
  },
}));
// El errorHandler audita los 403: sin este mock escribiría en la base del .env.
vi.mock("../audit/audit.service", () => ({ auditService: { register: vi.fn().mockResolvedValue(null) } }));

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
  rows.clear();
  for (const entry of DEVICES) rows.set(entry.id, empty());
  const repo = vi.mocked(clockDevicesRepository);
  repo.findCredentialById.mockImplementation(((id: string) => {
    const found = DEVICES.find((entry) => entry.id === id);
    return Promise.resolve(found ? { id: found.id, tokenHash: hashClockDeviceSecret(found.secret), status: found.status, name: found.name, lastSeenAt: new Date() } : null);
  }) as never);
  repo.findSafeById.mockImplementation(((id: string) => {
    const found = DEVICES.find((entry) => entry.id === id);
    return Promise.resolve(found ? { id: found.id, name: found.name, status: found.status } : null);
  }) as never);
  repo.setMaintenanceCode.mockImplementation(async (id, hash, expiresAt) => {
    if (!live(DEVICES.find((entry) => entry.id === id)!)) return false;
    Object.assign(row(id), { codeHash: hash, codeExpiresAt: expiresAt, failed: 0 });
    return true;
  });
  repo.consumeMaintenanceCode.mockImplementation(async (id, codeHash, session, now, max) => {
    const current = row(id);
    const ok = live(DEVICES.find((entry) => entry.id === id)!) && current.codeHash === codeHash && current.codeExpiresAt! > now && current.failed < max;
    if (ok) Object.assign(current, { codeHash: null, codeExpiresAt: null, failed: 0, sessionHash: session.hash, sessionExpiresAt: session.expiresAt });
    return ok;
  });
  repo.registerFailedMaintenanceCode.mockImplementation(async (id, now, max) => {
    const current = row(id);
    if (!current.codeHash || current.codeExpiresAt! <= now) return null;
    current.failed += 1;
    const burned = current.failed >= max;
    if (burned) Object.assign(current, { codeHash: null, codeExpiresAt: null, failed: 0 });
    return { failedAttempts: burned ? max : current.failed, burned };
  });
  repo.findMaintenanceSession.mockImplementation((async (id: string, hash: string, now: Date) => {
    const current = row(id);
    const entry = DEVICES.find((item) => item.id === id)!;
    return live(entry) && current.sessionHash === hash && current.sessionExpiresAt! > now ? { ...diagnosticsOf(entry), maintenanceSessionExpiresAt: current.sessionExpiresAt } : null;
  }) as never);
  repo.findMaintenanceDiagnostics.mockImplementation((async (id: string) => diagnosticsOf(DEVICES.find((entry) => entry.id === id)!)) as never);
  repo.endMaintenanceSession.mockImplementation(async (id, hash) => {
    if (row(id).sessionHash === hash) Object.assign(row(id), { sessionHash: null, sessionExpiresAt: null });
  });
});

// Dispositivos nuevos por test (ver fresh()).
let A: FakeDevice;
let B: FakeDevice;
beforeEach(() => {
  A = fresh("Pañol 01");
  B = fresh("Recepción");
});

async function call(method: string, path: string, options: { authorization?: string; body?: unknown; session?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.authorization) headers.authorization = options.authorization;
  if (options.session !== undefined) headers["x-clock-maintenance-session"] = options.session;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const text = await response.text();
  // El 429 de express-rate-limit es texto plano.
  const payload = (response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : null) as { data?: Record<string, any>; error?: { code?: string; message?: string } } | null;
  return { status: response.status, data: payload?.data, error: payload?.error, raw: text, cacheControl: response.headers.get("cache-control") };
}

const open = (entry: FakeDevice, code: string) => call("POST", "/clock/maintenance/session", { authorization: credential(entry), body: { code } });
const issue = async (entry: FakeDevice) => (await clockDeviceMaintenanceService.issueCode(entry.id)).code;
const wrongCodeFor = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

describe("POST /api/clock/maintenance/session — canje del código", () => {
  it("código válido → 201 con token de sesión, 10 min y diagnóstico sin ids; no-store; el código no se puede volver a usar", async () => {
    const code = await issue(A);
    const opened = await open(A, code);

    expect(opened.status).toBe(201);
    expect(opened.cacheControl).toBe("no-store");
    expect(opened.data!.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(opened.data!.expiresInSeconds).toBe(600);
    expect(opened.data!.device).toMatchObject({ name: "Pañol 01", status: "ACTIVE", connectivity: "ONLINE", establishment: { name: "Planta Norte" } });
    expect(opened.raw).not.toMatch(/"id"|tokenHash|maintenanceCodeHash|maintenanceSessionHash|lastIp|lastUserAgent/);
    // Sólo hashes en la "fila".
    expect(row(A.id).sessionHash).toBe(hashClockDeviceSecret(opened.data!.token));
    expect(JSON.stringify([...rows.values()])).not.toContain(code);

    const reused = await open(A, code);
    expect(reused).toMatchObject({ status: 401, error: { code: "CLOCK_MAINTENANCE_CODE_INVALID", message: "El código no es válido o ya venció." } });
  });

  it("código incorrecto, vencido o de OTRO dispositivo → exactamente la misma respuesta 401", async () => {
    const codeA = await issue(A);
    const wrong = await open(A, wrongCodeFor(codeA));
    const fromOther = await open(B, codeA);
    row(A.id).codeExpiresAt = new Date(Date.now() - 1_000);
    const expired = await open(A, codeA);
    const never = await open(fresh("Sin código"), "123456");

    for (const result of [wrong, fromOther, expired, never]) {
      expect(result.status).toBe(401);
      expect(result.error).toEqual(wrong.error);
    }
    expect(wrong.error).toMatchObject({ code: "CLOCK_MAINTENANCE_CODE_INVALID", message: "El código no es válido o ya venció." });
  });

  it("el código de A probado en B no lo consume ni lo anula: después A lo usa", async () => {
    const codeA = await issue(A);
    expect((await open(B, codeA)).status).toBe(401);
    expect((await open(A, codeA)).status).toBe(201);
  });

  it("generar un código nuevo invalida el anterior", async () => {
    const first = await issue(A);
    let second = await issue(A);
    while (second === first) second = await issue(A);
    expect((await open(A, first)).status).toBe(401);
    expect((await open(A, second)).status).toBe(201);
  });

  it("5 intentos fallidos anulan el código: el correcto ya no entra", async () => {
    const code = await issue(A);
    for (let attempt = 0; attempt < 5; attempt += 1) expect((await open(A, wrongCodeFor(code))).status).toBe(401);
    expect((await open(A, code)).status).toBe(401);
    expect(vi.mocked(auditService.register).mock.calls.at(-1)?.[0]).toMatchObject({ action: "REJECT", description: expect.stringContaining("quedó anulado por exceso de intentos") });
  });

  it.each([
    ["5 dígitos", { code: "12345" }],
    ["letras", { code: "12ab56" }],
    ["campo extra", { code: "123456", deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
    ["sin código", {}],
  ])("body inválido (%s) → 400 VALIDATION_ERROR sin tocar el código", async (_label, body) => {
    const result = await call("POST", "/clock/maintenance/session", { authorization: credential(A), body });
    expect(result).toMatchObject({ status: 400, error: { code: "VALIDATION_ERROR" } });
    expect(clockDevicesRepository.consumeMaintenanceCode).not.toHaveBeenCalled();
  });
});

describe("GET / DELETE /api/clock/maintenance/session — sesión", () => {
  async function session(entry: FakeDevice) {
    return (await open(entry, await issue(entry))).data!.token as string;
  }

  it("con el token vigente → diagnóstico y segundos restantes; sin token o con otro → 401 CLOCK_MAINTENANCE_SESSION_INVALID", async () => {
    const token = await session(A);
    const current = await call("GET", "/clock/maintenance/session", { authorization: credential(A), session: token });
    expect(current.status).toBe(200);
    expect(current.cacheControl).toBe("no-store");
    expect(current.data).toMatchObject({ expiresInSeconds: expect.any(Number), device: { name: "Pañol 01", connectivity: "ONLINE" }, serverTime: expect.any(String) });
    expect(current.data!.expiresInSeconds).toBeGreaterThan(590);

    expect(await call("GET", "/clock/maintenance/session", { authorization: credential(A) })).toMatchObject({ status: 401, error: { code: "CLOCK_MAINTENANCE_SESSION_INVALID" } });
    expect(await call("GET", "/clock/maintenance/session", { authorization: credential(A), session: "x".repeat(43) })).toMatchObject({ status: 401, error: { code: "CLOCK_MAINTENANCE_SESSION_INVALID" } });
    // El token de A no abre la sesión de B.
    expect(await call("GET", "/clock/maintenance/session", { authorization: credential(B), session: token })).toMatchObject({ status: 401, error: { code: "CLOCK_MAINTENANCE_SESSION_INVALID" } });
  });

  it("la sesión vence sola", async () => {
    const token = await session(A);
    row(A.id).sessionExpiresAt = new Date(Date.now() - 1);
    expect(await call("GET", "/clock/maintenance/session", { authorization: credential(A), session: token })).toMatchObject({ status: 401, error: { code: "CLOCK_MAINTENANCE_SESSION_INVALID" } });
  });

  it("salida manual → 204 y la sesión deja de valer; repetirla también responde 204", async () => {
    const token = await session(A);
    expect((await call("DELETE", "/clock/maintenance/session", { authorization: credential(A), session: token })).status).toBe(204);
    expect((await call("GET", "/clock/maintenance/session", { authorization: credential(A), session: token })).status).toBe(401);
    expect((await call("DELETE", "/clock/maintenance/session", { authorization: credential(A), session: token })).status).toBe(204);
  });

  it("RRHH revoca el equipo durante el mantenimiento: la sesión deja de servir (403 CLOCK_DEVICE_REVOKED)", async () => {
    const token = await session(A);
    A.status = "REVOKED";
    expect(await call("GET", "/clock/maintenance/session", { authorization: credential(A), session: token })).toMatchObject({ status: 403, error: { code: "CLOCK_DEVICE_REVOKED" } });
    expect(clockDevicesRepository.findMaintenanceSession).not.toHaveBeenCalled();
  });
});

describe("Mantenimiento — autenticación y aislamiento", () => {
  it.each([
    ["POST", "/clock/maintenance/session"],
    ["GET", "/clock/maintenance/session"],
    ["DELETE", "/clock/maintenance/session"],
  ])("un dispositivo REVOKED no entra: %s %s → 403 sin tocar el estado de mantenimiento", async (method, path) => {
    const result = await call(method, path, { authorization: credential(REVOKED), body: method === "POST" ? { code: "123456" } : undefined, session: "t".repeat(43) });
    expect(result).toMatchObject({ status: 403, error: { code: "CLOCK_DEVICE_REVOKED" } });
    expect(clockDevicesRepository.consumeMaintenanceCode).not.toHaveBeenCalled();
    expect(clockDevicesRepository.findMaintenanceSession).not.toHaveBeenCalled();
    expect(clockDevicesRepository.endMaintenanceSession).not.toHaveBeenCalled();
  });

  it.each([
    ["sin credencial", undefined],
    ["secreto incorrecto", `ClockDevice ${OTHER.id}.${REVOKED.secret}`],
    ["Bearer de usuario", "Bearer eyJhbGciOiJIUzI1NiJ9.e30.signature"],
  ])("%s → 401 CLOCK_DEVICE_INVALID_CREDENTIAL", async (_label, authorization) => {
    expect(await call("POST", "/clock/maintenance/session", { authorization, body: { code: "123456" } })).toMatchObject({ status: 401, error: { code: "CLOCK_DEVICE_INVALID_CREDENTIAL" } });
  });

  it("la credencial del dispositivo no genera códigos: la ruta RRHH exige JWT", async () => {
    const result = await call("POST", `/clock-devices/${A.id}/maintenance-code`, { authorization: credential(A) });
    expect(result.status).toBe(401);
    expect(clockDevicesRepository.setMaintenanceCode).not.toHaveBeenCalled();
  });

  it("no existe bajo /time-entries/clock (alias legacy retirado)", async () => {
    expect((await call("POST", "/time-entries/clock/maintenance/session", { authorization: credential(A), body: { code: "123456" } })).status).toBe(404);
  });
});

describe("Mantenimiento — cupo propio para validar códigos", () => {
  it("10 cada 15 minutos por dispositivo; el 11.º → 429. Otro dispositivo y la lectura de sesión tienen su propio cupo", async () => {
    const quota = fresh("Cupo");
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await open(quota, "123456")).status).toBe(401);
    }
    const limited = await open(quota, "123456");
    expect(limited.status).toBe(429);
    expect(clockDevicesRepository.consumeMaintenanceCode).toHaveBeenCalledTimes(10);

    expect((await open(B, "123456")).status).toBe(401);
    expect((await call("GET", "/clock/maintenance/session", { authorization: credential(quota), session: "t".repeat(43) })).status).toBe(401);
  });
});
