// @vitest-environment node
// (F11: importa `vite` para loadEnv, que no corre bajo jsdom.)
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertDeployEnv,
  buildApiUrl,
  contentSecurityPolicy,
  hostingHeaders,
  securityHeaders,
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

  it("F11: ninguna directiva tiene wildcard ni esquemas abiertos; todo cae en 'self' por defecto", () => {
    for (const part of csp.split("; ")) {
      expect(part, part).not.toMatch(/(^|\s)(\*|https?:|wss?:)(\s|$)/);
      expect(part, part).not.toMatch(/\*\./);
    }
    expect(directive(csp, "default-src")).toBe("default-src 'self'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
  });

  it("F3: sin ningún origin de terceros (MediaPipe e Inter son self-hosted); sólo 'self' y el backend", () => {
    const origins = csp.match(/https?:\/\/[^\s;]+/g) || [];
    expect(origins).toEqual(["https://api-test.example.com"]);
    expect(directive(csp, "worker-src")).toContain("'self'");
    expect(directive(csp, "manifest-src")).toBe("manifest-src 'self'");
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

  it("F11: la CSP sale enforced (ya no Report-Only)", () => {
    expect(headers).toContain(`  Content-Security-Policy: ${contentSecurityPolicy("https://api-test.example.com/api")}\n`);
    expect(headers).not.toContain("Report-Only");
  });

  it("es la misma política que sirve `vite preview` (una sola fuente)", () => {
    for (const [name, value] of Object.entries(securityHeaders("https://api-test.example.com/api"))) {
      expect(headers).toContain(`  ${name}: ${value}\n`);
    }
  });

  it("sin directivas de Permissions-Policy obsoletas (interest-cohort hace loguear un error a Chrome)", () => {
    expect(headers).not.toContain("interest-cohort");
  });

  it("service worker, manifest y MediaPipe se revalidan siempre (F3)", () => {
    expect(headers).toMatch(/\/sw\.js\n\s+Cache-Control: no-cache/);
    expect(headers).toMatch(/\/manifest\.webmanifest\n\s+Cache-Control: no-cache/);
    expect(headers).toMatch(/\/mediapipe\/\*\n\s+Cache-Control: no-cache/);
  });

  it("assets con hash cacheados como immutable y el documento siempre revalidado", () => {
    expect(headers).toMatch(/\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
    expect(headers).toMatch(/\n\/\n\s+Cache-Control: no-cache/);
    expect(headers).toMatch(/\/index\.html\n\s+Cache-Control: no-cache/);
  });
});

describe("assertDeployEnv — variables del build en el hosting", () => {
  const valid = { NETLIFY: "true", VITE_API_URL: "https://api-test.example.com/api" };

  it("fuera del hosting no exige nada (build local)", () => {
    expect(() => assertDeployEnv({})).not.toThrow();
  });

  it("acepta un deploy con API https y sin ninguna credencial de build", () => {
    expect(() => assertDeployEnv(valid)).not.toThrow();
  });

  it.each([
    [{ ...valid, VITE_API_URL: undefined }, /VITE_API_URL/],
    [{ ...valid, VITE_API_URL: "http://localhost:4002/api" }, /VITE_API_URL/],
    // F6: un sitio que todavía define el token compartido retirado falla el
    // build, para que el valor viejo no quede olvidado en el hosting.
    [{ ...valid, VITE_CLOCK_DEVICE_TOKEN: "x".repeat(32) }, /VITE_CLOCK_DEVICE_TOKEN fue retirado/],
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

// F11: con la CSP enforced, connect-src tiene que ser el mismo API que ve el
// bundle; si no, todas las llamadas quedarían bloqueadas.
describe("buildApiUrl — el API del header es el del bundle", () => {
  let root;
  afterEach(() => {
    vi.unstubAllEnvs();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("toma VITE_API_URL del .env del modo, como Vite", () => {
    root = mkdtempSync(join(tmpdir(), "fichador-env-"));
    writeFileSync(join(root, ".env.production"), "VITE_API_URL=https://api-env.example.com/api\n");
    const inheritedApiUrl = process.env.VITE_API_URL;
    delete process.env.VITE_API_URL;
    try {
      expect(buildApiUrl("production", root)).toBe("https://api-env.example.com/api");
    } finally {
      if (inheritedApiUrl === undefined) delete process.env.VITE_API_URL;
      else process.env.VITE_API_URL = inheritedApiUrl;
    }
  });

  it("process.env gana sobre el .env (variables del hosting)", () => {
    root = mkdtempSync(join(tmpdir(), "fichador-env-"));
    writeFileSync(join(root, ".env"), "VITE_API_URL=https://api-env.example.com/api\n");
    vi.stubEnv("VITE_API_URL", "https://api-hosting.example.com/api");
    expect(buildApiUrl("production", root)).toBe("https://api-hosting.example.com/api");
  });

  it("sin variable, el mismo default que src/services/api/apiClient.ts", () => {
    root = mkdtempSync(join(tmpdir(), "fichador-env-"));
    vi.stubEnv("VITE_API_URL", "");
    expect(buildApiUrl("production", root)).toBe("http://localhost:4002/api");
  });
});
