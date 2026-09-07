import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import type { ListShiftAlertsQuery } from "./shiftAlert.schemas";
import { shiftAlertService } from "./shiftAlert.service";
import { clearShiftAlertReadCaches, shiftAlertListCache } from "./shiftAlert.cache";

function userScopedCacheKey(req: Parameters<RequestHandler>[0]) {
  return `${req.user?.id || "anon"}:${req.user?.role || "none"}:${req.originalUrl}`;
}

export const shiftAlertController = {
  list: (async (req, res) => {
    const key = userScopedCacheKey(req);
    const cached = shiftAlertListCache.get(key);
    if (cached) return res.json({ data: cached.items, meta: cached.meta });
    const result = await shiftAlertService.list(req.query as unknown as ListShiftAlertsQuery, req.user!);
    shiftAlertListCache.set(key, result);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  resolve: (async (req, res) => {
    const item = await shiftAlertService.resolve(requireParam(req, "id"), req.body, req.user!, requestAuditContext(req));
    clearShiftAlertReadCaches();
    res.json({ data: item });
  }) satisfies RequestHandler,
};
