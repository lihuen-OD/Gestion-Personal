import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useClockWakeLock } from "./useClockWakeLock";

// F10 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §29).
type Sentinel = { released: boolean; release: ReturnType<typeof vi.fn>; addEventListener: ReturnType<typeof vi.fn>; fireRelease: () => void };

function makeSentinel(): Sentinel {
  let onRelease: (() => void) | undefined;
  const sentinel: Sentinel = {
    released: false,
    release: vi.fn(async () => { sentinel.released = true; onRelease?.(); }),
    addEventListener: vi.fn((_type: string, listener: () => void) => { onRelease = listener; }),
    fireRelease: () => { sentinel.released = true; onRelease?.(); },
  };
  return sentinel;
}

let visibility: DocumentVisibilityState = "visible";
let sentinels: Sentinel[] = [];
const request = vi.fn();
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  visibility = "visible";
  sentinels = [];
  request.mockReset().mockImplementation(async () => { const sentinel = makeSentinel(); sentinels.push(sentinel); return sentinel; });
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "wakeLock");
});

describe("useClockWakeLock", () => {
  it("habilitado y visible: pide un bloqueo de pantalla", async () => {
    renderHook(() => useClockWakeLock(true));
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("screen");
  });

  it("deshabilitado (PENDING, REVOKED o sin credencial): no pide nada", async () => {
    renderHook(() => useClockWakeLock(false));
    setVisibility("hidden");
    setVisibility("visible");
    await flush();
    expect(request).not.toHaveBeenCalled();
  });

  it("si arranca oculto no lo pide hasta quedar visible", async () => {
    visibility = "hidden";
    renderHook(() => useClockWakeLock(true));
    await flush();
    expect(request).not.toHaveBeenCalled();
    setVisibility("visible");
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("el sistema lo libera al pasar a segundo plano y se vuelve a pedir al volver", async () => {
    renderHook(() => useClockWakeLock(true));
    await flush();
    setVisibility("hidden");
    sentinels[0]!.fireRelease();
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("nunca dos bloqueos a la vez: volver a primer plano con el bloqueo vigente no pide otro", async () => {
    renderHook(() => useClockWakeLock(true));
    await flush();
    setVisibility("visible");
    setVisibility("visible");
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("sin la API el fichador sigue igual (no falla)", async () => {
    Reflect.deleteProperty(navigator, "wakeLock");
    expect(() => renderHook(() => useClockWakeLock(true))).not.toThrow();
    await flush();
  });

  it("si el sistema lo rechaza no rompe ni reintenta en loop; vuelve a intentar al volver a primer plano", async () => {
    request.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    renderHook(() => useClockWakeLock(true));
    await flush();
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("al deshabilitarse (revocado) o desmontar libera el bloqueo y deja de escuchar", async () => {
    const { rerender, unmount } = renderHook(({ enabled }) => useClockWakeLock(enabled), { initialProps: { enabled: true } });
    await flush();
    rerender({ enabled: false });
    await flush();
    expect(sentinels[0]!.release).toHaveBeenCalledTimes(1);

    rerender({ enabled: true });
    await flush();
    unmount();
    await flush();
    expect(sentinels[1]!.release).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("si se deshabilita mientras el pedido está en vuelo, libera el bloqueo apenas llega", async () => {
    let resolve!: (value: Sentinel) => void;
    request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const { rerender } = renderHook(({ enabled }) => useClockWakeLock(enabled), { initialProps: { enabled: true } });
    rerender({ enabled: false });
    const late = makeSentinel();
    await act(async () => { resolve(late); });
    await flush();
    expect(late.release).toHaveBeenCalledTimes(1);
  });
});
