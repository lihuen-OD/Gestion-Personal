import type { RequestHandler } from "express";
import type { RoleName } from "@prisma/client";
import { AppError } from "../shared/errors/AppError";

export function requireAnyRole(allowedRoles: RoleName[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError("Authentication required", 401, "AUTH_REQUIRED"));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError("You do not have permission to perform this action", 403, "FORBIDDEN"));
    }

    return next();
  };
}

export function requireRole(role: RoleName): RequestHandler {
  return requireAnyRole([role]);
}
