import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { env } from "./config/env";
import { clockDevicesRepository } from "./modules/clock-devices/clockDevices.repository";
import { generateClockDeviceSecret, hashClockDeviceSecret } from "./shared/security/clockDeviceCredentials";
import { trustProxySetting } from "./shared/http/clientIp";
import { timeEntriesService } from "./modules/time-entries/timeEntries.service";

/**
 * F0 del fichador standalone (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md
 * §F0 / trust proxy). Prueba la app real (`createApp()`) con cadenas de
 * proxies SIMULADAS: el socket (127.0.0.1) cumple el papel del proxy más
 * cercano y X-Forwarded-For llega como "<cliente>, <proxy de borde>, <proxy
 * interno>". Los números de saltos usados acá (0, 1, 3, 4) son ilustrativos:
 * fijan cómo se comporta Express con cada valor, no cuál es el valor de
 * ningún entorno. El valor real se mide en el deploy del backend con
 * GET /api/health/client-ip antes de configurarlo.
 */

vi.mock("./modules/time-entries/timeEntries.service", async (importOriginal) => {
  const original = await importOriginal<typeof import("./modules/time-entries/timeEntries.service")>();
  return {
    ...original,
    timeEntriesService: {
      ...original.timeEntriesService,
      clockSearch: vi.fn(),
      clockPhotoPunchIdempotent: vi.fn(),
    },
  };
});

vi.mock("./modules/clock-devices/clockDevices.repository", () => ({
  clockDevicesRepository: { findCredentialById: vi.fn(), touchIfStale: vi.fn() },
}));

type MutableEnv = {
  TRUST_PROXY_HOPS: number;
  CLIENT_IP_DIAGNOSTICS_ENABLED: boolean;
  RATE_LIMIT_MAX: number;
};

// F6: el fichador se autentica con su propio ClockDevice ACTIVE.
const DEVICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE_SECRET = generateClockDeviceSecret();
const DEVICE_AUTHORIZATION = `ClockDevice ${DEVICE_ID}.${DEVICE_SECRET}`;
const CLIENT_A = "203.0.113.7";
const CLIENT_B = "198.51.100.23";
const EDGE_PROXY = "104.16.0.1";
const INTERNAL_PROXY = "10.0.0.5";
const original = {
  TRUST_PROXY_HOPS: env.TRUST_PROXY_HOPS,
  CLIENT_IP_DIAGNOSTICS_ENABLED: env.CLIENT_IP_DIAGNOSTICS_ENABLED,
  RATE_LIMIT_MAX: env.RATE_LIMIT_MAX,
};

let server: Server | undefined;

