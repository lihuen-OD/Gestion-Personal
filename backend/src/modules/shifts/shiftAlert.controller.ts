import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import type { ListShiftAlertsQuery } from "./shiftAlert.schemas";
import { shiftAlertService } from "./shiftAlert.service";

export const shiftAlertController = {
  list: (async (req, res) => {
    const result = await shiftAlertService.list(req.query as unknown as ListShiftAlertsQuery, req.user!);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  resolve: (async (req, res) => {
    const item = await shiftAlertService.resolve(requireParam(req, "id"), req.body, req.user!, requestAuditContext(req));
    res.json({ data: item });
  }) satisfies RequestHandler,
};
