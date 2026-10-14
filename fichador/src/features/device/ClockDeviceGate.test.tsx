import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClockDeviceGate } from "./ClockDeviceGate";
import { clockDeviceStorage } from "./clockDeviceStorage";
import { ApiError, NetworkError } from "../../services/api/apiClient";
import { clockDeviceApiService } from "../../services/api/clockDeviceApiService";
import { clockDeviceSession } from "../../services/api/clockDeviceSession";
import { timeClockApiService } from "../../services/api/timeClockApiService";

vi.mock("./clockDeviceStorage", () => ({ clockDeviceStorage: { get: vi.fn(), set: vi.fn(), clear: vi.fn() } }));
vi.mock("../../services/api/clockDeviceApiService", () => ({ clockDeviceApiService: { register: vi.fn(), status: vi.fn(), refreshPairing: vi.fn() } }));

const IDENTITY = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", secret: "s".repeat(43) };
const device = (status: "PENDING" | "ACTIVE" | "REVOKED") => ({ id: IDENTITY.id, name: "Recepción", status });

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderGate() {
  return render(<ClockDeviceGate><h1>Fichador de personal</h1></ClockDeviceGate>);
}

/** Simula el siguiente request operativo del fichador con la respuesta dada por el backend. */
async function nextOperationalRequest(status: number, code: string) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(status, { error: { code, message: "rechazado" } })));
  await act(async () => { await timeClockApiService.searchEmployees("ana").catch(() => undefined); });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clockDeviceStorage.clear).mockResolvedValue(undefined);
  // jsdom no implementa matchMedia; el Gate lo usa para detectar la PWA instalada.
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  clockDeviceSession.end();
});

