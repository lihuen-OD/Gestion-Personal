import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AUTO_RETRY_MESSAGE, ClockDeviceGate, POLL_INTERRUPTED_MESSAGE, VERIFY_RETRY_DELAYS_MS } from "./ClockDeviceGate";
import { clockDeviceStorage } from "./clockDeviceStorage";
import { ApiError, NetworkError } from "../../services/api/apiClient";
import { clockDeviceApiService, type ClockDeviceState } from "../../services/api/clockDeviceApiService";
import { clockDeviceSession } from "../../services/api/clockDeviceSession";

/**
 * Etapa 6B-4 (AUDITORIA_6A F6-06 / F6-07): el Gate se recupera solo después
 * de un corte y avisa cuando la consulta de aprobación falla, sin dar nunca
 * por aprobado un equipo que el servidor no confirmó ACTIVE. Temporizadores
 * simulados; estado del dispositivo simulado (sin backend).
 */
vi.mock("./clockDeviceStorage", () => ({ clockDeviceStorage: { get: vi.fn(), set: vi.fn(), clear: vi.fn() } }));
vi.mock("../../services/api/clockDeviceApiService", () => ({ clockDeviceApiService: { register: vi.fn(), status: vi.fn(), refreshPairing: vi.fn() } }));

const IDENTITY = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", secret: "s".repeat(43) };
const device = (status: ClockDeviceState["status"], extra: Partial<ClockDeviceState> = {}): ClockDeviceState => ({ id: IDENTITY.id, name: "Recepción", status, ...extra });
const POLL_MS = 7_500;

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const statusCalls = () => vi.mocked(clockDeviceApiService.status).mock.calls.length;
const goOnline = () => act(() => { window.dispatchEvent(new Event("online")); });
const fichador = () => screen.queryByText("Fichador de personal");
const transient = () => screen.queryByRole("heading", { name: "No pudimos verificar el dispositivo" });

async function renderGate() {
  render(<ClockDeviceGate><h1>Fichador de personal</h1></ClockDeviceGate>);
  await advance(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
  vi.mocked(clockDeviceStorage.get).mockResolvedValue(IDENTITY);
});

