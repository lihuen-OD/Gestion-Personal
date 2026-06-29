import type { RequestHandler } from "express";
import type { ZodSchema } from "zod";
import { AppError } from "../errors/AppError";

export function validateQuery<T>(schema: ZodSchema<T>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return next(new AppError("Invalid query parameters", 400, "VALIDATION_ERROR", result.error.flatten()));
    }
    req.query = result.data as typeof req.query;
    return next();
  };
}
