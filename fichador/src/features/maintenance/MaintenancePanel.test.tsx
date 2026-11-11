import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { clockDeviceSession } from "../../services/api/clockDeviceSession";
import type { ClockMaintenanceDevice } from "../../services/api/clockMaintenanceApiService";
import { MAINTENANCE_REFRESH_MS, MaintenancePanel } from "./MaintenancePanel";

/** Modo mantenimiento (docs/decisions/FICHADOR_MAINTENANCE_MODE.md): la pantalla de RRHH. */
const IDENTITY = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", secret: "s".repeat(43) };
const TOKEN = "t".repeat(43);
const DEVICE: ClockMaintenanceDevice = {
  name: "Pañol 01",
  status: "ACTIVE",
  activatedAt: "2026-10-20T12:00:00.000Z",
  lastSeenAt: "2026-10-26T14:58:00.000Z",
  lastAppVersion: "1.4.0",
  connectivity: "ONLINE",
  establishment: { name: "Planta Norte", zone: { name: "Zona Centro" } },
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let fetchMock: ReturnType<typeof vi.fn>;
const calls = (method: string) => fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/clock/maintenance/session") && ((init as RequestInit | undefined)?.method || "GET") === method);
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function renderPanel(overrides: { expiresInSeconds?: number; onReconfigure?: () => Promise<boolean> } = {}) {
  const onExit = vi.fn();
  const onReconfigure = vi.fn(overrides.onReconfigure ?? (async () => true));
  const reloadApp = vi.fn();
  const now = Date.now();
  const view = render(<MaintenancePanel access={{ token: TOKEN, deadline: now + (overrides.expiresInSeconds ?? 600) * 1_000, device: DEVICE, verifiedAt: now }} onExit={onExit} onReconfigure={onReconfigure} reloadApp={reloadApp} />);
  return { ...view, onExit, onReconfigure, reloadApp };
}

let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-26T15:00:00.000Z"));
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  clockDeviceSession.start(IDENTITY);
});

afterEach(() => {
  clockDeviceSession.end();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("MaintenancePanel — información para RRHH", () => {
  it("muestra dispositivo y aplicación en lenguaje humano, sin ids ni valores técnicos", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "Modo mantenimiento" })).toBeInTheDocument();
    const device = screen.getByRole("region", { name: "Dispositivo" });
    expect(within(device).getByText("Pañol 01")).toBeInTheDocument();
    expect(within(device).getByText("Activo")).toBeInTheDocument();
    expect(within(device).getByText("Zona Centro · Planta Norte")).toBeInTheDocument();
    expect(within(device).getByText("En línea")).toBeInTheDocument();
    expect(within(device).getByText("26/10/2026 · 11:58")).toBeInTheDocument();
    expect(within(device).getByText("1.4.0")).toBeInTheDocument();
    const app = screen.getByRole("region", { name: "Aplicación" });
    expect(within(app).getByText("Con conexión")).toBeInTheDocument();
    expect(within(app).getByText("Instalada en el equipo")).toBeInTheDocument();
    expect(within(app).getByText("A las 12:00")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("10:00");
    expect(document.body.textContent).not.toMatch(new RegExp(`${IDENTITY.id}|${TOKEN}|ACTIVE|ONLINE|PWA|standalone|2026-10-26T`));
  });

  it("refleja en vivo si el equipo pierde o recupera Internet", async () => {
    renderPanel();
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(within(screen.getByRole("region", { name: "Aplicación" })).getByText("Sin conexión")).toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(within(screen.getByRole("region", { name: "Aplicación" })).getByText("Con conexión")).toBeInTheDocument();
    await advance(0);
    expect(calls("GET")).toHaveLength(1);
  });
});

