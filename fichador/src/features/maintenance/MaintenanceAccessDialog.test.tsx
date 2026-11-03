import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clockDeviceSession } from "../../services/api/clockDeviceSession";
import { CONNECTION_MESSAGE, INVALID_CODE_MESSAGE, MAINTENANCE_ACCESS_IDLE_MS, MaintenanceAccessDialog, TOO_MANY_ATTEMPTS_MESSAGE } from "./MaintenanceAccessDialog";

/** Modo mantenimiento (docs/decisions/FICHADOR_MAINTENANCE_MODE.md): "Acceso de mantenimiento". */
const IDENTITY = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", secret: "s".repeat(43) };
const DEVICE = { name: "Pañol 01", status: "ACTIVE", activatedAt: null, lastSeenAt: null, lastAppVersion: "1.4.0", connectivity: "ONLINE", establishment: null };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderDialog() {
  const onCancel = vi.fn();
  const onGranted = vi.fn();
  render(<MaintenanceAccessDialog onCancel={onCancel} onGranted={onGranted} />);
  return { onCancel, onGranted, input: screen.getByLabelText("Código"), submit: () => screen.getByRole("button", { name: "Ingresar" }) };
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

beforeEach(() => {
  setOnline(true);
  clockDeviceSession.start(IDENTITY);
});

afterEach(() => {
  clockDeviceSession.end();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "onLine");
});

describe("MaintenanceAccessDialog", () => {
  it("pide sólo el código: sin pistas, sin ids; Ingresar habilitado recién con 6 dígitos (se descartan letras)", async () => {
    const user = userEvent.setup();
    const { input, submit } = renderDialog();
    expect(screen.getByRole("dialog", { name: "Acceso de mantenimiento" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(submit()).toBeDisabled();
    await user.type(input, "48a2-731");
    expect(input).toHaveValue("482731");
    expect(submit()).toBeEnabled();
    expect(document.body.textContent).not.toMatch(new RegExp(`${IDENTITY.id}|ClockDevice|token|PIN`, "i"));
  });

  it("código válido: lo canjea con la credencial del equipo y abre la sesión con los segundos del servidor", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { data: { token: "t".repeat(43), expiresAt: "2026-10-26T12:10:00.000Z", expiresInSeconds: 600, device: DEVICE } }));
    vi.stubGlobal("fetch", fetchMock);
    const { input, onGranted } = renderDialog();
    const before = Date.now();
    await user.type(input, "482731{Enter}");

    await waitFor(() => expect(onGranted).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/clock\/maintenance\/session$/);
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ code: "482731" });
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("authorization")).toBe(`ClockDevice ${IDENTITY.id}.${IDENTITY.secret}`);
    expect(headers.get("x-clock-maintenance-session")).toBeNull();
    const granted = onGranted.mock.calls[0]![0];
    expect(granted).toMatchObject({ token: "t".repeat(43), device: DEVICE });
    expect(granted.deadline - before).toBeGreaterThanOrEqual(600_000);
    expect(granted.deadline - Date.now()).toBeLessThanOrEqual(600_000);
  });

  it.each([
    ["código inválido, vencido o de otro equipo", 401, { error: { code: "CLOCK_MAINTENANCE_CODE_INVALID", message: "x" } }, INVALID_CODE_MESSAGE],
    ["formato rechazado por el backend", 400, { error: { code: "VALIDATION_ERROR", message: "x" } }, INVALID_CODE_MESSAGE],
    ["demasiados intentos", 429, "Too many requests", TOO_MANY_ATTEMPTS_MESSAGE],
    ["servidor caído", 503, { error: { code: "INTERNAL_ERROR", message: "boom" } }, CONNECTION_MESSAGE],
  ])("%s → mensaje humano, el campo se limpia y no se abre nada", async (_label, status, body, message) => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(typeof body === "string" ? new Response(body, { status }) : jsonResponse(status, body)));
    const { input, onGranted } = renderDialog();
    await user.type(input, "482731{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(input).toHaveValue("");
    expect(onGranted).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/CLOCK_|VALIDATION|boom|503|429/);
    expect(clockDeviceSession.isActive()).toBe(true);
  });

  it("sin red: no envía nada y pide revisar la conexión", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setOnline(false);
    const { input } = renderDialog();
    await user.type(input, "482731{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(CONNECTION_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("la red se cae durante el envío → mismo mensaje de conexión", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { input } = renderDialog();
    await user.type(input, "482731{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(CONNECTION_MESSAGE);
  });

  it("equipo revocado: no muestra error propio; la sesión operativa se cierra (el Gate bloquea)", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, { error: { code: "CLOCK_DEVICE_REVOKED", message: "Este dispositivo fue deshabilitado por RRHH." } })));
    const failures: string[] = [];
    const unsubscribe = clockDeviceSession.onAuthFailure((failure) => failures.push(failure));
    const { input, onGranted } = renderDialog();
    await user.type(input, "482731{Enter}");
    await waitFor(() => expect(failures).toEqual(["CLOCK_DEVICE_REVOKED"]));
    expect(clockDeviceSession.isActive()).toBe(false);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onGranted).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("Cancelar vuelve al fichador sin enviar nada", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { onCancel } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sin actividad durante 60 s se cierra solo; escribir reinicia la espera", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { onCancel, input } = renderDialog();
    await act(async () => { await vi.advanceTimersByTimeAsync(MAINTENANCE_ACCESS_IDLE_MS - 1_000); });
    fireEvent.change(input, { target: { value: "48" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(MAINTENANCE_ACCESS_IDLE_MS - 1_000); });
    expect(onCancel).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
