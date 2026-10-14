import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { ApiError, NetworkError } from "../../services/api/apiClient";
import { timeClockApiService } from "../../services/api/timeClockApiService";
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_MIN_GAP_MS, useClockDeviceHeartbeat } from "./useClockDeviceHeartbeat";

// F9 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §28). Timers falsos: el
// intervalo y las separaciones se adelantan sin esperas reales.
vi.mock("../../services/api/timeClockApiService", () => ({ timeClockApiService: { heartbeat: vi.fn() } }));

const heartbeat = vi.mocked(timeClockApiService.heartbeat);
const OK = { device: { id: "d1", name: "Pañol", status: "ACTIVE" as const, establishment: null }, serverTime: "2026-10-14T12:00:00.000Z" };
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
let visibility: DocumentVisibilityState = "visible";

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  visibility = "visible";
  heartbeat.mockReset().mockResolvedValue(OK);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useClockDeviceHeartbeat", () => {
  it("habilitado: uno inmediato y después uno por minuto", async () => {
    renderHook(() => useClockDeviceHeartbeat(true));
    await advance(0);
    expect(heartbeat).toHaveBeenCalledTimes(1);

    await advance(HEARTBEAT_INTERVAL_MS);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    await advance(2 * HEARTBEAT_INTERVAL_MS);
    expect(heartbeat).toHaveBeenCalledTimes(4);
  });

  it("deshabilitado (PENDING, REVOKED o sin credencial): nunca manda nada", async () => {
    renderHook(() => useClockDeviceHeartbeat(false));
    setVisibility("visible");
    await advance(5 * HEARTBEAT_INTERVAL_MS);
    expect(heartbeat).not.toHaveBeenCalled();
  });

  it("al volver a primer plano manda uno enseguida; ocultarse no manda y no hay ráfagas", async () => {
    renderHook(() => useClockDeviceHeartbeat(true));
    await advance(30_000);
    expect(heartbeat).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    await advance(0);
    expect(heartbeat).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await advance(0);
    expect(heartbeat).toHaveBeenCalledTimes(2);

    // Volver otra vez enseguida, o el tick del minuto justo después, no duplican.
    setVisibility("hidden");
    setVisibility("visible");
    await advance(HEARTBEAT_MIN_GAP_MS - 1_000);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    await advance(HEARTBEAT_INTERVAL_MS);
    expect(heartbeat).toHaveBeenCalledTimes(3);
  });

  it("nunca dos a la vez: mientras uno no responde, el tick siguiente no manda otro", async () => {
    let release!: (value: typeof OK) => void;
    heartbeat.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    renderHook(() => useClockDeviceHeartbeat(true));
    await advance(0);
    await advance(HEARTBEAT_INTERVAL_MS);
    expect(heartbeat).toHaveBeenCalledTimes(1);

    await act(async () => { release(OK); });
    await advance(HEARTBEAT_INTERVAL_MS);
    expect(heartbeat).toHaveBeenCalledTimes(2);
  });

  it("sin red (o 5xx/429): silencio y sigue intentando en el próximo tick", async () => {
    heartbeat.mockRejectedValueOnce(new NetworkError()).mockRejectedValueOnce(new ApiError("x", "API_ERROR", 503)).mockRejectedValueOnce(new ApiError("x", "API_ERROR", 429));
    renderHook(() => useClockDeviceHeartbeat(true));
    await advance(0);
    await advance(3 * HEARTBEAT_INTERVAL_MS);
    expect(heartbeat).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["revocado", new ApiError("Este dispositivo fue deshabilitado por RRHH.", "CLOCK_DEVICE_REVOKED", 403)],
    ["credencial inválida", new ApiError("x", "CLOCK_DEVICE_INVALID_CREDENTIAL", 401)],
    ["sin sesión", new ApiError("x", "CLOCK_DEVICE_SESSION_MISSING", 401)],
  ])("%s: deja de mandar (el Gate ya bloquea) y no reintenta ni al volver a primer plano", async (_label, failure) => {
    heartbeat.mockRejectedValueOnce(failure);
    renderHook(() => useClockDeviceHeartbeat(true));
    await advance(0);
    await advance(3 * HEARTBEAT_INTERVAL_MS);
    setVisibility("hidden");
    setVisibility("visible");
    await advance(0);
    expect(heartbeat).toHaveBeenCalledTimes(1);
  });

  it("al desmontar limpia el intervalo y el listener", async () => {
    const { unmount } = renderHook(() => useClockDeviceHeartbeat(true));
    await advance(0);
    unmount();
    await advance(3 * HEARTBEAT_INTERVAL_MS);
    setVisibility("visible");
    await advance(0);
    expect(heartbeat).toHaveBeenCalledTimes(1);
  });

  it("re-renders no duplican el intervalo; deshabilitar lo corta y rehabilitar manda uno inmediato", async () => {
    const { rerender } = renderHook(({ enabled }) => useClockDeviceHeartbeat(enabled), { initialProps: { enabled: true } });
    await advance(0);
    rerender({ enabled: true });
    rerender({ enabled: true });
    await advance(HEARTBEAT_INTERVAL_MS);
    expect(heartbeat).toHaveBeenCalledTimes(2);

    rerender({ enabled: false });
    await advance(3 * HEARTBEAT_INTERVAL_MS);
    expect(heartbeat).toHaveBeenCalledTimes(2);

    rerender({ enabled: true });
    await advance(0);
    expect(heartbeat).toHaveBeenCalledTimes(3);
  });
});
