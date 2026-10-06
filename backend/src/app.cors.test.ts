import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { env } from "./config/env";

/**
 * F2 del fichador standalone (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md
 * §20): admin y fichador son dos sitios con origins distintos que consumen el
 * mismo backend. CORS_ORIGIN es una lista explícita; este test fija que el
 * preflight del fichador (POST con el header propio x-clock-device-token)
 * pasa para su origin y que nada fuera de la lista recibe permiso — ni por
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
      "access-control-request-headers": "content-type,x-clock-device-token",
    },
  });
}

describe("CORS para dos sitios independientes (admin + fichador)", () => {
  it("el preflight del fichador permite su origin, POST, Content-Type y x-clock-device-token", async () => {
    const response = await preflight(FICHADOR);

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(FICHADOR);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")?.split(",")).toEqual(
      expect.arrayContaining(["content-type", "x-clock-device-token"]),
    );
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