async function startApp(hops: number, options: { diagnostics?: boolean } = {}) {
  (env as MutableEnv).TRUST_PROXY_HOPS = hops;
  (env as MutableEnv).CLIENT_IP_DIAGNOSTICS_ENABLED = options.diagnostics ?? true;
  // El limitador global de la API no debe ser el que corte en estos tests:
  // así cualquier 429 sale del limitador propio de /clock/*.
  (env as MutableEnv).RATE_LIMIT_MAX = 100_000;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}${env.API_PREFIX}`;
}

/** Cadena simulada tal como la armaría una infraestructura de 3 proxies. */
function realChain(client: string) {
  return `${client}, ${EDGE_PROXY}, ${INTERNAL_PROXY}`;
}

async function seenIp(baseUrl: string, forwardedFor?: string) {
  const response = await fetch(`${baseUrl}/health/client-ip`, {
    headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: { ip: string } }).data.ip;
}

// Sin credencial: el límite por IP corre ANTES de autenticar, así que cada
// intento consume el cupo de la IP efectiva (401 mientras queda cupo, 429
// después). Es la capa que frena la fuerza bruta de credenciales.
async function searchAs(baseUrl: string, forwardedFor: string) {
  const response = await fetch(`${baseUrl}/time-entries/clock/employees?search=ana`, {
    headers: { "x-forwarded-for": forwardedFor },
  });
  return response.status;
}

beforeEach(() => {
  vi.mocked(clockDevicesRepository.findCredentialById).mockResolvedValue({
    id: DEVICE_ID, tokenHash: hashClockDeviceSecret(DEVICE_SECRET), status: "ACTIVE", name: "Kiosco", lastSeenAt: new Date(),
  });
  vi.mocked(timeEntriesService.clockSearch).mockResolvedValue([]);
  vi.mocked(timeEntriesService.clockPhotoPunchIdempotent).mockResolvedValue({ workShift: { id: "shift-1" } } as never);
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  Object.assign(env as MutableEnv, original);
  vi.restoreAllMocks();
});

describe("trustProxySetting", () => {
  it("nunca devuelve true: 0, negativos o no enteros desactivan la confianza", () => {
    expect(trustProxySetting(0)).toBe(false);
    expect(trustProxySetting(-1)).toBe(false);
    expect(trustProxySetting(1.5)).toBe(false);
    expect(trustProxySetting(Number.NaN)).toBe(false);
    expect(trustProxySetting(3)).toBe(3);
  });
});

describe("1. sin trust proxy (TRUST_PROXY_HOPS=0, comportamiento previo a F0)", () => {
  it("req.ip es la IP del socket (el proxy) e ignora X-Forwarded-For", async () => {
    const baseUrl = await startApp(0);
    expect(await seenIp(baseUrl, realChain(CLIENT_A))).toMatch(/127\.0\.0\.1$/);
    expect(await seenIp(baseUrl, realChain(CLIENT_B))).toMatch(/127\.0\.0\.1$/);
  });
});

describe("2. con la cantidad exacta de proxies confiables", () => {
  it("A/C) TRUST_PROXY_HOPS=3 sobre una cadena simulada de 3 proxies: req.ip es el cliente real que agregó la infraestructura", async () => {
    const baseUrl = await startApp(3);
    expect(await seenIp(baseUrl, realChain(CLIENT_A))).toBe(CLIENT_A);
    expect(await seenIp(baseUrl, realChain(CLIENT_B))).toBe(CLIENT_B);
  });

  it("A/C) TRUST_PROXY_HOPS=1 (un solo proxy): req.ip es la entrada que agregó ese proxy", async () => {
    const baseUrl = await startApp(1);
    expect(await seenIp(baseUrl, CLIENT_A)).toBe(CLIENT_A);
  });
});

describe("3. X-Forwarded-For falsificado por el cliente", () => {
  it("B) con 3 saltos, lo que el cliente antepone nunca se convierte en req.ip", async () => {
    const baseUrl = await startApp(3);
    expect(await seenIp(baseUrl, `6.6.6.6, ${realChain(CLIENT_A)}`)).toBe(CLIENT_A);
    expect(await seenIp(baseUrl, `1.1.1.1, 6.6.6.6, ${realChain(CLIENT_A)}`)).toBe(CLIENT_A);
  });

  it("B) con 1 salto, igual: la IP falsa queda a la izquierda de la que agrega el proxy", async () => {
    const baseUrl = await startApp(1);
    expect(await seenIp(baseUrl, `6.6.6.6, ${CLIENT_A}`)).toBe(CLIENT_A);
  });

  it("por qué el valor se mide y no se adivina: un número MAYOR al real sí deja falsificar la IP", async () => {
    const baseUrl = await startApp(4);
    expect(await seenIp(baseUrl, `6.6.6.6, ${realChain(CLIENT_A)}`)).toBe("6.6.6.6");
  });
});

describe("4/5. rate limiting del fichador por IP real (capa previa a la autenticación)", () => {
  it("sin trust proxy, dos clientes distintos comparten el mismo bucket (problema previo a F0)", async () => {
    const baseUrl = await startApp(0);
    for (let index = 0; index < env.CLOCK_IP_RATE_LIMIT_MAX; index += 1) {
      expect(await searchAs(baseUrl, realChain("192.0.2.10"))).toBe(401);
    }
    expect(await searchAs(baseUrl, realChain("192.0.2.11"))).toBe(429);
  });

  it("con trust proxy, cada IP tiene su bucket; la misma IP comparte el suyo aunque cambie lo que antepone", async () => {
    const baseUrl = await startApp(3);
    const clientC = "192.0.2.20";
    const clientD = "192.0.2.21";
    for (let index = 0; index < env.CLOCK_IP_RATE_LIMIT_MAX; index += 1) {
      expect(await searchAs(baseUrl, realChain(clientC))).toBe(401);
    }
    expect(await searchAs(baseUrl, realChain(clientC))).toBe(429);
    expect(await searchAs(baseUrl, `6.6.6.6, ${realChain(clientC)}`)).toBe(429);
    expect(await searchAs(baseUrl, realChain(clientD))).toBe(401);
  });
});

describe("6. IP que llega a AttendancePunch.ipAddress", () => {
  it("la fichada recibe como ipAddress la IP efectiva del cliente, no la del proxy ni una enviada por el cliente", async () => {
    const baseUrl = await startApp(3);
    const response = await fetch(`${baseUrl}/time-entries/clock/photo-punch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `6.6.6.6, ${realChain(CLIENT_A)}`,
        authorization: DEVICE_AUTHORIZATION,
      },
      body: JSON.stringify({
        requestId: "22222222-2222-4222-8222-222222222222",
        employeeId: "11111111-1111-4111-8111-111111111111",
        punchType: "IN",
        photo: `data:image/jpeg;base64,${"A".repeat(400)}`,
        faceValidationStatus: "VALID",
      }),
    });

    expect(response.status).toBe(201);
    expect(timeEntriesService.clockPhotoPunchIdempotent).toHaveBeenCalledWith(
      expect.anything(),
      DEVICE_ID,
      expect.objectContaining({ ipAddress: CLIENT_A }),
    );
  });
});

describe("GET /health/client-ip — sonda de medición", () => {
  it("no existe si CLIENT_IP_DIAGNOSTICS_ENABLED=false", async () => {
    const baseUrl = await startApp(3, { diagnostics: false });
    const response = await fetch(`${baseUrl}/health/client-ip`);
    expect(response.status).toBe(404);
  });

  it("devuelve la cadena de proxies pero nunca headers de credenciales", async () => {
    const baseUrl = await startApp(3);
    const response = await fetch(`${baseUrl}/health/client-ip`, {
      headers: {
        "x-forwarded-for": realChain(CLIENT_A),
        "cf-connecting-ip": CLIENT_A,
        authorization: DEVICE_AUTHORIZATION,
        cookie: "session=secret-cookie-value",
      },
    });
    const text = await response.text();

    expect(JSON.parse(text).data).toMatchObject({ ip: CLIENT_A, trustProxy: 3, xForwardedForEntries: 3, cfConnectingIp: CLIENT_A });
    expect(text).not.toContain(DEVICE_SECRET);
    expect(text).not.toContain(DEVICE_ID);
    expect(text).not.toContain("secret-cookie-value");
  });
});
