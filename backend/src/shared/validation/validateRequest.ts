import type { RequestHandler } from "express";
import type { ZodSchema } from "zod";
import { AppError } from "../errors/AppError";

export function validateBody<T>(schema: ZodSchema<T>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(new AppError("Invalid request body", 400, "VALIDATION_ERROR", result.error.flatten()));
    }
    req.body = result.data;
    return next();
  };
}
