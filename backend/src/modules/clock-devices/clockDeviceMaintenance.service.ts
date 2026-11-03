import { AppError } from "../../shared/errors/AppError";
import { generateMaintenanceCode, generateMaintenanceSessionToken, hashClockDeviceSecret, maintenanceCodeHash } from "../../shared/security/clockDeviceCredentials";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import type { ClockDeviceContext } from "./clockDeviceAuthentication";
import { withConnectivity } from "./clockDeviceConnectivity";
import { clockDevicesRepository } from "./clockDevices.repository";

/**
 * Acceso de mantenimiento del fichador (docs/decisions/FICHADOR_MAINTENANCE_MODE.md).
 *
 * RRHH genera un código temporal para un ClockDevice ACTIVE; el fichador lo
 * canjea, autenticado con su propia credencial, por una sesión corta. Nada de
 * esto vive en memoria del proceso: código, intentos y sesión están en la fila
 * del dispositivo (sólo hashes), así que vale con varias instancias.
 */
export const MAINTENANCE_CODE_TTL_MS = 5 * 60_000;
export const MAINTENANCE_SESSION_TTL_MS = 10 * 60_000;
/** Intentos fallidos que anulan el código vigente (contador en la base). */
export const MAINTENANCE_CODE_MAX_FAILED_ATTEMPTS = 5;
export const MAINTENANCE_SESSION_HEADER = "x-clock-maintenance-session";

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const AUDIT_ENTITY = "ClockDeviceMaintenance";

// Inexistente, vencido, anulado, ya usado o de otro equipo: siempre la misma
// respuesta, para no dar pistas.
function invalidCode() {
  return new AppError("El código no es válido o ya venció.", 401, "CLOCK_MAINTENANCE_CODE_INVALID");
}

function invalidSession() {
  return new AppError("El acceso de mantenimiento venció.", 401, "CLOCK_MAINTENANCE_SESSION_INVALID");
}

function deviceLabel(name: string | null) {
  return name ? `“${name}”` : "sin nombre";
}

function secondsUntil(instant: Date, now: Date) {
  return Math.max(0, Math.ceil((instant.getTime() - now.getTime()) / 1000));
}

function sessionHashOf(token: string | undefined) {
  return token && SESSION_TOKEN_PATTERN.test(token) ? hashClockDeviceSecret(token) : null;
}

export const clockDeviceMaintenanceService = {
  /** RRHH: genera (o reemplaza) el código de un dispositivo ACTIVE. El código no se audita ni se loguea. */
  async issueCode(deviceId: string, audit?: AuditContext) {
    const device = await clockDevicesRepository.findSafeById(deviceId);
    if (!device) throw new AppError("Device not found", 404, "CLOCK_DEVICE_NOT_FOUND");
    const notActive = () => new AppError("Sólo un dispositivo activo puede recibir un acceso de mantenimiento.", 409, "CLOCK_MAINTENANCE_DEVICE_NOT_ACTIVE");
    if (device.status !== "ACTIVE") throw notActive();

    const code = generateMaintenanceCode();
    const expiresAt = new Date(Date.now() + MAINTENANCE_CODE_TTL_MS);
    // Revocado entre la lectura y la escritura: el UPDATE condicionado no guarda nada.
    if (!await clockDevicesRepository.setMaintenanceCode(deviceId, maintenanceCodeHash(deviceId, code), expiresAt)) throw notActive();

    await auditService.register({
      ...audit,
      action: "CREATE",
      entity: AUDIT_ENTITY,
      entityId: deviceId,
      description: `Se generó un código de mantenimiento para el dispositivo de fichada ${deviceLabel(device.name)}. Es de un solo uso y vence en 5 minutos.`,
      after: { expiresAt: expiresAt.toISOString() },
    });
    return { code, expiresAt: expiresAt.toISOString(), expiresInSeconds: MAINTENANCE_CODE_TTL_MS / 1000 };
  },

  /** Fichador: canjea el código por una sesión de mantenimiento de este mismo dispositivo. */
  async openSession(device: ClockDeviceContext, code: string, audit?: AuditContext) {
    const now = new Date();
    const token = generateMaintenanceSessionToken();
    const expiresAt = new Date(now.getTime() + MAINTENANCE_SESSION_TTL_MS);
    const opened = await clockDevicesRepository.consumeMaintenanceCode(
      device.id,
      maintenanceCodeHash(device.id, code),
      { hash: hashClockDeviceSecret(token), expiresAt },
      now,
      MAINTENANCE_CODE_MAX_FAILED_ATTEMPTS,
    );

    if (!opened) {
      const failure = await clockDevicesRepository.registerFailedMaintenanceCode(device.id, now, MAINTENANCE_CODE_MAX_FAILED_ATTEMPTS);
      if (failure) {
        // Sólo se audita contra un código vigente: como mucho
        // MAINTENANCE_CODE_MAX_FAILED_ATTEMPTS filas por código generado.
        await auditService.register({
          ...audit,
          action: "REJECT",
          entity: AUDIT_ENTITY,
          entityId: device.id,
          description: failure.burned
            ? `Se rechazó un código de mantenimiento en el dispositivo de fichada ${deviceLabel(device.name)}. El código quedó anulado por exceso de intentos.`
            : `Se rechazó un código de mantenimiento en el dispositivo de fichada ${deviceLabel(device.name)}.`,
          after: { actorClockDeviceId: device.id, failedAttempts: failure.failedAttempts, codeRevoked: failure.burned },
        });
      } else {
        console.warn("CLOCK_MAINTENANCE_CODE_REJECTED", { deviceId: device.id, reason: "NO_ACTIVE_CODE" });
      }
      throw invalidCode();
    }

    await auditService.register({
      ...audit,
      action: "LOGIN",
      entity: AUDIT_ENTITY,
      entityId: device.id,
      description: `Se ingresó al modo mantenimiento del dispositivo de fichada ${deviceLabel(device.name)} con un código de RRHH.`,
      after: { actorClockDeviceId: device.id, sessionExpiresAt: expiresAt.toISOString() },
    });
    const diagnostics = await clockDevicesRepository.findMaintenanceDiagnostics(device.id);
    if (!diagnostics) throw invalidSession();
    return { token, expiresAt: expiresAt.toISOString(), expiresInSeconds: secondsUntil(expiresAt, now), device: withConnectivity(diagnostics, now) };
  },

  /** Fichador: la sesión sigue vigente → diagnóstico actualizado y segundos restantes. */
  async getSession(device: ClockDeviceContext, token: string | undefined) {
    const hash = sessionHashOf(token);
    if (!hash) throw invalidSession();
    const now = new Date();
    const found = await clockDevicesRepository.findMaintenanceSession(device.id, hash, now);
    if (!found?.maintenanceSessionExpiresAt) throw invalidSession();
    const { maintenanceSessionExpiresAt: expiresAt, ...diagnostics } = found;
    return { expiresAt: expiresAt.toISOString(), expiresInSeconds: secondsUntil(expiresAt, now), device: withConnectivity(diagnostics, now), serverTime: now.toISOString() };
  },

  /** Fichador: salida manual. Idempotente; un token ajeno o viejo no cierra nada. */
  async endSession(device: ClockDeviceContext, token: string | undefined) {
    const hash = sessionHashOf(token);
    if (hash) await clockDevicesRepository.endMaintenanceSession(device.id, hash);
  },
};
