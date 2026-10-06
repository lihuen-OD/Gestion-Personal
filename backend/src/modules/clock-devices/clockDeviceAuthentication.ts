import type { ClockDeviceStatus } from "@prisma/client";
import type { Request, RequestHandler } from "express";
import { AppError } from "../../shared/errors/AppError";
import { hashClockDeviceSecret, verifyClockDeviceSecret } from "../../shared/security/clockDeviceCredentials";
import { clockDevicesRepository } from "./clockDevices.repository";

// Único formato de credencial de dispositivo (F5/F6):
//   Authorization: ClockDevice <uuid>.<secret base64url de 32 bytes>
// No existe otro header ni un secreto compartido: cada request del fichador
// se autentica contra su propio ClockDevice.
const CREDENTIAL_PATTERN = /^ClockDevice ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i;
const DUMMY_HASH = hashClockDeviceSecret("invalid-clock-device-credential");
const PRESENCE_THROTTLE_MS = 60_000;
const APP_VERSION_PATTERN = /^[0-9A-Za-z.+_-]{1,40}$/;

export const ALL_CLOCK_DEVICE_STATUSES: readonly ClockDeviceStatus[] = ["PENDING", "ACTIVE", "REVOKED"];

/** Lo único que el resto del backend ve del dispositivo: nunca tokenHash ni pairingCodeHash. */
export type ClockDeviceContext = { id: string; status: ClockDeviceStatus; name: string | null; sectorId: string | null };

/**
 * Metadata informativa de conexión. IP y user-agent salen de la request (la
 * IP efectiva respeta TRUST_PROXY_HOPS); la versión de app es sólo un dato
 * para el panel de RRHH, nunca participa de la autenticación.
 */
export function clockDeviceRequestMetadata(req: Request) {
  const appVersion = req.get("x-clock-app-version")?.trim();
  return {
    ip: req.ip || null,
    userAgent: req.get("user-agent")?.slice(0, 600) || null,
    appVersion: appVersion && APP_VERSION_PATTERN.test(appVersion) ? appVersion : undefined,
  };
}

function invalidCredential() {
  return new AppError("Invalid device credentials", 401, "CLOCK_DEVICE_INVALID_CREDENTIAL");
}

function statusError(status: ClockDeviceStatus) {
  return status === "REVOKED"
    ? new AppError("Este dispositivo fue deshabilitado por RRHH.", 403, "CLOCK_DEVICE_REVOKED")
    : new AppError("Este dispositivo todavía no fue aprobado por RRHH.", 403, "CLOCK_DEVICE_NOT_ACTIVE");
}

/**
 * Autentica un ClockDevice individual y aplica la política de estado.
 *
 * - Credencial ausente, mal formada, id inexistente o secreto incorrecto →
 *   el mismo 401 CLOCK_DEVICE_INVALID_CREDENTIAL (nunca dice qué parte falló).
 *   Un id bien formado siempre hace el lookup y la comparación SHA-256 con
 *   timingSafeEqual, exista o no, para no distinguir por tiempo.
 * - Credencial válida con estado no permitido → 403 CLOCK_DEVICE_REVOKED o
 *   CLOCK_DEVICE_NOT_ACTIVE.
 * - Por defecto sólo ACTIVE: las rutas de enrolamiento declaran explícitamente
 *   que aceptan PENDING/REVOKED.
 * - `recordPresence` actualiza lastSeenAt/IP/UA/versión como máximo una vez
 *   por minuto por dispositivo, sin bloquear la respuesta.
 */
export function requireClockDevice(options: { allow?: readonly ClockDeviceStatus[]; recordPresence?: boolean } = {}): RequestHandler {
  const allowed = new Set(options.allow ?? ["ACTIVE"]);
  return async (req, _res, next) => {
    try {
      const match = CREDENTIAL_PATTERN.exec(req.get("authorization") || "");
      if (!match) throw invalidCredential();
      const [, id, secret] = match;
      const credential = await clockDevicesRepository.findCredentialById(id!.toLowerCase());
      const valid = verifyClockDeviceSecret(secret!, credential?.tokenHash || DUMMY_HASH);
      if (!credential || !valid) throw invalidCredential();
      if (!allowed.has(credential.status)) throw statusError(credential.status);

      req.clockDevice = { id: credential.id, status: credential.status, name: credential.name, sectorId: credential.sectorId };
      if (options.recordPresence && credential.status === "ACTIVE" && (!credential.lastSeenAt || Date.now() - credential.lastSeenAt.getTime() >= PRESENCE_THROTTLE_MS)) {
        void clockDevicesRepository
          .touchIfStale(credential.id, new Date(Date.now() - PRESENCE_THROTTLE_MS), clockDeviceRequestMetadata(req))
          .catch((error: unknown) => console.error("CLOCK_DEVICE_PRESENCE_UPDATE_FAILED", { deviceId: credential.id, error: error instanceof Error ? error.message : String(error) }));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Para controllers detrás de requireClockDevice: falla cerrado si la ruta quedó mal montada. */
export function authenticatedClockDevice(req: Request): ClockDeviceContext {
  if (!req.clockDevice) throw invalidCredential();
  return req.clockDevice;
}
