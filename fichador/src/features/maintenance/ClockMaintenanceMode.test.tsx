import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ClockDeviceGate } from "../device/ClockDeviceGate";
import { clockDeviceStorage } from "../device/clockDeviceStorage";
import { clockDeviceApiService } from "../../services/api/clockDeviceApiService";
import { clockDeviceSession } from "../../services/api/clockDeviceSession";
import { kioskActivity } from "../../pwa/kioskActivity";
import { TimeClockPage } from "../../pages/TimeClockPage";
import { MAINTENANCE_LONG_PRESS_MS } from "./maintenanceTrigger";

/**
 * Modo mantenimiento (docs/decisions/FICHADOR_MAINTENANCE_MODE.md) sobre el
 * fichador real: ClockDeviceGate + TimeClockPage. Sólo IndexedDB y el estado
 * de enrolamiento están mockeados; el resto de las requests sale por fetch.
 */
vi.mock("../device/clockDeviceStorage", () => ({ clockDeviceStorage: { get: vi.fn(), set: vi.fn(), clear: vi.fn() } }));
vi.mock("../../services/api/clockDeviceApiService", () => ({ clockDeviceApiService: { register: vi.fn(), status: vi.fn(), refreshPairing: vi.fn() } }));

const IDENTITY = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", secret: "s".repeat(43) };
const TOKEN = "t".repeat(43);
const DEVICE = { name: "Pañol 01", status: "ACTIVE", activatedAt: null, lastSeenAt: null, lastAppVersion: "1.4.0", connectivity: "ONLINE", establishment: null };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Route = (init: RequestInit) => Response;
let routes: Record<string, Route>;
// Vencimiento de la sesión según el "servidor": el GET informa lo que queda, como el real.
let serverDeadline = 0;
let fetchMock: ReturnType<typeof vi.fn>;
const requests = (key: string) => fetchMock.mock.calls.filter(([url, init]) => `${(init as RequestInit | undefined)?.method || "GET"} ${new URL(String(url)).pathname.replace(/^\/api/, "")}` === key);
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

async function renderKiosk() {
  render(<ClockDeviceGate><TimeClockPage /></ClockDeviceGate>);
  await advance(0);
  expect(screen.getByRole("heading", { name: "Fichador de personal" })).toBeInTheDocument();
}

const heading = () => screen.getByRole("heading", { name: "Fichador de personal" }).closest(".clock-heading")!;

async function holdHeading(ms = MAINTENANCE_LONG_PRESS_MS) {
  fireEvent.pointerDown(heading(), { pointerType: "touch", clientX: 50, clientY: 50 });
  await advance(ms);
}

