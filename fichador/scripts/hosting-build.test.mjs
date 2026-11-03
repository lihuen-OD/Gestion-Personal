// @vitest-environment node
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { build, createServer, preview } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostingHeaders, securityHeaders } from "./hosting-headers.mjs";
import { hostingHeadersPlugin, readPreviewHeaders } from "./write-hosting-headers.mjs";

// setupTests bloquea fetch por defecto. Esta integración sólo consulta sus
// propios servidores efímeros de loopback, nunca el API ni servicios reales.
const fetchLocal = globalThis.fetch;

describe("Vite — bundle y CSP del mismo build", () => {
  let root;
  let dev;
  let previewServer;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "fichador-build-")));
    vi.stubEnv("VITE_API_URL", undefined);
    vi.stubEnv("NETLIFY", undefined);
    writeFileSync(join(root, "index.html"), '<script type="module" src="/entry.js"></script>');
    writeFileSync(join(root, "entry.js"), "document.body.textContent = import.meta.env.VITE_API_URL;");
  });
  afterEach(async () => {
    if (dev) await dev.close();
    if (previewServer) {
      const closed = once(previewServer.httpServer, "close");
      previewServer.httpServer.close();
      previewServer.httpServer.closeAllConnections();
      await closed;
    }
    dev = previewServer = undefined;
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });
  const options = () => ({ root, configFile: false, logLevel: "silent", plugins: [hostingHeadersPlugin()] });

  it.each(["production", "local-test"])("%s: build, _headers y preview coinciden aunque cambie el entorno", async (mode) => {
    const api = "http://localhost:4002/api";
    writeFileSync(join(root, ".env.production"), "VITE_API_URL=https://production.example.com/api\n");
    writeFileSync(join(root, `.env.${mode}`), `VITE_API_URL=${api}\n`);
    const result = await build({ ...options(), mode });
    const chunk = result.output.find((output) => output.type === "chunk" && output.isEntry);
    expect(chunk.code).toContain(api);
    expect(readFileSync(join(root, "dist/_headers"), "utf8")).toBe(hostingHeaders(api));

    // Reproduce el bug: otro entorno al arrancar preview NO debe cambiar CSP.
    vi.stubEnv("VITE_API_URL", "https://preview.example.com/api");
    previewServer = await preview({ ...options(), preview: { host: "127.0.0.1", port: 0 } });
    const { port } = previewServer.httpServer.address();
    const response = await fetchLocal(`http://127.0.0.1:${port}/`);
    for (const [name, value] of Object.entries(securityHeaders(api))) expect(response.headers.get(name)).toBe(value);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).not.toContain("immutable");
  });

  it("dev carga localhost y mantiene el comportamiento existente de HMR sin CSP de hosting", async () => {
    vi.stubEnv("VITE_API_URL", "http://localhost:4002/api");
    dev = await createServer({ ...options(), server: { host: "127.0.0.1", port: 0 } });
    await dev.listen();
    const { port } = dev.httpServer.address();
    const response = await fetchLocal(`http://127.0.0.1:${port}/entry.js`);
    expect(await response.text()).toContain('"VITE_API_URL": "http://localhost:4002/api"');
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  it("Netlify rechaza HTTP antes de escribir el build", async () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("VITE_API_URL", "http://localhost:4002/api");
    await expect(build(options())).rejects.toThrow(/VITE_API_URL/);
  });

  it("Netlify HTTPS sólo permite el backend embebido en el bundle", async () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("VITE_API_URL", "https://backend.example.com/api");
    const result = await build(options());
    expect(result.output.find((output) => output.type === "chunk").code).toContain("https://backend.example.com/api");
    expect(readPreviewHeaders(join(root, "dist"))).toEqual(securityHeaders("https://backend.example.com/api"));
  });

  it("preview falla cerrado si no hay headers o falta la CSP", () => {
    expect(() => readPreviewHeaders(root)).toThrow(/npm run build/);
    writeFileSync(join(root, "_headers"), "/*\n  X-Frame-Options: DENY\n");
    expect(() => readPreviewHeaders(root)).toThrow(/no contiene CSP/);
  });
});
