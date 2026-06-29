import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { validateBody } from "../../shared/validation/validateRequest";
import { authController } from "./auth.controller";
import { loginSchema, refreshTokenSchema } from "./auth.schemas";

export const authRouter = Router();

authRouter.post(
  "/login",
  validateBody(loginSchema),
  asyncHandler(authController.login),
);

authRouter.post(
  "/refresh",
  validateBody(refreshTokenSchema),
  asyncHandler(authController.refresh),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(authController.me),
);
