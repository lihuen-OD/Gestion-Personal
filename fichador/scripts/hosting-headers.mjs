// Fichador standalone (F2, docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §20).
// Genera dist/_headers (formato Netlify / Cloudflare Pages) al final del
// build. Se genera en vez de versionarse fijo porque la CSP necesita el
// origin del backend de cada entorno (VITE_API_URL), igual que el bundle.

// Recursos externos que el fichador carga hoy en runtime (F1), acotados por
// ruta. F3 los pasa a self-hosted y esta lista se achica.
export const MEDIAPIPE_WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/";
export const MEDIAPIPE_MODEL_BASE = "https://storage.googleapis.com/mediapipe-models/face_detector/";
export const FONT_STYLESHEET_ORIGIN = "https://fonts.googleapis.com";
export const FONT_FILES_ORIGIN = "https://fonts.gstatic.com";

export function apiOrigin(apiUrl) {
  return new URL(apiUrl).origin;
}

/**
 * CSP del fichador. Sin 'unsafe-inline' ni 'unsafe-eval': el bundle de Vite
 * no tiene scripts ni estilos inline (React aplica `style` vía CSSOM, que CSP
 * no bloquea) y el loader de MediaPipe no usa eval/new Function.
 * 'wasm-unsafe-eval' es lo mínimo que exige compilar el WASM de MediaPipe.
 */
export function contentSecurityPolicy(apiUrl) {
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' ${MEDIAPIPE_WASM_BASE}`,
    `connect-src 'self' ${apiOrigin(apiUrl)} ${MEDIAPIPE_WASM_BASE} ${MEDIAPIPE_MODEL_BASE}`,
    `style-src 'self' ${FONT_STYLESHEET_ORIGIN}`,
    `font-src ${FONT_FILES_ORIGIN}`,
    "img-src 'self' data: blob:",
    "media-src 'self' blob: mediastream:",
    "worker-src 'self' blob:",
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
