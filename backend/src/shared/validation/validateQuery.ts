import type { RequestHandler } from "express";
import type { ZodType, ZodTypeDef } from "zod";
import { AppError } from "../errors/AppError";

// Input `unknown`: el query string crudo puede diferir del tipo validado
// (defaults, coerce, transform — ej. un cursor que se parsea a objeto).
export function validateQuery<T>(schema: ZodType<T, ZodTypeDef, unknown>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return next(new AppError("Invalid query parameters", 400, "VALIDATION_ERROR", result.error.flatten()));
    }
    req.query = result.data as typeof req.query;
    return next();
  };
}
