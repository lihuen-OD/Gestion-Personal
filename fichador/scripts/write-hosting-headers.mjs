// Los headers son parte del build de Vite: comparten modo y entorno con el
// bundle. Preview sirve ese artefacto, aunque cambie el .env.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertDeployEnv, buildApiUrl, hostingHeaders } from "./hosting-headers.mjs";

export function readPreviewHeaders(outDir) {
  let contents;
  try {
    contents = readFileSync(resolve(outDir, "_headers"), "utf8");
  } catch {
    throw new Error("Faltan los headers del build del fichador. Ejecutá npm run build antes de npm run preview.");
  }
  // Sólo el bloque global generado; las reglas de caché por ruta no son
  // headers globales. No recalcular una CSP si el artefacto está incompleto.
  const globalBlock = contents.match(/^\/\*\r?\n((?:[ \t]+[^\r\n]+\r?\n)+)/m)?.[1] || "";
  const headers = Object.fromEntries([...globalBlock.matchAll(/^[ \t]+([^:\r\n]+):[ \t]*(.+)$/gm)]
    .map(([, name, value]) => [name, value.trim()]));
  if (!headers["Content-Security-Policy"]) {
    throw new Error("El build del fichador no contiene CSP. Volvé a ejecutar npm run build.");
  }
  return headers;
}

/** @returns {import('vite').Plugin} */
export function hostingHeadersPlugin() {
  let headers;
  return {
    name: "fichador-hosting-headers",
    configResolved(config) {
      if (config.command !== "build") return;
      // Validar antes de generar assets y también con `vite build --mode …`.
      assertDeployEnv({ ...process.env, ...config.env });
      headers = hostingHeaders(buildApiUrl(config.mode, config.envDir, config.env));
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "_headers", source: headers });
    },
    configurePreviewServer(server) {
      const headers = readPreviewHeaders(resolve(server.config.root, server.config.build.outDir));
      server.middlewares.use((_request, response, next) => {
        for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
        next();
      });
    },
  };
}
