import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { createRateLimiter } from "../../middlewares/rateLimiter";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { env } from "../../config/env";
import { validateBody } from "../../shared/validation/validateRequest";
import { authController } from "./auth.controller";
import { loginSchema, refreshTokenSchema } from "./auth.schemas";

export const authRouter = Router();

const loginRateLimiter = createRateLimiter({
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
  max: env.LOGIN_RATE_LIMIT_MAX,
});
const refreshRateLimiter = createRateLimiter({
  windowMs: env.REFRESH_RATE_LIMIT_WINDOW_MS,
  max: env.REFRESH_RATE_LIMIT_MAX,
});

authRouter.post(
  "/login",
  loginRateLimiter,
  validateBody(loginSchema),
  asyncHandler(authController.login),
);

authRouter.post(
  "/refresh",
  refreshRateLimiter,
  validateBody(refreshTokenSchema),
  asyncHandler(authController.refresh),
);

authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler(authController.logout),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(authController.me),
);
