import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type ErrorRequestHandler } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env";
import { CLOCK_DEVICE_TOKEN_HEADER } from "../../middlewares/clockDeviceAuth";
import { AppError } from "../../shared/errors/AppError";
import { timeEntriesRouter } from "./timeEntries.routes";
import { timeEntriesService } from "./timeEntries.service";

/**
 * F0 del fichador standalone (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md):
 * prueba a nivel HTTP (router real de Express, servicio mockeado) que las
 * rutas de fichada sin foto ya no existen — 404, con o sin el token de
 * kiosco — y que el namespace /clock queda cerrado: ninguna ruta /clock/*
 * desconocida cae en el requireAuth ni en las rutas paramétricas (/:id) del
 * resto del router. También fija que las 4 rutas que usa el fichador actual
 * siguen registradas.
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

const TOKEN = "test-clock-device-token-0123456789";
const EMPLOYEE_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";

type MutableEnv = { CLOCK_DEVICE_TOKEN?: string };
const originalToken = env.CLOCK_DEVICE_TOKEN;
let server: Server;
let baseUrl: string;

const testErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const appError = error instanceof AppError ? error : new AppError("Unexpected server error", 500, "INTERNAL_ERROR");
  res.status(appError.statusCode).json({ error: { code: appError.code } });
};

beforeAll(async () => {
  (env as MutableEnv).CLOCK_DEVICE_TOKEN = TOKEN;
  const app = express();
  app.use(express.json());
  app.use("/api/time-entries", timeEntriesRouter);
  app.use(testErrorHandler);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/time-entries`;
});

afterAll(async () => {
  (env as MutableEnv).CLOCK_DEVICE_TOKEN = originalToken;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(timeEntriesService.clockSearch).mockResolvedValue([]);
  vi.mocked(timeEntriesService.clockStatusByEmployee).mockResolvedValue({ employee: { id: EMPLOYEE_ID }, openShift: null } as never);
  vi.mocked(timeEntriesService.clockPhotoPunchIdempotent).mockResolvedValue({ workShift: { id: "shift-1" } } as never);
  vi.mocked(timeEntriesService.clockPunchAttemptStatus).mockResolvedValue({ requestId: REQUEST_ID, status: "COMPLETED" } as never);
});

async function call(method: string, path: string, options: { token?: string; bearer?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.token) headers[CLOCK_DEVICE_TOKEN_HEADER] = options.token;
  if (options.bearer) headers.authorization = `Bearer ${options.bearer}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
  return { status: response.status, code: payload?.error?.code };
}

describe("F0 — rutas de fichada sin foto retiradas", () => {
  const retired = [
    { path: "/clock/in", body: { employeeId: EMPLOYEE_ID } },
    { path: "/clock/out", body: { employeeId: EMPLOYEE_ID } },
    { path: "/clock/status-by-dni", body: { dni: "30123456" } },
    { path: "/clock/in-by-dni", body: { dni: "30123456" } },
    { path: "/clock/out-by-dni", body: { dni: "30123456" } },
  ];

  it.each(retired)("POST $path responde 404 aun con el token de kiosco válido", async ({ path, body }) => {
    const result = await call("POST", path, { token: TOKEN, body });
    expect(result).toEqual({ status: 404, code: "ROUTE_NOT_FOUND" });
  });

  it.each(retired)("POST $path responde 404 sin token (no 401/403: la ruta no existe)", async ({ path, body }) => {
    const result = await call("POST", path, { body });
    expect(result).toEqual({ status: 404, code: "ROUTE_NOT_FOUND" });
  });

  it("ninguna ruta retirada llega a ejecutar lógica de fichada", async () => {
    for (const { path, body } of retired) await call("POST", path, { token: TOKEN, body });
    expect(timeEntriesService.clockPhotoPunchIdempotent).not.toHaveBeenCalled();
    expect(timeEntriesService.clockStatusByEmployee).not.toHaveBeenCalled();
  });

  it("una ruta /clock/* desconocida responde 404 y nunca cae en requireAuth (ni con un Bearer cualquiera)", async () => {
    expect(await call("POST", "/clock/anything", { token: TOKEN, body: {} })).toEqual({ status: 404, code: "ROUTE_NOT_FOUND" });
    expect(await call("GET", "/clock", { token: TOKEN })).toEqual({ status: 404, code: "ROUTE_NOT_FOUND" });
    expect(await call("POST", "/clock/in", { bearer: "not-a-real-jwt", body: { employeeId: EMPLOYEE_ID } })).toEqual({ status: 404, code: "ROUTE_NOT_FOUND" });
  });
});

describe("F0 — rutas que el fichador actual sigue usando", () => {
  it("GET /clock/employees sigue registrada y exige el token", async () => {
    expect((await call("GET", "/clock/employees?search=ana", { token: TOKEN })).status).toBe(200);
    expect(await call("GET", "/clock/employees?search=ana")).toEqual({ status: 401, code: "CLOCK_DEVICE_UNAUTHORIZED" });
  });

  it("POST /clock/status sigue registrada y exige el token", async () => {
    expect((await call("POST", "/clock/status", { token: TOKEN, body: { employeeId: EMPLOYEE_ID } })).status).toBe(200);
    expect(await call("POST", "/clock/status", { body: { employeeId: EMPLOYEE_ID } })).toEqual({ status: 401, code: "CLOCK_DEVICE_UNAUTHORIZED" });
  });

  it("POST /clock/photo-punch sigue registrada, exige el token y valida el payload con foto", async () => {
    const valid = {
      requestId: REQUEST_ID,
      employeeId: EMPLOYEE_ID,
      punchType: "IN",
      photo: `data:image/jpeg;base64,${"A".repeat(400)}`,
      faceValidationStatus: "VALID",
    };
    expect((await call("POST", "/clock/photo-punch", { token: TOKEN, body: valid })).status).toBe(201);
    expect(await call("POST", "/clock/photo-punch", { body: valid })).toEqual({ status: 401, code: "CLOCK_DEVICE_UNAUTHORIZED" });
    const withoutPhoto = { ...valid, photo: undefined };
    expect((await call("POST", "/clock/photo-punch", { token: TOKEN, body: withoutPhoto })).status).toBe(400);
  });

  it("GET /clock/attempts/:requestId sigue registrada y exige el token", async () => {
    expect((await call("GET", `/clock/attempts/${REQUEST_ID}?employeeId=${EMPLOYEE_ID}`, { token: TOKEN })).status).toBe(200);
    expect(await call("GET", `/clock/attempts/${REQUEST_ID}?employeeId=${EMPLOYEE_ID}`)).toEqual({ status: 401, code: "CLOCK_DEVICE_UNAUTHORIZED" });
  });
});
