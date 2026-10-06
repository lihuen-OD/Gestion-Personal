// Fichador standalone (F2, docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §20).
// Genera dist/_headers (formato Netlify / Cloudflare Pages) al final del
// build. Se genera en vez de versionarse fijo porque la CSP necesita el
// origin del backend de cada entorno (VITE_API_URL), igual que el bundle.

// F3: MediaPipe (WASM + modelo) e Inter son self-hosted, así que la CSP ya
// no tiene ningún origin de terceros: sólo 'self' y el backend del entorno.

export function apiOrigin(apiUrl) {
  return new URL(apiUrl).origin;
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

export function hostingHeaders(apiUrl) {
  return `# Generado por fichador/scripts/hosting-headers.mjs — no editar a mano.
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Strict-Transport-Security: max-age=31536000
  Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
  Content-Security-Policy-Report-Only: ${contentSecurityPolicy(apiUrl)}

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
 * salir apuntando a localhost, por HTTP ni sin el token: fallaría en las
 * tablets sin que nadie lo note hasta usarlo.
 */
export function assertDeployEnv(env) {
  if (env.NETLIFY !== "true") return;
  const problems = [];
  if (!env.VITE_API_URL || !env.VITE_API_URL.startsWith("https://")) problems.push("VITE_API_URL debe ser una URL https del backend del entorno");
  if (!env.VITE_CLOCK_DEVICE_TOKEN || env.VITE_CLOCK_DEVICE_TOKEN.length < 16) problems.push("VITE_CLOCK_DEVICE_TOKEN debe estar definido (mínimo 16 caracteres, igual que CLOCK_DEVICE_TOKEN del backend)");
  if (problems.length) throw new Error(`Variables del fichador inválidas para deploy:\n  - ${problems.join("\n  - ")}`);
}
