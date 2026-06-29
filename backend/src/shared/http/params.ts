import type { Request } from "express";
import { AppError } from "../errors/AppError";

export function requireParam(req: Request, name: string) {
  const value = req.params[name];
  if (!value) throw new AppError(`Missing route parameter: ${name}`, 400, "MISSING_ROUTE_PARAM");
  return value;
}
