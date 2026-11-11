import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { clockDeviceSession } from "../../services/api/clockDeviceSession";
import type { ClockMaintenanceDevice } from "../../services/api/clockMaintenanceApiService";
import { MAINTENANCE_REFRESH_MS, MaintenancePanel } from "./MaintenancePanel";

/**
 * Etapa 6B-4 (F6-05b): la cuenta en pantalla se actualiza una vez por segundo,
 * pero ninguna acción del panel puede empezar después del vencimiento real.
 * El plazo queda desfasado medio segundo del tick (como tras un refresco a
 * mitad de segundo): a los 10,5 s vence y el próximo render es a los 11 s.
 */
const IDENTITY = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", secret: "s".repeat(43) };
const TOKEN = "t".repeat(43);
const DEVICE: ClockMaintenanceDevice = { name: "Pañol 01", status: "ACTIVE", activatedAt: null, lastSeenAt: null, lastAppVersion: "1.4.0", connectivity: "ONLINE", establishment: null };
const VALID_FOR_MS = 10_500;

let fetchMock: ReturnType<typeof vi.fn>;
let start = 0;
const deletes = () => fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/clock/maintenance/session") && (init as RequestInit | undefined)?.method === "DELETE").length;
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
/** Mueve el reloj sin disparar temporizadores: el tiempo pasa entre dos ticks de la cuenta. */
const clockAt = (ms: number) => vi.setSystemTime(start + ms);

function renderPanel(onReconfigure: () => Promise<boolean> = async () => true) {
  const onExit = vi.fn();
  const reconfigureSpy = vi.fn(onReconfigure);
  const reloadApp = vi.fn();
  render(<MaintenancePanel access={{ token: TOKEN, deadline: start + VALID_FOR_MS, device: DEVICE, verifiedAt: start }} onExit={onExit} onReconfigure={reconfigureSpy} reloadApp={reloadApp} />);
  return { onExit, onReconfigure: reconfigureSpy, reloadApp };
}
function writeWord() {
  fireEvent.click(screen.getByRole("button", { name: "Reconfigurar dispositivo" }));
  fireEvent.change(screen.getByLabelText("Escribí RECONFIGURAR para confirmar"), { target: { value: "RECONFIGURAR" } });
}
const confirmButton = () => screen.getByRole("button", { name: "Reconfigurar" });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-11-11T15:00:00.000Z"));
  start = Date.now();
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  clockDeviceSession.start(IDENTITY);
});