async function enterMaintenance() {
  await holdHeading();
  fireEvent.change(screen.getByLabelText("Código"), { target: { value: "482731" } });
  fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
  await advance(0);
  expect(screen.getByRole("heading", { name: "Modo mantenimiento" })).toBeInTheDocument();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
  vi.mocked(clockDeviceStorage.get).mockResolvedValue(IDENTITY);
  vi.mocked(clockDeviceStorage.clear).mockResolvedValue(undefined);
  vi.mocked(clockDeviceApiService.status).mockResolvedValue({ id: IDENTITY.id, name: "Pañol 01", status: "ACTIVE" });
  routes = {
    "POST /clock/heartbeat": () => jsonResponse(200, { data: { device: { id: IDENTITY.id, name: "Pañol 01", status: "ACTIVE", establishment: null }, serverTime: new Date().toISOString() } }),
    "POST /clock/maintenance/session": () => {
      serverDeadline = Date.now() + 600_000;
      return jsonResponse(201, { data: { token: TOKEN, expiresAt: "x", expiresInSeconds: 600, device: DEVICE } });
    },
    "GET /clock/maintenance/session": () => {
      const left = Math.ceil((serverDeadline - Date.now()) / 1_000);
      return left > 0
        ? jsonResponse(200, { data: { expiresAt: "x", expiresInSeconds: left, device: DEVICE, serverTime: "x" } })
        : jsonResponse(401, { error: { code: "CLOCK_MAINTENANCE_SESSION_INVALID", message: "El acceso de mantenimiento venció." } });
    },
    "DELETE /clock/maintenance/session": () => new Response(null, { status: 204 }),
  };
  fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const key = `${init.method || "GET"} ${new URL(url).pathname.replace(/^\/api/, "")}`;
    const route = routes[key];
    if (!route) throw new TypeError(`sin ruta en el test: ${key}`);
    return route(init);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  clockDeviceSession.end();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Modo mantenimiento sobre el fichador real", () => {
  it("quien ficha no ve ninguna opción administrativa: ni botones, ni textos, ni ids", async () => {
    await renderKiosk();
    // Etapa 2: en reposo el fichador no muestra ningún botón (sólo la búsqueda).
    expect(screen.queryAllByRole("button").map((button) => button.getAttribute("aria-label") || button.textContent)).toEqual([]);
    expect(document.body.textContent).not.toMatch(/mantenimiento|Reconfigurar|Administraci|Salir|Recargar|código/i);
    expect(document.body.textContent).not.toContain(IDENTITY.id);
    expect(requests("POST /clock/maintenance/session")).toHaveLength(0);
  });

  it("el gesto oculto (5 s sobre el encabezado) abre el acceso; soltar antes no hace nada", async () => {
    await renderKiosk();
    await holdHeading(MAINTENANCE_LONG_PRESS_MS - 100);
    fireEvent.pointerUp(heading(), { pointerType: "touch" });
    await advance(1_000);
    expect(screen.queryByRole("dialog", { name: "Acceso de mantenimiento" })).not.toBeInTheDocument();

    await holdHeading();
    expect(screen.getByRole("dialog", { name: "Acceso de mantenimiento" })).toBeInTheDocument();
    expect(kioskActivity.isIdle()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(kioskActivity.isIdle()).toBe(true);
    expect(requests("POST /clock/maintenance/session")).toHaveLength(0);
  });

  it("con un código válido reemplaza al fichador por el modo mantenimiento y al salir vuelve al fichador normal", async () => {
    await renderKiosk();
    await enterMaintenance();
    expect(screen.queryByLabelText("Buscar por nombre o apellido")).not.toBeInTheDocument();
    expect(kioskActivity.isIdle()).toBe(false);
    // La sesión operativa del equipo no cambió: el token de mantenimiento va aparte.
    expect(clockDeviceSession.isActive()).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Volver al fichador" }));
    await advance(0);
    expect(screen.getByLabelText("Buscar por nombre o apellido")).toBeInTheDocument();
    expect(screen.queryByText("Modo mantenimiento")).not.toBeInTheDocument();
    expect(requests("DELETE /clock/maintenance/session")).toHaveLength(1);
    expect(kioskActivity.isIdle()).toBe(true);
  });

  it("vencida la sesión vuelve sola al fichador", async () => {
    await renderKiosk();
    await enterMaintenance();
    await advance(600_000);
    expect(screen.getByLabelText("Buscar por nombre o apellido")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Modo mantenimiento" })).not.toBeInTheDocument();
  });

  it("revocación en caliente durante el mantenimiento: el equipo queda bloqueado sin sesión residual", async () => {
    await renderKiosk();
    await enterMaintenance();
    const revoked = () => jsonResponse(403, { error: { code: "CLOCK_DEVICE_REVOKED", message: "Este dispositivo fue deshabilitado por RRHH." } });
    routes["GET /clock/maintenance/session"] = revoked;
    routes["POST /clock/heartbeat"] = revoked;
    await advance(60_000);

    expect(screen.getByRole("heading", { name: "Dispositivo deshabilitado" })).toBeInTheDocument();
    expect(screen.queryByText("Modo mantenimiento")).not.toBeInTheDocument();
    expect(clockDeviceSession.isActive()).toBe(false);
    expect(kioskActivity.isIdle()).toBe(true);
    expect(clockDeviceStorage.clear).not.toHaveBeenCalled();
    // Ninguna request de mantenimiento más con la credencial revocada.
    const before = fetchMock.mock.calls.length;
    await advance(120_000);
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("reconfigurar desde mantenimiento borra sólo la vinculación local y vuelve a la configuración inicial", async () => {
    await renderKiosk();
    await enterMaintenance();
    fireEvent.click(screen.getByRole("button", { name: "Reconfigurar dispositivo" }));
    fireEvent.change(screen.getByLabelText("Escribí RECONFIGURAR para confirmar"), { target: { value: "RECONFIGURAR" } });
    fireEvent.click(screen.getByRole("button", { name: "Reconfigurar" }));
    await advance(0);

    expect(clockDeviceStorage.clear).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Configurar dispositivo" })).toBeInTheDocument();
    expect(clockDeviceSession.isActive()).toBe(false);
    expect(requests("DELETE /clock/maintenance/session")).toHaveLength(1);
    // El backend no se toca más allá de cerrar la sesión de mantenimiento: nada de revocar.
    expect(fetchMock.mock.calls.some(([url]) => /revoke|clock-devices/.test(String(url)))).toBe(false);
  });
});
