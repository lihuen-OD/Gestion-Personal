import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

const PAIRING_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const PAIRING_LENGTH = 8;

export function hashClockDeviceSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function generateClockDeviceSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function generatePairingCode(): string {
  const raw = Array.from({ length: PAIRING_LENGTH }, () => PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function normalizePairingCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function pairingCodeHash(value: string): string {
  return hashClockDeviceSecret(normalizePairingCode(value));
}

// Acceso de mantenimiento (docs/decisions/FICHADOR_MAINTENANCE_MODE.md): código
// numérico corto que RRHH dicta en el equipo y token de sesión de 256 bits.
const MAINTENANCE_CODE_DIGITS = 6;

export function generateMaintenanceCode(): string {
  return String(randomInt(10 ** MAINTENANCE_CODE_DIGITS)).padStart(MAINTENANCE_CODE_DIGITS, "0");
}

/** Ligado al dispositivo: el mismo código en otro equipo da otro hash. */
export function maintenanceCodeHash(deviceId: string, code: string): string {
  return hashClockDeviceSecret(`clock-maintenance:${deviceId}:${code}`);
}

export function generateMaintenanceSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function verifyClockDeviceSecret(secret: string, expectedHexHash: string): boolean {
  const actual = Buffer.from(hashClockDeviceSecret(secret), "hex");
  const expected = Buffer.from(expectedHexHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
