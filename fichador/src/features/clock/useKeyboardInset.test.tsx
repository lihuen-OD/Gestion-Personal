import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KEYBOARD_INSET_VAR, keyboardInset, useKeyboardInset } from "./useKeyboardInset";

describe("keyboardInset", () => {
  it("es la parte del viewport de layout que tapa el teclado", () => {
    expect(keyboardInset(844, { height: 508, offsetTop: 0, scale: 1 })).toBe(336);
    // Safari puede desplazar el visualViewport hacia abajo: lo tapado es lo que queda debajo.
    expect(keyboardInset(844, { height: 508, offsetTop: 120, scale: 1 })).toBe(216);
  });

  it("vale 0 sin teclado, sin visualViewport o con zoom", () => {
    expect(keyboardInset(844, { height: 844, offsetTop: 0, scale: 1 })).toBe(0);
    expect(keyboardInset(844, null)).toBe(0);
    expect(keyboardInset(844, { height: 400, offsetTop: 0, scale: 2 })).toBe(0);
  });
});

describe("useKeyboardInset", () => {
  const original = Object.getOwnPropertyDescriptor(window, "visualViewport");
  afterEach(() => {
    if (original) Object.defineProperty(window, "visualViewport", original);
    else delete (window as { visualViewport?: unknown }).visualViewport;
    vi.restoreAllMocks();
  });

  function fakeViewport(height: number) {
    const target = new EventTarget() as EventTarget & { height: number; offsetTop: number; scale: number };
    target.height = height;
    target.offsetTop = 0;
    target.scale = 1;
    Object.defineProperty(window, "visualViewport", { configurable: true, value: target });
    return target;
  }

  function Probe() {
    useKeyboardInset();
    return null;
  }

  it("publica el alto tapado, lo actualiza con el teclado y lo limpia al desmontar", async () => {
    // Como el real, el cuadro llega después de devolver el identificador.
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      queueMicrotask(() => callback(0));
      return 1;
    });
    const viewport = fakeViewport(window.innerHeight);
    const root = document.documentElement;
    const { unmount } = render(<Probe />);
    expect(root.style.getPropertyValue(KEYBOARD_INSET_VAR)).toBe("0px");

    await act(async () => {
      viewport.height = window.innerHeight - 300;
      viewport.dispatchEvent(new Event("resize"));
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(root.style.getPropertyValue(KEYBOARD_INSET_VAR)).toBe("300px");

    await act(async () => {
      viewport.height = window.innerHeight;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(root.style.getPropertyValue(KEYBOARD_INSET_VAR)).toBe("0px");

    unmount();
    expect(root.style.getPropertyValue(KEYBOARD_INSET_VAR)).toBe("");
  });

  it("sin visualViewport no hace nada", () => {
    Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
    render(<Probe />);
    expect(document.documentElement.style.getPropertyValue(KEYBOARD_INSET_VAR)).toBe("");
  });
});
