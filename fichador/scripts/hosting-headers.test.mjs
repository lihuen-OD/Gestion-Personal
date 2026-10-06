import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MEDIAPIPE_MODEL_BASE,
  MEDIAPIPE_WASM_BASE,
  assertDeployEnv,
  contentSecurityPolicy,
  hostingHeaders,
} from "./hosting-headers.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const directive = (csp, name) => csp.split("; ").find((part) => part.startsWith(`${name} `)) || "";

// F2 — configuración de hosting del fichador standalone.
describe("CSP del fichador", () => {
  const csp = contentSecurityPolicy("https://api-test.example.com/api");

  it("no usa 'unsafe-inline' ni 'unsafe-eval'; sólo 'wasm-unsafe-eval' para el WASM de MediaPipe", () => {
    expect(csp).not.toMatch(/'unsafe-inline'|'unsafe-eval'/);
    expect(directive(csp, "script-src")).toContain("'wasm-unsafe-eval'");
  });

  it("connect-src permite sólo el origin del backend del entorno, sin wildcard", () => {
    const sources = directive(csp, "connect-src").split(" ").slice(1);
    expect(sources).toContain("https://api-test.example.com");
    expect(sources).not.toContain("https://api-test.example.com/api");
    expect(sources.some((source) => source.includes("*") || source === "https:")).toBe(false);
  });

  it("no deja embeber el fichador en otro sitio", () => {
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
  });

  it("las URLs de MediaPipe de la CSP coinciden con las que usa FaceCaptureModal", () => {
    const modal = read("../src/components/time-clock/FaceCaptureModal.tsx");
    const wasmUrl = modal.match(/const WASM_URL = "([^"]+)"/)[1];
    const modelUrl = modal.match(/const MODEL_URL = "([^"]+)"/)[1];
    expect(`${wasmUrl}/`).toBe(MEDIAPIPE_WASM_BASE);
    expect(modelUrl.startsWith(MEDIAPIPE_MODEL_BASE)).toBe(true);
    const installed = JSON.parse(read("../node_modules/@mediapipe/tasks-vision/package.json")).version;
    expect(MEDIAPIPE_WASM_BASE).toContain(`@mediapipe/tasks-vision@${installed}/`);
  });
});

describe("_headers generado", () => {
  const headers = hostingHeaders("https://api-test.example.com/api");

  it("incluye los headers de seguridad y la cámara sólo para el propio origin", () => {
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).toContain("Referrer-Policy: strict-origin-when-cross-origin");
    expect(headers).toContain("X-Frame-Options: DENY");
    expect(headers).toMatch(/Permissions-Policy: camera=\(self\), microphone=\(\)/);
  });

  it("la CSP sale en modo Report-Only hasta validarla en Safari/iPad sobre HTTPS", () => {
    expect(headers).toContain("Content-Security-Policy-Report-Only: ");
    expect(headers).not.toMatch(/^\s+Content-Security-Policy: /m);
  });

  it("assets con hash cacheados como immutable y el documento siempre revalidado", () => {
    expect(headers).toMatch(/\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
    expect(headers).toMatch(/\n\/\n\s+Cache-Control: no-cache/);
    expect(headers).toMatch(/\/index\.html\n\s+Cache-Control: no-cache/);
  });
});

describe("assertDeployEnv — variables del build en el hosting", () => {
  const valid = { NETLIFY: "true", VITE_API_URL: "https://api-test.example.com/api", VITE_CLOCK_DEVICE_TOKEN: "x".repeat(32) };

  it("fuera del hosting no exige nada (build local)", () => {
    expect(() => assertDeployEnv({})).not.toThrow();
  });

  it("acepta un deploy con API https y token", () => {
    expect(() => assertDeployEnv(valid)).not.toThrow();
  });

  it.each([
    [{ ...valid, VITE_API_URL: undefined }, /VITE_API_URL/],
    [{ ...valid, VITE_API_URL: "http://localhost:4002/api" }, /VITE_API_URL/],
    [{ ...valid, VITE_CLOCK_DEVICE_TOKEN: "" }, /VITE_CLOCK_DEVICE_TOKEN/],
  ])("rechaza un deploy mal configurado (%#)", (env, message) => {
    expect(() => assertDeployEnv(env)).toThrow(message);
  });
});

describe("netlify.toml del fichador", () => {
  const toml = read("../netlify.toml");

  it("buildea y publica sólo fichador/ (paths relativos al base directory)", () => {
    expect(toml).toMatch(/command = "npm run build"/);
    expect(toml).toMatch(/publish = "dist"/);
    expect(toml).not.toMatch(/frontend|\.\.\//);
  });

  it("usa la misma versión mayor de Node que CI", () => {
    const ci = read("../../.github/workflows/ci.yml");
    const ciVersions = [...ci.matchAll(/node-version: (\d+)/g)].map((match) => match[1]);
    expect(new Set(ciVersions).size).toBe(1);
    expect(toml).toContain(`NODE_VERSION = "${ciVersions[0]}"`);
  });

  it("SPA fallback a index.html (status 200, no redirect a otro sitio)", () => {
    expect(toml).toMatch(/\[\[redirects\]\]\s+from = "\/\*"\s+to = "\/index\.html"\s+status = 200/);
  });

  it("deploy previews y branch deploys desactivados mientras exista el token compartido", () => {
    expect(toml).toMatch(/\[context\.deploy-preview\]\s+ignore = "exit 0"/);
    expect(toml).toMatch(/\[context\.branch-deploy\]\s+ignore = "exit 0"/);
  });
});