describe("MaintenancePanel — sesión corta", () => {
  it("se cierra sola al vencer, una sola vez", async () => {
    const { onExit } = renderPanel({ expiresInSeconds: 90 });
    await advance(60_000);
    expect(screen.getByRole("timer")).toHaveTextContent("0:30");
    expect(onExit).not.toHaveBeenCalled();
    await advance(30_000);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("cada 30 s con la pantalla visible confirma la sesión con su token y resincroniza el tiempo con el servidor", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { expiresAt: "x", expiresInSeconds: 120, device: { ...DEVICE, name: "Pañol renombrado" }, serverTime: "x" } }));
    renderPanel();
    await advance(MAINTENANCE_REFRESH_MS);
    expect(calls("GET")).toHaveLength(1);
    const headers = new Headers((calls("GET")[0]![1] as RequestInit).headers);
    expect(headers.get("x-clock-maintenance-session")).toBe(TOKEN);
    expect(headers.get("authorization")).toBe(`ClockDevice ${IDENTITY.id}.${IDENTITY.secret}`);
    expect(screen.getByText("Pañol renombrado")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("2:00");
  });

  it("con la pantalla oculta no consulta; al volver a primer plano sí", async () => {
    renderPanel();
    visibility = "hidden";
    await advance(3 * MAINTENANCE_REFRESH_MS);
    expect(calls("GET")).toHaveLength(0);
    visibility = "visible";
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await advance(0);
    expect(calls("GET")).toHaveLength(1);
  });

  it("sesión vencida o cerrada en el servidor (401) → vuelve al fichador", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: { code: "CLOCK_MAINTENANCE_SESSION_INVALID", message: "x" } }));
    const { onExit } = renderPanel();
    await advance(MAINTENANCE_REFRESH_MS);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("sin red al refrescar: sigue abierta con la última verificación a la vista", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { onExit } = renderPanel();
    await advance(MAINTENANCE_REFRESH_MS);
    expect(onExit).not.toHaveBeenCalled();
    expect(screen.getByText("A las 12:00")).toBeInTheDocument();
  });

  it("revocado durante el mantenimiento: la sesión operativa se cierra y el Gate se entera (lo desmonta)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: { code: "CLOCK_DEVICE_REVOKED", message: "Este dispositivo fue deshabilitado por RRHH." } }));
    const failures: string[] = [];
    const unsubscribe = clockDeviceSession.onAuthFailure((failure) => failures.push(failure));
    renderPanel();
    await advance(MAINTENANCE_REFRESH_MS);
    expect(failures).toEqual(["CLOCK_DEVICE_REVOKED"]);
    expect(clockDeviceSession.isActive()).toBe(false);
    unsubscribe();
  });

  it("al desmontarse no deja timers ni listeners, y no avisa nada después", async () => {
    const removeWindow = vi.spyOn(window, "removeEventListener");
    const removeDocument = vi.spyOn(document, "removeEventListener");
    const { unmount, onExit } = renderPanel({ expiresInSeconds: 5 });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(removeWindow.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(["online", "offline"]));
    expect(removeDocument.mock.calls.map(([type]) => type)).toContain("visibilitychange");
    await advance(MAINTENANCE_REFRESH_MS);
    expect(onExit).not.toHaveBeenCalled();
    expect(calls("GET")).toHaveLength(0);
  });
});

