import type { Request } from "express";

/**
 * F0 del fichador standalone (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md
 * §F0 / trust proxy). Única fuente del valor de `trust proxy` de Express.
 *
 * Express toma como `req.ip` la dirección que está a `hops` saltos: el
 * socket es el primero y el resto se recorre en X-Forwarded-For de derecha a
 * izquierda. Con el número exacto de proxies propios, lo que un cliente
 * agregue a la IZQUIERDA de X-Forwarded-For nunca llega a ser `req.ip`.
 * Nunca devuelve `true` (confiar en toda la cadena = IP elegida por el
 * cliente); 0 desactiva la confianza y `req.ip` queda en la IP del socket.
 */
export function trustProxySetting(hops: number): number | false {
  return Number.isInteger(hops) && hops > 0 ? hops : false;
}

/**
 * Lo que GET /api/health/client-ip devuelve para medir la topología real de
 * proxies de un entorno. Sólo headers de IP en una lista cerrada: nunca
 * Authorization (JWT ni credencial ClockDevice) ni cookies.
 */
export function describeClientIp(req: Request) {
  const header = (name: string) => req.get(name) ?? null;
  const forwardedFor = header("x-forwarded-for");
  return {
    ip: req.ip ?? null,
    ips: req.ips,
    remoteAddress: req.socket.remoteAddress ?? null,
    trustProxy: req.app.get("trust proxy") as number | boolean,
    xForwardedFor: forwardedFor,
    xForwardedForEntries: forwardedFor ? forwardedFor.split(",").map((entry) => entry.trim()).filter(Boolean).length : 0,
    xRealIp: header("x-real-ip"),
    forwarded: header("forwarded"),
    trueClientIp: header("true-client-ip"),
    cfConnectingIp: header("cf-connecting-ip"),
  };
}