afterEach(() => {
  clockDeviceSession.end();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("F6-06 — recuperación automática de la verificación", () => {
  it("sin red al abrir: reintenta solo y, con ACTIVE confirmado por el servidor, muestra el fichador", async () => {
    vi.mocked(clockDeviceApiService.status).mockRejectedValueOnce(new NetworkError()).mockResolvedValue(device("ACTIVE"));
    await renderGate();
    expect(transient()).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(AUTO_RETRY_MESSAGE);
    expect(clockDeviceSession.isActive()).toBe(false);
    await advance(VERIFY_RETRY_DELAYS_MS[0]!);
    expect(fichador()).toBeInTheDocument();
    expect(clockDeviceSession.isActive()).toBe(true);
    expect(clockDeviceApiService.register).not.toHaveBeenCalled();
  });

  it("al volver la red consulta en el acto; tener red no alcanza: sigue bloqueado mientras el servidor no confirme", async () => {
    vi.mocked(clockDeviceApiService.status).mockRejectedValue(new NetworkError());
    await renderGate();
    const before = statusCalls();
    goOnline();
    await advance(0);
    expect(statusCalls()).toBe(before + 1);
    expect(transient()).toBeInTheDocument();
    expect(fichador()).not.toBeInTheDocument();
    expect(clockDeviceSession.isActive()).toBe(false);
    vi.mocked(clockDeviceApiService.status).mockResolvedValue(device("ACTIVE"));
    goOnline();
    await advance(0);
    expect(fichador()).toBeInTheDocument();
  });

  it("si el servidor responde que fue revocado, la recuperación no lo elude", async () => {
    vi.mocked(clockDeviceApiService.status).mockRejectedValueOnce(new NetworkError()).mockResolvedValue(device("REVOKED"));
    await renderGate();
    await advance(VERIFY_RETRY_DELAYS_MS[0]!);
    expect(screen.getByRole("heading", { name: "Dispositivo deshabilitado" })).toBeInTheDocument();
    expect(fichador()).not.toBeInTheDocument();
    const calls = statusCalls();
    await advance(10 * 60_000);
    expect(statusCalls()).toBe(calls);
  });

  it("401 (credencial inválida) al reintentar: autorización perdida y no se sigue reintentando", async () => {
    vi.mocked(clockDeviceApiService.status).mockRejectedValueOnce(new NetworkError()).mockRejectedValue(new ApiError("x", "CLOCK_DEVICE_INVALID_CREDENTIAL", 401));
    await renderGate();
    await advance(VERIFY_RETRY_DELAYS_MS[0]!);
    expect(screen.getByRole("heading", { name: "Autorización perdida" })).toBeInTheDocument();
    const calls = statusCalls();
    goOnline();
    await advance(10 * 60_000);
    expect(statusCalls()).toBe(calls);
  });

  it("403/5xx siguen siendo transitorios: espera creciente, nunca alta frecuencia", async () => {
    vi.mocked(clockDeviceApiService.status).mockRejectedValue(new ApiError("x", "INTERNAL_ERROR", 503));
    await renderGate();
    const start = statusCalls();
    await advance(5_000);
    expect(statusCalls()).toBe(start + 1);
    await advance(10_000);
    expect(statusCalls()).toBe(start + 2);
    await advance(20_000);
    expect(statusCalls()).toBe(start + 3);
    // Avance en pasos: cada reintento se reprograma después de que React renderiza la falla anterior.
    for (let elapsed = 0; elapsed < 30_000 + 60_000 * 3; elapsed += 5_000) await advance(5_000);
    expect(statusCalls()).toBe(start + 7); // a los 5, 15, 35, 65 s y luego cada 60 s (125, 185, 245)
  });

  it("429: respeta la espera del backend aunque vuelva la red", async () => {
    vi.mocked(clockDeviceApiService.status).mockRejectedValueOnce(new ApiError("x", "RATE_LIMITED", 429, 120)).mockResolvedValue(device("ACTIVE"));
    await renderGate();
    const calls = statusCalls();
    goOnline();
    await advance(119_000);
    expect(statusCalls()).toBe(calls);
    expect(fichador()).not.toBeInTheDocument();
    await advance(1_000);
    expect(fichador()).toBeInTheDocument();
  });

  it("sin consultas simultáneas: varios eventos de red con una consulta en vuelo hacen una sola", async () => {
    let release: (value: ClockDeviceState) => void = () => undefined;
    vi.mocked(clockDeviceApiService.status).mockRejectedValueOnce(new NetworkError()).mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    await renderGate();
    const calls = statusCalls();
    goOnline(); goOnline(); goOnline();
    fireEvent.click(screen.getByRole("button", { name: /Verificando…|Reintentar/ }));
    await advance(0);
    expect(statusCalls()).toBe(calls + 1);
    await act(async () => { release(device("ACTIVE")); });
    expect(fichador()).toBeInTheDocument();
  });

  it("el reintento manual sigue disponible", async () => {
    vi.mocked(clockDeviceApiService.status).mockRejectedValueOnce(new NetworkError()).mockResolvedValue(device("ACTIVE"));
    await renderGate();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await advance(0);
    expect(fichador()).toBeInTheDocument();
  });
});

describe("F6-07 — consulta de aprobación interrumpida", () => {
  async function pendingWithCode() {
    vi.mocked(clockDeviceStorage.get).mockResolvedValue(undefined);
    vi.mocked(clockDeviceApiService.register).mockResolvedValue({ identity: IDENTITY, device: device("PENDING", { pairingCode: "K7Q4-M2XB", pairingExpiresAt: new Date(Date.now() + 600_000).toISOString() }) });
    await renderGate();
    fireEvent.click(screen.getByRole("button", { name: "Configurar dispositivo" }));
    await advance(0);
    expect(screen.getByText("Código de vinculación")).toBeInTheDocument();
  }
  const interrupted = () => screen.queryByText(POLL_INTERRUPTED_MESSAGE);
  const waitingPill = () => screen.queryByText("Se habilita sola cuando RRHH lo apruebe");

  it("consulta exitosa sin aprobación: espera normal, sin aviso", async () => {
    vi.mocked(clockDeviceApiService.status).mockResolvedValue(device("PENDING"));
    await pendingWithCode();
    await advance(3 * POLL_MS);
    expect(waitingPill()).toBeInTheDocument();
    expect(interrupted()).not.toBeInTheDocument();
  });

  it("una falla aislada no parpadea; dos seguidas se avisan, conservando el código y sin generar otro", async () => {
    vi.mocked(clockDeviceApiService.status).mockRejectedValue(new NetworkError());
    await pendingWithCode();
    await advance(POLL_MS);
    expect(interrupted()).not.toBeInTheDocument();
    expect(waitingPill()).toBeInTheDocument();
    await advance(POLL_MS);
    expect(interrupted()).toBeInTheDocument();
    expect(interrupted()!.closest("[role='status']")).not.toBeNull();
    expect(waitingPill()).not.toBeInTheDocument();
    expect(screen.getByText("Código de vinculación")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Esperando aprobación" })).toBeInTheDocument();
    expect(clockDeviceApiService.refreshPairing).not.toHaveBeenCalled();
    expect(clockDeviceApiService.register).toHaveBeenCalledTimes(1);
    expect(fichador()).not.toBeInTheDocument();
  });

  it("se recupera: la siguiente consulta exitosa quita el aviso; al volver la red consulta en el acto", async () => {
    vi.mocked(clockDeviceApiService.status).mockRejectedValue(new NetworkError());
    await pendingWithCode();
    await advance(2 * POLL_MS);
    expect(interrupted()).toBeInTheDocument();
    vi.mocked(clockDeviceApiService.status).mockResolvedValue(device("PENDING"));
    const calls = statusCalls();
    goOnline();
    await advance(0);
    expect(statusCalls()).toBe(calls + 1);
    expect(interrupted()).not.toBeInTheDocument();
    expect(waitingPill()).toBeInTheDocument();
  });

  it("la aprobación real (ACTIVE) habilita el fichador; un aviso previo no la impide", async () => {
    vi.mocked(clockDeviceApiService.status).mockRejectedValueOnce(new NetworkError()).mockRejectedValueOnce(new NetworkError()).mockResolvedValue(device("ACTIVE"));
    await pendingWithCode();
    await advance(2 * POLL_MS);
    expect(interrupted()).toBeInTheDocument();
    await advance(POLL_MS);
    expect(fichador()).toBeInTheDocument();
  });

  it("revocación durante la espera: bloquea", async () => {
    vi.mocked(clockDeviceApiService.status).mockResolvedValue(device("REVOKED"));
    await pendingWithCode();
    await advance(POLL_MS);
    expect(screen.getByRole("heading", { name: "Dispositivo deshabilitado" })).toBeInTheDocument();
    expect(fichador()).not.toBeInTheDocument();
  });

  it("429 durante la espera: no consulta antes de lo indicado por el backend", async () => {
    vi.mocked(clockDeviceApiService.status).mockRejectedValueOnce(new ApiError("x", "RATE_LIMITED", 429, 60)).mockResolvedValue(device("PENDING"));
    await pendingWithCode();
    await advance(POLL_MS);
    const calls = statusCalls();
    await advance(52_000); // t ≈ 59,5 s: todavía dentro de la espera (hasta 67,5 s)
    expect(statusCalls()).toBe(calls);
    await advance(2 * POLL_MS); // el tick de 67,5 s ya puede consultar
    expect(statusCalls()).toBe(calls + 1);
  });

  it("nunca dos consultas a la vez aunque una tarde más que el intervalo", async () => {
    vi.mocked(clockDeviceApiService.status).mockImplementation(() => new Promise(() => {}));
    await pendingWithCode();
    await advance(5 * POLL_MS);
    goOnline();
    await advance(0);
    expect(statusCalls()).toBe(1);
  });
});
