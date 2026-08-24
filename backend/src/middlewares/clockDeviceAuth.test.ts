import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { env } from "../config/env";
import { AppError } from "../shared/errors/AppError";
import { _resetClockDeviceAuthWarningForTests, requireClockDeviceToken } from "./clockDeviceAuth";

// El fichador (/clock/*) no tiene sesion de usuario, asi que en vez de
// requireAuth exige un secreto por dispositivo. Ver clockDeviceAuth.ts.
// `env` es un objeto compartido (singleton de modulo): mutarlo aqui es
// suficiente para que el middleware, que lee env.CLOCK_DEVICE_TOKEN en cada
// llamada (no lo cachea al importar), vea el valor actualizado.

type MutableEnv = { CLOCK_DEVICE_TOKEN?: string; NODE_ENV?: string };

function fakeReq(headerValue?: string): Request {
  return {
    header: (name: string) => (name.toLowerCase() === "x-clock-device-token" ? headerValue : undefined),
  } as unknown as Request;
}

describe("requireClockDeviceToken", () => {
  const originalToken = env.CLOCK_DEVICE_TOKEN;
  const originalNodeEnv = env.NODE_ENV;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    _resetClockDeviceAuthWarningForTests();
  });

  afterEach(() => {
    (env as MutableEnv).CLOCK_DEVICE_TOKEN = originalToken;
    (env as MutableEnv).NODE_ENV = originalNodeEnv;
    warnSpy.mockRestore();
  });

  it("request sin token/credencial debe ser rechazada cuando hay un secreto configurado", () => {
    (env as MutableEnv).CLOCK_DEVICE_TOKEN = "a-very-real-device-secret-value";

    const next = vi.fn();
    requireClockDeviceToken(fakeReq(undefined), {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0]![0] as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe("CLOCK_DEVICE_UNAUTHORIZED");
  });

  it("request con un token incorrecto debe ser rechazada", () => {
    (env as MutableEnv).CLOCK_DEVICE_TOKEN = "a-very-real-device-secret-value";

    const next = vi.fn();
    requireClockDeviceToken(fakeReq("not-the-right-secret"), {} as Response, next);

    const error = next.mock.calls[0]![0] as AppError;
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe("CLOCK_DEVICE_UNAUTHORIZED");
  });

  it("request con el token correcto debe seguir funcionando (deja pasar sin error)", () => {
    (env as MutableEnv).CLOCK_DEVICE_TOKEN = "a-very-real-device-secret-value";

    const next = vi.fn();
    requireClockDeviceToken(fakeReq("a-very-real-device-secret-value"), {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("un token de longitud distinta tambien se rechaza (no filtra la comparacion por timing)", () => {
    (env as MutableEnv).CLOCK_DEVICE_TOKEN = "a-very-real-device-secret-value";

    const next = vi.fn();
    requireClockDeviceToken(fakeReq("short"), {} as Response, next);

    const error = next.mock.calls[0]![0] as AppError;
    expect(error.statusCode).toBe(401);
  });

  it("si CLOCK_DEVICE_TOKEN no esta configurado fuera de production, deja pasar pero avisa por consola una sola vez (no debe quedar en silencio)", () => {
    (env as MutableEnv).CLOCK_DEVICE_TOKEN = undefined;
    (env as MutableEnv).NODE_ENV = "development";

    const next1 = vi.fn();
    const next2 = vi.fn();
    requireClockDeviceToken(fakeReq(undefined), {} as Response, next1);
    requireClockDeviceToken(fakeReq(undefined), {} as Response, next2);

    expect(next1).toHaveBeenCalledWith();
    expect(next2).toHaveBeenCalledWith();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain("CLOCK_DEVICE_TOKEN no esta configurado");
  });

  it("si CLOCK_DEVICE_TOKEN no esta configurado en production, falla cerrado (rechaza /clock/*) sin dejar pasar la request", () => {
    (env as MutableEnv).CLOCK_DEVICE_TOKEN = undefined;
    (env as MutableEnv).NODE_ENV = "production";

    const next = vi.fn();
    requireClockDeviceToken(fakeReq(undefined), {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0]![0] as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(503);
    expect(error.code).toBe("CLOCK_DEVICE_NOT_CONFIGURED");
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
