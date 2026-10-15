import { afterEach, describe, expect, it, vi } from "vitest";
import { isIOSDevice, isStandaloneMode } from "./platform";

// F10: qué ayuda de instalación corresponde según cómo se abrió el fichador.
function setNavigator(values: Partial<{ userAgent: string; platform: string; maxTouchPoints: number; standalone: boolean }>) {
  for (const [key, value] of Object.entries(values)) Object.defineProperty(navigator, key, { value, configurable: true });
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ["userAgent", "platform", "maxTouchPoints", "standalone"]) Reflect.deleteProperty(navigator, key);
});

describe("isStandaloneMode", () => {
  it("abierto desde el ícono instalado (display-mode: standalone)", () => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query === "(display-mode: standalone)" })));
    expect(isStandaloneMode()).toBe(true);
  });

  it("iOS informa el modo instalado con navigator.standalone", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    setNavigator({ standalone: true });
    expect(isStandaloneMode()).toBe(true);
  });

  it("en una pestaña común no está instalado; sin matchMedia tampoco falla", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    expect(isStandaloneMode()).toBe(false);
    vi.stubGlobal("matchMedia", undefined);
    expect(isStandaloneMode()).toBe(false);
  });
});

describe("isIOSDevice", () => {
  it.each([
    ["iPhone", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1" }, true],
    ["iPad con iPadOS (se presenta como Mac con pantalla táctil)", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 5 }, true],
    ["Mac de escritorio", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 0 }, false],
    ["Android", { userAgent: "Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 Chrome/126.0 Safari/537.36", platform: "Linux armv8l", maxTouchPoints: 5 }, false],
  ] as const)("%s", (_label, values, expected) => {
    setNavigator(values);
    expect(isIOSDevice()).toBe(expected);
  });
});
