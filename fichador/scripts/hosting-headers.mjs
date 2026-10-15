// Fichador standalone (F2, docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §20).
// Genera dist/_headers (formato Netlify / Cloudflare Pages) al final del
// build. Se genera en vez de versionarse fijo porque la CSP necesita el
// origin del backend de cada entorno (VITE_API_URL), igual que el bundle.
import { loadEnv } from "vite";

// F3: MediaPipe (WASM + modelo) e Inter son self-hosted, así que la CSP ya
// no tiene ningún origin de terceros: sólo 'self' y el backend del entorno.

export function apiOrigin(apiUrl) {
  return new URL(apiUrl).origin;
}

/**
 * La URL del API que ve el bundle (`import.meta.env.VITE_API_URL`): .env del
 * modo más process.env, con el mismo default que src/services/api/apiClient.ts.
 * F11: con la CSP enforced, un connect-src distinto del API del bundle
 * bloquearía todas las llamadas, así que el header sale de la misma fuente.
 */
export function buildApiUrl(mode, root) {
  return loadEnv(mode, root, "VITE_").VITE_API_URL || "http://localhost:4002/api";
}

/**
 * CSP del fichador. Sin 'unsafe-inline' ni 'unsafe-eval': el bundle de Vite
 * no tiene scripts ni estilos inline (React aplica `style` vía CSSOM, que CSP
 * no bloquea) y el loader de MediaPipe no usa eval/new Function.
 * 'wasm-unsafe-eval' es lo mínimo que exige compilar el WASM de MediaPipe.
 * worker-src/manifest-src 'self': service worker y manifest de la PWA (F3).
 */
export function contentSecurityPolicy(apiUrl) {
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    `connect-src 'self' ${apiOrigin(apiUrl)}`,
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: mediastream:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Headers de seguridad de todo el sitio. Los usan el `_headers` del hosting y
 * `vite preview` (vite.config.ts), así el build local y la PWA E2E corren con
 * la misma política que el deploy.
 *
 * F11 (plan §30): la CSP pasa de Report-Only a enforced. Se validó contra el
 * build real en Chromium (la PWA, el service worker y MediaPipe cargan sin
 * violaciones, e2e/csp.pwa.ts); la verificación en Safari/iPad queda en la
 * checklist del piloto (F12).
 */
export function securityHeaders(apiUrl) {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Strict-Transport-Security": "max-age=31536000",
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
    "Content-Security-Policy": contentSecurityPolicy(apiUrl),
  };
}

export function hostingHeaders(apiUrl) {
  const security = Object.entries(securityHeaders(apiUrl)).map(([name, value]) => `  ${name}: ${value}`).join("\n");
  return `# Generado por fichador/scripts/hosting-headers.mjs — no editar a mano.
/*
${security}

# Assets con hash de Vite: nunca cambian de contenido para la misma URL.
/assets/*
  Cache-Control: public, max-age=31536000, immutable

# El documento siempre se revalida: una tablet nunca queda con un index viejo
# apuntando a assets que ya no existen.
/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache

# PWA (F3): el navegador tiene que ver siempre el service worker y el
# manifest actuales para detectar una versión nueva. MediaPipe no lleva hash
# en el nombre: lo versiona el precache del service worker.
/sw.js
  Cache-Control: no-cache
/manifest.webmanifest
  Cache-Control: no-cache
/mediapipe/*
  Cache-Control: no-cache
`;
}

/**
 * En un build del hosting (Netlify define NETLIFY=true) el fichador no puede
 * salir apuntando a localhost ni por HTTP: fallaría en las tablets sin que
 * nadie lo note hasta usarlo. Desde F6 no hay credencial de build: cada
 * equipo se autentica con su propio ClockDevice.
 */
export function assertDeployEnv(env) {
  if (env.NETLIFY !== "true") return;
  const problems = [];
  if (!env.VITE_API_URL || !env.VITE_API_URL.startsWith("https://")) problems.push("VITE_API_URL debe ser una URL https del backend del entorno");
  if (env.VITE_CLOCK_DEVICE_TOKEN) problems.push("VITE_CLOCK_DEVICE_TOKEN fue retirado en F6: borrarlo del sitio (el fichador ya no usa un token compartido)");
  if (problems.length) throw new Error(`Variables del fichador inválidas para deploy:\n  - ${problems.join("\n  - ")}`);
}
