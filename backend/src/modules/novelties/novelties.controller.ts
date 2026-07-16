import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import { clearTimeEntriesReadCaches } from "../time-entries/timeEntries.cache";
import { clearNoveltiesReadCaches, noveltiesListCache } from "./novelties.cache";
import type { ListNoveltiesQuery } from "./novelties.schemas";
import { noveltiesService } from "./novelties.service";

function userScopedCacheKey(req: Parameters<RequestHandler>[0]) {
  return `${req.user?.id || "anon"}:${req.user?.role || "none"}:${req.originalUrl}`;
}

export const noveltiesController = {
  list: (async (req, res) => {
    const key = userScopedCacheKey(req);
    const cached = noveltiesListCache.get(key);
    if (cached) return res.json({ data: cached.items, meta: cached.meta });
    const result = await noveltiesService.list(req.query as unknown as ListNoveltiesQuery, req.user!);
    noveltiesListCache.set(key, result);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const items = await noveltiesService.create(req.body, req.user!, requestAuditContext(req));
    clearNoveltiesReadCaches();
    clearTimeEntriesReadCaches();
    res.status(201).json({ data: items });
  }) satisfies RequestHandler,

  approve: (async (req, res) => {
    const item = await noveltiesService.approve(requireParam(req, "id"), req.user!, requestAuditContext(req));
    clearNoveltiesReadCaches();
    clearTimeEntriesReadCaches();
    res.json({ data: item });
  }) satisfies RequestHandler,

  approveMany: (async (req, res) => {
    const items = await noveltiesService.approveMany(req.body.ids, req.user!, requestAuditContext(req));
    clearNoveltiesReadCaches(); clearTimeEntriesReadCaches(); res.json({ data: items });
  }) satisfies RequestHandler,

  reject: (async (req, res) => {
    const item = await noveltiesService.reject(requireParam(req, "id"), req.body, req.user!, requestAuditContext(req));
    clearNoveltiesReadCaches();
    clearTimeEntriesReadCaches();
    res.json({ data: item });
  }) satisfies RequestHandler,
};
