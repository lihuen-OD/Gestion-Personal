import { describe, expect, it } from "vitest";
import { CLOCK_PUNCH_COOLDOWN_MESSAGE, clockPunchCooldownError, clockPunchCooldownGuard } from "./clockPunchCooldown";

const NOW = new Date("2026-10-13T16:00:00.000Z");
const at = (secondsFromNow: number) => new Date(NOW.getTime() + secondsFromNow * 1000);

describe("clockPunchCooldownGuard", () => {
  it("la ventana empieza `seconds` antes de la hora del servidor", () => {
    expect(clockPunchCooldownGuard(NOW, 60)).toEqual({ windowStart: at(-60) });
  });

  it("0 desactiva el cooldown", () => {
    expect(clockPunchCooldownGuard(NOW, 0)).toBeUndefined();
  });
});

describe("clockPunchCooldownError", () => {
  it("409 CLOCK_PUNCH_COOLDOWN con lo que falta para salir de la ventana", () => {
    expect(clockPunchCooldownError(at(-10), NOW, 60)).toMatchObject({ statusCode: 409, code: "CLOCK_PUNCH_COOLDOWN", retryAfterSeconds: 50, message: CLOCK_PUNCH_COOLDOWN_MESSAGE });
  });

  it("redondea hacia arriba (nunca invita a reintentar antes de tiempo)", () => {
    expect(clockPunchCooldownError(new Date(NOW.getTime() - 10_500), NOW, 60).retryAfterSeconds).toBe(50);
  });

  it("la fichada ganadora de una carrera puede tener hora posterior a `now`: se acota a la ventana", () => {
    expect(clockPunchCooldownError(at(2), NOW, 60).retryAfterSeconds).toBe(60);
  });

  it("al borde de la ventana nunca responde 0", () => {
    expect(clockPunchCooldownError(at(-59.999), NOW, 60).retryAfterSeconds).toBe(1);
  });

  it("sin fichada conocida (otro intento tiene el lock) espera la ventana completa", () => {
    expect(clockPunchCooldownError(null, NOW, 45).retryAfterSeconds).toBe(45);
  });

  it("el mensaje es humano y sin datos internos (sin horas, ids ni segundos)", () => {
    expect(CLOCK_PUNCH_COOLDOWN_MESSAGE).not.toMatch(/\d|[0-9a-f]{8}-/i);
  });
});
