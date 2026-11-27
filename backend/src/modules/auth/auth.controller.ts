import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { authService } from "./auth.service";
import { requestShiftGroupScope, toShiftGroupAccess } from "../shifts/shiftGroupAccess";

export const authController = {
  login: (async (req, res) => {
    const result = await authService.login(req.body, requestAuditContext(req));
    res.json(result);
  }) satisfies RequestHandler,

  refresh: (async (req, res) => {
    const result = await authService.refresh(req.body);
    res.json(result);
  }) satisfies RequestHandler,

  logout: (async (req, res) => {
    const result = await authService.logout(req.user!.id, requestAuditContext(req));
    res.json(result);
  }) satisfies RequestHandler,

  // R8.4: agrega el alcance por grupo de turnos, resuelto en esta request (no
  // se cachea con el usuario: una revocación se ve en la siguiente llamada).
  me: (async (req, res) => {
    res.json({ data: { ...req.user, shiftGroupAccess: toShiftGroupAccess(await requestShiftGroupScope(req)) } });
  }) satisfies RequestHandler,
};
