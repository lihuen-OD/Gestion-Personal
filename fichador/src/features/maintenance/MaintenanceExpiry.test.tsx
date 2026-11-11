import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ClockDeviceGate } from "../device/ClockDeviceGate";
import { clockDeviceStorage } from "../device/clockDeviceStorage";
import { clockDeviceApiService } from "../../services/api/clockDeviceApiService";
import { clockDeviceSession } from "../../services/api/clockDeviceSession";
import { kioskActivity } from "../../pwa/kioskActivity";
import { TimeClockPage } from "../../pages/TimeClockPage";
import { MAINTENANCE_LONG_PRESS_MS } from "./maintenanceTrigger";
import { MAINTENANCE_EXPIRED_NOTICE_MS, MAINTENANCE_EXPIRED_TITLE } from "./ClockMaintenanceMode";
import { MAINTENANCE_EXPIRY_WARNING, MAINTENANCE_REFRESH_MS } from "./MaintenancePanel";

/**
 * Etapa 6B-4 (AUDITORIA_6A F6-05): el vencimiento del modo mantenimiento se
 * avisa (antes y al vencer) sin dejar datos ni acciones de RRHH a la vista y
 * sin extender la sesión. Gate + fichador reales; IndexedDB y el enrolamiento
 * simulados; el resto sale por fetch simulado (vencimiento según el "servidor").
 */
vi.mock("../device/clockDeviceStorage", () => ({ clockDeviceStorage: { get: vi.fn(), set: vi.fn(), clear: vi.fn() } }));
vi.mock("../../services/api/clockDeviceApiService", () => ({ clockDeviceApiService: { register: vi.fn(), status: vi.fn(), refreshPairing: vi.fn() } }));

const IDENTITY = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", secret: "s".repeat(43) };
const TOKEN = "t".repeat(43);
const DEVICE = { name: "Pañol 01", status: "ACTIVE", activatedAt: null, lastSeenAt: null, lastAppVersion: "1.4.0", connectivity: "ONLINE", establishment: null };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Route = (init: RequestInit) => Response | Promise<Response>;
let routes: Record<string, Route>;
let serverDeadline = 0;
let fetchMock: ReturnType<typeof vi.fn>;
const requests = (key: string) => fetchMock.mock.calls.filter(([url, init]) => `${(init as RequestInit | undefined)?.method || "GET"} ${new URL(String(url)).pathname.replace(/^\/api/, "")}` === key);
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const sessionOk = () => jsonResponse(200, { data: { expiresAt: "x", expiresInSeconds: Math.ceil((serverDeadline - Date.now()) / 1_000), device: DEVICE, serverTime: "x" } });
const sessionInvalid = () => jsonResponse(401, { error: { code: "CLOCK_MAINTENANCE_SESSION_INVALID", message: "El acceso de mantenimiento venció." } });

async function renderKiosk() {
  render(<ClockDeviceGate><TimeClockPage /></ClockDeviceGate>);
  await advance(0);
  expect(screen.getByRole("heading", { name: "Fichador de personal" })).toBeInTheDocument();
}

async function enterMaintenance() {
  const heading = screen.getByRole("heading", { name: "Fichador de personal" }).closest(".clock-heading")!;
  fireEvent.pointerDown(heading, { pointerType: "touch", clientX: 50, clientY: 50 });
  await advance(MAINTENANCE_LONG_PRESS_MS);
  fireEvent.change(screen.getByLabelText("Código"), { target: { value: "482731" } });
  fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
  await advance(0);
  expect(screen.getByRole("heading", { name: "Modo mantenimiento" })).toBeInTheDocument();
}

const notice = () => screen.queryByRole("heading", { name: MAINTENANCE_EXPIRED_TITLE });
const panelGone = () => {
  expect(screen.queryByRole("heading", { name: "Modo mantenimiento" })).not.toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/Pañol 01|1\.4\.0|Reconfigurar|Recargar aplicación/);
  expect(document.body.textContent).not.toContain(TOKEN);
};

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
    "GET /clock/maintenance/session": () => (serverDeadline > Date.now() ? sessionOk() : sessionInvalid()),
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

