import type { ErrorRequestHandler } from "express";
import { isProduction } from "../../config/env";
import { auditService } from "../../modules/audit/audit.service";
import { AppError } from "./AppError";
import { describeRequestPath } from "../audit/technicalIds";

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const appError =
    error instanceof AppError
      ? error
      : new AppError("Unexpected server error", 500, "INTERNAL_ERROR");

  if (!isProduction) {
    console.error(error);
  }

  if (appError.statusCode === 403) {
    // El usuario ya queda en userId (la UI lo muestra por nombre) y los ids de
    // la ruta se enmascaran: la descripción es texto visible, no un log técnico.
    const actor = req.user ? ` — rol ${req.user.role}` : " — no autenticado";
    void auditService.register({
      userId: req.user?.id ?? null,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? null,
      action: "REJECT",
      entity: "Route",
      description: `Acceso denegado: ${req.method} ${describeRequestPath(req.originalUrl)} (${appError.code})${actor}`,
    });
  }

  res.status(appError.statusCode).json({
    error: {
      code: appError.code,
      message: appError.message,
      details: isProduction ? undefined : appError.details,
    },
  });
};
