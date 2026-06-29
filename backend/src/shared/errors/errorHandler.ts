import type { ErrorRequestHandler } from "express";
import { isProduction } from "../../config/env";
import { AppError } from "./AppError";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const appError =
    error instanceof AppError
      ? error
      : new AppError("Unexpected server error", 500, "INTERNAL_ERROR");

  if (!isProduction) {
    console.error(error);
  }

  res.status(appError.statusCode).json({
    error: {
      code: appError.code,
      message: appError.message,
      details: isProduction ? undefined : appError.details,
    },
  });
};
