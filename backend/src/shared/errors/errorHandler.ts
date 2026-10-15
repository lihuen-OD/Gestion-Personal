import type { ErrorRequestHandler } from "express";
import { isProduction } from "../../config/env";
import { auditService } from "../../modules/audit/audit.service";
import { AppError } from "./AppError";
import { bodyParserError } from "./bodyParserErrors";
import { describeRequestPath } from "../audit/technicalIds";

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  // F11: un body demasiado grande o mal formado es un error del cliente (413,
  // 400, 415), no un 500. No se registra: el error de body-parser trae el body
  // crudo (puede ser una foto de fichada o un documento).
  const clientBodyError = bodyParserError(error);
  const appError =
    error instanceof AppError
      ? error
      : clientBodyError ?? new AppError("Unexpected server error", 500, "INTERNAL_ERROR");

  if (!isProduction && !clientBodyError) {
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
      ...(appError.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: appError.retryAfterSeconds }),
      details: isProduction ? undefined : appError.details,
    },
  });
};
