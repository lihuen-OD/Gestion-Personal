import { describe, expect, it } from "vitest";
import { updateClockDeviceSchema } from "./clockDevices.schemas";

const EST = "11111111-1111-4111-8111-111111111111";

describe("F9 — PATCH /clock-devices/:id sólo acepta nombre y establecimiento", () => {
  it("recorta el nombre y acepta establecimiento o 'sin establecimiento' (null)", () => {
    expect(updateClockDeviceSchema.parse({ name: "  Pañol principal  " })).toEqual({ name: "Pañol principal" });
    expect(updateClockDeviceSchema.parse({ establishmentId: EST })).toEqual({ establishmentId: EST });
    expect(updateClockDeviceSchema.parse({ establishmentId: null })).toEqual({ establishmentId: null });
  });

  it.each([
    ["vacío", { name: "" }],
    ["sólo espacios", { name: "   " }],
    ["de un carácter", { name: "A" }],
    ["demasiado largo", { name: "x".repeat(121) }],
    ["establecimiento que no es un id", { establishmentId: "planta-norte" }],
    ["sin ningún cambio", {}],
  ])("rechaza nombre o pedido inválido: %s", (_label, body) => {
    expect(updateClockDeviceSchema.safeParse(body).success).toBe(false);
  });

  it.each(["status", "tokenHash", "pairingCodeHash", "secret", "activatedAt", "revokedAt", "lastSeenAt", "lastIp", "lastAppVersion", "id"])(
    "rechaza (no ignora) el intento de asignar %s",
    (field) => {
      expect(updateClockDeviceSchema.safeParse({ name: "Pañol", [field]: "x" }).success).toBe(false);
    },
  );
});