afterEach(() => {
  clockDeviceSession.end();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("F6-05b — ninguna acción empieza después del vencimiento real", () => {
  it("con la sesión vigente, la reconfiguración se ejecuta como siempre", async () => {
    const { onExit, onReconfigure } = renderPanel();
    await advance(9_000);
    writeWord();
    fireEvent.click(confirmButton());
    await advance(0);
    expect(onReconfigure).toHaveBeenCalledTimes(1);
    expect(deletes()).toBe(1);
    expect(onExit).not.toHaveBeenCalled();
  });

  it("palabra escrita antes del vencimiento y clic después, antes del siguiente tick: no se reconfigura y sale por vencimiento", async () => {
    const { onExit, onReconfigure } = renderPanel();
    await advance(9_000);
    writeWord();
    await advance(1_000); // tick de los 10 s: todavía muestra 0:01
    expect(screen.getByRole("timer")).toHaveTextContent("0:01");
    clockAt(10_700); // venció a los 10,5 s; no hubo render
    fireEvent.click(confirmButton());
    await advance(0);
    expect(onReconfigure).not.toHaveBeenCalled();
    expect(deletes()).toBe(0);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith("expired");
  });

  it("confirmación pedida después del vencimiento: tampoco se ejecuta", async () => {
    const { onExit, onReconfigure } = renderPanel();
    await advance(10_000);
    clockAt(10_700);
    writeWord();
    fireEvent.click(confirmButton());
    await advance(0);
    expect(onReconfigure).not.toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith("expired");
  });

  it("recarga pedida después del vencimiento: no recarga ni cierra la sesión en el servidor; sale por vencimiento", async () => {
    const { onExit, reloadApp } = renderPanel();
    await advance(10_000);
    clockAt(10_700);
    fireEvent.click(screen.getByRole("button", { name: "Recargar aplicación" }));
    await advance(0);
    expect(reloadApp).not.toHaveBeenCalled();
    expect(deletes()).toBe(0);
    expect(onExit).toHaveBeenCalledWith("expired");
  });

  it("clic exactamente en el instante del vencimiento: cuenta como vencida", async () => {
    const { onExit, onReconfigure } = renderPanel();
    await advance(9_000);
    writeWord();
    await advance(1_000);
    clockAt(VALID_FOR_MS);
    fireEvent.click(confirmButton());
    await advance(0);
    expect(onReconfigure).not.toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledWith("expired");
  });

  it("una reconfiguración iniciada a tiempo no se interrumpe aunque la sesión venza mientras corre", async () => {
    let finish: (cleared: boolean) => void = () => undefined;
    const { onExit, onReconfigure } = renderPanel(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    await advance(9_000);
    writeWord();
    fireEvent.click(confirmButton());
    await advance(2_000); // vence durante el borrado local
    expect(onReconfigure).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith("expired");
    await act(async () => { finish(true); });
    expect(onReconfigure).toHaveBeenCalledTimes(1);
  });

  it("varios intentos mientras se procesa el vencimiento: una sola salida y ninguna acción", async () => {
    const { onExit, onReconfigure, reloadApp } = renderPanel();
    await advance(9_000);
    writeWord();
    await advance(1_000);
    clockAt(10_700);
    fireEvent.click(confirmButton());
    fireEvent.click(confirmButton());
    fireEvent.click(screen.getByRole("button", { name: "Recargar aplicación" }));
    await advance(1_000); // llega también el tick de los 11 s
    expect(onReconfigure).not.toHaveBeenCalled();
    expect(reloadApp).not.toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("la salida voluntaria con la sesión vigente no se confunde con el vencimiento", async () => {
    const { onExit } = renderPanel();
    await advance(5_000);
    fireEvent.click(screen.getByRole("button", { name: "Volver al fichador" }));
    await advance(0);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit.mock.calls[0]).toEqual([undefined]);
    expect(deletes()).toBe(1);
    await advance(10_000); // vence después: no hay una segunda salida
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("una respuesta tardía del servidor con más tiempo no reactiva el panel ni sus acciones", async () => {
    let release: (response: Response) => void = () => undefined;
    fetchMock.mockImplementation((url: string, init: RequestInit = {}) => (init.method === "DELETE" ? Promise.resolve(new Response(null, { status: 204 })) : new Promise<Response>((resolve) => { release = resolve; })));
    // El refresco de los 30 s queda en vuelo con un plazo de 35 s.
    const onExit = vi.fn(); const onReconfigure = vi.fn(async () => true);
    render(<MaintenancePanel access={{ token: TOKEN, deadline: start + 35_500, device: DEVICE, verifiedAt: start }} onExit={onExit} onReconfigure={onReconfigure} reloadApp={vi.fn()} />);
    await advance(MAINTENANCE_REFRESH_MS);
    writeWord();
    await advance(5_000);
    clockAt(35_700);
    fireEvent.click(confirmButton());
    await advance(0);
    expect(onExit).toHaveBeenCalledWith("expired");
    await act(async () => { release(new Response(JSON.stringify({ data: { expiresAt: "x", expiresInSeconds: 600, device: DEVICE, serverTime: "x" } }), { status: 200, headers: { "content-type": "application/json" } })); });
    await advance(0);
    fireEvent.click(confirmButton());
    await advance(0);
    expect(onReconfigure).not.toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
