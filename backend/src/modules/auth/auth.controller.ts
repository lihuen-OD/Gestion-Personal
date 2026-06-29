import type { RequestHandler } from "express";
import { authService } from "./auth.service";

export const authController = {
  login: (async (req, res) => {
    const result = await authService.login(req.body);
    res.json(result);
  }) satisfies RequestHandler,

  refresh: (async (req, res) => {
    const result = await authService.refresh(req.body);
    res.json(result);
  }) satisfies RequestHandler,

  me: (async (req, res) => {
    res.json({ data: req.user });
  }) satisfies RequestHandler,
};
