import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MEDIAPIPE_MODEL_PATH, MEDIAPIPE_WASM_PATH, MODEL_SHA256, NOSIMD_FILES, SIMD_FILES } from "./mediapipe-assets.mjs";
import { manifest, pwaOptions, workbox } from "./pwa-config.mjs";

const file = (path) => new URL(path, import.meta.url);
const pngSize = (path) => {
  const buffer = readFileSync(file(path));
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
};

// F3 — PWA del fichador standalone.
describe("manifest", () => {
  it("app instalable en modo standalone, con scope y start_url en la raíz", () => {
    expect(manifest).toMatchObject({ display: "standalone", start_url: "/", scope: "/", short_name: "Fichador", lang: "es-AR", orientation: "any" });
  });

  it("íconos 192/512 y maskable existen y tienen el tamaño declarado", () => {
    for (const icon of manifest.icons) {
      const [width, height] = icon.sizes.split("x").map(Number);
      expect(pngSize(`../public${icon.src}`)).toEqual({ width, height });
    }
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
    expect(pngSize("../public/icons/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
  });

  it("index.html enlaza el ícono de iOS, el modo app y viewport-fit=cover para las safe areas", () => {
    const html = readFileSync(file("../index.html"), "utf8");
    expect(html).toContain('rel="apple-touch-icon" href="/icons/apple-touch-icon.png"');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain("viewport-fit=cover");
  });
});

describe("service worker (Workbox)", () => {
  it("precachea el WASM SIMD y el modelo, no la variante sin SIMD", () => {
    for (const name of SIMD_FILES) expect(workbox.globPatterns).toContain(`${MEDIAPIPE_WASM_PATH.slice(1)}/${name}`);
    expect(workbox.globPatterns).toContain(MEDIAPIPE_MODEL_PATH.slice(1));
    for (const name of NOSIMD_FILES) expect(workbox.globIgnores).toContain(`${MEDIAPIPE_WASM_PATH.slice(1)}/${name}`);
  });

  it("el límite de tamaño alcanza para el WASM SIMD real", () => {
    const wasm = statSync(file("../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm")).size;
    expect(workbox.maximumFileSizeToCacheInBytes).toBeGreaterThan(wasm);
  });

  it("nunca cachea el API: el único runtime cache es la variante sin SIMD", () => {
    expect(workbox.runtimeCaching).toHaveLength(1);
    const [rule] = workbox.runtimeCaching;
    expect(rule.urlPattern.test("http://localhost:5175/mediapipe/wasm/vision_wasm_nosimd_internal.wasm")).toBe(true);
    for (const url of [
      "http://localhost:4002/api/time-entries/clock/status",
      "https://api-test.example.com/api/time-entries/clock/photo-punch",
      "https://api-test.example.com/api/clock/device/register",
      "https://api-test.example.com/api/clock/device/status",
      "https://api-test.example.com/api/clock/device/pairing-code/refresh",
      "http://localhost:5175/mediapipe/wasm/vision_wasm_internal.wasm",
    ]) expect(rule.urlPattern.test(url)).toBe(false);
  });

  it("navegación offline: cualquier ruta cae en index.html (el fichador muestra su 404)", () => {
    expect(workbox.navigateFallback).toBe("index.html");
    expect(workbox.navigateFallbackDenylist.some((pattern) => pattern.test("/mediapipe/wasm/vision_wasm_internal.wasm"))).toBe(true);
  });

  it("sin skipWaiting automático ni SW en dev: la actualización la decide el kiosco cuando está ocioso", () => {
    expect(workbox.skipWaiting).toBe(false);
    expect(pwaOptions.registerType).toBe("prompt");
    expect(pwaOptions.injectRegister).toBe(false);
    expect(pwaOptions.devOptions.enabled).toBe(false);
  });
});

describe("MediaPipe self-hosted", () => {
  it("FaceCaptureModal usa las rutas del mismo origin que sirve/emite el plugin", () => {
    const modal = readFileSync(file("../src/components/time-clock/FaceCaptureModal.tsx"), "utf8");
    expect(modal).toContain(`const WASM_URL = "${MEDIAPIPE_WASM_PATH}";`);
    expect(modal).toContain(`const MODEL_URL = "${MEDIAPIPE_MODEL_PATH}";`);
    expect(modal).not.toMatch(/jsdelivr|googleapis/);
  });

  it("el modelo versionado es exactamente el publicado por MediaPipe (SHA-256)", () => {
    const hash = createHash("sha256").update(readFileSync(file(`../public${MEDIAPIPE_MODEL_PATH}`))).digest("hex");
    expect(hash).toBe(MODEL_SHA256);
  });
});
