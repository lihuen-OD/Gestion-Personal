import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

// F10: el aviso de instalación propio del navegador (Chromium) se guarda al
// arrancar y se usa una sola vez desde la guía de puesta en marcha.
let module: typeof import("./installPrompt");
let target: EventTarget;

function installEvent() {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: ReturnType<typeof vi.fn> };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  return event;
}

beforeEach(async () => {
  vi.resetModules();
  module = await import("./installPrompt");
  target = new EventTarget();
  module.startInstallPromptCapture(target as unknown as Window);
});

describe("installPrompt", () => {
  it("sin aviso del navegador (iOS, Firefox): no hay instalación directa", () => {
    const { result } = renderHook(() => module.useInstallPrompt());
    expect(result.current.available).toBe(false);
  });

  it("guarda el aviso (evitando el del navegador) y lo usa una sola vez", async () => {
    const { result } = renderHook(() => module.useInstallPrompt());
    const event = installEvent();
    act(() => { target.dispatchEvent(event); });

    expect(event.defaultPrevented).toBe(true);
    expect(result.current.available).toBe(true);

    await act(async () => { await result.current.prompt(); });
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(result.current.available).toBe(false);

    await act(async () => { await result.current.prompt(); });
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it("un aviso que llegó antes de montar la guía igual queda disponible", () => {
    target.dispatchEvent(installEvent());
    const { result } = renderHook(() => module.useInstallPrompt());
    expect(result.current.available).toBe(true);
  });

  it("una vez instalada la app deja de ofrecerse", () => {
    const { result } = renderHook(() => module.useInstallPrompt());
    act(() => { target.dispatchEvent(installEvent()); });
    act(() => { target.dispatchEvent(new Event("appinstalled")); });
    expect(result.current.available).toBe(false);
  });
});
