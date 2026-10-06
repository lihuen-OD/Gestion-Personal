import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { env } from "./config/env";

/**
 * F2 del fichador standalone (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md
 * §20): admin y fichador son dos sitios con origins distintos que consumen el
 * mismo backend. CORS_ORIGIN es una lista explícita; este test fija que el
 * preflight del fichador (POST con `Authorization: ClockDevice …`, F6) pasa
 * para su origin y que nada fuera de la lista recibe permiso — ni por
 * comodín ni por sufijo.
 */
const ADMIN = "https://gestion-test.example.com";
const FICHADOR = "https://fichador-test.example.com";

type MutableEnv = { CORS_ORIGIN: string };
const originalCors = env.CORS_ORIGIN;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  (env as MutableEnv).CORS_ORIGIN = `http://localhost:5174,http://localhost:5175,${ADMIN},${FICHADOR}/,*`;
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}${env.API_PREFIX}`;
});

afterAll(async () => {
  (env as MutableEnv).CORS_ORIGIN = originalCors;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function preflight(origin: string, path = "/time-entries/clock/photo-punch") {
  return fetch(`${baseUrl}${path}`, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization, content-type",
    },
  });
}

describe("CORS para dos sitios independientes (admin + fichador)", () => {
  it("el preflight de OPTIONS /clock/photo-punch permite su origin, POST, Authorization y Content-Type", async () => {
    const response = await preflight(FICHADOR);

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(FICHADOR);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")?.split(",").map((header) => header.trim().toLowerCase())).toEqual(
      expect.arrayContaining(["authorization", "content-type"]),
    );
  });

  it("el preflight de las demás rutas del fichador (GET con Authorization) también pasa", async () => {
    for (const path of ["/time-entries/clock/employees", "/time-entries/clock/attempts/22222222-2222-4222-8222-222222222222", "/clock/device/status"]) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "OPTIONS",
        headers: { origin: FICHADOR, "access-control-request-method": "GET", "access-control-request-headers": "authorization, x-clock-app-version" },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe(FICHADOR);
    }
  });

  it("el origin del admin y los locales (5174/5175) siguen permitidos", async () => {
    for (const origin of [ADMIN, "http://localhost:5174", "http://localhost:5175"]) {
      expect((await preflight(origin, "/auth/login")).headers.get("access-control-allow-origin")).toBe(origin);
    }
  });

  it.each([
    "https://evil.example.com",
    "https://fichador-test.example.com.evil.com",
    "https://otro.fichador-test.example.com",
    "http://fichador-test.example.com",
  ])("%s no recibe Access-Control-Allow-Origin (ni comodín ni sufijo ni otro esquema)", async (origin) => {
    const response = await preflight(origin);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("credentials sigue en true (lo usa la configuración global; el fichador no manda cookies)", async () => {
    expect((await preflight(FICHADOR)).headers.get("access-control-allow-credentials")).toBe("true");
  });
});
