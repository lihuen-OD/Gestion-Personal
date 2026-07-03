import jwt from "jsonwebtoken";
import type { RequestHandler } from "express";
import { env } from "../config/env";
import { AppError } from "../shared/errors/AppError";
import { authService } from "../modules/auth/auth.service";
import { updateRequestMetricsUser } from "../shared/observability/requestMetrics";

interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError("Missing bearer token", 401, "AUTH_REQUIRED");
    }

    const token = header.slice("Bearer ".length);
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
    const user = await authService.getCurrentUser(payload.sub);
    req.user = user;
    updateRequestMetricsUser(user);
    next();
  } catch (error) {
    next(error instanceof AppError ? error : new AppError("Invalid or expired token", 401, "INVALID_TOKEN"));
  }
};
