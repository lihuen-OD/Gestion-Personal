import { describe, expect, it, vi } from "vitest";
import type { RequestHandler } from "express";

const { createRateLimiter, loginLimiter, refreshLimiter, requireAuth } = vi.hoisted(() => {
  const loginLimiter: RequestHandler = (_req, _res, next) => next();
  const refreshLimiter: RequestHandler = (_req, _res, next) => next();
  const requireAuth: RequestHandler = (_req, _res, next) => next();
  const createRateLimiter = vi.fn()
    .mockReturnValueOnce(loginLimiter)
    .mockReturnValueOnce(refreshLimiter);
  return { createRateLimiter, loginLimiter, refreshLimiter, requireAuth };
});

vi.mock("../../middlewares/rateLimiter", () => ({ createRateLimiter }));
vi.mock("../../middlewares/auth", () => ({ requireAuth }));
vi.mock("../../shared/validation/validateRequest", () => ({
  validateBody: vi.fn(() => vi.fn()),
}));
vi.mock("./auth.controller", () => ({
  authController: { login: vi.fn(), refresh: vi.fn(), logout: vi.fn(), me: vi.fn() },
}));

import { env } from "../../config/env";
import { authRouter } from "./auth.routes";

describe("auth refresh rate limiter", () => {
  it("configura y monta un limiter propio antes del handler de refresh", () => {
    expect(createRateLimiter).toHaveBeenNthCalledWith(2, {
      windowMs: env.REFRESH_RATE_LIMIT_WINDOW_MS,
      max: env.REFRESH_RATE_LIMIT_MAX,
    });

    const refreshRoute = authRouter.stack.find((layer) => layer.route?.path === "/refresh");
    expect(refreshRoute).toBeDefined();
    expect(refreshRoute?.route?.stack[0]?.handle).toBe(refreshLimiter);
    expect(refreshRoute?.route?.stack.some((layer) => layer.handle === loginLimiter)).toBe(false);
  });

  it("protege logout con autenticación", () => {
    const logoutRoute = authRouter.stack.find((layer) => layer.route?.path === "/logout");

    expect(logoutRoute).toBeDefined();
    expect(logoutRoute?.route?.stack[0]?.handle).toBe(requireAuth);
  });
});
