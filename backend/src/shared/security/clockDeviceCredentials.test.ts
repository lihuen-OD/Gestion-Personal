import { describe, expect, it } from "vitest";
import { generateClockDeviceSecret, generatePairingCode, hashClockDeviceSecret, normalizePairingCode, pairingCodeHash, verifyClockDeviceSecret } from "./clockDeviceCredentials";

describe("credenciales individuales del fichador", () => {
  it("genera un secreto de 256 bits y sólo persiste su SHA-256", () => {
    const secret = generateClockDeviceSecret();
    expect(Buffer.from(secret, "base64url")).toHaveLength(32);
    expect(hashClockDeviceSecret(secret)).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyClockDeviceSecret(secret, hashClockDeviceSecret(secret))).toBe(true);
    expect(verifyClockDeviceSecret(`${secret}x`, hashClockDeviceSecret(secret))).toBe(false);
  });

  it("emite códigos de 8 caracteres legibles y normaliza guion/espacios", () => {
    const code = generatePairingCode();
    expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
    expect(normalizePairingCode(` ${code.toLowerCase()} `)).toBe(code.replace("-", ""));
    expect(pairingCodeHash(code)).toBe(pairingCodeHash(code.replace("-", "").toLowerCase()));
  });
});
