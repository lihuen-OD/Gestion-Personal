import { describe, expect, it } from "vitest";
import { CLOCK_DEVICE_ONLINE_WINDOW_MS, clockDeviceConnectivity, withConnectivity } from "./clockDeviceConnectivity";

const NOW = new Date("2026-10-14T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("F9 — conectividad derivada de lastSeenAt", () => {
  it("la ventana tolera un heartbeat perdido (la PWA manda uno por minuto)", () => {
    expect(CLOCK_DEVICE_ONLINE_WINDOW_MS).toBeGreaterThan(2 * 60_000);
  });

  it.each([
    ["contacto recién", 0, "ONLINE"],
    ["un heartbeat perdido (130 s)", 130_000, "ONLINE"],
    ["justo en el límite", CLOCK_DEVICE_ONLINE_WINDOW_MS, "ONLINE"],
    ["un instante después del límite", CLOCK_DEVICE_ONLINE_WINDOW_MS + 1, "OFFLINE"],
    ["horas sin contacto", 3 * 60 * 60_000, "OFFLINE"],
  ] as const)("ACTIVE con %s → %s", (_label, elapsed, expected) => {
    expect(clockDeviceConnectivity({ status: "ACTIVE", lastSeenAt: ago(elapsed) }, NOW)).toBe(expected);
  });

  it("ACTIVE sin ningún contacto registrado → NEVER_SEEN (nunca 'sin conexión hace 0 min')", () => {
    expect(clockDeviceConnectivity({ status: "ACTIVE", lastSeenAt: null }, NOW)).toBe("NEVER_SEEN");
  });

  it.each(["PENDING", "REVOKED"] as const)("%s no tiene conectividad, aunque haya consultado su estado hace segundos", (status) => {
    expect(clockDeviceConnectivity({ status, lastSeenAt: ago(1_000) }, NOW)).toBeNull();
    expect(clockDeviceConnectivity({ status, lastSeenAt: null }, NOW)).toBeNull();
  });

  it("withConnectivity agrega el dato derivado sin modificar el resto", () => {
    const device = { id: "d1", name: "Pañol", status: "ACTIVE" as const, lastSeenAt: ago(10_000) };
    expect(withConnectivity(device, NOW)).toEqual({ ...device, connectivity: "ONLINE" });
  });
});
