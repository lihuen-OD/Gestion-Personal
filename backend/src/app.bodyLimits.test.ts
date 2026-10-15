import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { env } from "./config/env";
import { authService } from "./modules/auth/auth.service";
import { clockDevicesRepository } from "./modules/clock-devices/clockDevices.repository";
import { employeesService } from "./modules/employees/employees.service";
import { timeEntriesService } from "./modules/time-entries/timeEntries.service";
import { CLOCK_PHOTO_PUNCH_BODY_LIMIT_BYTES, DEFAULT_JSON_BODY_LIMIT_BYTES, EMPLOYEE_DOCUMENT_BODY_LIMIT_BYTES } from "./shared/http/bodyLimits";
import { generateClockDeviceSecret, hashClockDeviceSecret } from "./shared/security/clockDeviceCredentials";

/**
 * F11 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §30) sobre la app real
 * (createApp): límites de body por ruta, parseo después de autenticar en las
 * dos rutas de body grande, guarda de Content-Length y errores de body como
 * 4xx, nunca 500. Servicios, repositorio de dispositivos y usuario mockeados:
 * nada toca una base. Los requests van por node:http para controlar
 * Content-Length y mandar bodies chunked (sin Content-Length).
 */

vi.mock("./modules/clock-devices/clockDevices.repository", () => ({
  clockDevicesRepository: { findCredentialById: vi.fn(), touchIfStale: vi.fn() },
}));
vi.mock("./modules/time-entries/timeEntries.service", async (importOriginal) => {
  const original = await importOriginal<typeof import("./modules/time-entries/timeEntries.service")>();
  return { ...original, timeEntriesService: { ...original.timeEntriesService, clockStatusByEmployee: vi.fn(), clockPhotoPunchIdempotent: vi.fn() } };
});
vi.mock("./modules/employees/employees.service", async (importOriginal) => {
  const original = await importOriginal<typeof import("./modules/employees/employees.service")>();
  return { ...original, employeesService: { ...original.employeesService, createDocument: vi.fn() } };
});
vi.mock("./modules/auth/auth.service", async (importOriginal) => {
  const original = await importOriginal<typeof import("./modules/auth/auth.service")>();
  return { ...original, authService: { ...original.authService, getCurrentUser: vi.fn() } };
});
// El errorHandler audita los 403: sin este mock escribiría en la base del .env.
vi.mock("./modules/audit/audit.service", () => ({ auditService: { register: vi.fn().mockResolvedValue(null) } }));

const DEVICE = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", secret: generateClockDeviceSecret() };
const DEVICE_AUTHORIZATION = `ClockDevice ${DEVICE.id}.${DEVICE.secret}`;
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EMPLOYEE_ID = "11111111-1111-4111-8111-111111111111";
const MIB = 1024 * 1024;