describe("F6-05 — vencimiento del modo mantenimiento", () => {
  it("avisa el último minuto una sola vez, sin cambiar el plazo del servidor", async () => {
    await renderKiosk();
    await enterMaintenance();
    const timer = screen.getByRole("timer");
    expect(timer).not.toHaveClass("is-ending");
    expect(screen.queryByText(MAINTENANCE_EXPIRY_WARNING)).not.toBeInTheDocument();
    await advance(540_000); // quedan 60 s
    expect(screen.getByRole("timer")).toHaveClass("is-ending");
    expect(screen.getByText(MAINTENANCE_EXPIRY_WARNING)).toHaveAttribute("role", "status");
    expect(screen.getByRole("timer")).toHaveTextContent("1:00");
  });

  it("al vencer: el panel desaparece (sin datos ni acciones de RRHH), un aviso accesible explica el motivo y vuelve solo al fichador", async () => {
    await renderKiosk();
    await enterMaintenance();
    await advance(600_000);
    panelGone();
    expect(notice()).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(MAINTENANCE_EXPIRED_TITLE);
    expect(screen.getByRole("button", { name: "Volver al fichador" })).toHaveFocus();
    expect(screen.queryByLabelText("Buscar por nombre o apellido")).not.toBeInTheDocument(); // nadie ficha mientras se lee
    expect(kioskActivity.isIdle()).toBe(false);
    const gets = requests("GET /clock/maintenance/session").length;
    await advance(MAINTENANCE_EXPIRED_NOTICE_MS - 1);
    expect(notice()).toBeInTheDocument();
    await advance(1);
    expect(notice()).not.toBeInTheDocument();
    expect(screen.getByLabelText("Buscar por nombre o apellido")).toBeInTheDocument();
    expect(kioskActivity.isIdle()).toBe(true);
    await advance(10 * MAINTENANCE_REFRESH_MS);
    expect(requests("GET /clock/maintenance/session")).toHaveLength(gets); // la sesión vencida no se sigue consultando
  });

  it("el servidor da la sesión por vencida (401) antes del plazo local: mismo aviso", async () => {
    await renderKiosk();
    await enterMaintenance();
    routes["GET /clock/maintenance/session"] = sessionInvalid;
    await advance(MAINTENANCE_REFRESH_MS);
    panelGone();
    expect(notice()).toBeInTheDocument();
  });

  it("salir a propósito («Volver al fichador») no muestra el aviso de vencimiento", async () => {
    await renderKiosk();
    await enterMaintenance();
    fireEvent.click(screen.getByRole("button", { name: "Volver al fichador" }));
    await advance(0);
    expect(notice()).not.toBeInTheDocument();
    expect(screen.getByLabelText("Buscar por nombre o apellido")).toBeInTheDocument();
    expect(requests("DELETE /clock/maintenance/session")).toHaveLength(1);
  });

  it("vence con la confirmación RECONFIGURAR a medio escribir: no se reconfigura nada", async () => {
    await renderKiosk();
    await enterMaintenance();
    fireEvent.click(screen.getByRole("button", { name: "Reconfigurar dispositivo" }));
    fireEvent.change(screen.getByLabelText("Escribí RECONFIGURAR para confirmar"), { target: { value: "RECONFIGURAR" } });
    await advance(600_000);
    panelGone();
    expect(screen.queryByRole("button", { name: "Reconfigurar" })).not.toBeInTheDocument();
    expect(clockDeviceStorage.clear).not.toHaveBeenCalled();
  });

  it("una respuesta tardía del servidor (con más tiempo) no revive la sesión vencida", async () => {
    await renderKiosk();
    await enterMaintenance();
    let release: (response: Response) => void = () => undefined;
    await advance(590_000);
    routes["GET /clock/maintenance/session"] = () => new Promise<Response>((resolve) => { release = resolve; });
    await advance(MAINTENANCE_REFRESH_MS); // el refresco quedó en vuelo y vence el plazo local
    panelGone();
    expect(notice()).toBeInTheDocument();
    await act(async () => { release(jsonResponse(200, { data: { expiresAt: "x", expiresInSeconds: 600, device: DEVICE, serverTime: "x" } })); });
    await advance(0);
    panelGone();
    await advance(MAINTENANCE_EXPIRED_NOTICE_MS);
    expect(screen.getByLabelText("Buscar por nombre o apellido")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Modo mantenimiento" })).not.toBeInTheDocument();
  });

  it("el aviso se puede cerrar antes con su botón", async () => {
    await renderKiosk();
    await enterMaintenance();
    await advance(600_000);
    fireEvent.click(screen.getByRole("button", { name: "Volver al fichador" }));
    await advance(0);
    expect(notice()).not.toBeInTheDocument();
    expect(screen.getByLabelText("Buscar por nombre o apellido")).toBeInTheDocument();
  });

  it("revocación durante el aviso: el Gate bloquea igual (el aviso no la oculta)", async () => {
    await renderKiosk();
    await enterMaintenance();
    await advance(600_000);
    expect(notice()).toBeInTheDocument();
    routes["POST /clock/heartbeat"] = () => jsonResponse(403, { error: { code: "CLOCK_DEVICE_REVOKED", message: "Este dispositivo fue deshabilitado por RRHH." } });
    await advance(60_000);
    expect(screen.getByRole("heading", { name: "Dispositivo deshabilitado" })).toBeInTheDocument();
    expect(notice()).not.toBeInTheDocument();
  });
});
