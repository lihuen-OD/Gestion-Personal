import crypto from "node:crypto";
import type { RequestHandler } from "express";
import { env } from "../config/env";
import { AppError } from "../shared/errors/AppError";

export const CLOCK_DEVICE_TOKEN_HEADER = "x-clock-device-token";

let warnedUnconfigured = false;

function timingSafeEqual(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compara contra si mismo para no filtrar la longitud real por timing.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Los endpoints /clock/* no tienen sesion de usuario (nadie inicia sesion en
 * el fichador), asi que no pueden usar requireAuth. Este middleware exige en
 * su lugar un secreto por dispositivo (header CLOCK_DEVICE_TOKEN_HEADER).
 *
 * IMPORTANTE: esto es una mitigacion minima viable y temporal, no seguridad
 * final de produccion. El token viaja embebido en el bundle publico del
 * kiosco (VITE_CLOCK_DEVICE_TOKEN en el frontend), asi que no es un secreto
 * fuerte: no reemplaza biometria, VPN/IP allowlist a nivel de infraestructura,
 * ni una eventual app de kiosco separada que consuma la API de legajos/
 * fichadas con su propia autenticacion de dispositivo (decision pendiente,
 * no encarada en esta etapa). Decision de producto: el fichador queda asi
 * para demo/uso interno controlado; ver docs/SECURITY_STANDARDS.md ->
 * "Public clock endpoints (fichador)" para el detalle y los riesgos
 * pendientes antes de un uso de produccion real.
 *
 * Comportamiento si CLOCK_DEVICE_TOKEN no esta configurado:
 * - en production (NODE_ENV=production): falla cerrado, rechaza toda request
 *   a /clock/* en vez de dejar el fichador publico sin ningun control por un
 *   olvido de configuracion.
 * - en cualquier otro entorno (development/test/demo): deja pasar la request
 *   (no rompe un entorno que todavia no lo configuro) pero deja constancia
 *   explicita en el log una sola vez por proceso, para que la ausencia de
 *   proteccion real nunca quede en silencio.
 */
export const requireClockDeviceToken: RequestHandler = (req, _res, next) => {
  const configuredToken = env.CLOCK_DEVICE_TOKEN;

  if (!configuredToken) {
    if (env.NODE_ENV === "production") {
      return next(
        new AppError(
          "Fichador no disponible: falta configurar CLOCK_DEVICE_TOKEN en produccion",
          503,
          "CLOCK_DEVICE_NOT_CONFIGURED",
        ),
      );
    }

    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn(
        "[clockDeviceAuth] CLOCK_DEVICE_TOKEN no esta configurado: /clock/* sigue siendo publico sin control de dispositivo. Configurar antes de produccion.",
      );
    }
    return next();
  }

  const provided = req.header(CLOCK_DEVICE_TOKEN_HEADER);
  if (!provided || !timingSafeEqual(provided, configuredToken)) {
    return next(new AppError("Dispositivo no autorizado para fichar", 401, "CLOCK_DEVICE_UNAUTHORIZED"));
  }

  return next();
};

export function _resetClockDeviceAuthWarningForTests() {
  warnedUnconfigured = false;
}
