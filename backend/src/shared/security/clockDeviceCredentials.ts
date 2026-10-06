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

export function verifyClockDeviceSecret(secret: string, expectedHexHash: string): boolean {
  const actual = Buffer.from(hashClockDeviceSecret(secret), "hex");
  const expected = Buffer.from(expectedHexHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