describe("MaintenancePanel — acciones", () => {
  it("Volver al fichador cierra la sesión en el servidor (con su token) y sale", async () => {
    const { onExit } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Volver al fichador" }));
    expect(onExit).toHaveBeenCalledTimes(1);
    await advance(0);
    const [, init] = calls("DELETE")[0]!;
    expect(new Headers((init as RequestInit).headers).get("x-clock-maintenance-session")).toBe(TOKEN);
    expect((init as RequestInit).keepalive).toBe(true);
  });

  it("Volver al fichador sin red: sale igual (la sesión vence sola en el servidor)", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { onExit } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Volver al fichador" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("Recargar aplicación cierra la sesión y recarga", async () => {
    const { reloadApp } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Recargar aplicación" }));
    expect(reloadApp).toHaveBeenCalledTimes(1);
    await advance(0);
    expect(calls("DELETE")).toHaveLength(1);
  });

  it("Reconfigurar exige confirmación fuerte: explica la consecuencia y pide escribir RECONFIGURAR; Cancelar no borra nada", async () => {
    const { onReconfigure } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Reconfigurar dispositivo" }));
    const confirm = screen.getByRole("alertdialog", { name: "Confirmar reconfiguración" });
    expect(within(confirm).getByText("Este dispositivo dejará de estar vinculado y deberá aprobarse nuevamente desde RRHH.")).toBeInTheDocument();
    const action = within(confirm).getByRole("button", { name: "Reconfigurar" });
    expect(action).toBeDisabled();
    fireEvent.change(within(confirm).getByLabelText("Escribí RECONFIGURAR para confirmar"), { target: { value: "reconfigura" } });
    expect(action).toBeDisabled();

    fireEvent.click(within(confirm).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onReconfigure).not.toHaveBeenCalled();
    await advance(0);
    expect(calls("DELETE")).toHaveLength(0);
  });

  it("con la palabra escrita: cierra la sesión y reconfigura (reset del Gate)", async () => {
    const { onReconfigure } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Reconfigurar dispositivo" }));
    fireEvent.change(screen.getByLabelText("Escribí RECONFIGURAR para confirmar"), { target: { value: " reconfigurar " } });
    fireEvent.click(screen.getByRole("button", { name: "Reconfigurar" }));
    await advance(0);
    expect(onReconfigure).toHaveBeenCalledTimes(1);
    expect(calls("DELETE")).toHaveLength(1);
  });

  it("si no se pudo borrar la vinculación local, lo dice y permite reintentar", async () => {
    renderPanel({ onReconfigure: async () => false });
    fireEvent.click(screen.getByRole("button", { name: "Reconfigurar dispositivo" }));
    fireEvent.change(screen.getByLabelText("Escribí RECONFIGURAR para confirmar"), { target: { value: "RECONFIGURAR" } });
    fireEvent.click(screen.getByRole("button", { name: "Reconfigurar" }));
    await advance(0);
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos borrar la vinculación de este equipo. Intentá nuevamente.");
    expect(screen.getByRole("button", { name: "Reconfigurar" })).toBeEnabled();
  });
});

describe("MaintenancePanel — presentación y foco (Etapa 5)", () => {
  it("los estados se leen en texto; la señal de color es sólo decorativa", () => {
    renderPanel();
    const device = screen.getByRole("region", { name: "Dispositivo" });
    const app = screen.getByRole("region", { name: "Aplicación" });
    for (const [region, text] of [[device, "Activo"], [device, "En línea"], [app, "Con conexión"]] as const) {
      const value = within(region).getByText(text);
      const dot = value.querySelector(".maintenance-dot");
      expect(dot).toHaveAttribute("aria-hidden", "true");
    }
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(within(app).getByText("Sin conexión").querySelector(".maintenance-dot")).toHaveClass("is-warn");
  });

  it("abrir la confirmación lleva el foco al campo de la palabra; Cancelar lo devuelve al botón que la abrió", () => {
    renderPanel();
    const trigger = screen.getByRole("button", { name: "Reconfigurar dispositivo" });
    fireEvent.click(trigger);
    expect(screen.getByLabelText("Escribí RECONFIGURAR para confirmar")).toHaveFocus();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("button", { name: "Reconfigurar dispositivo" })).toHaveFocus();
  });

  it("mientras reconfigura, nada más se puede accionar; si falla, el foco vuelve al campo", async () => {
    let finish: (cleared: boolean) => void = () => undefined;
    renderPanel({ onReconfigure: () => new Promise<boolean>((resolve) => { finish = resolve; }) });
    fireEvent.click(screen.getByRole("button", { name: "Reconfigurar dispositivo" }));
    const field = screen.getByLabelText("Escribí RECONFIGURAR para confirmar");
    fireEvent.change(field, { target: { value: "RECONFIGURAR" } });
    fireEvent.click(screen.getByRole("button", { name: "Reconfigurar" }));
    const busy = screen.getByRole("button", { name: "Reconfigurando…" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    for (const name of ["Volver al fichador", "Recargar aplicación", "Cancelar"]) expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(field).toBeDisabled();

    await act(async () => { finish(false); });
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos borrar la vinculación de este equipo. Intentá nuevamente.");
    expect(field).toBeEnabled();
    expect(field).toHaveFocus();
  });
});