describe("ClockDeviceGate — sólo un ClockDevice ACTIVE opera (F6)", () => {
  it("sin identidad en IndexedDB muestra la configuración y no habilita requests operativos", async () => {
    vi.mocked(clockDeviceStorage.get).mockResolvedValue(undefined);
    renderGate();

    expect(await screen.findByRole("button", { name: "Configurar dispositivo" })).toBeInTheDocument();
    expect(screen.queryByText("Fichador de personal")).not.toBeInTheDocument();
    expect(clockDeviceSession.isActive()).toBe(false);
    expect(clockDeviceApiService.status).not.toHaveBeenCalled();
  });

  it("ACTIVE muestra el fichador con la sesión individual abierta", async () => {
    vi.mocked(clockDeviceStorage.get).mockResolvedValue(IDENTITY);
    vi.mocked(clockDeviceApiService.status).mockResolvedValue(device("ACTIVE"));
    renderGate();

    expect(await screen.findByText("Fichador de personal")).toBeInTheDocument();
    expect(clockDeviceSession.isActive()).toBe(true);
  });

  it("PENDING queda bloqueado sin sesión operativa", async () => {
    vi.mocked(clockDeviceStorage.get).mockResolvedValue(IDENTITY);
    vi.mocked(clockDeviceApiService.status).mockResolvedValue(device("PENDING"));
    renderGate();

    expect(await screen.findByRole("heading", { name: "Esperando aprobación" })).toBeInTheDocument();
    expect(screen.queryByText("Fichador de personal")).not.toBeInTheDocument();
    expect(clockDeviceSession.isActive()).toBe(false);
  });

  it("REVOKED al abrir: deshabilitado y sólo ofrece configurar como nuevo, con confirmación", async () => {
    const user = userEvent.setup();
    vi.mocked(clockDeviceStorage.get).mockResolvedValue(IDENTITY);
    vi.mocked(clockDeviceApiService.status).mockResolvedValue(device("REVOKED"));
    renderGate();

    expect(await screen.findByRole("heading", { name: "Dispositivo deshabilitado" })).toBeInTheDocument();
    expect(screen.getByText(/Este dispositivo fue deshabilitado por RRHH/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Configurar como nuevo dispositivo" }));
    expect(screen.getByRole("alertdialog", { name: "Confirmar reconfiguración" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(clockDeviceStorage.clear).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Configurar como nuevo dispositivo" }));
    await user.click(screen.getByRole("button", { name: "Borrar y configurar" }));
    expect(clockDeviceStorage.clear).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Configurar dispositivo" })).toBeInTheDocument();
  });

  it("RRHH revoca con la app abierta: el siguiente request cierra el fichador y no deja reintentar", async () => {
    vi.mocked(clockDeviceStorage.get).mockResolvedValue(IDENTITY);
    vi.mocked(clockDeviceApiService.status).mockResolvedValue(device("ACTIVE"));
    renderGate();
    await screen.findByText("Fichador de personal");

    await nextOperationalRequest(403, "CLOCK_DEVICE_REVOKED");

    expect(screen.getByRole("heading", { name: "Dispositivo deshabilitado" })).toBeInTheDocument();
    expect(screen.queryByText("Fichador de personal")).not.toBeInTheDocument();
    expect(clockDeviceSession.isActive()).toBe(false);
    await expect(timeClockApiService.status("employee-1")).rejects.toMatchObject({ code: "CLOCK_DEVICE_SESSION_MISSING" });
    expect(clockDeviceStorage.clear).not.toHaveBeenCalled();
  });

  it("credencial inválida en medio de la sesión: autorización perdida + reconfigurar con confirmación", async () => {
    const user = userEvent.setup();
    vi.mocked(clockDeviceStorage.get).mockResolvedValue(IDENTITY);
    vi.mocked(clockDeviceApiService.status).mockResolvedValue(device("ACTIVE"));
    renderGate();
    await screen.findByText("Fichador de personal");

    await nextOperationalRequest(401, "CLOCK_DEVICE_INVALID_CREDENTIAL");

    expect(screen.getByRole("heading", { name: "Autorización perdida" })).toBeInTheDocument();
    expect(screen.getByText("Este dispositivo perdió su autorización. Volvé a configurarlo.")).toBeInTheDocument();
    expect(screen.queryByText("Fichador de personal")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reconfigurar dispositivo" }));
    expect(clockDeviceStorage.clear).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Borrar y configurar" }));
    expect(clockDeviceStorage.clear).toHaveBeenCalledTimes(1);
  });

  it("NOT_ACTIVE en medio de la sesión: bloquea y vuelve a preguntar el estado real", async () => {
    vi.mocked(clockDeviceStorage.get).mockResolvedValue(IDENTITY);
    vi.mocked(clockDeviceApiService.status).mockResolvedValueOnce(device("ACTIVE")).mockResolvedValueOnce(device("PENDING"));
    renderGate();
    await screen.findByText("Fichador de personal");

    await nextOperationalRequest(403, "CLOCK_DEVICE_NOT_ACTIVE");

    expect(await screen.findByRole("heading", { name: "Esperando aprobación" })).toBeInTheDocument();
    expect(screen.queryByText("Fichador de personal")).not.toBeInTheDocument();
    expect(clockDeviceApiService.status).toHaveBeenCalledTimes(2);
  });

  it("credencial inválida al abrir: no muestra el fichador y ofrece reconfigurar", async () => {
    vi.mocked(clockDeviceStorage.get).mockResolvedValue(IDENTITY);
    vi.mocked(clockDeviceApiService.status).mockRejectedValue(new ApiError("Este dispositivo perdió su autorización. Volvé a configurarlo.", "CLOCK_DEVICE_INVALID_CREDENTIAL", 401));
    renderGate();

    expect(await screen.findByRole("heading", { name: "Autorización perdida" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconfigurar dispositivo" })).toBeInTheDocument();
  });

  it("sin red al verificar: reintentar, nunca borrar ni ofrecer reconfigurar", async () => {
    const user = userEvent.setup();
    vi.mocked(clockDeviceStorage.get).mockResolvedValue(IDENTITY);
    vi.mocked(clockDeviceApiService.status).mockRejectedValueOnce(new NetworkError()).mockResolvedValueOnce(device("ACTIVE"));
    renderGate();

    expect(await screen.findByRole("heading", { name: "No pudimos verificar el dispositivo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reconfigurar|Configurar como nuevo/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.getByText("Fichador de personal")).toBeInTheDocument());
    expect(clockDeviceStorage.clear).not.toHaveBeenCalled();
  });
});

// F9 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §28): el Gate es el único
// que manda heartbeats, y sólo con la sesión operativa abierta.
describe("ClockDeviceGate — heartbeat (F9)", () => {
  const heartbeatCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/clock/heartbeat"));

  it("ACTIVE: manda el heartbeat al abrir, con la credencial del equipo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { data: { device: device("ACTIVE"), serverTime: new Date().toISOString() } })));
    vi.mocked(clockDeviceStorage.get).mockResolvedValue(IDENTITY);
    vi.mocked(clockDeviceApiService.status).mockResolvedValue(device("ACTIVE"));
    renderGate();
    await screen.findByText("Fichador de personal");

    await waitFor(() => expect(heartbeatCalls()).toHaveLength(1));
    const [, init] = heartbeatCalls()[0]!;
    expect((init as RequestInit).method).toBe("POST");
    expect(new Headers((init as RequestInit).headers).get("authorization")).toBe(`ClockDevice ${IDENTITY.id}.${IDENTITY.secret}`);
    expect((init as RequestInit).body).toBeUndefined();
  });

  it.each(["PENDING", "REVOKED"] as const)("%s: no manda heartbeat", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {})));
    vi.mocked(clockDeviceStorage.get).mockResolvedValue(IDENTITY);
    vi.mocked(clockDeviceApiService.status).mockResolvedValue(device(status));
    renderGate();
    await screen.findByRole("heading", { name: status === "PENDING" ? "Esperando aprobación" : "Dispositivo deshabilitado" });

    expect(heartbeatCalls()).toHaveLength(0);
  });

  it("un heartbeat rechazado porque RRHH revocó el equipo cierra el fichador sin reintentos (mecanismo F6)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, { error: { code: "CLOCK_DEVICE_REVOKED", message: "Este dispositivo fue deshabilitado por RRHH." } })));
    vi.mocked(clockDeviceStorage.get).mockResolvedValue(IDENTITY);
    vi.mocked(clockDeviceApiService.status).mockResolvedValue(device("ACTIVE"));
    renderGate();

    expect(await screen.findByRole("heading", { name: "Dispositivo deshabilitado" })).toBeInTheDocument();
    expect(screen.queryByText("Fichador de personal")).not.toBeInTheDocument();
    expect(clockDeviceSession.isActive()).toBe(false);
    expect(heartbeatCalls()).toHaveLength(1);
    expect(clockDeviceStorage.clear).not.toHaveBeenCalled();
  });

  it("sin red el heartbeat falla en silencio: el fichador sigue abierto y la sesión intacta", async () => {
    vi.mocked(clockDeviceStorage.get).mockResolvedValue(IDENTITY);
    vi.mocked(clockDeviceApiService.status).mockResolvedValue(device("ACTIVE"));
    renderGate();
    await screen.findByText("Fichador de personal");

    await waitFor(() => expect(heartbeatCalls()).toHaveLength(1));
    expect(screen.getByText("Fichador de personal")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(clockDeviceSession.isActive()).toBe(true);
  });
});