let server: Server;
let port: number;
let userAuthorization: string;

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  port = (server.address() as AddressInfo).port;
  userAuthorization = `Bearer ${jwt.sign({ sub: USER_ID, email: "rrhh@example.com", role: "NIVEL_1_RRHH" }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" })}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clockDevicesRepository.findCredentialById).mockResolvedValue({ id: DEVICE.id, tokenHash: hashClockDeviceSecret(DEVICE.secret), status: "ACTIVE", name: "Kiosco", lastSeenAt: new Date() } as never);
  vi.mocked(clockDevicesRepository.touchIfStale).mockResolvedValue({ count: 1 } as never);
  vi.mocked(timeEntriesService.clockStatusByEmployee).mockResolvedValue({ employee: { id: EMPLOYEE_ID }, openShift: null } as never);
  vi.mocked(timeEntriesService.clockPhotoPunchIdempotent).mockResolvedValue({ workShift: { id: "shift-1" } } as never);
  vi.mocked(employeesService.createDocument).mockResolvedValue({ id: EMPLOYEE_ID } as never);
  vi.mocked(authService.getCurrentUser).mockResolvedValue({ id: USER_ID, email: "rrhh@example.com", role: "NIVEL_1_RRHH", status: "ACTIVO" } as never);
});

type RawResponse = { status: number; code?: string; connection?: string };
type RawRequest = {
  method?: string;
  path: string;
  authorization?: string;
  /** Body completo, con su Content-Length. */
  body?: string;
  /** Body chunked, sin Content-Length: se manda por partes hasta `bytes` o hasta que llegue la respuesta. */
  chunked?: { prefix: string; bytes: number };
  /** Content-Length declarado sin mandar ese body (sólo una parte mínima). */
  declaredLength?: number;
};

// Una vez que el servidor respondió (p. ej. 413 y cierre), los errores de
// escritura del cliente (EPIPE/ECONNRESET) son esperables y no cuentan.
function rawRequest(options: RawRequest): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    let answered = false;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (options.authorization) headers.authorization = options.authorization;
    if (options.body !== undefined) headers["content-length"] = String(Buffer.byteLength(options.body));
    if (options.declaredLength !== undefined) headers["content-length"] = String(options.declaredLength);
    if (options.chunked) headers["transfer-encoding"] = "chunked";

    const req = http.request({ host: "127.0.0.1", port, method: options.method ?? "POST", path: `${env.API_PREFIX}${options.path}`, headers }, (res) => {
      answered = true;
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { data += chunk; });
      res.on("end", () => {
        let code: string | undefined;
        try { code = (JSON.parse(data) as { error?: { code?: string } }).error?.code; } catch { code = undefined; }
        resolve({ status: res.statusCode!, code, connection: res.headers.connection });
        req.destroy();
      });
    });
    req.on("error", (error) => { if (!answered) reject(error); });

    if (options.body !== undefined) {
      req.end(options.body);
    } else if (options.declaredLength !== undefined) {
      req.write("{");
      // Sin end(): el servidor tiene que responder sólo con el header.
    } else if (options.chunked) {
      const { prefix, bytes } = options.chunked;
      const piece = "A".repeat(256 * 1024);
      (async () => {
        req.write(prefix);
        for (let sent = 0; sent < bytes && !answered && !req.destroyed; sent += piece.length) {
          if (!req.write(piece)) await new Promise((done) => { req.once("drain", done); req.once("close", done); });
        }
        if (!answered && !req.destroyed) req.end('"}');
      })().catch(() => undefined);
    } else {
      req.end();
    }
  });
}

const photoPunch = (photoChars: number) => JSON.stringify({
  requestId: "22222222-2222-4222-8222-222222222222",
  employeeId: EMPLOYEE_ID,
  punchType: "IN",
  photo: `data:image/jpeg;base64,${"A".repeat(photoChars)}`,
  faceValidationStatus: "VALID",
});

const documentBody = (base64Chars: number) => JSON.stringify({
  categoryId: "33333333-3333-4333-8333-333333333333",
  fileName: "constancia.pdf",
  fileMimeType: "application/pdf",
  fileSizeBytes: Math.floor(base64Chars * 0.75),
  fileBase64: "A".repeat(base64Chars),
});

describe("F11 — body normal (1 MiB) en las rutas comunes", () => {
  it("un body chico funciona", async () => {
    const result = await rawRequest({ path: "/clock/status", authorization: DEVICE_AUTHORIZATION, body: JSON.stringify({ employeeId: EMPLOYEE_ID }) });
    expect(result.status).toBe(200);
  });

  it("JSON mal formado → 400 INVALID_JSON, no 500", async () => {
    expect(await rawRequest({ path: "/clock/status", authorization: DEVICE_AUTHORIZATION, body: '{"employeeId":' })).toMatchObject({ status: 400, code: "INVALID_JSON" });
    expect(await rawRequest({ path: "/auth/login", body: "{not json" })).toMatchObject({ status: 400, code: "INVALID_JSON" });
  });

  it("Content-Length por encima de 1 MiB → 413 sin leer el body, y cierra la conexión (también sin auth)", async () => {
    expect(await rawRequest({ path: "/auth/login", declaredLength: DEFAULT_JSON_BODY_LIMIT_BYTES + 1 })).toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE", connection: "close" });
    expect(await rawRequest({ path: "/clock/status", authorization: DEVICE_AUTHORIZATION, declaredLength: 40 * MIB })).toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
    expect(timeEntriesService.clockStatusByEmployee).not.toHaveBeenCalled();
  });

  it("chunked (sin Content-Length) por encima de 1 MiB → 413 del parser, no 500", async () => {
    expect(await rawRequest({ path: "/auth/login", chunked: { prefix: '{"email":"', bytes: 2 * MIB } })).toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
    expect(await rawRequest({ path: "/clock/status", authorization: DEVICE_AUTHORIZATION, chunked: { prefix: '{"employeeId":"', bytes: 2 * MIB } })).toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
  });

  it("una ruta que no es de documentos tampoco acepta un body grande aunque esté autenticado", async () => {
    expect(await rawRequest({ path: `/employees/${EMPLOYEE_ID}/field-history`, authorization: userAuthorization, chunked: { prefix: '{"x":"', bytes: 2 * MIB } })).toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
  });
});

describe("F11 — POST /api/clock/photo-punch: 6 MiB, parseado después del dispositivo", () => {
  it("una foto real (≈ 70 KB en base64) → 201", async () => {
    expect((await rawRequest({ path: "/clock/photo-punch", authorization: DEVICE_AUTHORIZATION, body: photoPunch(70_000) })).status).toBe(201);
    expect(timeEntriesService.clockPhotoPunchIdempotent).toHaveBeenCalledTimes(1);
  });

  it("el máximo que acepta el schema (foto de 4.500.000 caracteres, > 1 MiB) pasa el parser: el global no la corta", async () => {
    const body = photoPunch(4_500_000 - "data:image/jpeg;base64,".length);
    expect(Buffer.byteLength(body)).toBeGreaterThan(DEFAULT_JSON_BODY_LIMIT_BYTES);
    expect((await rawRequest({ path: "/clock/photo-punch", authorization: DEVICE_AUTHORIZATION, body })).status).toBe(201);
  });

  it("sin credencial, el body no se parsea: un JSON inválido de 2 MB recibe 401, no 400 ni 413", async () => {
    const invalidJson = `{${"A".repeat(2 * MIB)}`;
    expect(await rawRequest({ path: "/clock/photo-punch", body: invalidJson })).toMatchObject({ status: 401, code: "CLOCK_DEVICE_INVALID_CREDENTIAL" });
    expect(timeEntriesService.clockPhotoPunchIdempotent).not.toHaveBeenCalled();
  });

  it("con credencial, JSON mal formado → 400 INVALID_JSON", async () => {
    expect(await rawRequest({ path: "/clock/photo-punch", authorization: DEVICE_AUTHORIZATION, body: '{"photo":' })).toMatchObject({ status: 400, code: "INVALID_JSON" });
  });

  it("Content-Length por encima de 6 MiB → 413, con o sin credencial, sin llegar al servicio", async () => {
    expect(await rawRequest({ path: "/clock/photo-punch", authorization: DEVICE_AUTHORIZATION, declaredLength: CLOCK_PHOTO_PUNCH_BODY_LIMIT_BYTES + 1 })).toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
    expect(await rawRequest({ path: "/clock/photo-punch", declaredLength: 40 * MIB })).toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
    expect(timeEntriesService.clockPhotoPunchIdempotent).not.toHaveBeenCalled();
  });

  it("chunked por encima de 6 MiB con credencial → 413 del parser de la ruta", async () => {
    expect(await rawRequest({ path: "/clock/photo-punch", authorization: DEVICE_AUTHORIZATION, chunked: { prefix: '{"photo":"', bytes: 7 * MIB } })).toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
    expect(timeEntriesService.clockPhotoPunchIdempotent).not.toHaveBeenCalled();
  });

  it("chunked sin credencial → 401 (no se lee el body)", async () => {
    expect(await rawRequest({ path: "/clock/photo-punch", chunked: { prefix: '{"photo":"', bytes: 7 * MIB } })).toMatchObject({ status: 401, code: "CLOCK_DEVICE_INVALID_CREDENTIAL" });
  });
});

describe("F11 — POST /api/employees/:id/documents: 36 MiB, parseado después de auth y rol", () => {
  it("un documento de 2 MB (> 1 MiB) llega al servicio", async () => {
    expect((await rawRequest({ path: `/employees/${EMPLOYEE_ID}/documents`, authorization: userAuthorization, body: documentBody(2 * MIB) })).status).toBe(201);
    expect(employeesService.createDocument).toHaveBeenCalledTimes(1);
  });

  it("sin sesión, el body no se parsea: un JSON inválido de 2 MB recibe 401", async () => {
    expect(await rawRequest({ path: `/employees/${EMPLOYEE_ID}/documents`, body: `{${"A".repeat(2 * MIB)}` })).toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
  });

  it("Content-Length por encima de 36 MiB → 413", async () => {
    expect(await rawRequest({ path: `/employees/${EMPLOYEE_ID}/documents`, authorization: userAuthorization, declaredLength: EMPLOYEE_DOCUMENT_BODY_LIMIT_BYTES + 1 })).toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
    expect(employeesService.createDocument).not.toHaveBeenCalled();
  });
});
